// `pdf-export book` (spec 001 T029, contracts/cli.md): the release's book, one PDF per
// top-level pathway, from the graph, the release's files and the figures' folder `figures`
// drew; it asks no render service. The preflight (T024) runs first; then the PDFs are
// printed into a folder beside `--out`'s name, moved into place only once every PDF is
// written, so a failed run leaves no book, part or temporary folder. Exit 0 with the book
// written, 1 on faults (the preflight's, or a figure's labels before its part is printed),
// 2 on bad arguments, a `--report` that exists or cannot be written, an `--out` that is not
// absent or empty, in a folder the run cannot write, or a mount point, a graph that cannot
// be read at the start, or any other error, after printing the faults found before it; a
// signal is 128 and its number, but once the book is in place, when it is 0. FR-011's check
// (`check-book`, T030) runs on the book's folder before it is moved into place: its faults
// are exit 1, and no book is written. The run report (data-model.md) is written to
// `--report` however the run ends once its arguments and report are accepted, a signal's
// included.
import {
  accessSync,
  constants as fsConstants,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { constants as osConstants } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';

import { graphSettings, openGraph, type Graph, type GraphSettings } from '../graph/connection.ts';
import { releaseInfo, type ReleaseInfo } from '../graph/queries.ts';
import { checkBook, type CheckResult } from '../check/book.ts';
import { BookCharacters } from '../layout/characters.ts';
import { codePointName } from '../layout/fonts.ts';
import type { Figure } from '../model/types.ts';
import { closing, message, SettingsError } from '../preflight/command.ts';
import { expectedFigures } from '../preflight/folder.ts';
import { preflight } from '../preflight/preflight.ts';
import { PARTS, type PartPrinter } from '../print/parts.ts';
import { privateTemporary } from '../print/temporary.ts';
import { BookFaults, OBJECT_STREAMS, writeBook, type PdfWritten, type Written } from './book.ts';

export interface BookSettings {
  graph: GraphSettings;
  species: string;
  files: string;
  figures: string;
  site: string;
  out: string;
  parallel: number;
  joins: number;
  report: string | null;
}

const FLAGS = [
  '--graph',
  '--database',
  '--figures',
  '--site',
  '--files',
  '--species',
  '--out',
  '--parallel',
  '--joins',
  '--report',
];

/**
 * The settings from `book`'s flags and the environment (contracts/cli.md): a flag wins over
 * its variable; the graph's credentials come from the environment only.
 */
export function bookSettings(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>
): BookSettings {
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const [name = '', inline] = (args[i] ?? '').split(/=(.*)/s, 2);
    if (!FLAGS.includes(name)) throw new SettingsError(`Unknown argument: ${name}`);
    const value = inline ?? args[++i];
    if (value === undefined || value === '') throw new SettingsError(`${name} needs a value`);
    if (flags.has(name)) throw new SettingsError(`${name} is given twice`);
    flags.set(name, value);
  }
  const setting = (flag: string, variable?: string): string | undefined =>
    flags.get(flag) ?? (variable === undefined ? undefined : env[variable] || undefined);
  const required = (flag: string, variable?: string): string => {
    const value = setting(flag, variable);
    if (value === undefined) {
      throw new SettingsError(`${flag}${variable ? ` (or ${variable})` : ''} is needed`);
    }
    return value;
  };
  const whole = (flag: string, fallback: number): number => {
    const value = flags.get(flag) ?? String(fallback);
    if (!/^[0-9]+$/.test(value) || Number(value) < 1 || Number(value) > 64) {
      throw new SettingsError(`${flag} must be a whole number from 1 to 64`);
    }
    return Number(value);
  };
  const graphEnv = { ...env };
  const uri = setting('--graph');
  if (uri !== undefined) graphEnv['NEO4J_URI'] = uri;
  const database = setting('--database');
  if (database !== undefined) graphEnv['NEO4J_DATABASE'] = database;
  let graph: GraphSettings;
  try {
    graph = graphSettings(graphEnv);
  } catch {
    throw new SettingsError('--graph (or NEO4J_URI) is needed');
  }
  const parallel = whole('--parallel', PARTS.parallel);
  const joins = whole('--joins', PARTS.joins);
  // a join holds one of --parallel's slots, so more joins than slots is never reached
  if (joins > parallel) throw new SettingsError('--joins cannot be more than --parallel');
  return {
    graph,
    species: setting('--species') ?? 'Homo sapiens',
    files: required('--files'),
    figures: required('--figures'),
    site: required('--site', 'REACTOME_SITE'),
    out: setting('--out') ?? 'TheReactomeBook',
    parallel,
    joins,
    report: setting('--report') ?? null,
  };
}

