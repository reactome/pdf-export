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
// is the analysis's user's own (FR-211). The parts are found by their headings: pdf-export's
// and today's, learned from today's real files on the comparison's run (T019, research R9);
// a heading not known leaves its part unread, which is reported as a difference, never a
// pass.
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
import {
  ANALYSIS_TYPES,
  Output,
  RESOURCES,
  checked,
  fold,
  hash,
  withhold,
  type Checked,
  type Difference,
  type Shape,
  type Withheld,
} from './output.ts';
import { MARGIN_BAND_PT, readLayout, type Layout, type Line } from './read.ts';
import { HEADING_RATIO, bodySize, reduce, reportEntityRows, type Reduced } from './reduce.ts';

/**
 * The report's parts, by the headings they are known by: pdf-export's, and today's, which
 * numbers them (`4. Most significant pathways`) and calls the details "Pathways details".
 */
const REPORT_PARTS = {
  properties: [/^analysis properties$/i, /^properties$/i],
  overview: [/^genome-wide overview$/i, /^pathways overview$/i],
  pathways: [/^most significant pathways$/i],
  details: [/^pathways? details$/i],
  found: [/^identifiers found$/i],
  notFound: [/^identifiers not found$/i],
} as const;

type ReportPartName = keyof typeof REPORT_PARTS;
const REPORT_PART_NAMES: readonly ReportPartName[] = [
  'properties',
  'overview',
  'pathways',
  'details',
  'found',
  'notFound',
];

/** A part's number, as today's heading begins with it. */
const PART_NUMBER = /^\d+\.\s*/;

/** Any of them, numbered or not: a heading that ends a section's region. */
const STOPS = new RegExp(
  `^(?:\\d+\\.\\s*)?(?:${Object.values(REPORT_PARTS)
    .flat()
    .map((pattern) => pattern.source.replace(/^\^/, ''))
    .join('|')})`,
  'i'
);

/** The statistics of a pathway's row: entities found, total, ratio, p-value, FDR; reactions found, total, ratio. */
const STATISTICS = 8;

/**
 * A number as a table prints it, at a row's end, perhaps with commas between thousands (as
 * today's does); a cell's text may run into the next.
 */
const NUMBER =
  '[+-]?(?:\\d{1,3}(?:,\\d{3})+(?:\\.\\d*)?|\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
/**
 * A row: its name, then its eight statistics, the first of which may follow the name with no
 * space; a count found and its total parted by a space, or by a slash (`10 / 536`, today's).
 */
const ROW = new RegExp(
  `^(.*?)(${NUMBER})((?:(?:\\s*/\\s*|\\s+)${NUMBER}){${String(STATISTICS - 1)}})\\s*$`
);

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
  /** Each statistic's last printed place: 1 for a count, 0.001 for `0.033`, 1e-11 for `1.16e-09`. */
  units: number[];
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
  /** The details' sections and their figures: spec 001's reading, in the report's form. */
  reduced: Reduced;
  /** The properties, from pdf-export's labelled rows or today's sentences; null without the part. */
  properties: Record<string, Checked> | null;
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
  // each part at the largest heading that names it: today's contents list names them too,
  // set larger than the body but smaller than the parts' own headings
  const starts = new Map<ReportPartName, number>();
  lines.forEach((line, i) => {
    if (line.page === 0 || !heading(line)) return;
    const text = read(line.text).replace(PART_NUMBER, '');
    const name = REPORT_PART_NAMES.find((part) =>
      REPORT_PARTS[part].some((pattern) => pattern.test(text))
    );
    if (!name) return;
    const at = starts.get(name);
    if (at === undefined || line.size > (lines[at]?.size ?? 0)) starts.set(name, i);
  });
  /**
   * A part's lines, after its heading, up to the next heading of the report's parts; the
   * headings within it left out, unless kept (today's properties are set at a heading's size).
   */
  const region = (part: ReportPartName, headings = false): Line[] | null => {
    const at = starts.get(part);
    if (at === undefined) return null;
    const ends = [...starts.values()].filter((i) => i > at);
    const end = ends.length > 0 ? Math.min(...ends) : lines.length;
    return lines.slice(at + 1, end).filter((line) => headings || !heading(line));
  };
  const foundRegion = region('found');
  const propertiesRegion = region('properties', true);
  return {
    cover: cover(
      lines.filter((line) => line.page === 0),
      layout.links.some(
        (link) =>
          link.box.page === 0 && link.uri !== null && /[?&#/](?:analysis|ANALYSIS)=/.test(link.uri)
      )
    ),
    reduced: reduce(layout, { editRows: 'report', stops: STOPS, report: true }),
    properties: propertiesRegion ? reportProperties(propertiesRegion) : null,
    pathways: pathwayRows(region('pathways')),
    found: foundRegion ? resourceRows(foundRegion, false) : null,
    interactors: foundRegion ? resourceRows(foundRegion, true) : null,
    notFound: notFound(region('notFound')),
  };
}

