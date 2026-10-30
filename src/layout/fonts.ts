// The PDFs' typefaces (spec 001 T017, FR-015, research R5): the website's Roboto, Roboto
// Mono for identifiers, and the Noto Sans family only for characters those lack, all
// OFL-1.1 from @fontsource. The image carries no other font, so nothing falls back
// silently; a character none of these covers is a fault before anything is printed.
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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

const NODE_MODULES = new URL('../../node_modules/', import.meta.url);

/** Every font file the pages may load: each family's weights, upright, in WOFF2. */
export function fontFiles(): FontFile[] {
  const files: FontFile[] = [];
  for (const { family, package: name, weights } of FAMILIES) {
    const folder = new URL(`@fontsource/${name}/files/`, NODE_MODULES);
    for (const file of readdirSync(folder)) {
      const match = new RegExp(`^${name}-(.+)-(\\d+)-normal\\.woff2$`).exec(file);
      const weight = Number(match?.[2]);
      if (!match?.[1] || !(weights as readonly number[]).includes(weight)) continue;
      files.push({ family, weight, subset: match[1], path: fileURLToPath(new URL(file, folder)) });
    }
  }
  return files;
}

let covered: Set<number> | undefined;

/** Every code point the fonts draw, at the body weight. */
export function coveredCodePoints(): ReadonlySet<number> {
  if (covered) return covered;
  covered = new Set();
  for (const file of fontFiles()) {
    if (file.weight !== 400) continue;
    const font = fontkit.openSync(file.path);
    if ('characterSet' in font) for (const point of font.characterSet) covered.add(point);
  }
  return covered;
}

/**
 * The characters in a text that no font draws, each once, in order: white space and
 * control characters aside, which are not drawn.
 */
export function uncoveredCharacters(
  text: string,
  set: ReadonlySet<number> = coveredCodePoints()
): number[] {
  const missing = new Set<number>();
  for (const char of text) {
    const point = char.codePointAt(0) ?? 0;
    if (/[\s\p{Cc}\p{Cf}]/u.test(char)) continue;
    if (!set.has(point)) missing.add(point);
  }
  return [...missing].sort((a, b) => a - b);
}

/** A fault's text for an uncovered character: `uncovered-character U+XXXX`. */
export function codePointName(point: number): string {
  return `U+${point.toString(16).toUpperCase().padStart(4, '0')}`;
}
