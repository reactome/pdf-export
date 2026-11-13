// FR-012's comparison (spec 001 T035, contracts/cli.md `compare`, research R8): a reference
// (`event-pdf`'s output) and the new output, each a PDF or a folder of them, reduced to
// FR-012's parts (reduce.ts) and compared part by part. A folder is compared file by file,
// by name, as today's book is one file per top-level pathway, named after it; a file that
// cannot be read is a difference, and the rest are still compared.
//
// Each difference is reported by its part, its field and its kind, with a count and the
// stable identifiers of the sections it is in. Its values pass through one printer
// (output.ts), which prints text read from a PDF only where it has a strict shape that
// cannot hold a name, and anything else as a salted hash and a length (FR-013). A list in
// another order is a difference of its own kind, `order`, which `--expected` records like
// any other; the sections' order is read by their longest common subsequence, so a section
// moved is the one reported, and a section written twice is compared occurrence by
// occurrence.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

import { SettingsError } from '../preflight/command.ts';
import { errorKind } from '../print/unread.ts';
import { isRecord } from '../unknown.ts';
import { fold, hash, Output, type Difference } from './output.ts';
import { MARGIN_BAND_PT, readLayout } from './read.ts';
import {
  reduce,
  type ContentsItem,
  type PartName,
  type Reduced,
  type ReducedSection,
} from './reduce.ts';

export type { Difference } from './output.ts';

/** A recorded difference: matches by part and kind, and by field, file and events if given. */
export interface Recorded {
  part: string;
  kind: string;
  field?: string;
  file?: string;
  events?: string[];
  reason: string;
}

/** How a list differs: in its items, or only in their order. */
export function listKind(a: readonly string[], b: readonly string[]): 'text' | 'order' | null {
  if (a.length === b.length && a.every((item, i) => item === b[i])) return null;
  const sorted = (list: readonly string[]): string => [...list].sort().join('\n');
  return sorted(a) === sorted(b) ? 'order' : 'text';
}

/**
 * The longest common subsequence of two lists, as pairs of indexes (Hunt and Szymanski: for
 * each item of `b`, the places it has in `a`, latest first, through a longest increasing
 * sequence), in about (n + matches) log n.
 */
export function commonSubsequence(a: readonly string[], b: readonly string[]): [number, number][] {
  const places = new Map<string, number[]>();
  a.forEach((item, i) => {
    const list = places.get(item);
    if (list) list.push(i);
    else places.set(item, [i]);
  });
  const nodes: { i: number; j: number; prev: number }[] = [];
  /** The node ending the best sequence of each length, by length - 1. */
  const tails: number[] = [];
  b.forEach((item, j) => {
    const at = places.get(item) ?? [];
    for (let k = at.length - 1; k >= 0; k--) {
      const i = at[k] ?? 0;
      let lo = 0;
      let hi = tails.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if ((nodes[tails[mid] ?? 0]?.i ?? 0) < i) lo = mid + 1;
        else hi = mid;
      }
      nodes.push({ i, j, prev: lo > 0 ? (tails[lo - 1] ?? -1) : -1 });
      tails[lo] = nodes.length - 1;
    }
  });
  const pairs: [number, number][] = [];
  for (let n = tails.at(-1) ?? -1; n >= 0;) {
    const node = nodes[n];
    if (!node) break;
    pairs.push([node.i, node.j]);
    n = node.prev;
  }
  return pairs.reverse();
}

/** How many times each item is in a list. */
function tally(list: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of list) counts.set(item, (counts.get(item) ?? 0) + 1);
  return counts;
}

/**
 * The sections' differences in which and in what order: each stable identifier's occurrences
 * beyond the other side's are missing or extra; of the rest, those outside the longest
 * common subsequence are out of order. A section written twice is listed as often.
 */
