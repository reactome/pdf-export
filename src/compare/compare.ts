// FR-012's comparison (spec 001 T035, contracts/cli.md `compare`, research R8): a reference
// (`event-pdf`'s output) and the new output, each a PDF or a folder of them, reduced to
// FR-012's parts (reduce.ts) and compared part by part. A folder is compared file by file,
// by name, as today's book is one file per top-level pathway, named after it.
//
// Each difference is reported by its part, its field and its kind, with a count and the
// stable identifiers of the sections it is in. No text of a section is printed, and the
// cover's names only as a count and a hash (FR-013): the report holds a pathway's title,
// the introduction's numbers and the analysis's properties, none of which names a person.
// A list in another order is a difference of its own kind, `order`, which `--expected`
// records like any other (the spec's expected differences: today's lists are in the
// database's order, the new ones in the curators').
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

import { SettingsError } from '../preflight/command.ts';
import { readLayout } from './read.ts';
import { reduce, type Reduced, type ReducedPart } from './reduce.ts';

export interface Difference {
  /** The file compared, by name. */
  file: string;
  part:
    | 'file'
    | 'cover'
    | 'introduction'
    | 'analysis'
    | 'sections'
    | 'section'
    | 'contents'
    | 'figure'
    | 'short-entries';
  /** Which of the part's fields: a cover's `names`, a section's `summation`; none for some. */
  field?: string;
  /** `value`, `text`, `order`, `missing` (on the new side), `extra` or `kind`. */
  kind: string;
  count: number;
  /** The sections it is in, by stable identifier. */
  events?: string[];
  /** Each side's value, where it names no one: the cover's names as a count and a hash. */
  reference?: unknown;
  new?: unknown;
  /** Why it is expected, where `--expected` records it. */
  recorded?: string;
}

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
function listKind(a: readonly string[], b: readonly string[]): 'text' | 'order' | null {
  if (a.length === b.length && a.every((item, i) => item === b[i])) return null;
  const sorted = (list: readonly string[]) => [...list].sort().join('\n');
  return sorted(a) === sorted(b) ? 'order' : 'text';
}

