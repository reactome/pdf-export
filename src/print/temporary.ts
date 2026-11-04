// A process's private temporary folder (spec 001 T029): `book` and
// `serve` make one at their start and point everything they start at it, by TMPDIR, which
// Node's os.tmpdir() reads each time it is called: the printer's pages' folder
// (src/print/print.ts), the browser launcher's artifacts' and profile folders, which it makes
// with os.tmpdir() at each launch, and the browser itself, which inherits the environment.
// The folder is removed, whole and at once, as the process exits, so a signal at any moment
// that lets the exit handlers run (the commands' handlers exit, never die by the signal)
// leaves nothing, whichever of those folders had been made by then. Its exit handler is kept
// the last: the launcher's own, added when a browser is spawned, kills the browser first,
// as one still running could write into its profile again after the folder had gone.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface PrivateTemporary {
  /** The folder, which TMPDIR names until `remove`. */
  root: string;
  /** The folder removed, TMPDIR as it was, and the exit handler let go; done once. */
  remove(): void;
}

/**
 * A private temporary folder in TMPDIR, named for `purpose`, TMPDIR set to it, and an exit
 * handler removing it, registered before anything else is started.
 */
export function privateTemporary(purpose: string): PrivateTemporary {
  const root = mkdtempSync(join(tmpdir(), `pdf-export.${purpose}-`));
  const was = process.env['TMPDIR'];
  const onExit = () => {
    rmSync(root, { recursive: true, force: true });
  };
  let removed = false;
  let moving = false;
  // an exit handler added after this one (the launcher's, at a browser's spawn) is followed
  // by this one again, moved to the end before anything else runs
  const keepLast = (event: string | symbol) => {
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
      process.off('newListener', keepLast);
      process.off('exit', onExit);
      onExit();
      if (was === undefined) delete process.env['TMPDIR'];
      else process.env['TMPDIR'] = was;
    },
  };
}
