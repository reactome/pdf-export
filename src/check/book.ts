// FR-011's check of a written book (spec 001 T030, contracts/cli.md `check-book`, research
// R8): the folder holds one PDF per top-level pathway and nothing else, and in each PDF every
// event of its pathway has its section, named and with its stable identifier, its entry in
// the contents list and in the outline, and its figure where the figure's source exists; and
// no internal link is broken. The book is untagged (research R4), so each PDF is read with
// pdf.js for its outline, its links and its text, and compared with the documents the book
// was made from: `book` gives its own, `check-book` builds them from the graph as `book`
// does. Each fault is a line naming its PDF and a stable identifier, never a text or a person.
//
// A section is found by its heading's link to the event's page on the website, the first
// link there in reading order, where an outline or contents entry with its name lands too;
// failing that, where such an entry lands whose section gives its stable identifier first
// (two events of one name), or the first such entry (a heading that lost its link, whose
// first link is then a reaction's figure's); failing both, at that first link. It runs to
// the next section found. Its name is the text of its heading, the leading text there set
// larger than its own body text (its `Stable identifier` label, so a page printed scaled
// down still reads it); its stable identifier the text after that label; its figure the
// link to the figure's interactive form below its heading. An entry of the outline or the contents list
// is the event's when it lands on its section's heading and reads its name, compared
// without white space or the characters never drawn; the contents list's entries are the
// links before the first section. A link is broken when it lands on no page of its PDF, is
// still a placeholder or a probe (src/layout/html.ts), or its address to an event's page
// cannot be decoded, named by the section it is in, or by the PDF's pathway in the front.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

import { printedDocument } from '../book/book.ts';
import {
  graphSettings,
  openGraph,
  type Graph,
  type GraphOptions,
  type GraphSettings,
} from '../graph/connection.ts';
import { releaseInfo } from '../graph/queries.ts';
import { BookCharacters, NEVER_DRAWN } from '../layout/characters.ts';
import { PAGE } from '../layout/figure.ts';
import { Links, PLACEHOLDER, PROBE } from '../layout/html.ts';
import { buildBook } from '../model/build.ts';
import type { Document, Figure } from '../model/types.ts';
import { closing, message, SettingsError } from '../preflight/command.ts';
import { checkFiles, neededFiles, readSummary, SUMMARY } from '../preflight/files.ts';
import { figureRecord } from '../preflight/folder.ts';
import { fileName } from '../preflight/names.ts';
import { bookPathways } from '../preflight/preflight.ts';

/** FR-011's checks, in the order their faults are listed (contracts/cli.md). */
export const CHECKS = [
  'missing-pathway',
  'extra-file',
  'not-in-contents',
  'not-in-outline',
  'no-name',
  'no-stable-id',
  'missing-figure',
  'broken-link',
] as const;

export type CheckKind = (typeof CHECKS)[number];

/** A check and how many faults it found: none is a pass. */
export interface CheckResult {
  check: CheckKind;
  faults: number;
}

export interface BookCheck {
  /** Each fault, as `check-book` prints it after `fault `. */
  faults: string[];
  /** Every check, each with its count of faults, in CHECKS' order. */
  checks: CheckResult[];
}

/**
 * A heading is set at least this much larger than its section's body text: between the body's
 * 10.5 pt and the smallest heading's 12 pt (src/layout/pages.css: body-medium, and
 * title-medium for h3 to h6), as a ratio, so a page Chromium printed scaled down (anything
 * wider than the text column, which the layout should never print) still reads its headings.
 */
const HEADING_RATIO = 11.25 / 10.5;

/**
 * How far a landing may be from a heading's link and still be on it: a destination is the
 * top of the heading's line, its link's rectangle the top of its text, 0.5 to 1.5 pt lower.
 */
const ON_HEADING_PT = 3;

/** A place in a PDF: its page, counted from 0, and a height on it in points from its foot. */
interface Spot {
  page: number;
  y: number;
}

/** Whether `a` comes after `b` in reading order: a later page, or lower on the same one. */
const later = (a: Spot, b: Spot): boolean => a.page > b.page || (a.page === b.page && a.y < b.y);

