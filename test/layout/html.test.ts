// A long token's places to break (spec 001 T030): `<wbr>` in a token longer than 40
// characters, in equal pieces of at most 20, never inside a character reference or a tag.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { BREAK_EVERY, LONG_TOKEN, markupBreaks, text } from '../../src/layout/html.ts';

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
    const half = 'a'.repeat(30);
    for (const space of [' ', '\t', '\n', '\r', '\r\n'])
      assert.equal(text(`${half}${space}${half}`), `${half}${space}${half}`, JSON.stringify(space));
    for (const joiner of ['\u00a0', '\u202f', '\ufeff']) {
      const out = text(`${half}${joiner}${half}`);
      assert.deepEqual(pieces(out), [16, 15, 15, 15], JSON.stringify(joiner));
      assert.equal(out.replaceAll('<wbr>', ''), `${half}${joiner}${half}`);
    }
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
});