/**
 * Why `--out` cannot be written, or null: it must be absent or an empty folder, in a folder
 * the run can write (the book is written beside it and renamed into place), and not a mount
 * point (on another device than its parent), which a rename cannot replace.
 *
 * @param stat how a path is read (a test gives one that puts `--out` on another device)
 */
export function outProblem(
  out: string,
  stat: (path: string) => { dev: number; isDirectory(): boolean } = statSync
): string | null {
  const target = resolve(out);
  const parent = dirname(target);
  if (!existsSync(parent) || !stat(parent).isDirectory()) {
    return `--out ${out}: its folder ${parent} does not exist`;
  }
  try {
    accessSync(parent, fsConstants.W_OK | fsConstants.X_OK);
  } catch {
    return `--out ${out}: its folder ${parent} cannot be written`;
  }
  // a symbolic link, even one to an empty folder or to nothing, cannot be renamed onto
  let link: boolean;
  try {
    link = lstatSync(target).isSymbolicLink();
  } catch {
    return null;
  }
  if (link) return `--out ${out} is a symbolic link, which the finished book cannot replace`;
  try {
    const folder = stat(target);
    if (!folder.isDirectory()) return `--out ${out} is not a folder`;
    if (folder.dev !== stat(parent).dev) {
      return `--out ${out} is on another device than its folder, or a mount point, which the finished book cannot be moved onto`;
    }
    if (readdirSync(target).length > 0) {
      return `--out ${out} is not empty: an old book is never replaced in place`;
    }
  } catch (error) {
    // one that cannot be read (its mode 000, say) cannot be known to be empty
    return `--out ${out} cannot be read: ${message(error)}`;
  }
  return null;
}

/**
 * Why `--report` cannot be written, or null, its folder made if need be: an earlier run's
 * report is never replaced, as `figures` refuses one (T046), and a report whose folder
 * cannot be made is found before the book is made, not after. One inside `--out` is
 * refused before its folder is made: `--out` would then not be empty, nor after a failure.
 */
export function reportProblem(report: string, out: string): string | null {
  const path = resolve(report);
  const book = resolve(out);
  if (path === book || path.startsWith(`${book}${sep}`)) {
    return `--report ${report} is inside --out ${out}`;
  }
  if (existsSync(report)) return `--report must not exist: ${report}`;
  const folder = dirname(resolve(report));
  try {
    mkdirSync(folder, { recursive: true });
    accessSync(folder, fsConstants.W_OK | fsConstants.X_OK);
  } catch (error) {
    return `--report ${report}: its folder cannot be written: ${message(error)}`;
  }
  return null;
}

/** A stage's time against research R7's budget, in seconds. */
export interface StageTime {
  stage: string;
  /** Null for a stage not run. */
  seconds: number | null;
  budget: number | null;
  /** Wall time, or the time summed over the slots, above the wall time where they overlap. */
  measured: 'wall' | 'summed';
}

/** The run report (data-model.md). Everything is named by stable identifier or file. */
export interface RunReport {
  release: number | null;
  checksum: string | null;
  outcome: 'written' | 'faults' | 'error';
  /** The faults, each a line as `preflight` prints it: the preflight's, then the printing's. */
  faults: string[];
  /** The error that stopped the run, if one did. */
  error: string | null;
  /**
   * The signal that stopped the run, if one did: with the outcome `written` when it came once
   * the book was in place, and `error` before.
   */
  signal: NodeJS.Signals | null;
  seconds: number;
  stages: StageTime[];
  pdfs: PdfWritten[];
  total: { pdfs: number; pages: number; bytes: number };
  /** The settings that shape the join's memory (research R4). */
  joins: { joins: number; parallel: number; objectStreams: boolean };
  figures: {
    byKind: Record<Figure['kind'], number>;
    /** Missing from the figures' folder, or stale there, by the event's stable identifier. */
    missing: string[];
    stale: string[];
    /** Whose labels print below 1 pt even at their largest (research R4). */
    belowFloor: string[];
    unmeasured: string[];
  };
  /** The release's files missing, by name as in `--files`. */
  missingFiles: string[];
  characters: {
    /** FR-017's substitutions in the finished book, by code point. */
    replaced: Record<string, number>;
    /** Characters no font draws, each as its fault: code point and stable identifier. */
    uncovered: string[];
  };
  /** FR-011's checks, each with its count of faults (none a pass); null if not run. */
  checks: CheckResult[] | null;
}

