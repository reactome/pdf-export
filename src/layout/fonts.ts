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

/**
 * The pages' @font-face rules, one for each file, its unicode-range the file's own
 * character map. Chromium chooses a face by its declared range, and @fontsource's ranges
 * are not always what a file draws (it declares Noto Sans Math's whole font as Latin), so
 * the ranges here come from the same maps the coverage check reads, and the two agree.
 */
export function fontFaceCss(): string {
  return fontFiles()
    .map(
      (file) => `@font-face {
  font-family: '${file.family}';
  font-style: normal;
  font-weight: ${String(file.weight)};
  font-display: block;
  src: url('${pathToFileURL(file.path).href}') format('woff2');
  unicode-range: ${unicodeRange(drawnBy(file.path))};
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
