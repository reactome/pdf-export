// A PDF reduced to FR-012's parts (spec 001 T035, research R8), from either layout: the
// cover's title, diagram, excerpt note and distinct names; the introduction's release and
// counts; the analysis's properties; each section's parts and their text; the contents
// list's entries and their targets; and each section's figure's kind.
//
// Text is compared folded: compatibility forms folded (NFKC), and white space and the
// characters never drawn (FR-017's NEVER_DRAWN: joiners, U+2060 among them) left out, so a
// line broken elsewhere, or the cover's names written with U+2060 between their characters
// and no-break spaces between their words (`event-pdf`, research R2), read the same.
//
// What the reduced form holds as text (a section's parts, the contents' titles) is compared,
// never printed: src/compare/output.ts prints only values of strict shapes. People's names
// are not held as text at all: the cover's names are a count and a hash, its title (which
// a misread cover could take from the names) a hash and a length, a section's literature
// references and edit history one hash an item, and an analysis property not of its shape a
// hash and a length (FR-013).
//
// The parts are found by their labels: pdf-export's, and other words for them. `event-pdf`'s
// own labels are not known here, and are for T040 to add from its real files; a label not
// known leaves its part unread, which the comparison reports as a difference.
import { CONTRIBUTORS, INSTITUTIONS } from '../layout/text.ts';
import {
  ANALYSIS_TYPES,
  RESOURCES,
  checked,
  fold,
  hash,
  withhold,
  type Checked,
  type Hashed,
  type Shape,
  type Withheld,
} from './output.ts';
import type { Box, Layout, Line, Link, Spot } from './read.ts';

export { fold, hash } from './output.ts';
export type { Hashed } from './output.ts';

export type FigureKind = 'none' | 'diagram' | 'selection' | 'reaction' | 'figure';

export interface ReducedPart {
  part: PartName;
  /** Its items, folded, in order; a part that names people holds a hash for each. */
  items: string[];
}

export interface ReducedSection {
  stId: string;
  /** Its parts in the order they are printed, its name first. */
  parts: ReducedPart[];
  /**
   * Its figure: `diagram`, `selection` or `reaction` where its link to the website says
   * which; `reaction` too for a reaction's section whose figure has no such link; else
   * `figure`, a figure of a kind not read.
   */
  figure: FigureKind;
}

export interface ContentsItem {
  title: string;
  /** The section's stable identifier, or the front part's name, it lands on; null if none. */
  target: string | null;
}

export interface Reduced {
  cover: { title: Withheld; diagram: boolean; excerpt: boolean; names: Hashed };
  introduction: { release: number | null; pathways: number | null; reactions: number | null };
  /** The analysis's properties by name, each of its shape or withheld; null without one. */
  analysis: Record<string, Checked> | null;
  sections: ReducedSection[];
  /** Null where the PDF has no contents list. */
  contents: ContentsItem[] | null;
  /** Short entries at an event's later places (FR-004), which today's files do not write. */
  shortEntries: number;
}

/** Distinct names, folded, counted and hashed together; empty names left out. */
export function hashNames(names: readonly string[]): Hashed {
  const distinct = [...new Set(names.map(fold).filter((name) => name !== ''))].sort();
  return { count: distinct.length, hash: hash(distinct.join('\n')) };
}

/**
 * The cover's names from their text. Where the names are written with U+2060 between their
 * characters (research R2), each name is a run of characters joined by U+2060 or no-break
 * spaces, and whatever else stands between runs parts them; otherwise names are parted by
 * semicolons, as pdf-export writes them.
 */
export function coverNames(text: string): string[] {
  if (text.includes('\u2060')) {
    return text.match(/[^\s\u2060\u00a0](?:[\u2060\u00a0]+[^\s\u2060\u00a0])+/gu) ?? [];
  }
  return text.split(';');
}

export const PART_NAMES = [
  'name',
  'location',
  'stId',
  'type',
  'compartments',
  'diseases',
  'inferredFrom',
  'summation',
  'before',
  'after',
  'references',
  'edits',
  'entities',
  'interactors',
] as const;