/** A printer that can be closed: the Printer (src/print/print.ts). */
export type BookPrinter = PartPrinter & { close(): Promise<void> };

export interface BookIo {
  out: (text: string) => void;
  err: (text: string) => void;
  /** How the graph is opened (a test gives one that fails or rewrites rows). */
  open?: typeof openGraph;
  /** How the printer is started (a test counts its prints). */
  startPrinter?: () => Promise<BookPrinter>;
  /** The pages at which a part ends (T025): lowered by the tests, so a PDF splits. */
  threshold?: number;
  /** The covers' date. */
  date?: Date;
  /** How a signal ends the process (a test's stands in for `process.exit`). */
  exit?: (code: number) => never;
}

/** `pdf-export book`: its exit code; faults to `out`, errors to `err`. */
export async function bookCommand(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  io: BookIo
): Promise<number> {
  const { out, err, open = openGraph } = io;
  let settings: BookSettings;
  try {
    settings = bookSettings(args, env);
  } catch (error) {
    if (!(error instanceof SettingsError)) throw error;
    err(`${error.message}\n`);
    return 2;
  }
  // the run's private temporary folder, first, its removal on exit registered with it: the
  // printer and the browser it starts write theirs in it (src/print/temporary.ts)
  const temporary = privateTemporary('book');
  const started = performance.now();
  const report = emptyReport(settings);
  const writeReport = (): boolean => {
    report.seconds = seconds(performance.now() - started);
    if (settings.report === null) return true;
    try {
      writeAtomically(settings.report, `${JSON.stringify(report, null, 2)}\n`);
      return true;
    } catch (failure) {
      err(`The run report was not written: ${message(failure)}\n`);
      return false;
    }
  };
  // the report is written before the private folder is removed (in the `finally` below), so
  // a removal that fails cannot keep it from being written
  const end = (code: number, error: unknown = null): number => {
    for (const signal of SIGNALS) process.off(signal, onSignal);
    for (const fault of report.faults) out(`fault ${fault}\n`);
    if (error !== null) {
      report.error = message(error);
      err(`The book was not written: ${report.error}\n`);
    }
    report.outcome = code === 0 ? 'written' : code === 1 ? 'faults' : 'error';
    return writeReport() ? code : 2;
  };

  // A signal stops the run from its start: the book's folder removed, the report written
  // naming it, and the process exited as one the signal stopped (128 and its number), so
  // the exit handlers run: the printer's, which removes its pages' folder
  // (src/print/print.ts), and the browser launcher's, which ends the browser and removes its
  // profile. A signal while the browser is launching is held until the launch ends, as the
  // launcher registers its folders for removal only once the browser has started. Once the
  // book is in place (checked, and renamed), a signal stops nothing: the report says the
  // book was written, naming the signal, and the exit is 0.
  const exit = io.exit ?? ((code: number) => process.exit(code));
  /** The book's folder while it is written, null before and once it is in place. */
  let folder: string | null = null;
  let placed = false;
  // set by the handler, read after the launch: an object, as a closure sets it
  const signals: { held: boolean; signalled: NodeJS.Signals | null } = {
    held: false,
    signalled: null,
  };
  const stop = (signal: NodeJS.Signals): void => {
    // the run's private temporary folder is removed by its exit handler, after the browser
    // launcher's has ended the browser (src/print/temporary.ts)
    report.signal = signal;
    if (placed) {
      report.outcome = 'written';
      err(`The book was written; then stopped by ${signal}\n`);
      exit(writeReport() ? 0 : 2);
    }
    if (folder !== null) rmSync(folder, { recursive: true, force: true });
    report.outcome = 'error';
    report.error = `stopped by ${signal}`;
    err(`The book was not written: ${report.error}\n`);
    writeReport();
    exit(128 + osConstants.signals[signal]);
  };
  const onSignal = (signal: NodeJS.Signals): void => {
    // a second signal stops the run at once, held or not: a launch that hangs would
    // otherwise hold every signal until it times out
    if (signals.signalled !== null || !signals.held) {
      stop(signals.signalled ?? signal);
      return;
    }
    signals.signalled = signal;
  };
  // everything from here in a `try`: an exception escaping the run still lets the handlers
  // go and removes the private folder, after the report is written
  try {
    for (const signal of SIGNALS) process.on(signal, onSignal);

    // an earlier run's report is never replaced, and no report is written for the refusal;
    // checked, and its folder made, once the handlers are set, so a signal from the moment
    // its folder exists finds them
    const unreportable =
      settings.report === null ? null : reportProblem(settings.report, settings.out);
    if (unreportable) {
      err(`${unreportable}\n`);
      return 2;
    }

    const problem = outProblem(settings.out);
    if (problem) return end(2, problem);

    // the start's check, its own driver retrying briefly, as `preflight`'s (T024)
    let start: Graph | undefined;
    let release: ReleaseInfo;
    try {
      start = open(settings.graph, { connectionTimeoutMs: 5000, retryTimeMs: 0 });
      release = await releaseInfo(start);
    } catch (error) {
      await closing(start, err);
      return end(2, `the graph cannot be read: ${message(error)}`);
    }
    await closing(start, err);
    report.release = release.release;
    report.checksum = release.checksum;

    // the preflight, with the driver's own retries; its faults kept check by check
    const preflightStarted = performance.now();
    const faults: string[] = [];
    let docs;
    let stopped: { error: unknown } | null = null;
    let graph: Graph | undefined;
    try {
      graph = open(settings.graph);
      docs = (await preflight(graph, release, settings, faults)).docs;
    } catch (error) {
      stopped = { error };
    } finally {
      await closing(graph, err);
    }
    report.stages.push({
      stage: 'preflight',
      seconds: seconds(performance.now() - preflightStarted),
      budget: 4 * 60,
      measured: 'wall',
    });
    noteFaults(report, faults);
    if (stopped) return end(2, `the preflight stopped: ${message(stopped.error)}`);
    if (faults.length > 0 || !docs) return end(1);
    for (const record of expectedFigures(docs).values()) report.figures.byKind[record.kind] += 1;

    // the book, printed into a folder beside its name, checked (FR-011), and moved into place
    const target = resolve(settings.out);
    let printer: BookPrinter | undefined;
    let written: Written | undefined;
    let failure: unknown = null;
    const characters = new BookCharacters();
    // closed once the book is printed, so its browser is not held through the check
    const closePrinter = async (): Promise<void> => {
      const open = printer;
      printer = undefined;
      try {
        await open?.close();
      } catch (error) {
        err(`The printer did not close: ${message(error)}\n`);
      }
    };
    try {
      folder = mkdtempSync(join(dirname(target), `.${basename(target)}-`));
      signals.held = true;
      try {
        printer = await (io.startPrinter ?? startPrinter)();
      } finally {
        // a signal held through the launch acts now, whether it began the browser or not
        signals.held = false;
        if (signals.signalled !== null) stop(signals.signalled);
      }
      written = await writeBook(docs, characters, {
        figures: settings.figures,
        site: settings.site,
        folder,
        parts: {
          threshold: io.threshold ?? PARTS.threshold,
          parallel: settings.parallel,
          joins: settings.joins,
        },
        printer,
        date: io.date ?? new Date(),
      });
      await closePrinter();
      noteWritten(report, written);
      // FR-011's check, on the folder before it is moved into place: a fault is exit 1, and
      // the folder is removed with it
      const checkStarted = performance.now();
      const checked = await checkBook(folder, docs, settings.files);
      report.checks = checked.checks;
      report.stages.push({
        stage: 'check-book',
        seconds: seconds(performance.now() - checkStarted),
        budget: 9 * 60,
        measured: 'wall',
      });
      if (checked.faults.length > 0) throw new BookFaults(checked.faults);
      renameSync(folder, target);
      // in place: a signal from now on reports the book written (`stop`, above)
      folder = null;
      placed = true;
    } catch (error) {
      failure = error;
    } finally {
      await closePrinter();
      if (failure !== null && folder !== null) rmSync(folder, { recursive: true, force: true });
    }
    report.characters.replaced = counts(written?.replaced ?? characters.replaced);
    if (failure !== null) {
      // faults found while printing or checking are exit 1, any other error exit 2, the
      // faults printed first
      const failures =
        failure instanceof AggregateError ? (failure.errors as unknown[]) : [failure];
      const others = failures.filter((f) => !(f instanceof BookFaults));
      for (const f of failures) if (f instanceof BookFaults) noteFaults(report, [...f.faults]);
      if (others.length > 0) return end(2, others.map(message).join('; '));
      return end(1);
    }
    err(
      `The book: ${String(report.total.pdfs)} PDFs, ${String(report.total.pages)} pages, in ${settings.out}\n`
    );
    return end(0);
  } finally {
    for (const signal of SIGNALS) process.off(signal, onSignal);
    try {
      temporary.remove();
    } catch (error) {
      err(`The run's temporary folder was not removed: ${message(error)}\n`);
    }
  }
}