function sectionOrder(
  ref: readonly string[],
  neu: readonly string[]
): { missing: string[]; extra: string[]; moved: string[] } {
  const [inRef, inNew] = [tally(ref), tally(neu)];
  const kept = tally(commonSubsequence(ref, neu).map(([i]) => ref[i] ?? ''));
  const missing: string[] = [];
  const extra: string[] = [];
  const moved: string[] = [];
  const repeat = (list: string[], id: string, times: number): void => {
    for (let k = 0; k < times; k++) list.push(id);
  };
  for (const id of new Set(ref)) repeat(missing, id, (inRef.get(id) ?? 0) - (inNew.get(id) ?? 0));
  for (const id of new Set(neu)) {
    const [r, n] = [inRef.get(id) ?? 0, inNew.get(id) ?? 0];
    repeat(extra, id, n - r);
    repeat(moved, id, Math.min(r, n) - (kept.get(id) ?? 0));
  }
  return { missing, extra, moved };
}

/** The pairs of sections compared: each identifier's k-th occurrence on each side. */
function pairSections(
  ref: readonly ReducedSection[],
  neu: readonly ReducedSection[]
): [ReducedSection, ReducedSection][] {
  const occurrences = (list: readonly ReducedSection[]): Map<string, ReducedSection[]> => {
    const by = new Map<string, ReducedSection[]>();
    for (const s of list) by.set(s.stId, [...(by.get(s.stId) ?? []), s]);
    return by;
  };
  const newBy = occurrences(neu);
  const pairs: [ReducedSection, ReducedSection][] = [];
  for (const [stId, list] of occurrences(ref)) {
    const others = newBy.get(stId) ?? [];
    list.forEach((s, k) => {
      const other = others[k];
      if (other) pairs.push([s, other]);
    });
  }
  return pairs;
}

/** A file's name without `.pdf`, as a title is compared with it. */
const stem = (file: string): string => fold(basename(file).replace(/\.pdf$/i, ''));

/**
 * Two reduced PDFs' differences, grouped by part, field and kind. `files` names each side's
 * file, whose name's stem each cover's title is compared with.
 */