const near = (a: Spot, b: Spot): boolean =>
  a.page === b.page && Math.abs(a.y - b.y) <= ON_HEADING_PT;

/** A piece of text in the page's text area (not the stamps in its margins). */
interface Piece extends Spot {
  x: number;
  size: number;
  str: string;
}

interface Link extends Spot {
  /** Its rectangle: left, bottom, right, top; `y` is its top. */
  rect: [number, number, number, number];
  uri: string | null;
  /** Where an internal link lands, or null for one that lands nowhere. */
  landing: Spot | null;
  internal: boolean;
}

interface OutlineItem {
  title: string;
  landing: Spot | null;
}

/** What is read from one PDF. */
interface Read {
  /** Every page's pieces of text, in reading order. */
  pieces: Piece[];
  /** Every link, in reading order. */
  links: Link[];
  /** Every outline entry, at any depth. */
  outline: OutlineItem[];
}

/**
 * Text compared as read back: compatibility forms folded, white space ignored, and the
 * characters never drawn (FR-017's NEVER_DRAWN: controls and default-ignorables, a soft
 * hyphen, a joiner, a variation selector) left out, as the printed text has none of them.
 */
const folded = (text: string): string => text.normalize('NFKC').replace(UNPRINTED, '');
const UNPRINTED = new RegExp(`${NEVER_DRAWN.source}+`, 'gu');

/** The label a section's stable identifier follows, as read. */
const LABEL = folded('Stable identifier');

const byReading = (a: Spot & { x?: number }, b: Spot & { x?: number }): number =>
  a.page - b.page || b.y - a.y || (a.x ?? 0) - (b.x ?? 0);

type PdfJs = Awaited<ReturnType<typeof getDocument>['promise']>;