export type PartName = (typeof PART_NAMES)[number];

/** A label at a line's start, whole and case aside, then a colon, white space or its end. */
const labelPattern = (labels: readonly string[]): RegExp[] =>
  labels.map((label) => {
    const words = label.split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp(`^\\s*${words.join('\\s*')}\\s*(?::|\\s|$)`, 'i');
  });

interface PartRule {
  part: PartName;
  /** The labels it is known by, longest first where one begins another, compiled. */
  labels: readonly RegExp[];
  /** A fact, beside its label: a line of the section's own left edge after it ends it. */
  fact?: boolean;
  /** Its items, within its text: parted by a pattern, or each on lines of their own. */
  split?: RegExp | 'numbered' | 'dated' | 'rows';
  /** Whether its items name people, and so are held as hashes. */
  names?: boolean;
}

/** The labelled parts, in the order a section prints them (FR-005). */
const RULES: readonly PartRule[] = [
  { part: 'location', labels: labelPattern(['location']), fact: true, split: /[›»>]/ },
  { part: 'stId', labels: labelPattern(['stable identifier', 'stable id']), fact: true },
  { part: 'type', labels: labelPattern(['reaction type', 'type']), fact: true },
  {
    part: 'compartments',
    labels: labelPattern(['compartments', 'compartment']),
    fact: true,
    split: /,/,
  },
  { part: 'diseases', labels: labelPattern(['diseases', 'disease']), fact: true, split: /,/ },
  { part: 'inferredFrom', labels: labelPattern(['inferred from']), fact: true, split: /;/ },
  { part: 'summation', labels: [] },
  {
    part: 'before',
    labels: labelPattern(['preceded by', 'preceding events', 'preceding event']),
    fact: true,
    split: /;/,
  },
  {
    part: 'after',
    labels: labelPattern(['followed by', 'following events', 'following event']),
    fact: true,
    split: /;/,
  },
  {
    part: 'references',
    labels: labelPattern(['literature references', 'references']),
    split: 'numbered',
    names: true,
  },
  { part: 'edits', labels: labelPattern(['edit history']), split: 'dated', names: true },
  { part: 'entities', labels: labelPattern(['entities found']), split: 'rows' },
  { part: 'interactors', labels: labelPattern(['interactors found']), split: 'rows' },
];

const ruleOf = (part: PartName): PartRule | undefined => RULES.find((r) => r.part === part);
const orderOf = (part: PartName): number => PART_NAMES.indexOf(part);
const STABLE_ID_LABELS = ruleOf('stId')?.labels ?? [];
const LOCATION_LABELS = ruleOf('location')?.labels ?? [];

/** A line's text as read: compatibility forms folded, U+2060 left out. */
const plain = (text: string): string => text.normalize('NFKC').replace(/\u2060/g, '');

/** What follows a line's label, or null where it does not begin with one of them. */
function labelled(text: string, labels: readonly RegExp[]): string | null {
  const read = plain(text);
  for (const label of labels) {
    const match = label.exec(read);
    if (match) return read.slice(match[0].length);
  }
  return null;
}

const STABLE_ID = /R-[A-Z]{3}-\d+/;
const STABLE_ID_AT_END = /R-[A-Z]{3}-\d+$/;

/** A heading is set at least this much larger than its body text (as check-book reads it). */
const HEADING_RATIO = 11.25 / 10.5;

/**
 * How far below where a link lands its target's first line may be: Chromium's own
 * destinations land up to about 76 pt above a heading's baseline (at the top of its page, or
 * of the space above it), measured on pdf-export's single-event PDFs.
 */
export const LANDING_PT = 100;

/** Whether `a` comes before `b` in reading order: an earlier page, or higher on the same one. */
const before = (a: Spot, b: Spot): boolean => a.page < b.page || (a.page === b.page && a.y > b.y);

