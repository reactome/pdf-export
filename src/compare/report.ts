// The analysis report's comparison by meaning (spec 002 T019, FR-208): today's report and
// pdf-export's, each read with spec 001's reader (read.ts) and reduced to FR-208's parts:
// the cover's title, the analysis's name, its release and its link to the result; the
// properties; the pathways reported, in order, with their statistics; each pathway's detail
// (spec 001's sections, reduce.ts, with the edit history's rows read as the report compares
// them); the identifiers found per resource, with their values, and the interactors; the
// identifiers not found.
//
// What it prints passes through spec 001's printer (output.ts): counts, a few values of
// strict shapes, and salted hashes; never a name, and never a submitted identifier, which
// is the analysis's user's own (FR-211). The parts are found by their headings: pdf-export's,
// and other words for them; today's own are for the comparison's run to add from its real
// files, as spec 001's were (its T040), and a heading not known leaves its part unread,
// which is reported as a difference, never a pass.
import { readFileSync } from 'node:fs';

import { SettingsError } from '../preflight/command.ts';
import { errorKind } from '../print/unread.ts';
import { REPORT_TITLE } from '../report/text.ts';
import {
  applyRecorded,
  compareReduced,
  listKind,
  readRecorded,
  withConsoleHeld,
  type Recorded,
} from './compare.ts';
import { Output, fold, hash, withhold, type Difference, type Withheld } from './output.ts';
import { MARGIN_BAND_PT, readLayout, type Layout, type Line } from './read.ts';
import { HEADING_RATIO, bodySize, reduce, type Reduced } from './reduce.ts';

/** The report's parts after its details, by the headings they are known by. */
const REPORT_PARTS = {
  overview: [/^genome-wide overview$/i, /^pathways overview$/i],
  pathways: [/^most significant pathways$/i],
  details: [/^pathway details$/i],
  found: [/^identifiers found$/i],
  notFound: [/^identifiers not found$/i],
} as const;

type ReportPartName = keyof typeof REPORT_PARTS;
const REPORT_PART_NAMES: readonly ReportPartName[] = [
  'overview',
  'pathways',
  'details',
  'found',
  'notFound',
];

/** Any of them: a heading that ends a section's region. */
const STOPS = new RegExp(
  Object.values(REPORT_PARTS)
    .flat()
    .map((pattern) => pattern.source)
    .join('|'),
  'i'
);

/** The statistics of a pathway's row: entities found, total, ratio, p-value, FDR; reactions found, total, ratio. */
const STATISTICS = 8;

/** A number as a table prints it, at a row's end; a cell's text may run into the next. */
const NUMBER = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
/** A row: its name, then its eight statistics, the first of which may follow the name with no space. */
const ROW = new RegExp(`^(.*?)(${NUMBER})((?:\\s+${NUMBER}){${String(STATISTICS - 1)}})\\s*$`);

/** A line's text as parsed: compatibility forms folded, its spaces kept (fold drops them). */
const read = (text: string): string =>
  text
    .normalize('NFKC')
    .replace(/\u2060/g, '')
    .trim();

export interface PathwayRow {
  /** Its name, withheld: it is the curators', but a misread row could hold anything. */
  name: Withheld;
  statistics: number[];
}

export interface ResourceRows {
  /** The resource's label as the heading names it, withheld. */
  label: Withheld;
  /** The heading's counts: its identifiers and the Reactome entities they map to. */
  counts: number[];
  /** Each row, hashed: a submitted identifier, its mappings and its values. */
  rows: string[];
}

export interface ReportReduced {
  cover: { title: 'same' | 'differs'; name: Withheld; release: number | null; link: boolean };
  /** The properties, the details' sections and their figures: spec 001's reading. */
  reduced: Reduced;
  /** Null where the part was not found. */
  pathways: PathwayRow[] | null;
  found: ResourceRows[] | null;
  interactors: ResourceRows[] | null;
  notFound: string[] | null;
}