/** The signals a run is stopped by, its folder removed and its report written first. */
const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;

const startPrinter = async (): Promise<BookPrinter> => {
  // loaded only here: it starts a browser
  const { Printer } = await import('../print/print.ts');
  return Printer.start();
};

const seconds = (ms: number): number => Math.round(ms) / 1000;

/**
 * What the book's printing gives the report: each PDF (printed and checked; on a fault of the
 * check, printed and then discarded), the figures, the characters replaced, and the stages.
 */
function noteWritten(report: RunReport, written: Written): void {
  report.pdfs = written.pdfs;
  report.total = {
    pdfs: written.pdfs.length,
    pages: written.pdfs.reduce((n, pdf) => n + pdf.pages, 0),
    bytes: written.pdfs.reduce((n, pdf) => n + pdf.bytes, 0),
  };
  report.characters.replaced = counts(written.replaced);
  report.figures.belowFloor = written.layout.belowFloor;
  report.figures.unmeasured = written.layout.unmeasured;
  report.figures.missing = [...new Set([...report.figures.missing, ...written.layout.missing])];
  const { ms } = written;
  report.stages.push(
    { stage: 'figures', seconds: seconds(ms.figures), budget: 44 * 60, measured: 'summed' },
    { stage: 'print', seconds: seconds(ms.print), budget: 13 * 60, measured: 'summed' },
    { stage: 'join', seconds: seconds(ms.join), budget: 6 * 60, measured: 'summed' },
    { stage: 'contents', seconds: seconds(ms.contents), budget: 2 * 60, measured: 'summed' },
    { stage: 'parts', seconds: seconds(ms.parts), budget: null, measured: 'wall' }
  );
}

