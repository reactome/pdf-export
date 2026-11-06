// Page numbers and running headers on the book's joined PDFs (spec 001 T027, FR-016,
// research R4). A single event's PDF has them from its @page margin boxes (document.ts); the
// book's parts are printed without them, as a part does not know where it lands, and they
// are stamped here with pdf-lib on each joined PDF, numbered within that PDF across its
// parts. Each looks as a margin box draws it: the same text, the same faces (Roboto first,
// then the Noto fonts for what it lacks, each embedded as a subset), the theme's
// body-small size and on-surface-variant colour read from the compiled theme, centred
// where the box puts it. The cover has neither. A top-level pathway's name is stamped,
// not laid out, so FR-017's substitutions are made here; they are not counted in the run
// report, which counts the name where its section prints it. White space is collapsed and
// characters never drawn are left out, close to a margin box, so a stray tab or variation
// selector that prints in a section does not refuse the PDF here (`marginText`).
//
// Each face is embedded from its WOFF file, not the WOFF2 the pages load: fontkit's
// subsetter copies a WOFF2 file's `glyf` bytes as they are, transformed, and the subset's
// glyphs have no outlines (found in review: the text read back, and nothing was drawn).
// There is no shaping: no kerning, no ligatures, no bidirectional text or joined scripts
// (Arabic). A stamp is a pathway's name, a front part's or a number, which today's names
// do not need; a name that did would be drawn letter by letter.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import { ColorTypes, type PDFDocument, type PDFFont, type RGB } from '@cantoo/pdf-lib';
import * as fontkit from 'fontkit';

import { substituted } from '../layout/characters.ts';
import { MARGIN_FAMILIES, pageStyles } from '../layout/document.ts';
import { PAGE } from '../layout/figure.ts';
import { codePointName, fontFaces, type FontFace } from '../layout/fonts.ts';
import { FRONT, FRONT_NAMES, FRONT_PARTS } from '../layout/front.ts';
import type { Joined } from './parts.ts';

/** What one page carries: its header and its number, or neither (the cover). */
export interface PageStamp {
  header: string;
  number: string;
}

/** Where a front part's heading landed: its page, counted from 0 (links.ts's Target). */
export interface FrontTarget {
  index: number;
}

/**
 * What a margin box leaves out: FR-017's characters never drawn (`NEVER_DRAWN`) but its
 * white space, which is collapsed or kept (below), so controls and default-ignorable
 * characters (variation selectors, joiners, a soft hyphen).
 */
const LEFT_OUT = /[\p{Cc}\p{Default_Ignorable_Code_Point}]/u;

/**
 * A text close to how a margin box draws it: each run of CSS's collapsible white space
 * (space, tab, line feed, carriage return; not JavaScript's `\s`) one space, `LEFT_OUT`'s
 * characters left out (a form feed among them, a control CSS does not collapse), and a
 * space at either end trimmed. Any other space is kept, as Chromium keeps it: as itself
 * where a stamp face draws it (a no-break or thin space), and otherwise as U+0020, which
 * Chromium's box draws in its place where it has no face for it (an ideographic space, a
 * line separator, an Ogham space mark), not refused as a character no face draws. Such a
 * space at either end is not trimmed, as Chromium does not trim it: CSS strips only its
 * collapsible white space at a line's ends, so the box keeps it, a blank before or after
 * the name, and so does the stamp, as U+0020.
 *
 * Gaps against Chromium, known: Hangul fillers (U+3164, U+115F) are default-ignorable and
 * left out here, where Chromium may draw them as blanks; a space no stamp face draws is
 * stamped as U+0020, so as wide as a word space, where Chromium draws it at its own width
 * (an ideographic space an em wide), while a no-break or thin space, which a face draws,
 * is stamped at its own; and nothing here is shaped (above).
 */