/** Where a destination lands, or null where it names no page of the PDF. */
async function land(doc: PdfJs, dest: unknown): Promise<Spot | null> {
  const explicit: unknown = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
  if (!Array.isArray(explicit)) return null;
  const [ref, kind, left, top] = explicit as unknown[];
  let page: number;
  try {
    if (typeof ref === 'number') {
      if (!Number.isInteger(ref) || ref < 0 || ref >= doc.numPages) return null;
      page = ref;
    } else if (ref !== null && typeof ref === 'object' && 'num' in ref && 'gen' in ref) {
      page = await doc.getPageIndex(ref as { num: number; gen: number });
    } else {
      return null;
    }
  } catch {
    return null;
  }
  // the height a destination names: `/XYZ left top zoom`, `/FitH top`, `/FitBH top`
  const name = kind !== null && typeof kind === 'object' && 'name' in kind ? kind.name : null;
  const height = name === 'XYZ' ? top : name === 'FitH' || name === 'FitBH' ? left : null;
  if (typeof height === 'number') return { page, y: height };
  const [, , , pageTop = 0] = (await doc.getPage(page + 1)).view;
  return { page, y: pageTop };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object';

/** A PDF's text, links and outline, read with pdf.js. */
async function readPdf(path: string): Promise<Read> {
  const task = getDocument({ data: new Uint8Array(readFileSync(path)) });
  try {
    const doc = await task.promise;
    const pieces: Piece[] = [];
    const links: Link[] = [];
    for (let i = 0; i < doc.numPages; i++) {
      const page = await doc.getPage(i + 1);
      const [, , , height = 0] = page.view;
      for (const item of (await page.getTextContent()).items) {
        if (!('str' in item) || item.str.trim() === '') continue;
        const [a = 0, b = 0, c = 0, d = 0, x = 0, y = 0] = item.transform as number[];
        // the stamped headers and numbers are in the margins
        if (y <= PAGE.margin || y >= height - PAGE.margin) continue;
        const size = Math.max(Math.hypot(a, b), Math.hypot(c, d));
        pieces.push({ page: i, x, y, size, str: item.str });
      }
      for (const annot of (await page.getAnnotations()) as unknown[]) {
        if (!isRecord(annot) || annot['subtype'] !== 'Link') continue;
        const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = (annot['rect'] as number[] | undefined) ?? [];
        const rect: Link['rect'] = [
          Math.min(x1, x2),
          Math.min(y1, y2),
          Math.max(x1, x2),
          Math.max(y1, y2),
        ];
        const address = annot['unsafeUrl'] ?? annot['url'];
        const uri = typeof address === 'string' ? address : null;
        const dest = annot['dest'];
        const internal = uri === null && dest !== undefined && dest !== null;
        links.push({
          page: i,
          y: rect[3],
          rect,
          uri,
          internal,
          landing: internal ? await land(doc, dest) : null,
        });
      }
      page.cleanup();
    }
    const outline: OutlineItem[] = [];
    const walk = async (items: readonly { title: string; dest: unknown; items: unknown[] }[]) => {
      for (const item of items) {
        outline.push({ title: item.title, landing: await land(doc, item.dest) });
        await walk(item.items as typeof items);
      }
    };
    // null, not an empty list, for a PDF with no outline, whatever its type says
    const top = (await doc.getOutline()) as Parameters<typeof walk>[0] | null;
    await walk(top ?? []);
    return { pieces: pieces.sort(byReading), links: links.sort(byReading), outline };
  } finally {
    await task.destroy();
  }
}

/** The text of a link: the pieces on its page whose start and baseline are in its box. */
function linkText(link: Link, pieces: readonly Piece[]): string {
  const [x1, y1, x2, y2] = link.rect;
  return between(pieces, { page: link.page, y: y2 }, { page: link.page, y: y1 - 1 })
    .filter((p) => p.x >= x1 - 1 && p.x <= x2 + 1)
    .map((p) => p.str)
    .join('');
}

/** An event with a full section in a PDF, as the book prints it. */
interface Expected {
  stId: string;
  name: string;
  figure: Figure | null;
}

/** The items of a list in reading order from `start` (at or below it) to `next` (above it). */
function between<T extends Spot>(sorted: readonly T[], start: Spot, next: Spot | undefined): T[] {
  const first = (before: (item: T) => boolean) => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const item = sorted[mid];
      if (item && before(item)) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const from = first(
    (item) => item.page < start.page || (item.page === start.page && item.y > start.y)
  );
  const to = next
    ? first((item) => item.page < next.page || (item.page === next.page && item.y > next.y))
    : sorted.length;
  return sorted.slice(from, Math.max(from, to));
}

/** One PDF's faults, in its events' order, then its broken links. */
function checkPdf(
  file: string,
  pathway: string,
  events: readonly Expected[],
  { pieces, links, outline }: Read,
  sourced: (stId: string, figure: Figure) => boolean
): string[] {
  const site = new Links(true, '', new Set());
  const fault = (kind: CheckKind, stId: string) => `${kind} ${JSON.stringify(file)} ${stId}`;

  // each event's first link to its page on the website: its heading's, unless that is lost;
  // a link whose address cannot be decoded is broken, never a stop
  const pagePath = site.event('');
  const firstLinks = new Map<string, Link>();
  const undecodable = new Set<Link>();
  for (const link of links) {
    const at = link.uri?.lastIndexOf(pagePath) ?? -1;
    if (link.uri === null || at < 0) continue;
    let stId: string;
    try {
      stId = decodeURIComponent(link.uri.slice(at + pagePath.length));
    } catch {
      undecodable.add(link);
      continue;
    }
    if (!firstLinks.has(stId)) firstLinks.set(stId, link);
  }
  // the contents list's entries: the links before the first section, which is where the
  // first outline entry with an event's name lands, or else at the first event's first link
  // to its page (a link to an event's page on the cover would otherwise end the list before
  // it begins). Chromium writes one annotation for a link, its rectangle around every line of
  // an entry that wraps, so an entry's text is all that rectangle holds
  const names = new Set(events.map((event) => folded(event.name)));
  const first =
    outline
      .flatMap((item) => (item.landing && names.has(folded(item.title)) ? [item.landing] : []))
      .sort(byReading)[0] ??
    events
      .flatMap((event) => {
        const link = firstLinks.get(event.stId);
        return link ? [link] : [];
      })
      .sort(byReading)[0];
  const entries: { landing: Spot; text: string }[] = [];
  for (const link of links) {
    if (first && !later(first, link)) break;
    if (link.landing) entries.push({ landing: link.landing, text: folded(linkText(link, pieces)) });
  }
  // a page's body size, for a section with no `Stable identifier` label: the size most of
  // its characters are set at, leaving out what is inside a figure's link (its labels)
  const figureAddresses = events.flatMap((event) =>
    event.figure ? [site.figure(event.figure, event.stId)] : []
  );
  const figureLinks = links.filter(
    (link) => link.uri !== null && figureAddresses.some((address) => link.uri?.endsWith(address))
  );
  const bodies = new Map<number, number>();
  const bodyOf = (page: number): number => {
    let size = bodies.get(page);
    if (size === undefined) {
      const counts = new Map<number, number>();
      const boxes = figureLinks.filter((link) => link.page === page).map((link) => link.rect);
      for (const piece of between(pieces, { page, y: Infinity }, { page: page + 1, y: Infinity })) {
        const inside = boxes.some(
          ([x1, y1, x2, y2]) => piece.x >= x1 && piece.x <= x2 && piece.y >= y1 && piece.y <= y2
        );
        if (inside) continue;
        const rounded = Math.round(piece.size * 100) / 100;
        counts.set(rounded, (counts.get(rounded) ?? 0) + piece.str.length);
      }
      size = [...counts].sort(([, m], [, n]) => n - m)[0]?.[0] ?? 0;
      bodies.set(page, size);
    }
    return size;
  };
  // where the outline's entries and the contents' land, by the name each reads, once
  const byName = new Map<string, { outline: Spot[]; contents: Spot[] }>();
  const named = (name: string) => {
    let spots = byName.get(name);
    if (!spots) {
      spots = { outline: [], contents: [] };
      byName.set(name, spots);
    }
    return spots;
  };
  for (const item of outline)
    if (item.landing) named(folded(item.title)).outline.push(item.landing);
  for (const entry of entries) named(entry.text).contents.push(entry.landing);
  /** Whether the section starting at `spot` gives `stId` as its stable identifier: its first. */
  // where a section may start: each event's first link to its page, and each outline entry
  // with an event's name, so a candidate's section is read only up to the next
  const eventNames = new Set(events.map((event) => folded(event.name)));
  const possible = [
    ...firstLinks.values(),
    ...outline.flatMap((item) =>
      item.landing && eventNames.has(folded(item.title)) ? [item.landing] : []
    ),
  ].sort(byReading);
  const identifies = (spot: Spot, stId: string): boolean => {
    const next = possible.find((other) => later(other, spot) && !near(other, spot));
    const after = between(pieces, spot, next);
    const at = after.findIndex((piece) => folded(piece.str).startsWith(LABEL));
    const read = folded(after[at]?.str ?? '');
    return read === LABEL + stId || (read === LABEL && folded(after[at + 1]?.str ?? '') === stId);
  };
  // each section: at its first link to its page where an outline or contents entry with its
  // name lands there too; or else where such an entry lands whose section gives its stable
  // identifier (two events of one name), or the first; or else at that link
  const located = new Map<string, Spot>();
  for (const event of events) {
    const spots = byName.get(folded(event.name));
    const candidates = spots ? [...spots.outline, ...spots.contents] : [];
    const link = firstLinks.get(event.stId);
    const stId = folded(event.stId);
    const found =
      link && candidates.some((spot) => near(spot, link))
        ? link
        : (candidates.find((spot) => identifies(spot, stId)) ?? candidates[0] ?? link);
    if (found) located.set(event.stId, found);
  }
  // each section runs from its start to the next section's
  const starts = [...located.values()].sort(byReading);
  const sections = new Map<string, { start: Spot; next: Spot | undefined }>();
  for (const [stId, start] of located) {
    const next = starts.find((other) => later(other, start) && !near(other, start));
    sections.set(stId, { start, next });
  }

  const faults: string[] = [];
  for (const event of events) {
    const section = sections.get(event.stId);
    const name = folded(event.name);
    if (!section) {
      faults.push(fault('not-in-contents', event.stId), fault('not-in-outline', event.stId));
      faults.push(fault('no-name', event.stId));
      continue;
    }
    const { start, next } = section;
    const spots = byName.get(name);
    if (!spots?.contents.some((spot) => near(spot, start))) {
      faults.push(fault('not-in-contents', event.stId));
    }
    if (!spots?.outline.some((spot) => near(spot, start))) {
      faults.push(fault('not-in-outline', event.stId));
    }
    const text = between(pieces, start, next);
    const heading: Piece[] = [];
    // measured against the section's own body text: its `Stable identifier` label, which
    // every section prints; or else its page's commonest size outside its figures
    const label = text.find((piece) => folded(piece.str).startsWith(LABEL));
    const body = label?.size ?? bodyOf(start.page);
    for (const piece of text) {
      if (piece.size < body * HEADING_RATIO) break;
      heading.push(piece);
    }
    if (folded(heading.map((p) => p.str).join('')) !== name) {
      faults.push(fault('no-name', event.stId));
    }
    // its own piece after the label's, or in one piece with it
    const stId = folded(event.stId);
    const identified = text.some((piece, i) => {
      const read = folded(piece.str);
      return read === LABEL + stId || (read === LABEL && folded(text[i + 1]?.str ?? '') === stId);
    });
    if (!identified) {
      faults.push(fault('no-stable-id', event.stId));
    }
    if (event.figure && sourced(event.stId, event.figure)) {
      // below its heading, so not a reaction's heading's link to the same page
      const below = heading.at(-1) ?? text[0] ?? start;
      const address = site.figure(event.figure, event.stId);
      const drawn = between(links, start, next).some(
        (link) => link.uri?.endsWith(address) && later(link, below)
      );
      if (!drawn) faults.push(fault('missing-figure', event.stId));
    }
  }
  // a link not rewritten, one landing on no page of the PDF, or one whose address cannot be
  // decoded, named by the section it is in, or by the PDF's pathway in the front parts
  const broken = new Set<string>();
  for (const link of links) {
    const placeholder = link.uri?.startsWith(PLACEHOLDER) || link.uri?.startsWith(PROBE);
    const nowhere = link.internal && link.landing === null;
    if (!placeholder && !nowhere && !undecodable.has(link)) continue;
    let holder = pathway;
    for (const [stId, { start, next }] of sections) {
      if (between([link], start, next).length > 0) holder = stId;
    }
    broken.add(fault('broken-link', holder));
  }
  faults.push(...broken);
  return faults;
}

/**
 * FR-011's check of a book's folder, against the documents it was made from (as the
 * preflight builds them) and the release's folder, which says which figures' sources exist.
 */
export async function checkBook(
  folder: string,
  docs: readonly Document[],
  files: string
): Promise<BookCheck> {
  const characters = new BookCharacters();
  const expected = docs.flatMap((doc) => {
    const [pathway] = bookPathways([doc]);
    if (!pathway) return [];
    const printed = printedDocument(doc, characters);
    const events = printed.places.flatMap((place) =>
      place.full
        ? [
            {
              stId: place.section.event.stId,
              name: place.section.event.name,
              figure: place.section.figure,
            },
          ]
        : []
    );
    // named as `book` names it: the pathway's name as the graph has it
    return [{ file: fileName(pathway.name), stId: pathway.stId, events }];
  });
  const present = new Set(readdirSync(folder));
  const faults: string[] = [];
  for (const pdf of expected)
    if (!present.has(pdf.file)) faults.push(`missing-pathway ${pdf.stId}`);
  const names = new Set(expected.map((pdf) => pdf.file));
  const extra = [...present].filter((name) => !names.has(name)).sort();
  for (const name of extra) faults.push(`extra-file ${JSON.stringify(name)}`);

  const sources = new Map<string, boolean>();
  const sourced = (stId: string, figure: Figure): boolean => {
    let known = sources.get(stId);
    if (known === undefined) {
      known = checkFiles(files, neededFiles([figureRecord(stId, figure)])).length === 0;
      sources.set(stId, known);
    }
    return known;
  };
  for (const pdf of expected) {
    if (!present.has(pdf.file)) continue;
    const read = await readPdf(join(folder, pdf.file));
    faults.push(...checkPdf(pdf.file, pdf.stId, pdf.events, read, sourced));
  }
  return {
    faults,
    checks: CHECKS.map((check) => ({
      check,
      faults: faults.filter((f) => f.startsWith(`${check} `)).length,
    })),
  };
}

export interface CheckBookSettings {
  folder: string;
  graph: GraphSettings;
  species: string;
  files: string;
}

const FLAGS = ['--graph', '--database', '--species', '--files'];

/** The settings from `check-book`'s arguments and the environment (contracts/cli.md). */
export function checkBookSettings(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>
): CheckBookSettings {
  const flags = new Map<string, string>();
  const folders: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    if (!arg.startsWith('--')) {
      folders.push(arg);
      continue;
    }
    const [name = '', inline] = arg.split(/=(.*)/s, 2);
    if (!FLAGS.includes(name)) throw new SettingsError(`Unknown argument: ${name}`);
    const value = inline ?? args[++i];
    if (value === undefined || value === '') throw new SettingsError(`${name} needs a value`);
    if (flags.has(name)) throw new SettingsError(`${name} is given twice`);
    flags.set(name, value);
  }
  const [folder] = folders;
  if (folder === undefined || folder === '' || folders.length > 1) {
    throw new SettingsError('One folder is needed: pdf-export check-book <folder>');
  }
  const files = flags.get('--files');
  if (files === undefined) throw new SettingsError('--files is needed');
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
  return { folder, graph, species: flags.get('--species') ?? 'Homo sapiens', files };
}