export function compareReduced(
  file: string,
  ref: Reduced,
  neu: Reduced,
  files: { reference: string; new: string } = { reference: file, new: file }
): Difference[] {
  const out: Difference[] = [];
  const add = (d: Omit<Difference, 'file' | 'count'> & { count?: number }): void => {
    out.push({ file, count: d.events?.length ?? 1, ...d });
  };

  // the cover: its title compared by its hash, and said only to be its file's name or not
  if (ref.cover.title.hash !== neu.cover.title.hash) {
    const named = (title: Reduced['cover']['title'], name: string): 'same' | 'differs' =>
      title.hash === hash(stem(name)) ? 'same' : 'differs';
    add({
      part: 'cover',
      field: 'title',
      kind: 'value',
      reference: named(ref.cover.title, files.reference),
      new: named(neu.cover.title, files.new),
    });
  }
  for (const field of ['diagram', 'excerpt'] as const) {
    if (ref.cover[field] !== neu.cover[field]) {
      add({
        part: 'cover',
        field,
        kind: 'value',
        reference: ref.cover[field],
        new: neu.cover[field],
      });
    }
  }
  const names = { reference: ref.cover.names, new: neu.cover.names };
  if (ref.cover.names.count !== neu.cover.names.count) {
    add({ part: 'cover', field: 'names', kind: 'count', ...names });
  } else if (ref.cover.names.hash !== neu.cover.names.hash) {
    add({ part: 'cover', field: 'names', kind: 'value', ...names });
  }

  // the introduction
  for (const field of ['release', 'pathways', 'reactions'] as const) {
    const [a, b] = [ref.introduction[field], neu.introduction[field]];
    if (a !== b) add({ part: 'introduction', field, kind: 'value', reference: a, new: b });
  }

  // the analysis's properties
  if ((ref.analysis === null) !== (neu.analysis === null)) {
    add({ part: 'analysis', kind: ref.analysis ? 'missing' : 'extra' });
  } else if (ref.analysis && neu.analysis) {
    const keys = [...new Set([...Object.keys(ref.analysis), ...Object.keys(neu.analysis)])].sort();
    for (const field of keys) {
      const [a, b] = [ref.analysis[field], neu.analysis[field]];
      if (JSON.stringify(a) === JSON.stringify(b)) continue;
      const kind = a === undefined ? 'extra' : b === undefined ? 'missing' : 'value';
      add({ part: 'analysis', field, kind, reference: a ?? null, new: b ?? null });
    }
  }

  // the sections: which, and in what order
  const order = sectionOrder(
    ref.sections.map((s) => s.stId),
    neu.sections.map((s) => s.stId)
  );
  if (order.missing.length > 0) add({ part: 'sections', kind: 'missing', events: order.missing });
  if (order.extra.length > 0) add({ part: 'sections', kind: 'extra', events: order.extra });
  if (order.moved.length > 0) add({ part: 'sections', kind: 'order', events: order.moved });

  // each section's parts and figure, grouped by field and kind across sections
  const grouped = new Map<string, Difference>();
  const note = (
    part: 'section' | 'figure',
    field: string | undefined,
    kind: Difference['kind'],
    stId: string
  ): void => {
    const key = `${part}\0${field ?? ''}\0${kind}`;
    let d = grouped.get(key);
    if (!d) {
      d = { file, part, ...(field === undefined ? {} : { field }), kind, count: 0, events: [] };
      grouped.set(key, d);
    }
    d.events?.push(stId);
    d.count++;
  };
  for (const [a, b] of pairSections(ref.sections, neu.sections)) {
    const byPart = (s: ReducedSection): Map<PartName, string[]> =>
      new Map(s.parts.map((p) => [p.part, p.items]));
    const [pa, pb] = [byPart(a), byPart(b)];
    for (const part of new Set([...pa.keys(), ...pb.keys()])) {
      const [ia, ib] = [pa.get(part), pb.get(part)];
      if (!ia) note('section', part, 'extra', a.stId);
      else if (!ib) note('section', part, 'missing', a.stId);
      else {
        const kind = listKind(ia, ib);
        if (kind) note('section', part, kind, a.stId);
      }
    }
    // a figure of a kind not read is compared only as being there
    if (a.figure !== b.figure) {
      if (a.figure === 'none') note('figure', undefined, 'extra', a.stId);
      else if (b.figure === 'none') note('figure', undefined, 'missing', a.stId);
      else if (a.figure !== 'figure' && b.figure !== 'figure') {
        note('figure', undefined, 'kind', a.stId);
      }
    }
  }
  out.push(...grouped.values());

  if ((ref.contents === null) !== (neu.contents === null)) {
    add({ part: 'contents', kind: ref.contents ? 'missing' : 'extra' });
  } else if (ref.contents && neu.contents) {
    compareContents(ref.contents, neu.contents, add);
  }

  if (ref.shortEntries !== neu.shortEntries) {
    add({
      part: 'short-entries',
      kind: 'count',
      reference: ref.shortEntries,
      new: neu.shortEntries,
    });
  }
  return out;
}

/** The contents lists: their entries, their order, and each entry's target. */
function compareContents(
  ref: readonly ContentsItem[],
  neu: readonly ContentsItem[],
  add: (d: Omit<Difference, 'file' | 'count'> & { count?: number }) => void
): void {
  const remaining = neu.map((e) => e.title);
  let gone = 0;
  for (const entry of ref) {
    const at = remaining.indexOf(entry.title);
    if (at < 0) gone++;
    else remaining.splice(at, 1);
  }
  if (gone > 0) add({ part: 'contents', kind: 'missing', count: gone });
  if (remaining.length > 0) add({ part: 'contents', kind: 'extra', count: remaining.length });
  if (gone === 0 && remaining.length === 0) {
    const [ta, tb] = [ref.map((e) => e.title), neu.map((e) => e.title)];
    if (listKind(ta, tb) === 'order') add({ part: 'contents', kind: 'order' });
  }
  // each entry's target, matched by title occurrence by occurrence: a target not read on
  // either side is a difference of its own, never a pass
  const targets = new Map<string, (string | null)[]>();
  for (const entry of neu)
    targets.set(entry.title, [...(targets.get(entry.title) ?? []), entry.target]);
  let wrong = 0;
  let unread = 0;
  for (const entry of ref) {
    const target = targets.get(entry.title)?.shift();
    if (target === undefined) continue;
    if (entry.target === null || target === null) unread++;
    else if (target !== entry.target) wrong++;
  }
  if (wrong > 0) add({ part: 'contents', kind: 'target', count: wrong });
  if (unread > 0) add({ part: 'contents', kind: 'missing-target', count: unread });
}

