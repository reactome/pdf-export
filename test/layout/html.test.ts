// A long token's places to break (spec 001 T030): `<wbr>` in a token longer than 40
// characters, in equal pieces of at most 20, never inside a character reference or a tag.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { BREAK_EVERY, LONG_TOKEN, markupBreaks, text } from '../../src/layout/html.ts';
import { sanitiseSummation } from '../../src/model/rules.ts';

/** Each piece's length in characters, a character reference counted as one. */
const pieces = (out: string): number[] =>
  out.split('<wbr>').map((piece) => piece.replace(/&[^;]*;/g, '_').length);

describe("text()'s breaks", () => {
  test('a token of 40 characters is kept whole; longer, it breaks in equal pieces', () => {
    assert.equal(text('a'.repeat(LONG_TOKEN)), 'a'.repeat(LONG_TOKEN));
    assert.deepEqual(pieces(text('a'.repeat(41))), [14, 14, 13]);
    for (let n = LONG_TOKEN + 1; n <= 200; n++) {
      const lengths = pieces(text('a'.repeat(n)));
      assert.equal(lengths.length, Math.ceil(n / BREAK_EVERY), `${String(n)}: pieces`);
      assert.ok(Math.max(...lengths) <= BREAK_EVERY, `${String(n)}: at most 20`);
      assert.ok(Math.max(...lengths) - Math.min(...lengths) <= 1, `${String(n)}: equal`);
    }
  });

  test('a token ends at a space Chromium breaks at, and runs through one it does not', () => {
    // as measured by ci/measure/breaks.ts
    const half = 'a'.repeat(30);
    const breaking = [' ', '\t', '\n', '\r', '\r\n', '\u1680', '\u200b', '\u2028', '\u2029'];
    for (let code = 0x2000; code <= 0x200a; code++)
      if (code !== 0x2007) breaking.push(String.fromCharCode(code));
    breaking.push('\u205f', '\u3000', String.fromCharCode(0x85));
    for (const space of breaking)
      assert.equal(text(`${half}${space}${half}`), `${half}${space}${half}`, JSON.stringify(space));
    const joining = [
      '\u000b',
      '\u000c',
      '\u00a0',
      '\u2007',
      '\u202f',
      '\ufeff',
      '\u180e',
      '\u2060',
    ];
    for (const joiner of joining) {
      const out = text(`${half}${joiner}${half}`);
      assert.deepEqual(pieces(out), [16, 15, 15, 15], JSON.stringify(joiner));
      assert.equal(out.replaceAll('<wbr>', ''), `${half}${joiner}${half}`);
    }
  });

  test('two words beside a thin space are two tokens, each kept whole', () => {
    // 46 characters together: before, they were one token, broken mid-word
    const name = 'glycosylphosphatidylinositol\u2009phosphodiesterase isoform';
    assert.equal(text(name), name);
  });

  test('a run ends after a hyphen: a hyphenated name is kept whole, a long run broken', () => {
    const name = '1-phosphatidyl-1D-myo-inositol-4,5-bisphosphate';
    assert.equal(text(name), name);
    assert.equal(markupBreaks(`<p>${name}</p>`), `<p>${name}</p>`);
    // the hyphen counted in the run it closes: 45 and a hyphen in three pieces, then 10
    const long = `${'a'.repeat(45)}-${'b'.repeat(10)}`;
    assert.deepEqual(pieces(text(long)), [16, 15, 25]);
    assert.equal(text(long).replaceAll('<wbr>', ''), long);
  });

  test('a run ends where Chromium breaks beside a character, and nowhere else', () => {
    // as measured by ci/measure/breaks.ts, between two runs of 30
    const half = 'a'.repeat(30);
    const kept = (c: string) => text(`${half}${c}${half}`) === `${half}${c}${half}`;
    const after = [0x2d, 0x3f, 0xad, 0x58a, 0x2010, 0x2012, 0x2013, 0x2027, 0x2e17, 0x30fb];
    for (const code of [...after, 0x1806, 0x2014])
      assert.ok(kept(String.fromCharCode(code)), code.toString(16));
    // U+2011 (non-breaking hyphen), U+2015, U+2212 (minus), and punctuation that joins
    for (const code of [0x2011, 0x2015, 0x2212, 0x2f, 0x7c, 0x2c, 0x2e, 0x2b, 0x5f, 0xb7])
      assert.deepEqual(
        pieces(text(`${half}${String.fromCharCode(code)}${half}`)),
        [16, 15, 15, 15]
      );
    // a run that starts with U+1806 counts it there: 30, then 1 and 45
    const before = `${'a'.repeat(30)}${String.fromCharCode(0x1806)}${'b'.repeat(45)}`;
    assert.deepEqual(pieces(text(before)), [46, 15, 15]);
  });

  test('a space with a combining mark ends a token; a hyphen with one is taken to join', () => {
    const half = 'a'.repeat(30);
    const mark = String.fromCharCode(0x301);
    for (const space of [' ', String.fromCharCode(0x2009)])
      assert.equal(text(`${half}${space}${mark}${half}`), `${half}${space}${mark}${half}`);
    assert.deepEqual(pieces(text(`${half}-${mark}${half}`)), [16, 16, 15, 15]);
  });

  test('a character escaped is one unit, never broken into', () => {
    const out = text('&'.repeat(41));
    assert.equal(out, ['&amp;'.repeat(14), '&amp;'.repeat(14), '&amp;'.repeat(13)].join('<wbr>'));
    assert.doesNotMatch(text(`${'<'.repeat(30)}>${'"'.repeat(30)}`), /&[a-z]*<wbr>/);
  });
});

