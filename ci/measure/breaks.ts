// T030 (research R8): where Chromium breaks a line, and what can still be wider than the
// text column once long tokens are given places to break (src/layout/html.ts).
//
//   node ci/measure/breaks.ts
//
// 1. Breaks: each character JavaScript's `\s` matches, U+0085, U+180E, U+200B and U+2060,
//    ASCII's punctuation, and hyphens and dashes, set between two runs of eight characters
//    (letters, digits, and each both ways round) in a box too narrow for both: whether
//    Chromium breaks the line after it, before it, both or not at all, and the same for a
//    space or a hyphen with a combining mark. Each is compared with `breakBeside`
//    (src/layout/html.ts), a space expected to break after; any disagreement is exit 1.
// 2. Tables: a summation's table of two rows, every cell one token, laid out by Chromium
//    with the book's stylesheets and print media, in a `.summation` as wide as the text
//    column (A4 less two 20 mm margins, 170 mm); the token given its breaks by
//    `markupBreaks`, as the layout does. For each token length, the fewest columns whose
//    table is wider than the column. The letters are given: a widest case of `m` alone,
//    and lowercase text cut from biochemical words, as a summation's long words are. The
//    figures depend on the letters, so they are approximate for any other text.
//
// The output is numbers only.
import { chromium } from 'playwright-core';

import { pageStyles } from '../../src/layout/document.ts';
import { breakBeside, markupBreaks } from '../../src/layout/html.ts';