/**
 * The differences with those `--expected` records marked, with their reasons, and the
 * records that matched nothing, by their place in the file. A record naming events covers
 * only those, and never a difference that names none.
 */
export function applyRecorded(
  differences: readonly Difference[],
  recorded: readonly Recorded[]
): { differences: Difference[]; unmatched: number[] } {
  const used = new Set<number>();
  const out: Difference[] = [];
  for (const difference of differences) {
    let rest: Difference | null = { ...difference };
    for (const [index, record] of recorded.entries()) {
      if (!rest) break;
      if (record.part !== rest.part || record.kind !== rest.kind) continue;
      if (record.field !== undefined && record.field !== rest.field) continue;
      if (record.file !== undefined && record.file !== rest.file) continue;
      if (record.events === undefined) {
        out.push({ ...rest, recorded: record.reason });
        used.add(index);
        rest = null;
        continue;
      }
      if (rest.events === undefined) continue;
      const events: string[] = rest.events;
      const covered = events.filter((e) => record.events?.includes(e));
      if (covered.length === 0) continue;
      used.add(index);
      out.push({ ...rest, events: covered, count: covered.length, recorded: record.reason });
      const left = events.filter((e) => !covered.includes(e));
      rest = left.length > 0 ? { ...rest, events: left, count: left.length } : null;
    }
    if (rest) out.push(rest);
  }
  return { differences: out, unmatched: recorded.flatMap((_, i) => (used.has(i) ? [] : [i])) };
}

const RECORD_KEYS = new Set(['part', 'kind', 'field', 'file', 'events', 'reason']);

/** The recorded differences, from `--expected`'s file: `{ "differences": [...] }`. */
export function readRecorded(path: string): Recorded[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new SettingsError(
      `${path} cannot be read as JSON (${error instanceof Error ? error.name : 'error'})`
    );
  }
  const list =
    parsed !== null && typeof parsed === 'object' && 'differences' in parsed
      ? parsed.differences
      : undefined;
  if (!Array.isArray(list)) throw new SettingsError(`${path} holds no "differences" list`);
  return list.map((item: unknown, i) => {
    const text = (v: unknown): v is string => typeof v === 'string' && v !== '';
    if (!isRecord(item) || Array.isArray(item)) {
      throw new SettingsError(`${path}: difference ${String(i)} is not an object`);
    }
    const unknown = Object.keys(item).filter((key) => !RECORD_KEYS.has(key));
    if (unknown.length > 0) {
      throw new SettingsError(
        `${path}: difference ${String(i)} has keys not known: ${unknown.join(', ')}`
      );
    }
    const { part, kind, reason, field, file, events } = item;
    if (
      !text(part) ||
      !text(kind) ||
      !text(reason) ||
      !(field === undefined || text(field)) ||
      !(file === undefined || text(file)) ||
      !(events === undefined || (Array.isArray(events) && events.every(text)))
    ) {
      throw new SettingsError(
        `${path}: difference ${String(i)} needs a part, a kind and a reason, and its field, file and events as text`
      );
    }
    return {
      part,
      kind,
      ...(field === undefined ? {} : { field }),
      ...(file === undefined ? {} : { file }),
      ...(events === undefined ? {} : { events }),
      reason,
    };
  });
}

/** One PDF, reduced; its bytes read once and handed to pdf.js. */
export async function reducePdf(path: string, margin = MARGIN_BAND_PT): Promise<Reduced> {
  const bytes = readFileSync(path);
  // a plain view over the Buffer's memory, not a copy: pdf.js refuses a Buffer
  return reduce(
    await readLayout(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), { margin })
  );
}

export interface CompareOptions {
  /** The reference's margin band, in points (read.ts). */
  referenceMargin?: number;
  /** Told of each file that could not be read, by path, never its content. */
  unreadable?: (path: string, error: unknown) => void;
}