describe("markupBreaks()'s breaks", () => {
  test('a character reference is one unit, never broken into', () => {
    for (const reference of ['&amp;', '&#x3b1;', '&#945;']) {
      const out = markupBreaks(reference.repeat(41));
      assert.equal(
        out,
        [reference.repeat(14), reference.repeat(14), reference.repeat(13)].join('<wbr>')
      );
    }
  });

  test("a tag's attribute is never broken, nor counted in the word beside it", () => {
    const href = `https://site.example/${'p'.repeat(60)}`;
    const link = `<a href="${href}">link</a>`;
    assert.equal(markupBreaks(`<p>${link}</p>`), `<p>${link}</p>`);
    assert.equal(
      markupBreaks(`<p>${'w'.repeat(30)}${link}</p>`),
      `<p>${'w'.repeat(30)}${link}</p>`
    );
  });

  test('a word runs through inline tags, and ends at any other', () => {
    const x = 'x'.repeat(25);
    const y = 'y'.repeat(25);
    assert.equal(
      markupBreaks(`<p>${x}<i>${y}</i></p>`),
      `<p>${'x'.repeat(17)}<wbr>${'x'.repeat(8)}<i>${'y'.repeat(9)}<wbr>${'y'.repeat(16)}</i></p>`
    );
    assert.match(markupBreaks(`${x}<sub>2</sub>${y}`), /<wbr>/);
    const cells = `<tr><td>${x}</td><td>${y}</td></tr>`;
    assert.equal(markupBreaks(cells), cells);
    assert.equal(markupBreaks(`${x}<br>${y}`), `${x}<br>${y}`);
  });

  test('its text breaks as text() does, a `<` before no tag name being text', () => {
    const plain = `${'a'.repeat(45)} ${'b'.repeat(10)}`;
    assert.equal(markupBreaks(plain), text(plain));
    const lessThan = `${'a'.repeat(30)}<=${'b'.repeat(30)}`;
    assert.equal(markupBreaks(lessThan).replaceAll('<wbr>', ''), lessThan);
    assert.equal(markupBreaks(lessThan).split('<wbr>').length, 4);
    assert.equal(
      markupBreaks(`<p>${'a'.repeat(30)}\u00a0${'a'.repeat(30)}</p>`).split('<wbr>').length,
      4
    );
  });
  test('a space written as a numeric reference ends a token as the space does', () => {
    const x = 'x'.repeat(30);
    for (const space of ['&#x2009;', '&#8201;', '&#x20;'])
      assert.equal(markupBreaks(`${x}${space}${x}`), `${x}${space}${x}`, space);
    assert.equal(markupBreaks(`${x}&#xa0;${x}`).split('<wbr>').length, 4);
    assert.equal(markupBreaks(`${x}&nbsp;${x}`).split('<wbr>').length, 4);
  });

  test("a tag's quoted `>`, a comment, upper case: read as the tags they are", () => {
    const x = 'x'.repeat(25);
    const y = 'y'.repeat(25);
    // a quoted `>` does not end the tag, so nothing in it is counted or broken
    const link = `<a href="https://site.example/?q=a>${'b'.repeat(40)}">`;
    assert.equal(markupBreaks(`<p>${link}w</a></p>`), `<p>${link}w</a></p>`);
    // a word runs through a comment, `a`, `b` and an inline tag in capitals
    for (const [open, close] of [
      ['<!-- note -->', ''],
      ['<a href="https://site.example/">', '</a>'],
      ['<b>', '</b>'],
      ['<I>', '</I>'],
    ] as const) {
      const out = markupBreaks(`${x}${open}${y}${close}`);
      assert.equal(out.split('<wbr>').length, 3, open);
      assert.equal(out.replaceAll('<wbr>', ''), `${x}${open}${y}${close}`, open);
    }
  });

  test("it is given the sanitiser's markup, and breaks nothing inside a tag of it", () => {
    const raw =
      `<!DOCTYPE html><?pi ${'p'.repeat(50)}?><![CDATA[${'c'.repeat(50)}]]>` +
      `<script>${'s'.repeat(50)}</script><p title="${'t'.repeat(50)}">${'w'.repeat(50)}</p>`;
    const out = markupBreaks(sanitiseSummation(raw));
    assert.doesNotMatch(out, /<[^>]*<wbr>/);
    assert.match(out, /^<p>w+<wbr>w+<wbr>w+<\/p>$/);
  });
});