const hex = (code: number) => `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;

const browser = await chromium.launch();
let disagree = 0;
try {
  const page = await browser.newPage();

  // 1. where a line breaks
  const codes: number[] = [];
  for (let code = 0; code <= 0xffff; code++)
    if (/\s/u.test(String.fromCharCode(code))) codes.push(code);
  codes.push(0x85, 0x180e, 0x200b, 0x2060);
  for (let code = 0x21; code <= 0x7e; code++)
    if (!/[a-z0-9]/i.test(String.fromCharCode(code))) codes.push(code);
  codes.push(0xad, 0xb7, 0x58a, 0x1806, 0x2027, 0x2043, 0x2044, 0x2212, 0x2215, 0x2e17);
  for (let code = 0x2010; code <= 0x2015; code++) codes.push(code);
  codes.push(0x2e1a, 0x30fb);
  // a combining acute accent after a space or a hyphen: one grapheme with it
  const marked = [0x20, 0x2009, 0x2d, 0x2010].map(
    (code) => String.fromCharCode(code) + String.fromCharCode(0x301)
  );
  const units = [...codes.map((code) => String.fromCharCode(code)), ...marked];
  await page.setContent(
    '<div id="box" style="width: 60px; font: 16px monospace; white-space: normal"></div>'
  );
  // run in the page, as a string: this project's types have no DOM. For each unit between
  // eight characters and eight more (letters, digits, both ways round), too wide for one
  // line: whether the line breaks after it, before it, both, or not at all.
  const measured = await page.evaluate<string[][]>(
    `(() => {
      const box = document.getElementById('box');
      const top = (node, from, to) => {
        const range = document.createRange();
        range.setStart(node, from);
        range.setEnd(node, to);
        const rect = range.getClientRects()[0];
        return rect ? Math.round(rect.top) : NaN;
      };
      return ${JSON.stringify(units)}.map((unit) =>
        [['a', 'b'], ['a', '1'], ['1', 'b'], ['1', '2']].map(([left, right]) => {
          box.textContent = left.repeat(8) + unit + right.repeat(8);
          const node = box.firstChild;
          const before = top(node, 7, 8);
          const after = top(node, 8 + unit.length, 9 + unit.length);
          const lines = new Set();
          for (let i = 0; i < 16 + unit.length; i++) lines.add(top(node, i, i + 1));
          lines.delete(NaN);
          if (lines.size === 1) return 'none';
          // the unit's own line, where it is drawn (a space at a line's end may not be)
          let own = NaN;
          for (let i = 8; i < 8 + unit.length && Number.isNaN(own); i++) own = top(node, i, i + 1);
          if (Number.isNaN(own)) return 'after';
          if (own === before && own !== after) return 'after';
          if (own === after && own !== before) return 'before';
          // on neither line: on one of its own (both), or a soft hyphen's added hyphen
          return lines.size > 2 ? 'both' : 'after';
        })
      );
    })()`
  );
  console.log(
    'Breaks: where Chromium breaks a line beside each, between letters and digits' +
      ' (DISAGREE: breakBeside says otherwise)'
  );
  units.forEach((unit, i) => {
    const found = [...new Set(measured[i])];
    const expected = breakBeside(unit);
    const agrees = found.length === 1 && found[0] === (expected === 'space' ? 'after' : expected);
    // a hyphen with a mark is taken to join, as decided (breakBeside): not a disagreement
    const decided = !agrees && expected === 'none' && Array.from(unit).length > 1;
    if (!agrees && !decided) disagree++;
    const name = Array.from(unit, (char) => hex(char.codePointAt(0) ?? 0)).join(' ');
    // by context (letter-letter, letter-digit, digit-letter, digit-digit) where they differ
    const what = found.length === 1 ? (found[0] ?? '') : (measured[i] ?? []).join(' ');
    const mark = agrees ? '' : decided ? ' taken to join, as decided' : ' DISAGREE';
    console.log(`  ${name.padEnd(13)} ${what.padEnd(7)} ${mark}`);
  });

  // 2. tables
  const css = pageStyles();
  const words = [
    'phosphatidylinositol',
    'glycosyltransferase',
    'ubiquitin',
    'mitochondrial',
    'dehydrogenase',
    'acetylglucosamine',
    'carboxykinase',
    'phosphofructokinase',
    'transcription',
    'cytochrome',
    'oxidoreductase',
    'aminoacyl',
    'synthetase',
    'glutathione',
    'peroxidase',
  ].join('');
  const letters: Record<string, (length: number, column: number) => string> = {
    'm alone': (length) => 'm'.repeat(length),
    'biochemical words': (length, column) =>
      (words + words).slice((column * 37) % words.length).slice(0, length),
  };
  const lengths = [20, 21, 25, 30, 35, 40, 41, 50, 60, 100];
  console.log('\nTables: the fewest columns wider than the text column, by token length');
  for (const [name, token] of Object.entries(letters)) {
    console.log(`  ${name}`);
    for (const length of lengths) {
      let found = 'none of 1 to 12';
      for (let columns = 1; columns <= 12; columns++) {
        const cells = Array.from(
          { length: columns },
          (_, c) => `<td>${token(length, c)}</td>`
        ).join('');
        const table = markupBreaks(`<table><tr>${cells}</tr><tr>${cells}</tr></table>`);
        await page.setContent(
          `<!doctype html><html><head><style>${css.fonts}</style><style>${css.theme}</style>` +
            `<style>${css.pages}</style></head><body class="book">` +
            `<div class="summation" style="width: 170mm">${table}</div></body></html>`
        );
        await page.emulateMedia({ media: 'print' });
        const [column, wide] = await page.evaluate<[number, number]>(
          `document.fonts.ready.then(() => [
            document.querySelector('.summation').getBoundingClientRect().width,
            document.querySelector('table').scrollWidth,
          ])`
        );
        if (wide > column + 0.5) {
          found = `${String(columns)} (${wide.toFixed(0)} px > ${column.toFixed(0)} px)`;
          break;
        }
      }
      console.log(`    ${String(length).padStart(3)} characters: ${found}`);
    }
  }
} finally {
  await browser.close();
}
if (disagree > 0) {
  console.log(`\n${String(disagree)} disagree`);
  process.exitCode = 1;
}