export function marginText(text: string): string {
  let out = '';
  for (const char of text.replace(/[ \t\n\r]+/g, ' ')) {
    if (char === ' ' || !LEFT_OUT.test(char)) out += char;
  }
  out = out.replace(/ {2,}/g, ' ').replace(/^ | $/g, '');
  let drawn = '';
  for (const char of out) {
    drawn += /\s/u.test(char) && !faceFor(char.codePointAt(0) ?? 0) ? ' ' : char;
  }
  return drawn;
}

/**
 * Each page's stamp, or null for the cover's pages, from each part's pages in order, the
 * front part first. The front part's pages are named for the front part begun on or
 * before them (its heading's probe, from `rewriteLinks`), the pages before the first of
 * them being the cover's; every later page is the PDF's top-level pathway's, its name
 * after FR-017's substitutions. Numbers count the PDF's pages from the first, across its
 * parts, the cover's included, as a single PDF's `counter(page)` does.
 */
export function pageStamps(
  name: string,
  parts: readonly number[],
  targets: ReadonlyMap<string, FrontTarget>
): (PageStamp | null)[] {
  const frontPages = parts[0] ?? 0;
  const pages = parts.reduce((n, p) => n + p, 0);
  const starts = FRONT_PARTS.flatMap((part) => {
    const index = targets.get(FRONT[part])?.index;
    return index === undefined ? [] : [{ index, header: FRONT_NAMES[part] }];
  });
  starts.sort((a, b) => a.index - b.index);
  if (!targets.has(FRONT.introduction)) {
    throw new Error("The front part's introduction has no probe: run rewriteLinks first");
  }
  const outside = starts.filter((s) => s.index < 1 || s.index >= frontPages);
  if (outside.length > 0) {
    const named = outside.map((s) => `${s.header} on page ${String(s.index + 1)}`).join(', ');
    throw new Error(`Front parts outside the front part's pages 2–${String(frontPages)}: ${named}`);
  }
  const header = marginText(substituted(name));
  if (/^\s*$/u.test(header)) {
    throw new Error(`The pathway's name ${JSON.stringify(name)} leaves no header to stamp`);
  }
  const stamps: (PageStamp | null)[] = [];
  for (let i = 0; i < pages; i++) {
    const number = String(i + 1);
    if (i >= frontPages) stamps.push({ header, number });
    else {
      const begun = starts.filter((s) => s.index <= i).at(-1);
      stamps.push(begun ? { header: begun.header, number } : null);
    }
  }
  return stamps;
}

/** How the stamps look: the theme's body-small size, in points, and on-surface-variant. */
export interface Look {
  size: number;
  colour: RGB;
}

/** The look, read from the compiled theme's stylesheet (FR-015), never written here. */
export function stampLook(theme: string = pageStyles().theme): Look {
  const value = (name: string): string => {
    const found = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(theme)?.[1]?.trim();
    if (found === undefined) throw new Error(`The theme has no ${name}`);
    return found;
  };
  const hex = value('--mat-sys-on-surface-variant');
  const colour = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!colour) throw new Error(`The theme's on-surface-variant is ${hex}, not #rrggbb`);
  const [red = 0, green = 0, blue = 0] = colour.slice(1).map((c) => parseInt(c, 16) / 255);
  const size = value('--mat-sys-body-small-size');
  // the root's 16 px a rem (pages.css), at 0.75 pt a CSS pixel
  const length = /^([\d.]+)(rem|px)$/.exec(size);
  if (!length?.[1]) throw new Error(`The theme's body-small size is ${size}, not rem or px`);
  const px = Number(length[1]) * (length[2] === 'rem' ? 16 : 1);
  return { size: px * 0.75, colour: { type: ColorTypes.RGB, red, green, blue } };
}

let faceOf: Map<number, FontFace> | undefined;