/** A reference and a new side, each a PDF or a folder of them, compared (contracts/cli.md). */
export async function comparePaths(
  reference: string,
  neu: string,
  { referenceMargin = MARGIN_BAND_PT, unreadable = () => undefined }: CompareOptions = {}
): Promise<Difference[]> {
  const folder = (path: string): boolean => statSync(path).isDirectory();
  const [refFolder, newFolder] = [folder(reference), folder(neu)];
  if (refFolder !== newFolder) {
    throw new SettingsError('The reference and the new side must both be PDFs or both be folders');
  }
  /** Both sides reduced and compared; a side that cannot be read, a difference. */
  const pair = async (file: string, refPath: string, newPath: string): Promise<Difference[]> => {
    const read = async (path: string, margin: number): Promise<Reduced | null> => {
      try {
        return await reducePdf(path, margin);
      } catch (error) {
        unreadable(path, error);
        return null;
      }
    };
    const a = await read(refPath, referenceMargin);
    const b = await read(newPath, MARGIN_BAND_PT);
    const failed: Difference[] = [];
    if (!a) failed.push({ file, part: 'file', field: 'reference', kind: 'unreadable', count: 1 });
    if (!b) failed.push({ file, part: 'file', field: 'new', kind: 'unreadable', count: 1 });
    if (!a || !b) return failed;
    // A side with no section the reader recognised was not read, whatever else
    // it holds: two such sides are not "the same".
    const unread: Difference[] = [];
    if (a.sections.length === 0)
      unread.push({ file, part: 'sections', field: 'reference', kind: 'unreadable', count: 1 });
    if (b.sections.length === 0)
      unread.push({ file, part: 'sections', field: 'new', kind: 'unreadable', count: 1 });
    return [...unread, ...compareReduced(file, a, b, { reference: refPath, new: newPath })];
  };
  if (!refFolder) return pair(basename(neu), reference, neu);
  const pdfs = (path: string): string[] =>
    readdirSync(path)
      .filter((name) => name.toLowerCase().endsWith('.pdf'))
      .sort();
  const [refFiles, newFiles] = [pdfs(reference), pdfs(neu)];
  // A folder with no PDF compares nothing: not a pass.
  for (const [path, files] of [
    [reference, refFiles],
    [neu, newFiles],
  ] as const)
    if (files.length === 0) throw new SettingsError(`${path} holds no PDF`);
  const out: Difference[] = [];
  for (const file of refFiles) {
    if (!newFiles.includes(file)) out.push({ file, part: 'file', kind: 'missing', count: 1 });
  }
  for (const file of newFiles) {
    if (!refFiles.includes(file)) out.push({ file, part: 'file', kind: 'extra', count: 1 });
  }
  for (const file of refFiles.filter((f) => newFiles.includes(f))) {
    out.push(...(await pair(file, join(reference, file), join(neu, file))));
  }
  return out;
}

export interface CompareSettings {
  reference: string;
  neu: string;
  expected: string | null;
  referenceMargin: number;
}

export function compareSettings(args: readonly string[]): CompareSettings {
  const paths: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    if (!arg.startsWith('--')) {
      paths.push(arg);
      continue;
    }
    const [name = '', inline] = arg.split(/=(.*)/s, 2);
    if (name !== '--expected' && name !== '--reference-margin') {
      throw new SettingsError(`Unknown argument: ${name}`);
    }
    const value = inline ?? args[++i];
    if (value === undefined || value === '') throw new SettingsError(`${name} needs a value`);
    if (flags.has(name)) throw new SettingsError(`${name} is given twice`);
    flags.set(name, value);
  }
  const [reference, neu] = paths;
  if (paths.length !== 2 || !reference || !neu) {
    throw new SettingsError('Two paths are needed: pdf-export compare <reference> <new>');
  }
  const margin = flags.get('--reference-margin');
  const referenceMargin = margin === undefined ? MARGIN_BAND_PT : Number(margin);
  if (!Number.isFinite(referenceMargin) || referenceMargin < 0 || referenceMargin > 300) {
    throw new SettingsError('--reference-margin is a number of points, 0 to 300');
  }
  return { reference, neu, expected: flags.get('--expected') ?? null, referenceMargin };
}