/** A report's layout reduced to FR-208's parts. */
export function reduceReport(layout: Layout): ReportReduced {
  const { lines } = layout;
  const body = bodySize(lines.filter((line) => line.page > 0));
  const heading = (line: Line): boolean => line.size >= body * HEADING_RATIO;
  const starts = new Map<ReportPartName, number>();
  lines.forEach((line, i) => {
    if (line.page === 0 || !heading(line)) return;
    const text = read(line.text);
    const name = REPORT_PART_NAMES.find((part) =>
      REPORT_PARTS[part].some((pattern) => pattern.test(text))
    );
    if (name && !starts.has(name)) starts.set(name, i);
  });
  /** A part's lines, after its heading, up to the next heading of the report's parts. */
  const region = (part: ReportPartName): Line[] | null => {
    const at = starts.get(part);
    if (at === undefined) return null;
    const ends = [...starts.values()].filter((i) => i > at);
    const end = ends.length > 0 ? Math.min(...ends) : lines.length;
    return lines.slice(at + 1, end).filter((line) => !heading(line));
  };
  const foundRegion = region('found');
  return {
    cover: cover(
      lines.filter((line) => line.page === 0),
      layout.links.some(
        (link) =>
          link.box.page === 0 && link.uri !== null && /[?&#](?:analysis|ANALYSIS)=/.test(link.uri)
      )
    ),
    reduced: reduce(layout, { editRows: 'report', stops: STOPS }),
    pathways: pathwayRows(region('pathways')),
    found: foundRegion ? resourceRows(foundRegion, false) : null,
    interactors: foundRegion ? resourceRows(foundRegion, true) : null,
    notFound: notFound(region('notFound')),
  };
}

/** The cover: its title said to be the report's or not, the name after it, its release. */
function cover(page: readonly Line[], link: boolean): ReportReduced['cover'] {
  const texts = page.map((line) => read(line.text)).filter((text) => text !== '');
  const at = texts.findIndex(
    (text) => fold(text).toLowerCase() === fold(REPORT_TITLE).toLowerCase()
  );
  const release = /release\s*(\d+)/i.exec(texts.join(' '))?.[1];
  return {
    title: at >= 0 ? 'same' : 'differs',
    name: withhold(fold(at >= 0 ? (texts[at + 1] ?? '') : '')),
    release: release === undefined ? null : Number(release),
    link,
  };
}

/**
 * The table's rows: each begins with its name and ends in its eight statistics, a long
 * name's other words on the lines after it, up to the next row. The header has none.
 */
function pathwayRows(region: readonly Line[] | null): PathwayRow[] | null {
  if (region === null) return null;
  const rows: { name: string[]; statistics: number[] }[] = [];
  for (const line of region) {
    const text = read(line.text);
    const row = ROW.exec(text);
    if (row) {
      const statistics = [row[2] ?? '', ...(row[3] ?? '').trim().split(/\s+/)].map(Number);
      rows.push({ name: [row[1] ?? ''], statistics });
    } else {
      // a long name's next lines, after its row's first; before the first row, the header
      rows.at(-1)?.name.push(text);
    }
  }
  return rows.map((row) => ({
    name: withhold(fold(row.name.join(' '))),
    statistics: row.statistics,
  }));
}

/** A heading of the identifiers found: a resource, its identifiers and their entities. */
const FOUND_HEADING = /^(.+?):\s*(\d+)\s+identifiers?\s+mapping\s+to\s+(\d+)\s+Reactome\s+entit/i;
/** A heading of the interactors found: the resource they interact through, and how many. */
const INTERACTOR_HEADING = /^Interactors\s+through\s+(.+?):\s*(\d+)\s*$/i;

/** The identifiers found, or the interactors: their headings' counts and their rows hashed. */
function resourceRows(region: readonly Line[], interactors: boolean): ResourceRows[] {
  const out: ResourceRows[] = [];
  let current: ResourceRows | null = null;
  for (const line of region) {
    const text = read(line.text);
    const found = FOUND_HEADING.exec(text);
    const interacting = INTERACTOR_HEADING.exec(text);
    if (found || interacting) {
      current = null;
      if (interacting && interactors) {
        current = {
          label: withhold(interacting[1] ?? ''),
          counts: [Number(interacting[2])],
          rows: [],
        };
      }
      if (found && !interactors) {
        current = {
          label: withhold(found[1] ?? ''),
          counts: [Number(found[2]), Number(found[3])],
          rows: [],
        };
      }
      if (current) out.push(current);
      continue;
    }
    // a table's header names its columns; a row begins with an identifier
    if (!current || /^identifier\b/i.test(text) || text === '') continue;
    current.rows.push(hash(fold(text)));
  }
  return out;
}

/** The identifiers not found, each row hashed, the table's header left out. */
function notFound(region: readonly Line[] | null): string[] | null {
  if (region === null) return null;
  return region
    .map((line) => read(line.text))
    .filter((text) => text !== '' && !/^identifier\b/i.test(text))
    .map((text) => hash(fold(text)));
}

/** Two statistics agree when they print the same at three significant figures. */
export function sameStatistic(a: number, b: number): boolean {
  if (a === b) return true;
  return Number(a.toPrecision(3)) === Number(b.toPrecision(3));
}

/** The two reports' differences, by FR-208's parts. */
export function compareReports(file: string, ref: ReportReduced, neu: ReportReduced): Difference[] {
  const out: Difference[] = [];
  const add = (d: Omit<Difference, 'file' | 'count'> & { count?: number }): void => {
    out.push({ file, count: d.count ?? 1, ...d });
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
  if (ref.cover.name.hash !== neu.cover.name.hash) {
    add({
      part: 'cover',
      field: 'name',
      kind: 'value',
      reference: ref.cover.name,
      new: neu.cover.name,
    });
  }
  if (ref.cover.release !== neu.cover.release) {
    add({
      part: 'cover',
      field: 'release',
      kind: 'value',
      reference: ref.cover.release,
      new: neu.cover.release,
    });
  }
  if (ref.cover.link !== neu.cover.link) {
    add({
      part: 'cover',
      field: 'link',
      kind: 'value',
      reference: ref.cover.link,
      new: neu.cover.link,
    });
  }

  // the properties and the details' sections and figures, as spec 001 compares them; its
  // cover, introduction and contents are spec 001's, not the report's, and are not compared
  const shell = (reduced: Reduced): Reduced => ({
    ...reduced,
    cover: {
      title: withhold(''),
      diagram: false,
      excerpt: false,
      names: { count: 0, hash: hash('') },
    },
    introduction: { release: null, pathways: null, reactions: null },
    contents: null,
    shortEntries: 0,
  });
  out.push(...compareReduced(file, shell(ref.reduced), shell(neu.reduced)));
  for (const [side, reduced] of [
    ['reference', ref.reduced],
    ['new', neu.reduced],
  ] as const) {
    if (reduced.analysis === null) add({ part: 'analysis', field: side, kind: 'unreadable' });
  }

  // the pathways reported: in order, each with its statistics
  comparePart('pathways', ref.pathways, neu.pathways, add, (a, b) => {
    const [na, nb] = [a.map((r) => r.name.hash), b.map((r) => r.name.hash)];
    if (a.length !== b.length) {
      add({ part: 'pathways', field: 'rows', kind: 'count', reference: a.length, new: b.length });
    } else {
      const kind = listKind(na, nb);
      if (kind) add({ part: 'pathways', field: 'rows', kind });
    }
    // each row of one name, by its place among the rows of its name: its statistics
    let differing = 0;
    for (const row of a) {
      const other = b.find((r) => r.name.hash === row.name.hash);
      if (!other) continue;
      if (
        row.statistics.length !== other.statistics.length ||
        row.statistics.some((value, i) => !sameStatistic(value, other.statistics[i] ?? NaN))
      ) {
        differing++;
      }
    }
    if (differing > 0)
      add({ part: 'pathways', field: 'statistics', kind: 'value', count: differing });
  });

  // the identifiers found and the interactors, per resource, by its heading's place
  for (const [field, a, b] of [
    ['entities', ref.found, neu.found],
    ['interactors', ref.interactors, neu.interactors],
  ] as const) {
    comparePart('found', a, b, add, (ra, rb) => {
      if (ra.length !== rb.length) {
        add({
          part: 'found',
          field: `${field}-resources`,
          kind: 'count',
          reference: ra.length,
          new: rb.length,
        });
      }
      ra.forEach((resource, i) => {
        const other = rb.find((r) => r.label.hash === resource.label.hash) ?? rb[i];
        if (!other) return;
        if (JSON.stringify(resource.counts) !== JSON.stringify(other.counts)) {
          add({
            part: 'found',
            field: `${field}-counts`,
            kind: 'value',
            reference: resource.counts.join(' '),
            new: other.counts.join(' '),
          });
        }
        const gone = resource.rows.filter((row) => !other.rows.includes(row)).length;
        const extra = other.rows.filter((row) => !resource.rows.includes(row)).length;
        if (gone > 0) add({ part: 'found', field, kind: 'missing', count: gone });
        if (extra > 0) add({ part: 'found', field, kind: 'extra', count: extra });
      });
    });
  }

  // the identifiers not found: a part both have, or neither
  comparePart('not-found', ref.notFound, neu.notFound, add, (a, b) => {
    const gone = a.filter((row) => !b.includes(row)).length;
    const extra = b.filter((row) => !a.includes(row)).length;
    if (gone > 0) add({ part: 'not-found', field: 'rows', kind: 'missing', count: gone });
    if (extra > 0) add({ part: 'not-found', field: 'rows', kind: 'extra', count: extra });
    if (gone === 0 && extra === 0 && listKind(a, b) === 'order') {
      add({ part: 'not-found', field: 'rows', kind: 'order' });
    }
  });
  return out;
}

/** A part on both sides compared, or said missing or extra. */
function comparePart<T>(
  part: 'pathways' | 'found' | 'not-found',
  a: T | null,
  b: T | null,
  add: (d: Omit<Difference, 'file' | 'count'> & { count?: number }) => void,
  compare: (a: T, b: T) => void
): void {
  if (a === null && b === null) return;
  if (a === null) add({ part, kind: 'extra' });
  else if (b === null) add({ part, kind: 'missing' });
  else compare(a, b);
}

/** One report PDF, read and reduced. */
export async function reduceReportPdf(
  path: string,
  margin = MARGIN_BAND_PT
): Promise<ReportReduced> {
  const bytes = readFileSync(path);
  return reduceReport(
    await readLayout(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), { margin })
  );
}

/**
 * `pdf-export compare-report <today's.pdf> <new.pdf> [--expected <file>]
 * [--reference-margin <pt>]`: FR-208's comparison, its report as JSON on standard output;
 * exit 0 with no difference not recorded, 1 with one, 2 on bad arguments or another error.
 */
export async function compareReportCommand(
  args: readonly string[],
  {
    out,
    err,
    output = new Output(),
  }: { out: (text: string) => void; err: (text: string) => void; output?: Output }
): Promise<number> {
  const paths: string[] = [];
  const flags = new Map<string, string>();
  let recorded: Recorded[] = [];
  try {
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
    if (paths.length !== 2) {
      throw new SettingsError("Two PDFs are needed: pdf-export compare-report <today's> <new>");
    }
    const expected = flags.get('--expected');
    if (expected !== undefined) recorded = readRecorded(expected);
  } catch (error) {
    err(`${error instanceof SettingsError ? error.message : errorKind(error)}\n`);
    return 2;
  }
  const margin = Number(flags.get('--reference-margin') ?? MARGIN_BAND_PT);
  if (!Number.isFinite(margin) || margin < 0 || margin > 300) {
    err('--reference-margin is a number of points, 0 to 300\n');
    return 2;
  }
  const [reference = '', neu = ''] = paths;
  let differences: Difference[];
  let unmatched: number[];
  try {
    const found = await withConsoleHeld(async () => {
      const [a, b] = [await reduceReportPdf(reference, margin), await reduceReportPdf(neu)];
      return compareReports(neu.split('/').at(-1) ?? neu, a, b);
    }, err);
    ({ differences, unmatched } = applyRecorded(found, recorded));
  } catch (error) {
    err(`The comparison stopped: ${errorKind(error)}\n`);
    return 2;
  }
  const unrecorded = differences.filter((d) => d.recorded === undefined).length;
  out(
    `${JSON.stringify(
      {
        reference,
        new: neu,
        counts: {
          differences: differences.length,
          recorded: differences.length - unrecorded,
          unrecorded,
        },
        differences: differences.map((d) => output.difference(d)),
        unmatched,
      },
      null,
      2
    )}\n`
  );
  return unrecorded > 0 ? 1 : 0;
}
