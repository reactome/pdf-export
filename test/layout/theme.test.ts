// The theme and fonts (spec 001 T017, FR-015, research R5).
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { FAMILIES, codePointName, fontFiles, uncoveredCharacters } from '../../src/layout/fonts.ts';
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
    assert.doesNotMatch(readFileSync(file, 'utf8'), /#[0-9a-f]{6}\b|rgba?\(/i, file);
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
  const missing = uncoveredCharacters('The 中 character, twice: 中');
  assert.deepEqual(missing.map(codePointName), ['U+4E2D']);
});

test('each Noto font is there for characters only it draws', () => {
  // braille (Symbols 2), a combining caron (Math), a Cyrillic supplement letter (Noto Sans)
  assert.deepEqual(uncoveredCharacters('\u2801 a\u030c \u0514'), []);
});