export { errorKind };

/** The console's methods that write: those held while a comparison runs. */
const WRITING = [
  'log',
  'info',
  'warn',
  'error',
  'debug',
  'trace',
  'dir',
  'dirxml',
  'table',
  'group',
  'groupCollapsed',
  'groupEnd',
  'count',
  'countReset',
  'time',
  'timeEnd',
  'timeLog',
  'assert',
] as const;

/**
 * `run`, with the console held for its length: each of its methods that writes (WRITING) is
 * replaced by one that counts the call and keeps the kinds of the errors it was passed, and
 * is put back after, whether `run` succeeds or fails; its other members (`Console`,
 * `context`, `createTask` and the profiler's) are left alone. A library writing to the
 * console (pdf.js's warnings quote a file's content) is not printed: the calls are said
 * once, in one line on standard error, with those kinds, never their words. Standard error
 * itself is not held: what `compare` writes there is its own.
 */
export async function withConsoleHeld<T>(
  run: () => Promise<T>,
  err: (text: string) => void
): Promise<T> {
  const names = WRITING.filter((name) => typeof Reflect.get(console, name) === 'function');
  // the methods as they are, put back as they were
  const saved = names.map((name): [string, unknown] => [name, Reflect.get(console, name)]);
  let count = 0;
  const kinds = new Set<string>();
  const held = (...args: unknown[]): void => {
    count++;
    for (const arg of args) if (arg instanceof Error) kinds.add(errorKind(arg));
  };
  for (const name of names) Reflect.set(console, name, held);
  try {
    return await run();
  } finally {
    for (const [name, method] of saved) Reflect.set(console, name, method);
    if (count > 0) {
      const of = kinds.size > 0 ? ` (${[...kinds].sort().join(', ')})` : '';
      err(`${String(count)} message(s) from a library withheld${of}\n`);
    }
  }
}

/**
 * `pdf-export compare <reference> <new> [--expected <file>] [--reference-margin <pt>]`: the
 * report as JSON on standard output; exit 0 with no difference (or none not recorded, with
 * `--expected`), 1 with one, 2 on bad arguments or any other error. A file that cannot be
 * read is named on standard error and is a difference; the others are still compared.
 */
export async function compareCommand(
  args: readonly string[],
  {
    out,
    err,
    output = new Output(),
  }: { out: (text: string) => void; err: (text: string) => void; output?: Output }
): Promise<number> {
  let settings: CompareSettings;
  let recorded: Recorded[] = [];
  try {
    settings = compareSettings(args);
    if (settings.expected !== null) recorded = readRecorded(settings.expected);
  } catch (error) {
    err(`${error instanceof SettingsError ? error.message : errorKind(error)}\n`);
    return 2;
  }
  let result: { differences: Difference[]; unmatched: number[] };
  try {
    const { reference, neu, referenceMargin } = settings;
    const found = await withConsoleHeld(
      () =>
        comparePaths(reference, neu, {
          referenceMargin,
          unreadable: (path, error) => {
            err(`Not read: ${path} (${errorKind(error)})\n`);
          },
        }),
      err
    );
    result = applyRecorded(found, recorded);
  } catch (error) {
    err(
      `The comparison stopped: ${error instanceof SettingsError ? error.message : errorKind(error)}\n`
    );
    return 2;
  }
  const { differences, unmatched } = result;
  const unrecorded = differences.filter((d) => d.recorded === undefined).length;
  const report = {
    reference: settings.reference,
    new: settings.neu,
    counts: {
      differences: differences.length,
      recorded: differences.length - unrecorded,
      unrecorded,
    },
    differences: differences.map((d) => output.difference(d)),
    /** The records of `--expected` that matched no difference, by their place in its list. */
    unmatched,
  };
  out(`${JSON.stringify(report, null, 2)}\n`);
  return unrecorded > 0 ? 1 : 0;
}