/** The face a margin box draws a character with, at weight 400: the first family's that draws it. */
function faceFor(point: number): FontFace | undefined {
  if (!faceOf) {
    faceOf = new Map();
    const faces = fontFaces().filter((f) => f.weight === 400 && MARGIN_FAMILIES.includes(f.family));
    for (const family of MARGIN_FAMILIES) {
      for (const face of faces) {
        if (face.family !== family) continue;
        for (const p of face.points) if (!faceOf.has(p)) faceOf.set(p, face);
      }
    }
  }
  return faceOf.get(point);
}

/** A face's file and its names and metrics, read once. */
interface Loaded {
  bytes: Uint8Array;
  postscriptName: string;
  /** The hhea metrics in font units, which a line's `normal` height comes from. */
  ascent: number;
  descent: number;
  lineGap: number;
  unitsPerEm: number;
}

const loaded = new Map<string, Loaded>();

/** A face's WOFF file, beside the WOFF2 the pages load (see above). */
export function stampFile(face: FontFace): string {
  const path = face.path.replace(/\.woff2$/, '.woff');
  if (path === face.path || !existsSync(path)) {
    throw new Error(`No WOFF file beside ${face.path} to stamp with`);
  }
  return path;
}

/** A face's file read, once a path; its path is found each time, so a missing file is refused. */
function load(face: FontFace, fileOf: (face: FontFace) => string): Loaded {
  const path = fileOf(face);
  let file = loaded.get(path);
  if (!file) {
    const bytes = new Uint8Array(readFileSync(path));
    const font = fontkit.create(Buffer.from(bytes));
    if (!('postscriptName' in font)) throw new Error(`${face.path} is a collection, not a font`);
    file = {
      bytes,
      postscriptName: font.postscriptName,
      ascent: font.ascent,
      descent: font.descent,
      lineGap: font.lineGap,
      unitsPerEm: font.unitsPerEm,
    };
    loaded.set(path, file);
  }
  return file;
}

/** A text in runs, each in the face that draws it; throws naming a character none draws. */
function runs(text: string): { face: FontFace; text: string }[] {
  const out: { face: FontFace; text: string }[] = [];
  for (const char of text) {
    const point = char.codePointAt(0) ?? 0;
    const face = faceFor(point);
    if (!face) {
      throw new Error(`The stamp "${text}" holds ${codePointName(point)}, which no font draws`);
    }
    const last = out.at(-1);
    if (last?.face === face) last.text += char;
    else out.push({ face, text: char });
  }
  return out;
}

/**
 * A subset's tag, six capitals before its name (the PDF reference's subset fonts), from
 * the face and the characters it holds, so the same stamps write the same names.
 */
function subsetTag(face: FontFace, chars: ReadonlySet<string>): string {
  const hash = createHash('sha256')
    .update(face.path)
    .update([...chars].sort().join(''))
    .digest();
  return [...hash.subarray(0, 6)].map((byte) => String.fromCharCode(65 + (byte % 26))).join('');
}

/**
 * The PDFs stamped in this process, so none is stamped twice (T028 swaps a front part in
 * before stamping, never after). Held in memory, not marked in the file: a stamped PDF is
 * saved and done with, never loaded to be stamped again.
 */
const stamped = new WeakSet<PDFDocument>();

/**
 * Each page of a joined PDF stamped with its number and running header, in place. The
 * front part is the PDF's first part; `targets` are where its headings landed, as
 * `rewriteLinks` gives them, so it runs after that. Throws, stamping nothing, when the
 * PDF is stamped already, the parts' pages are not the PDF's, a front part's heading is
 * not in the front part, the name leaves no header, a character of a stamp is one no font
 * draws, or a face's file cannot be read; a PDF refused for any of these is not held as
 * stamped. Once those checks pass it is held as stamped before anything is embedded, so a
 * failure after that (embedding a face) leaves it held, part stamped: `book` discards a
 * PDF on any throw, never saving one (T029).
 *
 * @param fileOf each face's file (`stampFile`); the tests give one that is missing
 */
