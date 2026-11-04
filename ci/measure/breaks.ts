// T030 (research R8): where Chromium breaks a line, and what can still be wider than the
// text column once long tokens are given places to break (src/layout/html.ts).
//
//   node ci/measure/breaks.ts
//
// 1. Spaces: each character JavaScript's `\s` matches, and U+180E, U+200B and U+2060, set
//    between two runs of eight letters in a box too narrow for both: whether Chromium puts
//    them on two lines. Each is compared with `BREAKABLE_SPACE`; any disagreement is exit 1.
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
import { BREAKABLE_SPACE, markupBreaks } from '../../src/layout/html.ts';

const hex = (code: number) => `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;

const browser = await chromium.launch();
let disagree = 0;
try {
  const page = await browser.newPage();

  // 1. spaces
  const codes: number[] = [];
  for (let code = 0; code <= 0xffff; code++)
    if (/\s/u.test(String.fromCharCode(code))) codes.push(code);
  codes.push(0x180e, 0x200b, 0x2060);
  await page.setContent(
    '<div id="box" style="width: 60px; font: 16px monospace; white-space: normal"></div>'
  );
  // run in the page, as a string: this project's types have no DOM
  const broken = await page.evaluate<boolean[]>(
    `(() => {
      const box = document.getElementById('box');
      box.textContent = 'a';
      const one = box.getBoundingClientRect().height;
      return ${JSON.stringify(codes)}.map((code) => {
        box.textContent = 'aaaaaaaa' + String.fromCharCode(code) + 'bbbbbbbb';
        return box.getBoundingClientRect().height > one * 1.5;
      });
    })()`
  );
  console.log(
    'Spaces: whether Chromium breaks a line there (DISAGREE: BREAKABLE_SPACE says otherwise)'
  );
  codes.forEach((code, i) => {
    const chromiumBreaks = broken[i] === true;
    const ends = BREAKABLE_SPACE.test(String.fromCharCode(code));
    if (chromiumBreaks !== ends) disagree++;
    const mark = chromiumBreaks === ends ? '' : '  DISAGREE';
    console.log(`  ${hex(code)}  ${chromiumBreaks ? 'breaks' : 'joins '}  ${mark}`);
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
  console.log(`\n${String(disagree)} spaces disagree`);
  process.exitCode = 1;
}
