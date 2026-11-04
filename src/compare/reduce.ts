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
// People's names are never held as text: the cover's are a count and a hash, and a
// section's literature references and edit history, which name their authors, are held as
// one hash an item (FR-013).
//
// The parts are found by their labels. Each part has pdf-export's label and the others it
// is known by; `event-pdf`'s own are to be confirmed on its real files (T040), and a label
// not known leaves its part unread, which the comparison reports, never passes.
import { createHash } from 'node:crypto';

import { NEVER_DRAWN } from '../layout/characters.ts';
import { CONTRIBUTORS, INSTITUTIONS } from '../layout/text.ts';
import type { Box, Layout, Line, Spot } from './read.ts';

/** People's names, or a list that holds them: how many, and one hash of them all. */
export interface Hashed {
  count: number;
  hash: string;
}

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
  cover: { title: string; diagram: boolean; excerpt: boolean; names: Hashed };
  introduction: { release: number | null; pathways: number | null; reactions: number | null };
  /** The analysis's properties by name, their values folded, yes or no for either; null without one. */
  analysis: Record<string, string> | null;
  sections: ReducedSection[];
  /** Null where the PDF has no contents list. */
  contents: ContentsItem[] | null;
  /** Short entries at an event's later places (FR-004), which today's files do not write. */
  shortEntries: number;
}

const UNPRINTED = new RegExp(`${NEVER_DRAWN.source}+`, 'gu');

/** Text as compared: compatibility forms folded, white space and joiners left out. */
export const fold = (text: string): string => text.normalize('NFKC').replace(UNPRINTED, '');

/** A short hash of a text, as names and the parts naming people are held. */
export const hash = (text: string): string =>
  createHash('sha256').update(text).digest('hex').slice(0, 16);

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

interface PartRule {
  part: PartName;
  /** The labels it is known by, lower case, longest first where one begins another. */
  labels: readonly string[];
  /** A fact, beside its label: a line of the section's own left edge after it ends it. */
  fact?: boolean;
  /** Its items, within its text: parted by a pattern, or each on lines of their own. */
  split?: RegExp | 'numbered' | 'dated' | 'rows';
  /** Whether its items name people, and so are held as hashes. */
  names?: boolean;
}

/** The labelled parts, in the order a section prints them (FR-005). */
const RULES: readonly PartRule[] = [
  { part: 'location', labels: ['location'], fact: true, split: /[›»>]/ },
  { part: 'stId', labels: ['stable identifier', 'stable id'], fact: true },
  { part: 'type', labels: ['reaction type', 'type'], fact: true },
  { part: 'compartments', labels: ['compartments', 'compartment'], fact: true, split: /,/ },
  { part: 'diseases', labels: ['diseases', 'disease'], fact: true, split: /,/ },
  { part: 'inferredFrom', labels: ['inferred from'], fact: true, split: /;/ },
  { part: 'summation', labels: [] },
  {
    part: 'before',
    labels: ['preceded by', 'preceding events', 'preceding event'],
    fact: true,
    split: /;/,
  },
  {
    part: 'after',
    labels: ['followed by', 'following events', 'following event'],
    fact: true,
    split: /;/,
  },
  {
    part: 'references',
    labels: ['literature references', 'references'],
    split: 'numbered',
    names: true,
  },
  { part: 'edits', labels: ['edit history'], split: 'dated', names: true },
  { part: 'entities', labels: ['entities found'], split: 'rows' },
  { part: 'interactors', labels: ['interactors found'], split: 'rows' },
];

const ruleOf = (part: PartName): PartRule | undefined => RULES.find((r) => r.part === part);
const orderOf = (part: PartName): number => PART_NAMES.indexOf(part);

/** A line's text as read: compatibility forms folded, no-break spaces as spaces. */
const plain = (text: string): string => text.normalize('NFKC').replace(/\u2060/g, '');

/** A label at a line's start, whole and case aside, then a colon, white space or its end. */
function labelled(text: string, labels: readonly string[]): string | null {
  const read = plain(text);
  for (const label of labels) {
    const words = label.split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const match = new RegExp(`^\\s*${words.join('\\s*')}\\s*(?::|\\s|$)`, 'i').exec(read);
    if (match) return read.slice(match[0].length);
  }
  return null;
}

const STABLE_ID = /R-[A-Z]{2,4}-\d+/;
const STABLE_ID_AT_END = /R-[A-Z]{2,4}-\d+$/;

/** A heading is set at least this much larger than its body text (as check-book reads it). */
const HEADING_RATIO = 11.25 / 10.5;

/** How far below where a link lands its target's first line may be. */
const LANDING_PT = 100;

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