/** The size most of the text is set at. */
function bodySize(lines: readonly Line[]): number {
  const counts = new Map<number, number>();
  for (const line of lines) {
    const size = Math.round(line.size * 100) / 100;
    counts.set(size, (counts.get(size) ?? 0) + fold(line.text).length);
  }
  return [...counts].sort(([, m], [, n]) => n - m)[0]?.[0] ?? 0;
}

const FRONT_HEADINGS = {
  introduction: /^introduction$/i,
  analysis: /^analysis/i,
  contents: /^(?:table of )?contents$/i,
} as const;

type FrontName = keyof typeof FRONT_HEADINGS;

const linkOn = (line: Line, box: Box): boolean =>
  box.page === line.page && line.y >= box.y1 - 2 && line.y <= box.y2 + 2;

/** Items grouped by their page, so each line looks only at its own page's. */
function byPage<T>(items: readonly T[], page: (item: T) => number): (p: number) => readonly T[] {
  const pages = new Map<number, T[]>();
  for (const item of items) {
    const list = pages.get(page(item));
    if (list) list.push(item);
    else pages.set(page(item), [item]);
  }
  return (p) => pages.get(p) ?? [];
}

/** A layout reduced to FR-012's parts. */
export function reduce(layout: Layout): Reduced {
  const { lines, figures } = layout;
  const linksOn = byPage(layout.links, (link) => link.box.page);
  const figuresOn = byPage(figures, (box) => box.page);
  const body = bodySize(lines.filter((line) => line.page > 0));
  const heading = (line: Line) => line.size >= body * HEADING_RATIO;
  const internalOn = (line: Line): Link | undefined =>
    linksOn(line.page).find((link) => link.uri === null && linkOn(line, link.box));

  // each section, at its stable identifier's label; its name the heading above it, above its
  // location where that comes first
  const anchors = lines.flatMap((line, i) => {
    const rest = labelled(line.text, STABLE_ID_LABELS);
    const stId = rest === null ? undefined : STABLE_ID.exec(fold(rest))?.[0];
    return stId === undefined ? [] : [{ i, stId }];
  });
  const starts = anchors.map(({ i }, n) => {
    const floor = n > 0 ? (anchors[n - 1]?.i ?? 0) + 1 : 0;
    let j = i - 1;
    for (let k = i - 1; k >= Math.max(floor, i - 6); k--) {
      if (labelled(lines[k]?.text ?? '', LOCATION_LABELS) !== null) {
        j = k - 1;
        break;
      }
    }
    let start = j + 1;
    while (start - 1 >= floor && lines[start - 1] && heading(lines[start - 1] as Line)) start--;
    return start;
  });
  const startSet = new Set(starts);
  const firstSection = starts[0] ?? lines.length;
  const lastAnchor = anchors.at(-1)?.i ?? -1;

  // the front parts' headings: the introduction's and the analysis's before the sections, the
  // contents list's before them or after them all (today's files put it last)
  const front = new Map<FrontName, number>();
  lines.forEach((line, i) => {
    if (line.page === 0 || !heading(line) || startSet.has(i)) return;
    const text = plain(line.text).trim();
    for (const name of Object.keys(FRONT_HEADINGS) as FrontName[]) {
      if (front.has(name) || !FRONT_HEADINGS[name].test(text)) continue;
      if (name !== 'contents' && i >= firstSection) continue;
      if (name === 'contents' && i >= firstSection && i < lastAnchor) continue;
      front.set(name, i);
    }
  });
  const boundaries = [...new Set([...starts, ...front.values(), lines.length])].sort(
    (a, b) => a - b
  );
  /** The first boundary after a line: the next section or front part, or the end. */
  const regionEnd = (from: number): number => {
    let lo = 0;
    let hi = boundaries.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((boundaries[mid] ?? Infinity) <= from) lo = mid + 1;
      else hi = mid;
    }
    return boundaries[lo] ?? lines.length;
  };
  const spotOf = (i: number): Spot | null => {
    const line = lines[i];
    return line ? { page: line.page, y: line.y + line.size } : null;
  };

  // where an internal link lands: the first section or front part starting at or below it on
  // its page, within LANDING_PT
  const targetsOn = byPage(
    [
      ...anchors.map(({ stId }, n) => ({ at: starts[n] ?? 0, name: stId })),
      ...[...front].map(([name, at]) => ({ at, name })),
    ].flatMap((t) => {
      const line = lines[t.at];
      return line ? [{ ...t, line }] : [];
    }),
    (t) => t.line.page
  );
  const resolve = (landing: Spot | null): string | null => {
    if (!landing) return null;
    let best: { name: string; y: number } | null = null;
    for (const { line, name } of targetsOn(landing.page)) {
      if (line.y > landing.y + 2 || line.y < landing.y - LANDING_PT) continue;
      if (!best || line.y > best.y) best = { name, y: line.y };
    }
    return best?.name ?? null;
  };

  let shortEntries = 0;
  const sections = anchors.map(({ i, stId }, n): ReducedSection => {
    const start = starts[n] ?? i;
    const end = regionEnd(i);
    const left = lines[i]?.x ?? 0;
    const from = spotOf(start);
    const to = spotOf(end);
    const own: Box[] = [];
    if (from) {
      for (let page = from.page; page <= (to?.page ?? from.page); page++) {
        for (const box of figuresOn(page)) {
          const top = { page: box.page, y: box.y2 };
          if (!before(top, from) && (to === null || before(top, to))) own.push(box);
        }
      }
    }
    const parts: { part: PartName; texts: string[] }[] = [];
    const headingLines: Line[] = [];
    for (let k = start; k < i && lines[k] && heading(lines[k] as Line); k++) {
      headingLines.push(lines[k] as Line);
    }
    parts.push({ part: 'name', texts: headingLines.map((line) => line.text) });
    let current: { part: PartName; texts: string[] } | null = null;
    for (let k = start + headingLines.length; k < end; k++) {
      const line = lines[k];
      if (!line) continue;
      const order = current ? orderOf(current.part) : orderOf('name');
      let matched: { part: PartName; rest: string } | null = null;
      for (const rule of RULES) {
        if (orderOf(rule.part) <= order || rule.labels.length === 0) continue;
        const rest = labelled(line.text, rule.labels);
        if (rest !== null) {
          matched = { part: rule.part, rest };
          break;
        }
      }
      if (matched) {
        current = { part: matched.part, texts: [matched.rest] };
        parts.push(current);
        continue;
      }
      // a short entry: an event's name and stable identifier, linked to its section
      if (STABLE_ID_AT_END.test(fold(line.text)) && internalOn(line)) {
        shortEntries++;
        continue;
      }
      const afterFigure = own.some(
        (box) => box.page < line.page || (box.page === line.page && box.y1 > line.y)
      );
      const fact = current ? ruleOf(current.part)?.fact === true : true;
      if (
        fact &&
        orderOf(current?.part ?? 'name') < orderOf('summation') &&
        (afterFigure || line.x <= left + 1)
      ) {
        current = { part: 'summation', texts: [line.text] };
        parts.push(current);
        continue;
      }
      current?.texts.push(line.text);
    }
    return {
      stId,
      parts: parts.map(({ part, texts }) => ({ part, items: items(part, texts) })),
      figure: figureKind(
        own,
        parts.some((p) => p.part === 'type')
      ),
    };
  });

  function figureKind(own: readonly Box[], reaction: boolean): FigureKind {
    const [box] = own;
    if (!box) return 'none';
    for (const link of linksOn(box.page)) {
      if (link.uri === null) continue;
      const overlaps =
        link.box.x1 < box.x2 &&
        box.x1 < link.box.x2 &&
        link.box.y1 < box.y2 &&
        box.y1 < link.box.y2;
      if (!overlaps) continue;
      if (/\/PathwayBrowser\/#\/[^&]+&SEL=/.test(link.uri)) return 'selection';
      if (/\/PathwayBrowser\//.test(link.uri)) return 'diagram';
      if (/\/content\/detail\//.test(link.uri)) return 'reaction';
    }
    return reaction ? 'reaction' : 'figure';
  }

  /** A front part's lines: after its heading, to the next section or front part. */
  const region = (name: FrontName): Line[] | null => {
    const at = front.get(name);
    return at === undefined ? null : lines.slice(at + 1, regionEnd(at));
  };
  const analysisLines = region('analysis');
  const contentsLines = region('contents');
  return {
    cover: cover(
      lines.filter((line) => line.page === 0),
      figuresOn(0)
    ),
    introduction: introduction(
      region('introduction') ?? lines.slice(0, firstSection).filter((line) => line.page > 0)
    ),
    analysis: analysisLines ? analysis(analysisLines, heading) : null,
    sections,
    contents: contentsLines
      ? contents(contentsLines, (line) => resolve(internalOn(line)?.landing ?? null))
      : null,
    shortEntries,
  };
}

/** A part's items from its lines' texts, folded; hashed where they name people. */
function items(part: PartName, texts: readonly string[]): string[] {
  const rule = ruleOf(part);
  let list: string[];
  const split = rule?.split;
  if (split === 'numbered' || split === 'dated') {
    const marker = split === 'numbered' ? /^\s*(?:\d+[.)]|\[\d+\])\s*/ : /^\s*\d{4}-\d{2}-\d{2}/;
    const found: string[] = [];
    for (const text of texts) {
      const read = plain(text);
      const last = found.pop();
      if (last !== undefined) found.push(marker.test(read) ? last : last + read);
      if (marker.test(read)) found.push(split === 'numbered' ? read.replace(marker, '') : read);
      // before the first item: the table's header, not an item
    }
    list = found;
  } else if (split === 'rows') {
    // each row a line; a first line with no digit is the table's header
    const rows = texts.filter((text) => text.trim() !== '');
    list = rows.filter((text, i) => i > 0 || /\d/.test(text));
  } else if (split instanceof RegExp) {
    list = texts.join(' ').split(split);
  } else {
    list = [texts.join(' ')];
  }
  const folded = list.map(fold).filter((item) => item !== '');
  return rule?.names ? folded.map(hash) : folded;
}

/** Lines before any of these on the cover end its names. */
const AFTER_NAMES = new RegExp(
  `\\d|institut|universit|licen[cs]|creative\\s*commons|excerpt|copyright|©|${INSTITUTIONS.map(
    (i) => fold(i).slice(0, 12)
  ).join('|')}`,
  'i'
);

/** The cover's label before its names: pdf-export's, or a word that says what they are. */
const NAMES_LABEL = /^\s*(?:authored|authors?|contributors?|edited|editors?|curated|curators?)\b/i;

/**
 * The cover. Its title is its largest text, held as a hash and a length: where a figure took
 * in the real title, the largest text left could be the names.
 */
function cover(page: readonly Line[], figures: readonly Box[]): Reduced['cover'] {
  const largest = Math.max(0, ...page.map((line) => line.size));
  const first = page.findIndex((line) => Math.abs(line.size - largest) < 0.5);
  let last = first;
  while (page[last + 1] && Math.abs((page[last + 1]?.size ?? 0) - largest) < 0.5) last++;
  const titleLines = first < 0 ? [] : page.slice(first, last + 1);
  const title = fold(titleLines.map((line) => line.text).join(''));
  const below = titleLines.at(-1);
  const diagram = figures.some((box) => box.page === 0 && below !== undefined && box.y2 < below.y);
  const excerpt = page.some((line) => /excerpt/i.test(plain(line.text)));

  // the names: after their label, up to what follows them; or the lines written with U+2060
  const contributors = fold(CONTRIBUTORS).toLowerCase();
  const at = page.findIndex(
    (line) => fold(line.text).toLowerCase() === contributors || NAMES_LABEL.test(plain(line.text))
  );
  let region: Line[] = [];
  if (at >= 0) {
    for (const line of page.slice(at + 1)) {
      if (AFTER_NAMES.test(fold(line.text))) break;
      region.push(line);
    }
  } else {
    region = page.filter((line) => line.text.includes('\u2060'));
  }
  return {
    title: withhold(title),
    diagram,
    excerpt,
    names: hashNames(coverNames(region.map((line) => line.text).join('\n'))),
  };
}

function introduction(region: readonly Line[]): Reduced['introduction'] {
  const text = fold(region.map((line) => line.text).join(' '));
  const number = (pattern: RegExp): number | null => {
    const found = pattern.exec(text)?.[1];
    return found === undefined ? null : Number(found.replace(/,/g, ''));
  };
  return {
    release: number(/release(?:version|number)?:?(\d+)/i),
    pathways: number(/(\d[\d,]*)pathways/i),
    reactions: number(/(\d[\d,]*)reactions/i),
  };
}

/** The analysis's properties, the labels each is known by (longest first), and their shapes. */
const PROPERTIES: readonly { name: string; labels: readonly RegExp[]; shape: Shape }[] = [
  { name: 'token', labels: labelPattern(['token']), shape: 'token' },
  {
    name: 'type',
    labels: labelPattern(['analysis type', 'type']),
    shape: { oneOf: ANALYSIS_TYPES },
  },
  { name: 'species', labels: labelPattern(['species']), shape: 'species' },
  {
    name: 'projection',
    labels: labelPattern(['projected to human', 'projection']),
    shape: 'yesno',
  },
  {
    name: 'interactors',
    labels: labelPattern(['interactors included', 'include interactors', 'interactors']),
    shape: 'yesno',
  },
  { name: 'identifiers', labels: labelPattern(['identifiers found']), shape: 'count' },
  { name: 'pathways', labels: labelPattern(['pathways hit', 'pathways found']), shape: 'count' },
  { name: 'resource', labels: labelPattern(['resource']), shape: { oneOf: RESOURCES } },
];

/**
 * The analysis's properties, from its region up to the first stable identifier or the next
 * heading (a section's, where its stable identifier was not read), each kept only where it
 * has its shape (src/compare/output.ts), else withheld.
 */
function analysis(
  region: readonly Line[],
  heading: (line: Line) => boolean
): Record<string, Checked> {
  const properties: Record<string, Checked> = {};
  for (const line of region) {
    if (heading(line) || STABLE_ID.test(fold(line.text))) break;
    for (const { name, labels, shape } of PROPERTIES) {
      if (name in properties || (name === 'identifiers' && 'identifiersFound' in properties)) {
        continue;
      }
      const rest = labelled(line.text, labels);
      if (rest === null) continue;
      const value = fold(rest);
      if (name === 'identifiers') {
        const [found = '', total, more] = value.split(/of/i);
        properties['identifiersFound'] = checked(found, 'count');
        if (total !== undefined) properties['identifiersTotal'] = checked(total, 'count');
        // a value of another form than `x of y`, withheld whole
        if (more !== undefined) properties['identifiersFound'] = checked(value, 'count');
      } else {
        properties[name] = checked(value, shape);
      }
      break;
    }
  }
  return properties;
}

/** The contents list's entries: each up to a line ending in its page's number. */
function contents(region: readonly Line[], target: (line: Line) => string | null): ContentsItem[] {
  const entries: ContentsItem[] = [];
  let pending: Line[] = [];
  const flush = () => {
    if (pending.length === 0) return;
    const title = fold(pending.map((line) => line.text).join(' ')).replace(/[.·…]*\d+$/, '');
    const landed = pending.map(target).find((t) => t !== null) ?? null;
    if (title !== '') entries.push({ title, target: landed });
    pending = [];
  };
  for (const line of region) {
    pending.push(line);
    if (/\d\s*$/.test(plain(line.text))) flush();
  }
  flush();
  return entries;
}