function emptyReport(settings: BookSettings): RunReport {
  return {
    release: null,
    checksum: null,
    outcome: 'error',
    faults: [],
    error: null,
    signal: null,
    seconds: 0,
    stages: [],
    pdfs: [],
    total: { pdfs: 0, pages: 0, bytes: 0 },
    joins: { joins: settings.joins, parallel: settings.parallel, objectStreams: OBJECT_STREAMS },
    figures: {
      byKind: { diagram: 0, ancestor: 0, ehld: 0, reaction: 0 },
      missing: [],
      stale: [],
      belowFloor: [],
      unmeasured: [],
    },
    missingFiles: [],
    characters: { replaced: {}, uncovered: [] },
    checks: null,
  };
}

/** Faults added to the report, and sorted into its lists by kind. */
function noteFaults(report: RunReport, faults: readonly string[]): void {
  for (const fault of faults) {
    report.faults.push(fault);
    const [kind = '', name = ''] = fault.split(' ');
    if (kind === 'missing-file') {
      // a figure's file is named for its event; a release file by its folder
      if (name.includes('/')) report.missingFiles.push(name);
      else report.figures.missing.push(name.replace(/\.svg$/, ''));
    } else if (kind === 'stale-figure') {
      report.figures.stale.push(name);
    } else if (kind === 'uncovered-character') {
      report.characters.uncovered.push(fault.slice(kind.length + 1));
    }
  }
}

/** Counts by code point, `U+XXXX`, in code point order. */
function counts(replaced: ReadonlyMap<number, number>): Record<string, number> {
  return Object.fromEntries(
    [...replaced].sort(([a], [b]) => a - b).map(([point, n]) => [codePointName(point), n])
  );
}

/** A file written beside its name and moved into place. */
function writeAtomically(path: string, text: string): void {
  const beside = `${path}.${String(process.pid)}.part`;
  try {
    writeFileSync(beside, text);
    renameSync(beside, path);
  } finally {
    rmSync(beside, { force: true });
  }
}
