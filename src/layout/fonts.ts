// The PDFs' typefaces (spec 001 T017, FR-015, research R5): the website's Roboto, Roboto
// Mono for identifiers, and the Noto Sans family only for characters those lack, all
// OFL-1.1 from @fontsource. The image carries no other font, so nothing falls back
// silently; a character none of these covers is a fault before anything is printed.
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import * as fontkit from 'fontkit';

/** Each family: its @fontsource package, and the weights the pages use. */
export const FAMILIES = [
  { family: 'Roboto', package: 'roboto', weights: [300, 400, 500, 600] },
  { family: 'Roboto Mono', package: 'roboto-mono', weights: [400] },
  { family: 'Noto Sans', package: 'noto-sans', weights: [400] },
  { family: 'Noto Sans Symbols 2', package: 'noto-sans-symbols-2', weights: [400] },
  { family: 'Noto Sans Math', package: 'noto-sans-math', weights: [400] },
] as const;

export interface FontFile {
  family: string;
  weight: number;
  /** The subset the file holds (latin, greek, math …). */
  subset: string;
  path: string;
}

/** A package's files folder, wherever the install put it. */
function filesOf(name: string): string {
  return join(
    dirname(fileURLToPath(import.meta.resolve(`@fontsource/${name}/package.json`))),
    'files'
  );
}

/** Every font file the pages may load: each family's weights, upright, in WOFF2. */
export function fontFiles(): FontFile[] {
  const files: FontFile[] = [];
  for (const { family, package: name, weights } of FAMILIES) {
    const folder = filesOf(name);
    for (const file of readdirSync(folder)) {
      const match = new RegExp(`^${name}-(.+)-(\\d+)-normal\\.woff2$`).exec(file);
      const weight = Number(match?.[2]);
      if (!match?.[1] || !(weights as readonly number[]).includes(weight)) continue;
      files.push({ family, weight, subset: match[1], path: join(folder, file) });
    }
  }
  return files;
}

/** The code points a font file draws, from its own character map. */
function drawnBy(path: string): number[] {
  const font = fontkit.openSync(path);
  return 'characterSet' in font ? font.characterSet : [];
}

/** Code points as CSS unicode-range ranges: U+41-5A, U+20AC. */
export function unicodeRange(points: Iterable<number>): string {
  const sorted = [...new Set(points)].sort((a, b) => a - b);
  const ranges: string[] = [];
  const hex = (p: number) => p.toString(16).toUpperCase();
  for (let i = 0; i < sorted.length;) {
    const start = sorted[i] ?? 0;
    let end = start;
    while (sorted[i + 1] === end + 1) {
      end += 1;
      i += 1;
    }
    ranges.push(start === end ? `U+${hex(start)}` : `U+${hex(start)}-${hex(end)}`);
    i += 1;
  }
  return ranges.join(', ');
}

/** The order files of one family and weight are given their characters: Latin first. */
const SUBSET_ORDER = ['latin', 'latin-ext', 'greek', 'greek-ext', 'cyrillic', 'cyrillic-ext'];
const subsetRank = (subset: string): number => {
  const at = SUBSET_ORDER.indexOf(subset);
  return at === -1 ? SUBSET_ORDER.length : at;
};

export interface FontFace extends FontFile {
  /** The code points this face, and no other of its family and weight, draws. */
  points: number[];
}

let faces: FontFace[] | undefined;

/**
 * Each font file with the characters it is to draw. A file's character map is wider than
 * its subset's name (Roboto's math and symbols files hold A–Z too), and Chromium tries
 * overlapping faces last-declared first, so plain text would come from whichever file was
 * listed last. So within a family and weight each code point is given to one file only:
 * Latin first, then Latin Extended, Greek, Cyrillic, then the rest by name.
 */
export function fontFaces(): readonly FontFace[] {
  if (faces) return faces;
  const ordered = [...fontFiles()].sort(
    (a, b) =>
      a.family.localeCompare(b.family, 'en') ||
      a.weight - b.weight ||
      subsetRank(a.subset) - subsetRank(b.subset) ||
      (a.subset < b.subset ? -1 : a.subset > b.subset ? 1 : 0)
  );
  const given = new Map<string, Set<number>>();
  faces = ordered.map((file) => {
    const key = `${file.family}/${String(file.weight)}`;
    const taken = given.get(key) ?? new Set<number>();
    given.set(key, taken);
    const points = drawnBy(file.path).filter((p) => !taken.has(p));
    for (const p of points) taken.add(p);
    return { ...file, points };
  });
  return faces;
}

/**
 * The pages' @font-face rules, one for each file that draws anything, its unicode-range
 * the characters given to it (fontFaces). Chromium chooses a face by its declared range,
 * and @fontsource's ranges are not always what a file draws (it declares Noto Sans Math's
 * whole font as Latin), so the ranges here come from the same character maps the coverage
 * check reads, and the two agree.
 */
export function fontFaceCss(): string {
  return fontFaces()
    .filter((face) => face.points.length > 0)
    .map(
      (face) => `@font-face {
  font-family: '${face.family}';
  font-style: normal;
  font-weight: ${String(face.weight)};
  font-display: block;
  src: url('${pathToFileURL(face.path).href}') format('woff2');
  unicode-range: ${unicodeRange(face.points)};
}`
    )
    .join('\n');
}

let covered: Set<number> | undefined;

/** Every code point the fonts draw, at the body weight. */
export function coveredCodePoints(): ReadonlySet<number> {
  if (covered) return covered;
  covered = new Set();
  for (const file of fontFiles()) {
    if (file.weight !== 400) continue;
    for (const point of drawnBy(file.path)) covered.add(point);
  }
  return covered;
}

/**
 * The characters in a text that no font draws, each once, in order: white space, control
 * characters and those that are never drawn (variation selectors, joiners) aside.
 */
export function uncoveredCharacters(
  text: string,
  set: ReadonlySet<number> = coveredCodePoints()
): number[] {
  const missing = new Set<number>();
  for (const char of text) {
    const point = char.codePointAt(0) ?? 0;
    if (/[\s\p{Cc}\p{Default_Ignorable_Code_Point}]/u.test(char)) continue;
    if (!set.has(point)) missing.add(point);
  }
  return [...missing].sort((a, b) => a - b);
}

/** A fault's text for an uncovered character: `uncovered-character U+XXXX`. */
export function codePointName(point: number): string {
  return `U+${point.toString(16).toUpperCase().padStart(4, '0')}`;
}
