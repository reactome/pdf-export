// `pdf-export figures` (spec 001 T046; contracts/cli.md, contracts/figures.md, SC-010): draws
// every figure the book needs, before the book, into a folder the book reads. In order:
// - the settings; a `--report` that exists already (exit 2, its file untouched); an `--out`
//   that is absent or empty (exit 2 otherwise: no resuming);
// - the graph's release and checksum (none, or no graph, is exit 2);
// - a probe of the render service's health (`build` not `unknown`, `files: local`) and the
//   content service's release, which must be the graph's (exit 2 otherwise), so a service
//   down is said before the preflight's minutes;
// - the book's figures by the Figure rules, built as `book` builds them (T048's `buildBook`
//   and the EHLD summary), and T024's release-file and pre-drawing character checks, before
//   any figure is asked for (a fault is exit 1);
// - the same read again, its values the folder's fingerprint;
// - each figure drawn through T014's client, its 504s and timeouts retried once, checked for
//   its labels' characters (T024's `labelsInBook`), written beside its name, synced and moved
//   into place, and given its manifest line only once the render service's `build` and the
//   content release, read again, still equal the fingerprint's.
// A figure's own fault (missing, or failing its label check) leaves it with no file and no
// line while the rest are drawn; a deployment changed or gone, or the breaker, stops the run at
// once. Either way the run ends with exit 1 and no `complete` line. Its report is written
// however the run ends, but for a signal and a `--report` refused. One writer appends the
// manifest, synchronously, so lines never interleave.
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import {
  graphSettings,
  openGraph,
  type Graph,
  type GraphOptions,
  type GraphSettings,
} from '../graph/connection.ts';
import { releaseInfo, type ReleaseInfo } from '../graph/queries.ts';
import { BookCharacters } from '../layout/characters.ts';
import { buildBook } from '../model/build.ts';
import { checkCharacters } from '../preflight/characters.ts';
import { SettingsError } from '../preflight/command.ts';
import { checkFiles, neededFiles, readSummary, SUMMARY } from '../preflight/files.ts';
import {
  expectedFigures,
  manifestLine,
  MANIFEST,
  type FigureRecord,
  type Fingerprint,
  type ManifestLine,
} from '../preflight/folder.ts';
import { fetchFigure, type FigureRequest, type MissingCause } from './client.ts';
import { labelsInBook } from './labels.ts';

export interface FiguresSettings {
  graph: GraphSettings;
  species: string;
  /** The release's folder: the EHLD summary, and the files the preflight looks for. */
  files: string;
  /** The render service's base URL. */
  render: string;
  /** The content service's base URL, asked only for its release. */
  content: string;
  out: string;
  /** Figures asked at once. */
  parallel: number;
  /** How long each attempt at a figure, and each health or release read, may take. */
  timeoutMs: number;
  /** Where the run report is written, as JSON; none without `--report`. */
  report: string | null;
}

const FLAGS = [
  '--graph',
  '--database',
  '--species',
  '--files',
  '--render',
  '--content',
  '--out',
  '--parallel',
  '--timeout',
  '--report',
];

/** The settings from the flags and the environment; the credentials from the environment. */
export function figuresSettings(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>
): FiguresSettings {
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const [name = '', inline] = (args[i] ?? '').split(/=(.*)/s, 2);
    if (!FLAGS.includes(name)) throw new SettingsError(`Unknown argument: ${name}`);
    const value = inline ?? args[++i];
    if (value === undefined || value === '') throw new SettingsError(`${name} needs a value`);
    if (flags.has(name)) throw new SettingsError(`${name} is given twice`);
    flags.set(name, value);
  }
  const required = (flag: string, variable?: string): string => {
    const value = flags.get(flag) ?? (variable === undefined ? undefined : env[variable]);
    if (value === undefined || value === '') {
      throw new SettingsError(`${flag}${variable ? ` (or ${variable})` : ''} is needed`);
    }
    return value;
  };
  const graphEnv = { ...env };
  const uri = flags.get('--graph');
  if (uri !== undefined) graphEnv['NEO4J_URI'] = uri;
  const database = flags.get('--database');
  if (database !== undefined) graphEnv['NEO4J_DATABASE'] = database;
  let graph: GraphSettings;
  try {
    graph = graphSettings(graphEnv);
  } catch {
    throw new SettingsError('--graph (or NEO4J_URI) is needed');
  }
  const parallel = flags.get('--parallel') ?? '2';
  if (!/^[1-9]\d*$/.test(parallel)) throw new SettingsError('--parallel must be a whole number');
  const timeout = flags.get('--timeout') ?? '60';
  if (!/^\d+(\.\d+)?$/.test(timeout) || Number(timeout) <= 0) {
    throw new SettingsError('--timeout must be a number of seconds above 0');
  }
  return {
    graph,
    species: flags.get('--species') ?? 'Homo sapiens',
    files: required('--files'),
    render: required('--render', 'RENDER_SERVICE'),
    content: required('--content', 'CONTENT_SERVICE'),
    out: required('--out'),
    parallel: Number(parallel),
    timeoutMs: Number(timeout) * 1000,
    report: flags.get('--report') ?? null,
  };
}