export async function stampPages(
  joined: Pick<Joined, 'doc' | 'pdf' | 'parts'>,
  targets: ReadonlyMap<string, FrontTarget>,
  look: Look = stampLook(),
  fileOf: (face: FontFace) => string = stampFile
): Promise<void> {
  const { doc, pdf, parts } = joined;
  if (stamped.has(pdf)) throw new Error('The joined PDF is stamped already');
  const pages = pdf.getPages();
  const counted = parts.reduce((n, part) => n + part.pages, 0);
  if (!parts[0] || parts[0].places.length > 0) {
    throw new Error("The joined PDF's first part is not its front part");
  }
  if (counted !== pages.length) {
    throw new Error(
      `The parts hold ${String(counted)} pages, the joined PDF ${String(pages.length)}`
    );
  }
  const stamps = pageStamps(
    doc.cover.title,
    parts.map((part) => part.pages),
    targets
  );
  // every stamp in runs, and each face's characters, before anything is embedded or drawn
  const laid = stamps.map((stamp) =>
    stamp ? { header: runs(stamp.header), number: runs(stamp.number) } : null
  );
  const used = new Map<FontFace, Set<string>>();
  for (const page of laid) {
    for (const run of page ? [...page.header, ...page.number] : []) {
      const chars = used.get(run.face) ?? new Set<string>();
      for (const char of run.text) chars.add(char);
      used.set(run.face, chars);
    }
  }
  // every face's file read, and the space's face found, before the PDF is held: a refusal
  // leaves it unmarked
  const files = [...used].map(([face, chars]) => ({ face, chars, file: load(face, fileOf) }));
  // a margin box's line is the first face's `normal` line (the one drawing a space,
  // Roboto's), centred in the box: the margin's height at the top or bottom of the page
  const space = faceFor(0x20);
  if (!space) throw new Error('No face draws a space');
  const metrics = load(space, fileOf);
  // held before the first await, so two stampings of the PDF at once cannot both pass
  stamped.add(pdf);
  pdf.registerFontkit(fontkit);
  const fonts = new Map<FontFace, PDFFont>();
  for (const { face, chars, file } of files) {
    const customName = `${subsetTag(face, chars)}+${file.postscriptName}`;
    fonts.set(face, await pdf.embedFont(file.bytes, { subset: true, customName }));
  }
  const em = look.size / metrics.unitsPerEm;
  const line = (metrics.ascent - metrics.descent + metrics.lineGap) * em;
  // the baseline's distance from the page's top edge in the top box, and from its bottom
  // edge in the bottom box
  const top = (PAGE.margin - line) / 2 + metrics.ascent * em;
  const bottom = PAGE.margin - top;
  const { size, colour: color } = look;
  pages.forEach((page, i) => {
    const stamp = laid[i];
    if (!stamp) return;
    const { width, height } = page.getSize();
    // each run placed, the header's and the number's, centred on the page's width
    const placed: { font: PDFFont; text: string; x: number; y: number }[] = [];
    const centred = (text: readonly { face: FontFace; text: string }[], y: number): void => {
      const sized = text.map((run) => {
        const font = fonts.get(run.face);
        if (!font) throw new Error(`No font embedded for ${run.face.path}`);
        return { font, text: run.text, width: font.widthOfTextAtSize(run.text, size) };
      });
      let x = (width - sized.reduce((w, run) => w + run.width, 0)) / 2;
      for (const run of sized) {
        placed.push({ font: run.font, text: run.text, x, y });
        x += run.width;
      }
    };
    centred(stamp.header, height - top);
    centred(stamp.number, bottom);
    // drawn a font at a time, each set on the page once: pdf-lib gives the page another
    // name for a font each time it is set
    for (const font of new Set(placed.map((run) => run.font))) {
      page.setFont(font);
      for (const run of placed) {
        if (run.font === font) page.drawText(run.text, { x: run.x, y: run.y, size, color });
      }
    }
  });
}