/** Lines joined as text, a word broken at a line's end by a hyphen joined again. */
function joined(region: readonly Line[]): string {
  return region
    .map((line) => read(line.text))
    .reduce(
      (text, next) =>
        /\p{L}-$/u.test(text) && /^\p{Ll}/u.test(next)
          ? text.slice(0, -1) + next
          : `${text} ${next}`,
      ''
    )
    .trim();
}

/**
 * The properties: pdf-export's rows, each a label and its value (`Pathways hit 443`), or
 * today's sentences (`7 out of 9 identifiers in the sample were found in Reactome, where 443
 * pathways were hit by at least one of them.`), each kept only where it has its shape.
 * Projection and interactors are said only when on, so read as no when not said.
 */
export function reportProperties(region: readonly Line[]): Record<string, Checked> {
  const text = joined(region);
  const properties: Record<string, Checked> = {};
  const set = (name: string, value: string | undefined, shape: Shape): void => {
    if (value !== undefined) properties[name] = checked(value.replace(/,/g, ''), shape);
  };
  const type =
    /\bType\s+([A-Z_]+)\b/.exec(text)?.[1] ??
    /\bThis is an?\s+(.+?)\s+analysis\b/i.exec(text)?.[1]?.toUpperCase().replace(/\s+/g, '_');
  set('type', type, { oneOf: ANALYSIS_TYPES });
  const identifiers =
    /\bIdentifiers found\s+(\d[\d,]*)\s+of\s+(\d[\d,]*)/i.exec(text) ??
    /\b(\d[\d,]*)\s+out of\s+(\d[\d,]*)\s+identifiers\b/i.exec(text);
  set('identifiersFound', identifiers?.[1], 'count');
  set('identifiersTotal', identifiers?.[2], 'count');
  set(
    'pathways',
    /\bPathways hit\s+(\d[\d,]*)/i.exec(text)?.[1] ??
      /\b(\d[\d,]*)\s+pathways were hit\b/i.exec(text)?.[1],
    'count'
  );
  const said = (label: RegExp, sentence: RegExp): string =>
    label.exec(text)?.[1] ?? (sentence.test(text) ? 'yes' : 'no');
  set(
    'projection',
    said(/\bProjected to human\s+(yes|no)\b/i, /converted to their human equivalent/i),
    'yesno'
  );
  set(
    'interactors',
    said(/\bInteractors included\s+(yes|no)\b/i, /\binteractors were included\b/i),
    'yesno'
  );
  const target = /\bfor species '([^']*)' and resource '([^']*)'/i.exec(text);
  set('species', target?.[1] ?? /\bSpecies\s+(.+?)\s+Resource\b/.exec(text)?.[1], 'species');
  const resource =
    target?.[2] === undefined
      ? /\bResource\s+([A-Z_]+)\b/.exec(text)?.[1]
      : /^all resources$/i.test(target[2])
        ? 'TOTAL'
        : target[2].toUpperCase().replace(/\s+/g, '_');
  set('resource', resource, { oneOf: RESOURCES });
  set(
    'token',
    /\(token\) is\s+(\S+?)\.?(?:\s|$)/i.exec(text)?.[1] ??
      /\bToken\s+(\S+?)\.?(?:\s|$)/.exec(text)?.[1],
    'token'
  );
  return properties;
}

/** The cover: its title said to be the report's or not, the name after it, its release. */
function cover(page: readonly Line[], link: boolean): ReportReduced['cover'] {
  const texts = page.map((line) => read(line.text)).filter((text) => text !== '');
  const at = texts.findIndex(
    (text) => fold(text).toLowerCase() === fold(REPORT_TITLE).toLowerCase()
  );
  // pdf-export's "Reactome release 98"; today's "performed against Reactome version 98"
  const release = /(?:release|version)\s*(\d+)/i.exec(texts.join(' '))?.[1];
  return {
    title: at >= 0 ? 'same' : 'differs',
    name: withhold(fold(at >= 0 ? (texts[at + 1] ?? '') : '')),
    release: release === undefined ? null : Number(release),
    link,
  };
}

const WHOLE_NUMBER = new RegExp(`^${NUMBER}$`);

/** pdf-export's first note on the table's columns, under it (`Entities found: the number …`). */
const TABLE_NOTES = /^Entities\s+found:\s/i;

/**
 * A row's name and statistics from its cells, where the statistics are cells of their own:
 * the last cells wholly of numbers, eight numbers in all, and the cells before them the
 * name. A name's last word that is a number (`Interleukin-4`) is never taken for a
 * statistic so, where the name's cell and the first statistic's are printed touching. Null
 * where the cells do not end so: the line is read as text (ROW).
 */
function statisticCells(line: Line): { name: string; statistics: string[] } | null {
  const cells = (line.cells ?? []).map(read);
  const printed: string[] = [];
  let at = cells.length;
  while (at > 0 && printed.length < STATISTICS) {
    const tokens = (cells[at - 1] ?? '').split(/\s*\/\s*|\s+/).filter((t) => t !== '');
    if (tokens.length === 0 || !tokens.every((t) => WHOLE_NUMBER.test(t))) break;
    printed.unshift(...tokens);
    at--;
  }
  if (printed.length !== STATISTICS) return null;
  return { name: cells.slice(0, at).join(' ').trim(), statistics: printed };
}

/** A printed number's last place: 1e-3 for `0.033`, 1e-11 for `1.16e-09`, 1 for `1,575`. */
export function unitOf(printed: string): number {
  const [mantissa = '', exponent = '0'] = printed.replace(/,/g, '').split(/[eE]/);
  const decimals = mantissa.split('.')[1]?.length ?? 0;
  return 10 ** (Number(exponent) - decimals);
}

/**
 * The table's rows: each ends in its eight statistics. Its name's other lines are placed by
 * how the table sets a name beside them:
 *
 * - **at the top** (pdf-export's): the name begins on the statistics' line and its other
 *   lines follow, up to the next row; the lines before a page's first row are the header,
 *   and the notes on the columns under it end the table.
 * - **centred** (today's, found where a row's statistics stand on a line of their own): as
 *   many of the name's lines above the statistics as below; lines of another size than the
 *   rows' (the header, the sentence before it) and a footnote (`* False Discovery Rate`)
 *   are not the table's.
 */
function pathwayRows(whole: readonly Line[] | null): PathwayRow[] | null {
  if (whole === null) return null;
  // pdf-export's notes on the columns, under the table, end it
  const notes = whole.findIndex((line) => TABLE_NOTES.test(read(line.text)));
  const region = notes < 0 ? whole : whole.slice(0, notes);
  const parsed = region.map((line) => {
    const text = read(line.text);
    const cells = statisticCells(line);
    if (cells) return { line, text, ...cells };
    const row = ROW.exec(text);
    if (!row) return { line, text, name: text, statistics: null };
    const printed = [row[2] ?? '', ...(row[3] ?? '').split(/\s*\/\s*|\s+/).filter((n) => n !== '')];
    return { line, text, name: (row[1] ?? '').trim(), statistics: printed };
  });
  const numbered = parsed.filter((p) => p.statistics !== null);
  const centred = numbered.some((p) => p.name === '');
  const size = numbered[0]?.line.size ?? 0;
  const rows: { name: string[]; printed: string[] }[] = [];
  if (centred) {
    let above: string[] = [];
    let owed = 0;
    for (const p of parsed) {
      if (Math.abs(p.line.size - size) > 0.1 || /^\*/.test(p.text)) continue;
      if (p.statistics !== null) {
        rows.push({ name: [...above, p.name], printed: p.statistics });
        owed = above.length;
        above = [];
      } else if (owed > 0) {
        rows.at(-1)?.name.push(p.text);
        owed--;
      } else {
        above.push(p.text);
      }
    }
  } else {
    let page = -1;
    let seen = false;
    for (const p of parsed) {
      if (p.line.page !== page) [page, seen] = [p.line.page, false];
      if (p.statistics !== null) {
        rows.push({ name: [p.name], printed: p.statistics });
        seen = true;
      } else if (seen) {
        // a long name's next lines, after its row's first
        rows.at(-1)?.name.push(p.text);
      }
      // before a page's first row: the header, repeated on each page
    }
  }
  return rows.map((row) => ({
    name: withhold(fold(row.name.join(' '))),
    statistics: row.printed.map((n) => Number(n.replace(/,/g, ''))),
    units: row.printed.map(unitOf),
  }));
}

/** A heading of the interactors found: the resource they interact through, and how many. */
const INTERACTOR_HEADING = /^Interactors\s+through\s+(.+?):\s*(\d+)\s*$/i;

/**
 * The identifiers found by resource, or the interactors: each resource's rows, read by
 * reportEntityRows (pdf-export's tables or today's), its counts the rows' and the distinct
 * mappings' among them, as today's prints no count by resource. The interactors are read
 * from pdf-export's headings; today's way of printing them is not known here, so its part
 * is read as none.
 */
function resourceRows(region: readonly Line[], interactors: boolean): ResourceRows[] {
  const at = region.findIndex((line) => INTERACTOR_HEADING.test(read(line.text)));
  if (!interactors) {
    const rows = reportEntityRows(at < 0 ? region : region.slice(0, at));
    const resources = [...new Set(rows.map((row) => row.slice(0, row.lastIndexOf(':'))))];
    return resources.map((resource) => {
      const own = rows.filter((row) => row.slice(0, row.lastIndexOf(':')) === resource);
      return { label: withhold(resource), counts: [own.length], rows: own };
    });
  }
  const out: ResourceRows[] = [];
  let current: ResourceRows | null = null;
  for (const line of at < 0 ? [] : region.slice(at)) {
    const text = read(line.text);
    const interacting = INTERACTOR_HEADING.exec(text);
    if (interacting) {
      current = {
        label: withhold(interacting[1] ?? ''),
        counts: [Number(interacting[2])],
        rows: [],
      };
      out.push(current);
      continue;
    }
    // a table's header names its columns; a row begins with an identifier
    if (!current || /^identifier\b/i.test(text) || text === '') continue;
    current.rows.push(hash(fold(text)));
  }
  return out;
}

/**
 * The identifiers not found, each hashed: each cell of a row (today's sets several a row),
 * the table's header and the sentence before it (today's) left out.
 */
function notFound(region: readonly Line[] | null): string[] | null {
  if (region === null) return null;
  return region
    .filter((line) => {
      const text = read(line.text);
      return text !== '' && !/^identifier\b/i.test(text) && !/\bnot found\b/i.test(text);
    })
    .flatMap((line) => (line.cells ?? [line.text]).map((cell) => hash(fold(read(cell)))));
}

/** Two statistics agree when they print the same at three significant figures. */
export function sameStatistic(a: number, b: number): boolean {
  if (a === b) return true;
  return Number(a.toPrecision(3)) === Number(b.toPrecision(3));
}

/**
 * Two printed statistics agree when they print the same at three significant figures, or
 * differ by less than half of each one's last place together, so that the values each could
 * have been rounded from overlap: `0.033` (today's, to three places) and `0.0329`
 * (pdf-export's, to three figures) are one value, rounded twice; counts must be equal.
 */
export function samePrinted(a: number, unitA: number, b: number, unitB: number): boolean {
  if (sameStatistic(a, b)) return true;
  return Math.abs(a - b) < (unitA + unitB) / 2;
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
  // the report's: its properties, today's sentences or pdf-export's rows; each section's
  // figure only there or not (today's links none to the website), and its stable identifier
  // its key, not a part (today's writes it in the heading)
  const shell = (reduced: Reduced, properties: ReportReduced['properties']): Reduced => ({
    ...reduced,
    analysis: properties,
    sections: reduced.sections.map((section) => ({
      ...section,
      figure: section.figure === 'none' ? 'none' : 'figure',
      // a part with no items is as none: today's prints "References" over an empty list
      parts: section.parts.filter((part) => part.part !== 'stId' && part.items.length > 0),
    })),
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
  out.push(
    ...compareReduced(file, shell(ref.reduced, ref.properties), shell(neu.reduced, neu.properties))
  );
  for (const [side, properties] of [
    ['reference', ref.properties],
    ['new', neu.properties],
  ] as const) {
    if (properties === null || Object.keys(properties).length === 0) {
      add({ part: 'analysis', field: side, kind: 'unreadable' });
    }
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
        row.statistics.some(
          (value, i) =>
            !samePrinted(value, row.units[i] ?? 0, other.statistics[i] ?? NaN, other.units[i] ?? 0)
        )
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