/** Two reduced PDFs' differences, grouped by part, field and kind. */
export function compareReduced(file: string, ref: Reduced, neu: Reduced): Difference[] {
  const out: Difference[] = [];
  const add = (d: Omit<Difference, 'file' | 'count'> & { count?: number }) => {
    out.push({ file, count: d.events?.length ?? 1, ...d });
  };

  // the cover
  if (ref.cover.title !== neu.cover.title) {
    add({
      part: 'cover',
      field: 'title',
      kind: 'value',
      reference: ref.cover.title,
      new: neu.cover.title,
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
      if (a === b) continue;
      const kind = a === undefined ? 'extra' : b === undefined ? 'missing' : 'value';
      add({ part: 'analysis', field, kind, reference: a ?? null, new: b ?? null });
    }
  }

  // the sections: which, and in what order
  const refIds = ref.sections.map((s) => s.stId);
  const newIds = neu.sections.map((s) => s.stId);
  const missing = refIds.filter((id) => !newIds.includes(id));
  const extra = newIds.filter((id) => !refIds.includes(id));
  if (missing.length > 0) add({ part: 'sections', kind: 'missing', events: missing });
  if (extra.length > 0) add({ part: 'sections', kind: 'extra', events: extra });
  const common = refIds.filter((id) => newIds.includes(id));
  const commonNew = newIds.filter((id) => refIds.includes(id));
  const moved = commonNew.filter((id, i) => id !== common[i]);
  if (moved.length > 0) add({ part: 'sections', kind: 'order', events: moved });

  // each section's parts and figure, grouped by field and kind across sections
  const grouped = new Map<string, Difference>();
  const note = (
    field: string,
    kind: string,
    stId: string,
    part: Difference['part'] = 'section'
  ) => {
    const key = `${part}\0${field}\0${kind}`;
    let d = grouped.get(key);
    if (!d) {
      d = { file, part, ...(part === 'section' ? { field } : {}), kind, count: 0, events: [] };
      grouped.set(key, d);
    }
    d.events?.push(stId);
    d.count++;
  };
  for (const stId of common) {
    const a = ref.sections.find((s) => s.stId === stId);
    const b = neu.sections.find((s) => s.stId === stId);
    if (!a || !b) continue;
    const byPart = (parts: readonly ReducedPart[]) => new Map(parts.map((p) => [p.part, p.items]));
    const [pa, pb] = [byPart(a.parts), byPart(b.parts)];
    for (const part of new Set([...pa.keys(), ...pb.keys()])) {
      const [ia, ib] = [pa.get(part), pb.get(part)];
      if (!ia) note(part, 'extra', stId);
      else if (!ib) note(part, 'missing', stId);
      else {
        const kind = listKind(ia, ib);
        if (kind) note(part, kind, stId);
      }
    }
    // a figure of a kind not read is compared only as being there
    if (a.figure !== b.figure) {
      if (a.figure === 'none') note('figure', 'extra', stId, 'figure');
      else if (b.figure === 'none') note('figure', 'missing', stId, 'figure');
      else if (a.figure !== 'figure' && b.figure !== 'figure')
        note('figure', 'kind', stId, 'figure');
    }
  }
  out.push(...grouped.values());

  // the contents list: its entries, their order and their targets
  if ((ref.contents === null) !== (neu.contents === null)) {
    add({ part: 'contents', kind: ref.contents ? 'missing' : 'extra' });
  } else if (ref.contents && neu.contents) {
    const key = (e: { title: string; target: string | null }) => e.title;
    const remaining = neu.contents.map(key);
    let gone = 0;
    for (const entry of ref.contents) {
      const at = remaining.indexOf(key(entry));
      if (at < 0) gone++;
      else remaining.splice(at, 1);
    }
    if (gone > 0) add({ part: 'contents', kind: 'missing', count: gone });
    if (remaining.length > 0) add({ part: 'contents', kind: 'extra', count: remaining.length });
    if (gone === 0 && remaining.length === 0) {
      const [ta, tb] = [ref.contents.map(key), neu.contents.map(key)];
      if (listKind(ta, tb) === 'order') add({ part: 'contents', kind: 'order' });
    }
    // an entry's target, where both sides read one: matched by title, in turn
    const targets = new Map<string, (string | null)[]>();
    for (const entry of neu.contents) {
      targets.set(entry.title, [...(targets.get(entry.title) ?? []), entry.target]);
    }
    let wrong = 0;
    for (const entry of ref.contents) {
      const target = targets.get(entry.title)?.shift();
      if (
        entry.target !== null &&
        target !== undefined &&
        target !== null &&
        target !== entry.target
      ) {
        wrong++;
      }
    }
    if (wrong > 0) add({ part: 'contents', kind: 'target', count: wrong });
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

/**
 * The differences with those `--expected` records marked, with their reasons. A record
 * naming events covers only those: a difference's other events stay unrecorded, apart.
 */
export function applyRecorded(
  differences: readonly Difference[],
  recorded: readonly Recorded[]
): Difference[] {
  const out: Difference[] = [];
  for (const difference of differences) {
    let rest: Difference | null = { ...difference };
    for (const record of recorded) {
      if (!rest) break;
      if (record.part !== rest.part || record.kind !== rest.kind) continue;
      if (record.field !== undefined && record.field !== rest.field) continue;
      if (record.file !== undefined && record.file !== rest.file) continue;
      if (record.events === undefined || rest.events === undefined) {
        out.push({ ...rest, recorded: record.reason });
        rest = null;
        continue;
      }
      const events: string[] = rest.events;
      const covered = events.filter((e) => record.events?.includes(e));
      if (covered.length === 0) continue;
      out.push({ ...rest, events: covered, count: covered.length, recorded: record.reason });
      const left = events.filter((e) => !covered.includes(e));
      rest = left.length > 0 ? { ...rest, events: left, count: left.length } : null;
    }
    if (rest) out.push(rest);
  }
  return out;
}

/** The recorded differences, from `--expected`'s file: `{ "differences": [...] }`. */
export function readRecorded(path: string): Recorded[] {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const list =
    parsed !== null && typeof parsed === 'object' && 'differences' in parsed
      ? parsed.differences
      : undefined;
  if (!Array.isArray(list)) throw new SettingsError(`${path} holds no "differences" list`);
  return list.map((item: unknown, i) => {
    const r = item as Partial<Recorded> | null;
    const text = (v: unknown) => typeof v === 'string' && v !== '';
    const ok =
      r !== null &&
      typeof r === 'object' &&
      text(r.part) &&
      text(r.kind) &&
      text(r.reason) &&
      (r.field === undefined || text(r.field)) &&
      (r.file === undefined || text(r.file)) &&
      (r.events === undefined || (Array.isArray(r.events) && r.events.every(text)));
    if (!ok) {
      throw new SettingsError(
        `${path}: difference ${String(i)} needs a part, a kind and a reason, and its field, file and events as text`
      );
    }
    return r as Recorded;
  });
}

/** One PDF, reduced. */
export async function reducePdf(path: string): Promise<Reduced> {
  return reduce(await readLayout(new Uint8Array(readFileSync(path))));
}

/** A reference and a new side, each a PDF or a folder of them, compared (contracts/cli.md). */
export async function comparePaths(reference: string, neu: string): Promise<Difference[]> {
  const folder = (path: string) => statSync(path).isDirectory();
  const [refFolder, newFolder] = [folder(reference), folder(neu)];
  if (refFolder !== newFolder) {
    throw new SettingsError('The reference and the new side must both be PDFs or both be folders');
  }
  if (!refFolder) {
    return compareReduced(basename(neu), await reducePdf(reference), await reducePdf(neu));
  }
  const pdfs = (path: string) =>
    readdirSync(path)
      .filter((name) => name.toLowerCase().endsWith('.pdf'))
      .sort();
  const [refFiles, newFiles] = [pdfs(reference), pdfs(neu)];
  const out: Difference[] = [];
  for (const file of refFiles) {
    if (!newFiles.includes(file)) out.push({ file, part: 'file', kind: 'missing', count: 1 });
  }
  for (const file of newFiles) {
    if (!refFiles.includes(file)) out.push({ file, part: 'file', kind: 'extra', count: 1 });
  }
  for (const file of refFiles.filter((f) => newFiles.includes(f))) {
    out.push(
      ...compareReduced(
        file,
        await reducePdf(join(reference, file)),
        await reducePdf(join(neu, file))
      )
    );
  }
  return out;
}

export interface CompareSettings {
  reference: string;
  neu: string;
  expected: string | null;
}

export function compareSettings(args: readonly string[]): CompareSettings {
  const paths: string[] = [];
  let expected: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    if (!arg.startsWith('--')) {
      paths.push(arg);
      continue;
    }
    const [name = '', inline] = arg.split(/=(.*)/s, 2);
    if (name !== '--expected') throw new SettingsError(`Unknown argument: ${name}`);
    const value = inline ?? args[++i];
    if (value === undefined || value === '') throw new SettingsError(`${name} needs a value`);
    if (expected !== null) throw new SettingsError(`${name} is given twice`);
    expected = value;
  }
  const [reference, neu] = paths;
  if (paths.length !== 2 || !reference || !neu) {
    throw new SettingsError('Two paths are needed: pdf-export compare <reference> <new>');
  }
  return { reference, neu, expected };
}

/**
 * `pdf-export compare <reference> <new> [--expected <file>]`: the report as JSON on standard
 * output; exit 0 with no difference (or none not recorded, with `--expected`), 1 with one,
 * 2 on bad arguments, a path that cannot be read or any other error.
 */
export async function compareCommand(
  args: readonly string[],
  { out, err }: { out: (text: string) => void; err: (text: string) => void }
): Promise<number> {
  let settings: CompareSettings;
  let recorded: Recorded[] = [];
  try {
    settings = compareSettings(args);
    if (settings.expected !== null) recorded = readRecorded(settings.expected);
  } catch (error) {
    if (error instanceof SettingsError) {
      err(`${error.message}\n`);
      return 2;
    }
    // the file's text is never printed: it may be anything
    err(
      `The recorded differences cannot be read: ${error instanceof Error ? error.name : 'error'}\n`
    );
    return 2;
  }
  let differences: Difference[];
  try {
    differences = applyRecorded(await comparePaths(settings.reference, settings.neu), recorded);
  } catch (error) {
    // the error's message (a path, or pdf.js's word on a file it cannot read), never a text
    err(`The comparison stopped: ${error instanceof Error ? error.message : 'error'}\n`);
    return 2;
  }
  const unrecorded = differences.filter((d) => d.recorded === undefined).length;
  const report = {
    reference: settings.reference,
    new: settings.neu,
    counts: {
      differences: differences.length,
      recorded: differences.length - unrecorded,
      unrecorded,
    },
    differences,
  };
  out(`${JSON.stringify(report, null, 2)}\n`);
  return unrecorded > 0 ? 1 : 0;
}
