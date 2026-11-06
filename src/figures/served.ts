// The figures' folder as the service reads it (spec 001 T047, contracts/service.md): used for
// a PDF without a token while it passes `book`'s folder checks (T024's `checkFolder`) against
// the graph's current release. The checks run in full at the start and again whenever what
// they were run on changes: the manifest's bytes (its fingerprint among them) or the graph's
// release and checksum, read again on each poll (once a minute in the service). Until a check
// has passed, and while one runs, the folder is not used: every figure is drawn on request,
// and the state says why. Which state a check's faults mean is decided here, not in
// `checkFolder`, which reports faults: `none` is no folder or no manifest, `incomplete` a
// manifest that is not whole or a figure's file missing, `stale` a folder drawn for another
// release, summary or Figure rules (or a graph with no checksum to tie it to).
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Graph } from '../graph/connection.ts';
import { releaseInfo, type ReleaseInfo } from '../graph/queries.ts';
import { buildBook } from '../model/build.ts';
import type { Figure } from '../model/types.ts';
import type { Summary } from '../preflight/files.ts';
import {
  checkFolder,
  expectedFigures,
  figureRecord,
  MANIFEST,
  readManifest,
  type FigureRecord,
} from '../preflight/folder.ts';

/** What `/health` says of the folder. */
export type FolderState =
  | { state: 'ready'; release: number; checksum: string }
  | { state: 'checking' | 'stale' | 'incomplete' | 'none' };

/** A figure's drawing as the folder records it, whichever event's file holds it. */
const recordKey = ({ kind, source, highlight }: Omit<FigureRecord, 'stId'>): string =>
  `${kind}/${source}/${highlight.join(',')}`;

/** The key of the folder's file that draws `figure`, as `recordKey` gives it. */
const drawingKey = (figure: Figure): string => recordKey(figureRecord('', figure));

export interface ServedFolderOptions {
  folder: string;
  /** The graph the checks read: its release, and the book built for the expected figures. */
  graph: Graph;
  /** The EHLD summary the service draws by, read once at its start. */
  summary: Summary;
  log: (line: string) => void;
}

export class ServedFolder {
  readonly #options: ServedFolderOptions;
  #state: FolderState = { state: 'checking' };
  /** Each drawing's file, by `recordKey`, while the folder is ready. */
  #files = new Map<string, string>();
  /** What the last check that ended was run on: the manifest's hash and the release. */
  #checked: string | null = null;
  #polling: Promise<void> | null = null;
  #stopped = false;

  constructor(options: ServedFolderOptions) {
    this.#options = options;
  }

  get state(): FolderState {
    return this.#state;
  }

  /**
   * The folder's files as they are now, for one PDF whose graph read gave `release`: null
   * while the folder is not ready, or was checked against another release (a graph swapped
   * since the last poll); else a lookup giving a figure's file, or null for a figure the
   * folder lacks.
   */
  files(release: number): ((figure: Figure) => string | null) | null {
    if (this.#state.state !== 'ready') return null;
    // a graph swapped since the last poll: the PDF's own read of the release says so first
    if (this.#state.release !== release) {
      this.#options.log(
        `figures-folder: the graph is release ${String(release)}, the folder ${String(this.#state.release)}; drawn on request`
      );
      return null;
    }
    const files = this.#files;
    const { folder } = this.#options;
    return (figure) => {
      const stId = files.get(drawingKey(figure));
      return stId === undefined ? null : join(folder, `${stId}.svg`);
    };
  }

  /** Read through a call: a check before an await does not hold after it. */
  #ended(): boolean {
    return this.#stopped;
  }

  /** No poll changes the state or logs from now on: the service is closing. */
  stop(): void {
    this.#stopped = true;
  }

  /**
   * Reads the manifest and the graph's release again, and runs the checks in full when
   * either has changed since the last check that ended. One poll at a time: a poll asked for
   * while one runs is that one.
   */
  poll(): Promise<void> {
    if (this.#stopped) return Promise.resolve();
    this.#polling ??= this.#poll().finally(() => {
      this.#polling = null;
    });
    return this.#polling;
  }

  async #poll(): Promise<void> {
    const { folder, graph, log } = this.#options;
    let manifest: string | null;
    let release: ReleaseInfo;
    try {
      manifest = await readFile(join(folder, MANIFEST), 'utf8').catch((error: unknown) => {
        // no folder, or no manifest in it
        const { code } = error as NodeJS.ErrnoException;
        if (code === 'ENOENT' || code === 'ENOTDIR') return null;
        throw error;
      });
      release = await releaseInfo(graph);
    } catch (error) {
      // the state stands until a read succeeds: nothing is known to have changed
      if (!this.#ended()) log(`figures-folder: not read (${describe(error)})`);
      return;
    }
    const hash = manifest === null ? 'none' : createHash('sha256').update(manifest).digest('hex');
    const key = `${hash} ${String(release.release)}/${String(release.checksum)}`;
    if (key === this.#checked || this.#ended()) return;
    // changed: not used until checked again
    this.#state = { state: 'checking' };
    this.#files = new Map();
    let checked: { state: FolderState; files: Map<string, string> };
    try {
      checked = await this.#check(manifest, release);
    } catch (error) {
      // not recorded as checked, so the next poll tries again
      if (!this.#ended()) log(`figures-folder: the checks failed (${describe(error)})`);
      return;
    }
    if (this.#ended()) return;
    const { state, files } = checked;
    this.#checked = key;
    this.#state = state;
    this.#files = files;
    log(
      state.state === 'ready'
        ? `figures-folder: ready ${String(state.release)}/${state.checksum}`
        : `figures-folder: ${state.state}, every figure drawn on request`
    );
  }

  /** The state the checks give the folder, and its files when they pass. */
  async #check(
    manifest: string | null,
    release: ReleaseInfo
  ): Promise<{ state: FolderState; files: Map<string, string> }> {
    const { folder, graph, summary } = this.#options;
    const files = new Map<string, string>();
    const not = (
      state: 'stale' | 'incomplete' | 'none'
    ): { state: FolderState; files: Map<string, string> } => ({
      state: { state },
      files,
    });
    if (manifest === null) return not('none');
    const read = readManifest(manifest);
    if (!read) return not('incomplete');
    const { fingerprint } = read;
    if (
      release.checksum === null ||
      fingerprint.release !== release.release ||
      fingerprint.checksum !== release.checksum ||
      fingerprint.summary !== summary.hash
    ) {
      return not('stale');
    }
    // current and whole: the full checks, each figure against the Figure rules
    const expected = expectedFigures(await buildBook(graph, { illustrated: summary.illustrated }));
    const faults = checkFolder(folder, { release, summary: summary.hash, expected });
    if (faults.some((fault) => !fault.startsWith('missing-file '))) return not('stale');
    if (faults.length > 0) return not('incomplete');
    for (const record of expected.values()) {
      const key = recordKey(record);
      if (!files.has(key)) files.set(key, record.stId);
    }
    return {
      state: { state: 'ready', release: release.release, checksum: release.checksum },
      files,
    };
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