/** A read of a service that did not give what was asked: no answer, or a bad one. */
class ReadError extends Error {
  override name = 'ReadError';
}

const base = (url: string): string => (url.endsWith('/') ? url : `${url}/`);

/** A GET within `timeoutMs` (or the caller's end), its body read whole, or a ReadError. */
async function get(url: URL, timeoutMs: number, signal?: AbortSignal): Promise<string> {
  const timeout = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetch(url, {
      signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
    });
    const body = await response.text();
    if (!response.ok) throw new ReadError(`${url.pathname} answered ${String(response.status)}`);
    return body;
  } catch (error) {
    if (error instanceof ReadError) throw error;
    const code = (
      error instanceof Error ? (error.cause as { code?: unknown } | undefined) : undefined
    )?.code;
    const why = error instanceof Error ? error.name : String(error);
    throw new ReadError(
      `${url.pathname}: no answer (${typeof code === 'string' ? `${why}: ${code}` : why})`
    );
  }
}

/** The render service's health answer (contracts/render.md). */
export async function readHealth(
  render: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<{ build: string; files: string }> {
  const body = await get(new URL('health', base(render)), timeoutMs, signal);
  let health: unknown;
  try {
    health = JSON.parse(body);
  } catch {
    throw new ReadError('/health answered no JSON');
  }
  const { build, files } = (health ?? {}) as { build?: unknown; files?: unknown };
  if (typeof build !== 'string') throw new ReadError('/health answered no build');
  return { build, files: typeof files === 'string' ? files : '' };
}

/** The content service's release, `GET /data/database/version`. */
export async function readContentRelease(
  content: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<number> {
  const body = await get(new URL('data/database/version', base(content)), timeoutMs, signal);
  if (!/^\s*\d+\s*$/.test(body)) throw new ReadError('/data/database/version answered no release');
  return Number(body.trim());
}

/** Why a figure has no file and no line: the client's cause, or its labels' check. */
export type FaultCause = MissingCause | 'label';

/** Why a run stopped at once (contracts/figures.md). */
export type StopReason =
  | 'deployment-changed'
  | 'deployment-unanswered'
  | 'breaker-unanswered'
  | 'breaker-silent'
  | 'error';

export interface KindCounts {
  needed: number;
  drawn: number;
  totalMs: number;
  maxMs: number;
  written: number;
}

/** The run report (contracts/figures.md): stable identifiers, kinds, times and counts only. */
export interface FiguresReport {
  /** The fingerprint, as far as it was read. */
  release: Partial<Fingerprint>;
  /** Why the run was refused before drawing (exit 2), if it was. */
  refused: string | null;
  /** The preflight's faults (exit 1, nothing drawn). */
  preflight: string[];
  /**
   * Each kind's figures: how many the book needs, how many the render service drew (and how
   * long each took, its retry included), and how many are in the folder with their line.
   */
  figures: Partial<Record<FigureRecord['kind'], KindCounts>>;
  /** Each figure with a fault of its own, in the order met. */
  missing: { stId: string; cause: FaultCause; detail: string }[];
  /** Why the run stopped at once, if it did. */
  stopped: { reason: StopReason; detail: string } | null;
  /** Whether the manifest's `complete` line was written. */
  complete: boolean;
  elapsedMs: number;
}

/** The request that draws a figure's record. */
export function figureRequest(record: FigureRecord): FigureRequest {
  if (record.kind === 'ancestor') {
    return { kind: 'ancestor', stId: record.source, highlight: record.highlight };
  }
  return { kind: record.kind, stId: record.source };
}

interface Draw {
  render: string;
  content: string;
  out: string;
  parallel: number;
  timeoutMs: number;
  retryPauseMs: number;
  fingerprint: Fingerprint;
  report: FiguresReport;
}

/**
 * Draws each figure into `out`, appending the manifest after the fingerprint, and `complete`
 * only when every figure has its line. Returns whether it was written; the report says why
 * not. An error of its own (a file that cannot be written) stops the run and is thrown.
 */
export async function drawFigures(figures: readonly FigureRecord[], draw: Draw): Promise<boolean> {
  const { out, parallel, timeoutMs, fingerprint, report } = draw;
  mkdirSync(out, { recursive: true });
  const manifest = openSync(join(out, MANIFEST), 'wx');
  /** The one writer: a line written and synced before anything else runs. */
  let lines = 0;
  const append = (line: ManifestLine): void => {
    // writeFileSync on a descriptor writes until every byte is written, or throws (a full disk)
    writeFileSync(manifest, manifestLine(line));
    fsyncSync(manifest);
    if (line.type === 'figure') lines += 1;
  };
  const stop = new AbortController();
  const halt = (reason: StopReason, detail: string): void => {
    if (stop.signal.aborted) return;
    report.stopped = { reason, detail };
    stop.abort(new Error(`${reason}: ${detail}`));
  };
  // the breaker: figures unanswered in a row, or no answer of any kind for a while; never less
  // than one figure's two tries and the pause between them, and a read, so a healthy service
  // asking for its pause is not taken for a silent one
  const silence = Math.max(5 * timeoutMs, 3 * timeoutMs + draw.retryPauseMs);
  let unanswered = 0;
  const breaker = setTimeout(() => {
    halt('breaker-silent', `no figure answered for ${String(silence / 1000)} s`);
  }, silence);
  const answered = (): void => {
    unanswered = 0;
    breaker.refresh();
  };

  /** The deployment read again: whether it is the fingerprint's; the run halted if not. */
  const unchanged = async (): Promise<boolean> => {
    let now: { build: string; files: string; content: number };
    try {
      const [health, content] = await Promise.all([
        readHealth(draw.render, timeoutMs, stop.signal),
        readContentRelease(draw.content, timeoutMs, stop.signal),
      ]);
      now = { ...health, content };
    } catch (error) {
      if (!stop.signal.aborted) halt('deployment-unanswered', describe(error));
      return false;
    }
    if (stop.signal.aborted) return false;
    if (
      now.build !== fingerprint.build ||
      now.content !== fingerprint.content ||
      now.files !== 'local'
    ) {
      halt(
        'deployment-changed',
        `build ${now.build}, content ${String(now.content)}, files ${now.files || 'unsaid'}`
      );
      return false;
    }
    return true;
  };

  const one = async (record: FigureRecord): Promise<void> => {
    const { stId, kind } = record;
    const started = performance.now();
    const answer = await fetchFigure(draw.render, figureRequest(record), {
      timeoutMs,
      retryPauseMs: draw.retryPauseMs,
      retryUnanswered: true,
      signal: stop.signal,
    });
    if ('missing' in answer) {
      report.missing.push({ stId, cause: answer.cause, detail: answer.missing });
      if (answer.cause !== 'unanswered') {
        answered();
        return;
      }
      unanswered += 1;
      if (unanswered >= 2 * parallel) {
        halt('breaker-unanswered', `${String(unanswered)} figures in a row unanswered`);
        return;
      }
      await unchanged();
      return;
    }
    answered();
    const times = report.figures[kind];
    if (times) {
      const ms = Math.round(performance.now() - started);
      times.drawn += 1;
      times.totalMs += ms;
      times.maxMs = Math.max(times.maxMs, ms);
    }
    const characters = new BookCharacters();
    try {
      labelsInBook(answer.svg, stId, characters);
    } catch (error) {
      report.missing.push({ stId, cause: 'label', detail: `unreadable: ${describe(error)}` });
      return;
    }
    if (characters.faults.length > 0) {
      report.missing.push({ stId, cause: 'label', detail: characters.faults.join(', ') });
      return;
    }
    // written beside its name, synced, and moved into place, with nothing between
    const file = join(out, `${stId}.svg`);
    const part = `${file}.part`;
    const fd = openSync(part, 'wx');
    try {
      writeFileSync(fd, answer.svg);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(part, file);
    // unchanged() is false once the run has stopped, so no line follows a stop
    if (await unchanged()) {
      append({ type: 'figure', ...record });
      if (times) times.written += 1;
    } else {
      rmSync(file, { force: true });
    }
  };

  const queue = [...figures];
  /** A worker's own error (a file that cannot be written), thrown once the workers end. */
  const failed: { error?: Error } = {};
  /** Read afresh: another figure may have stopped the run while this one waited. */
  const halted = (): boolean => stop.signal.aborted;
  const worker = async (): Promise<void> => {
    for (let next = queue.shift(); next && !halted(); next = queue.shift()) {
      try {
        await one(next);
      } catch (error) {
        if (halted()) return;
        failed.error = error instanceof Error ? error : new Error(String(error));
        halt('error', describe(error));
      }
    }
  };
  try {
    append({ type: 'fingerprint', ...fingerprint });
    await Promise.all(Array.from({ length: Math.min(parallel, figures.length) }, worker));
    if (failed.error) throw failed.error;
    if (stop.signal.aborted || report.missing.length > 0 || lines !== figures.length) {
      return false;
    }
    append({ type: 'complete', ...fingerprint });
    return true;
  } finally {
    clearTimeout(breaker);
    closeSync(manifest);
  }
}

/** `--out`: absent, or an empty folder. */
function usableOut(out: string): boolean {
  if (!existsSync(out)) return true;
  return statSync(out).isDirectory() && readdirSync(out).length === 0;
}

/** `pdf-export figures`: its exit code; faults to `out`, the rest to `err`. */
export async function figuresCommand(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  {
    out,
    err,
    open = openGraph,
    retryPauseMs = 5000,
  }: {
    out: (text: string) => void;
    err: (text: string) => void;
    /** How the graph is opened (a test gives one that rewrites its rows). */
    open?: (settings: GraphSettings, options?: GraphOptions) => Graph;
    /** The pause before a figure's retry (the render service asks for 5 s). */
    retryPauseMs?: number;
  }
): Promise<number> {
  let settings: FiguresSettings;
  try {
    settings = figuresSettings(args, env);
  } catch (error) {
    if (!(error instanceof SettingsError)) throw error;
    err(`${error.message}\n`);
    return 2;
  }
  // an earlier run's report is never overwritten: refused, and no report written
  if (settings.report !== null && existsSync(settings.report)) {
    err(`--report must not exist: ${settings.report}\n`);
    return 2;
  }
  const report: FiguresReport = {
    release: {},
    refused: null,
    preflight: [],
    figures: {},
    missing: [],
    stopped: null,
    complete: false,
    elapsedMs: 0,
  };
  const started = performance.now();
  const refuse = (why: string): number => {
    report.refused = why;
    err(`${why}\n`);
    return 2;
  };
  try {
    return await steps(settings, report, { out, err, open, retryPauseMs, refuse });
  } catch (error) {
    err(`The figures' run stopped: ${describe(error)}\n`);
    report.stopped ??= { reason: 'error', detail: describe(error) };
    return 2;
  } finally {
    report.elapsedMs = Math.round(performance.now() - started);
    if (settings.report !== null) writeReport(settings.report, report, err);
  }
}

/**
 * The report, written beside its name and moved into place, its folder made if need be. A
 * report that cannot be written is said on `err`, and the run keeps the exit it earned.
 */
function writeReport(path: string, report: FiguresReport, err: (text: string) => void): void {
  const part = `${path}.part`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(part, `${JSON.stringify(report, null, 2)}\n`);
    renameSync(part, path);
  } catch (error) {
    err(`The report could not be written: ${describe(error)}\n`);
  }
}

async function steps(
  settings: FiguresSettings,
  report: FiguresReport,
  {
    out,
    err,
    open,
    retryPauseMs,
    refuse,
  }: {
    out: (text: string) => void;
    err: (text: string) => void;
    open: (settings: GraphSettings, options?: GraphOptions) => Graph;
    retryPauseMs: number;
    refuse: (why: string) => number;
  }
): Promise<number> {
  if (!usableOut(settings.out)) {
    return refuse(`--out must be absent or an empty folder: ${settings.out}`);
  }

  // the start's read, its retrying bounded, so a graph that cannot be reached is said soon
  // (opened inside the try: the driver throws at once on an address it cannot parse)
  let start: Graph | undefined;
  let release: ReleaseInfo;
  try {
    start = open(settings.graph, { connectionTimeoutMs: 5000, retryTimeMs: 0 });
    release = await releaseInfo(start);
  } catch (error) {
    return refuse(`The graph cannot be read: ${describe(error)}`);
  } finally {
    await start?.close();
  }
  report.release.release = release.release;
  if (release.checksum === null) return refuse('The graph has no DBInfo checksum');
  report.release.checksum = release.checksum;

  // the deployment probed before the preflight's minutes, so a service down is said at once
  const probe = await readDeployment(settings, release.release, report, refuse);
  if (typeof probe === 'number') return probe;

  // the figures by the Figure rules, and the preflight's checks, before any figure is asked for
  const summary = readSummary(settings.files);
  if (!summary) report.preflight.push(`missing-file ${SUMMARY}`);
  let figures: FigureRecord[] = [];
  if (summary) {
    report.release.summary = summary.hash;
    const graph = open(settings.graph);
    try {
      const docs = await buildBook(graph, {
        species: settings.species,
        illustrated: summary.illustrated,
      });
      figures = [...expectedFigures(docs).values()];
      report.preflight.push(...checkFiles(settings.files, neededFiles(figures)));
      report.preflight.push(
        ...(await checkCharacters(graph, docs, { files: settings.files, expected: figures }))
      );
    } catch (error) {
      // the faults found before an error are printed, as the preflight's command prints them
      for (const fault of report.preflight) out(`fault ${fault}\n`);
      throw error;
    } finally {
      await graph.close();
    }
  }
  if (report.preflight.length > 0) {
    for (const fault of report.preflight) out(`fault ${fault}\n`);
    return 1;
  }
  for (const { kind } of figures) {
    const entry = (report.figures[kind] ??= {
      needed: 0,
      drawn: 0,
      totalMs: 0,
      maxMs: 0,
      written: 0,
    });
    entry.needed += 1;
  }

  // the deployment read again just before drawing: the fingerprint's values
  const deployment = await readDeployment(settings, release.release, report, refuse);
  if (typeof deployment === 'number') return deployment;
  const { build, content } = deployment;

  const fingerprint: Fingerprint = {
    release: release.release,
    checksum: release.checksum,
    summary: summary?.hash ?? '',
    content,
    build,
  };
  let complete: boolean;
  try {
    complete = await drawFigures(figures, {
      render: settings.render,
      content: settings.content,
      out: settings.out,
      parallel: settings.parallel,
      timeoutMs: settings.timeoutMs,
      retryPauseMs,
      fingerprint,
      report,
    });
  } finally {
    // the figures' own faults so far, however the drawing ended (its own error included)
    for (const { stId, cause } of report.missing) out(`fault missing-figure ${stId} ${cause}\n`);
  }
  report.complete = complete;
  if (report.stopped) err(`stopped: ${report.stopped.reason}: ${report.stopped.detail}\n`);
  const written = Object.values(report.figures).reduce((sum, kind) => sum + kind.written, 0);
  err(`${String(written)} of ${String(figures.length)} figures in ${settings.out}\n`);
  return complete ? 0 : 1;
}

/**
 * The render service's health and the content service's release, each refused as the start's
 * check refuses them (its exit, 2), or the build and the release, recorded in the report.
 */
async function readDeployment(
  settings: FiguresSettings,
  release: number,
  report: FiguresReport,
  refuse: (why: string) => number
): Promise<{ build: string; content: number } | number> {
  let health: { build: string; files: string };
  try {
    health = await readHealth(settings.render, settings.timeoutMs);
  } catch (error) {
    return refuse(`The render service cannot be read: ${describe(error)}`);
  }
  if (health.build === 'unknown') return refuse("The render service's build is unknown");
  if (health.files !== 'local') return refuse('The render service does not read local files');
  report.release.build = health.build;
  let content: number;
  try {
    content = await readContentRelease(settings.content, settings.timeoutMs);
  } catch (error) {
    return refuse(`The content service cannot be read: ${describe(error)}`);
  }
  report.release.content = content;
  if (content !== release) {
    return refuse(
      `The content service answers release ${String(content)}, the graph is release ${String(release)}`
    );
  }
  return { build: health.build, content };
}

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