/**
 * `pdf-export check-book <folder>`: exit 0 when every check passes, 1 with a fault (one line
 * each, `fault <fault>`), 2 on bad arguments, a folder that is not one, no EHLD summary in
 * `--files` (without it the Figure rules, and so the book, cannot be known), a graph that
 * cannot be reached at the start, or any other error.
 */
export async function checkBookCommand(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  {
    out,
    err,
    open = openGraph,
  }: {
    out: (text: string) => void;
    err: (text: string) => void;
    open?: (settings: GraphSettings, options?: GraphOptions) => Graph;
  }
): Promise<number> {
  let settings: CheckBookSettings;
  try {
    settings = checkBookSettings(args, env);
  } catch (error) {
    if (!(error instanceof SettingsError)) throw error;
    err(`${error.message}\n`);
    return 2;
  }
  let folder = false;
  try {
    folder = statSync(settings.folder).isDirectory();
  } catch {
    // not there: said below
  }
  if (!folder) {
    err(`Not a folder: ${settings.folder}\n`);
    return 2;
  }
  const summary = readSummary(settings.files);
  if (!summary) {
    err(`The release's folder has no ${SUMMARY}: the book's figures cannot be known\n`);
    return 2;
  }
  // the start's read on a driver of its own, retrying briefly, as `preflight`'s (T024)
  let start: Graph | undefined;
  try {
    start = open(settings.graph, { connectionTimeoutMs: 5000, retryTimeMs: 0 });
    await releaseInfo(start);
  } catch (error) {
    err(`The graph cannot be read: ${message(error)}\n`);
    return 2;
  } finally {
    await closing(start, err);
  }
  let graph: Graph | undefined;
  let checked: BookCheck;
  try {
    graph = open(settings.graph);
    const docs = await buildBook(graph, {
      species: settings.species,
      illustrated: summary.illustrated,
    });
    await closing(graph, err);
    graph = undefined;
    checked = await checkBook(settings.folder, docs, settings.files);
  } catch (error) {
    err(`The check stopped: ${message(error)}\n`);
    return 2;
  } finally {
    await closing(graph, err);
  }
  for (const fault of checked.faults) out(`fault ${fault}\n`);
  return checked.faults.length > 0 ? 1 : 0;
}
