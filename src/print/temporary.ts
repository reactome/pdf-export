// A process's private temporary folder (spec 001 T029): `book` and
// `serve` make one at their start and point everything they start at it, by TMPDIR, which
// Node's os.tmpdir() reads each time it is called: the printer's pages' folder
// (src/print/print.ts), the browser launcher's artifacts' and profile folders, which it makes
// with os.tmpdir() at each launch, and the browser itself, which inherits the environment.
// The folder is removed, whole and at once, as the process exits, so a signal at any moment
// that lets the exit handlers run (the commands' handlers exit, never die by the signal)
// leaves nothing, whichever of those folders had been made by then. Its exit handler is kept
// the last: the launcher's own, added when a browser is spawned, kills the browser first,
// as one still running could write into its profile again after the folder had gone. One
// is live in a process at a time: TMPDIR is the process's, and a second would leave it
// naming a folder the first had removed, and the two exit handlers each moving itself last
// on the other's every move. Writes on libuv's thread pool begun before the exit (a launch's
// `mkdtemp` of the browser's profile, say) go on while the exit handlers run, and can land in
// the folder as it is removed: a removal that meets one is tried again.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface PrivateTemporary {
  /** The folder, which TMPDIR names until `remove`. */
  root: string;
  /**
   * The folder removed, TMPDIR as it was, and the exit handler let go; done once. A removal
   * that fails throws, the handler set again to try once more as the process exits.
   */
  remove(): void;
}

/** The live folder's path, or null. */
let live: string | null = null;

/**
 * A private temporary folder in TMPDIR, named for `purpose`, TMPDIR set to it, and an exit
 * handler removing it, registered before anything else is started. Throws while another is
 * live in the process.
 */
export function privateTemporary(purpose: string): PrivateTemporary {
  if (live !== null) {
    throw new Error(`A private temporary folder is live in this process already: ${live}`);
  }
  const root = mkdtempSync(join(tmpdir(), `pdf-export.${purpose}-`));
  live = root;
  const was = process.env['TMPDIR'];
  // a directory found not empty as it is removed, a write in flight landing in it, is tried
  // again, each time after a longer pause, by when the writes in flight have ended
  const onExit = (): void => {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 5 });
  };
  let removed = false;
  let moving = false;
  // an exit handler added after this one (the launcher's, at a browser's spawn) is followed
  // by this one again, moved to the end before anything else runs
  const keepLast = (event: string | symbol): void => {
    if (event !== 'exit' || moving) return;
    process.nextTick(() => {
      if (removed) return;
      moving = true;
      process.off('exit', onExit);
      process.on('exit', onExit);
      moving = false;
    });
  };
  process.on('exit', onExit);
  process.on('newListener', keepLast);
  process.env['TMPDIR'] = root;
  return {
    root,
    remove() {
      if (removed) return;
      removed = true;
      live = null;
      process.off('newListener', keepLast);
      process.off('exit', onExit);
      if (was === undefined) delete process.env['TMPDIR'];
      else process.env['TMPDIR'] = was;
      // last, so a removal that fails leaves the process as it was before, but for the
      // folder's exit handler, set again: the folder is still there, and is tried again on exit
      try {
        onExit();
      } catch (error) {
        process.on('exit', () => {
          try {
            onExit();
          } catch {
            // the folder could not be removed now either: nothing more can be done
          }
        });
        throw error;
      }
    },
  };
}
