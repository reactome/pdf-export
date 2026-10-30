// The theme and fonts (spec 001 T017, FR-015, research R5).
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  FAMILIES,
  codePointName,
  fontFaceCss,
  fontFiles,
  uncoveredCharacters,
  unicodeRange,
} from '../../src/layout/fonts.ts';
import { themeCss, themeVariables } from '../../src/layout/theme.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

test("the colours are the website's theme package's, compiled", () => {
  const variables = themeVariables();
  // the theme package's own primary palette, at the tone Material's light theme uses
  const palette = readFileSync(
    join(ROOT, 'node_modules/ngx-reactome-style/_theme-colors.scss'),
    'utf8'
  );
  const primary = /\bprimary:\s*\([\s\S]*?\b40:\s*(#[0-9a-f]{6})/i.exec(palette)?.[1];
  assert.ok(primary, 'the package names its primary palette');
  assert.equal(variables.get('--mat-sys-primary'), primary);
  for (const role of [
    'on-primary',
    'surface',
    'on-surface',
    'outline',
    'surface-container-lowest',
  ]) {
    assert.match(variables.get(`--mat-sys-${role}`) ?? '', /^#[0-9a-f]{6}$/i, role);
  }
  assert.match(themeCss(variables), /^:root \{$/m);
});

test('no colour value is written in our own code', () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|scss|css)$/.test(name)) files.push(path);
    }
  };
  walk(join(ROOT, 'src'));
  walk(join(ROOT, 'theme'));
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    // hex in any length, colour functions, and a named colour given to a colour property
    assert.doesNotMatch(
      text,
      /#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|light-dark|color-mix)\(/i,
      file
    );
    assert.doesNotMatch(
      text,
      /\b(?:color|background(?:-color)?|border(?:-[a-z]+)?-color|fill|stroke|outline-color)\s*:\s*(?!var\(|inherit|currentColor|transparent|none)[a-z]+/i,
      file
    );
  }
});

test('every family has its upright files at the weights the pages use', () => {
  const files = fontFiles();
  for (const { family, weights } of FAMILIES) {
    for (const weight of weights) {
      assert.ok(
        files.some((f) => f.family === family && f.weight === weight && f.subset === 'latin'),
        `${family} ${String(weight)}`
      );
    }
  }
});

test('the fonts draw what the website writes, and a character none draws is found', () => {
  assert.deepEqual(uncoveredCharacters('ATP → ADP; α-helix ≥ 2 μM, Ca²⁺ ✓ 𝔄'), []);
  assert.deepEqual(uncoveredCharacters('a\tb\n​'), [], 'white space and format characters');
  assert.deepEqual(uncoveredCharacters('\u2713\ufe0f'), [], 'a variation selector is never drawn');
  const missing = uncoveredCharacters('The 中 character, twice: 中');
  assert.deepEqual(missing.map(codePointName), ['U+4E2D']);
});

test('each Noto font is there for characters only it draws', () => {
  // braille (Symbols 2), a combining caron (Math), a Cyrillic supplement letter (Noto Sans)
  assert.deepEqual(uncoveredCharacters('\u2801 a\u030c \u0514'), []);
});

test('unicodeRange writes runs and single points as CSS does', () => {
  assert.equal(unicodeRange([0x43, 0x41, 0x42, 0x20ac, 0x41]), 'U+41-43, U+20AC');
});

test("each face declares the range its own file draws, so Chromium's choice and the check agree", () => {
  const css = fontFaceCss();
  const faces = [...css.matchAll(/font-family: '([^']+)';[\s\S]*?unicode-range: ([^;]+);/g)];
  assert.equal(faces.length, fontFiles().length);
  const declares = (point: number) =>
    faces
      .filter(([, , range]) =>
        (range ?? '').split(', ').some((r) => {
          const [lo, hi] = r
            .slice(2)
            .split('-')
            .map((h) => parseInt(h, 16));
          return lo !== undefined && point >= lo && point <= (hi ?? lo);
        })
      )
      .map(([, family]) => family);
  // characters only Noto Sans Math draws, though @fontsource declares its file as Latin
  assert.ok(declares(0x1d504).includes('Noto Sans Math'), 'U+1D504');
  assert.ok(declares(0x030c).includes('Noto Sans Math'), 'U+030C');
  // and a face never claims what its file cannot draw
  assert.equal(declares(0x4e2d).length, 0, 'U+4E2D');
});