/** A layout reduced to FR-012's parts. */
export function reduce(layout: Layout): Reduced {
  const { lines, links, figures } = layout;
  const body = bodySize(lines.filter((line) => line.page > 0));
  const heading = (line: Line) => line.size >= body * HEADING_RATIO;

  // each section, at its stable identifier's label; its name the heading above it, above its
  // location where that comes first
  const anchors = lines.flatMap((line, i) => {
    const rest = labelled(line.text, ruleOf('stId')?.labels ?? []);
    const stId = rest === null ? undefined : STABLE_ID.exec(fold(rest))?.[0];
    return stId === undefined ? [] : [{ i, stId }];
  });
  const starts = anchors.map(({ i }, n) => {
    const floor = n > 0 ? (anchors[n - 1]?.i ?? 0) + 1 : 0;
    let j = i - 1;
    for (let k = i - 1; k >= Math.max(floor, i - 6); k--) {
      if (labelled(lines[k]?.text ?? '', ruleOf('location')?.labels ?? []) !== null) {
        j = k - 1;
        break;
      }
    }
    let start = j + 1;
    while (start - 1 >= floor && lines[start - 1] && heading(lines[start - 1] as Line)) start--;
    return start;
  });
  const firstSection = starts[0] ?? lines.length;

  // the front parts' headings: the introduction's and the analysis's before the sections, the
  // contents list's before them or after them all (today's files put it last)
  const front = new Map<FrontName, number>();
  lines.forEach((line, i) => {
    if (line.page === 0 || !heading(line) || starts.includes(i)) return;
    const text = plain(line.text).trim();
    for (const name of Object.keys(FRONT_HEADINGS) as FrontName[]) {
      if (front.has(name) || !FRONT_HEADINGS[name].test(text)) continue;
      if (name !== 'contents' && i >= firstSection) continue;
      if (name === 'contents' && i >= firstSection && i < (anchors.at(-1)?.i ?? 0)) continue;
      front.set(name, i);
    }
  });
  const boundaries = [...starts, ...front.values(), lines.length].sort((a, b) => a - b);
  const regionEnd = (from: number) => boundaries.find((b) => b > from) ?? lines.length;
  const spotOf = (i: number): Spot | null => {
    const line = lines[i];
    return line ? { page: line.page, y: line.y + line.size } : null;
  };

  // where an internal link lands: the first section or front part starting at or below it
  // on its page, within LANDING_PT (Chromium's own destinations land up to about 76 pt
  // above a heading's baseline, at the top of its page or of the space above it)
  const targets = [
    ...anchors.map(({ stId }, n) => ({ at: starts[n] ?? 0, name: stId })),
    ...[...front].map(([name, at]) => ({ at, name })),
  ];
  const resolve = (landing: Spot | null): string | null => {
    if (!landing) return null;
    let best: { name: string; y: number } | null = null;
    for (const { at, name } of targets) {
      const line = lines[at];
      if (!line || line.page !== landing.page) continue;
      if (line.y > landing.y + 2 || line.y < landing.y - LANDING_PT) continue;
      if (!best || line.y > best.y) best = { name, y: line.y };
    }
    return best?.name ?? null;
  };

  let shortEntries = 0;
  const sections = anchors.map(({ i, stId }, n): ReducedSection => {
    const start = starts[n] ?? i;
    const end = regionEnd(i);
    const label = lines[i];
    const left = label?.x ?? 0;
    const from = spotOf(start);
    const to = spotOf(end);
    const own = figures.filter((box) => {
      const top = { page: box.page, y: box.y2 };
      return from !== null && !before(top, from) && (to === null || before(top, to));
    });
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
      const internal = links.some((link) => link.uri === null && linkOn(line, link.box));
      if (internal && STABLE_ID_AT_END.test(fold(line.text))) {
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
    for (const link of links) {
      if (link.box.page !== box.page || link.uri === null) continue;
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

  return {
    cover: cover(
      lines.filter((line) => line.page === 0),
      figures
    ),
    introduction: introduction(
      front.has('introduction')
        ? lines.slice(
            (front.get('introduction') ?? 0) + 1,
            regionEnd(front.get('introduction') ?? 0)
          )
        : lines.slice(0, firstSection).filter((line) => line.page > 0)
    ),
    analysis: front.has('analysis')
      ? analysis(
          lines.slice((front.get('analysis') ?? 0) + 1, regionEnd(front.get('analysis') ?? 0))
        )
      : null,
    sections,
    contents: front.has('contents')
      ? contents(
          lines.slice((front.get('contents') ?? 0) + 1, regionEnd(front.get('contents') ?? 0)),
          (line) =>
            resolve(
              links.find((link) => link.uri === null && link.landing && linkOn(line, link.box))
                ?.landing ?? null
            )
        )
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

function cover(page: readonly Line[], figures: readonly Box[]): Reduced['cover'] {
  const largest = Math.max(0, ...page.map((line) => line.size));
  const first = page.findIndex((line) => Math.abs(line.size - largest) < 0.5);
  let last = first;
  while (page[last + 1] && Math.abs((page[last + 1]?.size ?? 0) - largest) < 0.5) last++;
  const titleLines = first < 0 ? [] : page.slice(first, last + 1);
  const title = titleLines
    .map((line) => plain(line.text).replace(/\s+/g, ' ').trim())
    .join(' ')
    .trim();
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
    title,
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

/** The analysis's properties and the labels each is known by, longest first. */
const PROPERTIES: readonly (readonly [string, readonly string[]])[] = [
  ['token', ['token']],
  ['type', ['analysis type', 'type']],
  ['species', ['species']],
  ['projection', ['projected to human', 'projection']],
  ['interactors', ['interactors included', 'include interactors', 'interactors']],
  ['identifiers', ['identifiers found']],
  ['pathways', ['pathways hit', 'pathways found']],
  ['resource', ['resource']],
];

function analysis(region: readonly Line[]): Record<string, string> {
  const properties: Record<string, string> = {};
  for (const line of region) {
    for (const [name, labels] of PROPERTIES) {
      if (name in properties || (name === 'identifiers' && 'identifiersFound' in properties)) {
        continue;
      }
      const rest = labelled(line.text, labels);
      if (rest === null) continue;
      const value = fold(rest);
      const yes = /^(?:yes|true)$/i.test(value);
      const no = /^(?:no|false)$/i.test(value);
      if (name === 'identifiers') {
        const [found, total] = value.split(/of/i);
        properties['identifiersFound'] = found ?? '';
        if (total !== undefined) properties['identifiersTotal'] = total;
      } else {
        properties[name] = yes ? 'yes' : no ? 'no' : value;
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
