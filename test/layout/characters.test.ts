// FR-017's characters in a PDF made on request (spec 001 T022): the substitutions, U+FFFD
// for any other character no font draws, each code point logged once per PDF, and in markup
// (a summation, a figure's labels) the text alone changed, never a tag or an attribute.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { labelsOnRequest } from '../../src/figures/labels.ts';
import {
  CharacterLog,
  SUBSTITUTIONS,
  onRequestStrings,
  onRequestText,
} from '../../src/layout/characters.ts';
import { coveredCodePoints } from '../../src/layout/fonts.ts';

function logged(): { log: CharacterLog; lines: string[] } {
  const lines: string[] = [];
  return { log: new CharacterLog('R-HSA-1', (line) => lines.push(line)), lines };
}

test('each substitution is drawn by the fonts and replaces its character, unlogged', () => {
  const covered = coveredCodePoints();
  for (const [point, by] of SUBSTITUTIONS) {
    assert.ok(!covered.has(point), `${point.toString(16)} needs its substitution`);
    for (const char of by) assert.ok(covered.has(char.codePointAt(0) ?? 0), by);
  }
  const { log, lines } = logged();
  assert.equal(
    onRequestText('non\u2011breaking, \uFB01ne, O2\u02D9\u2212, 2\u05F3-O', log),
    'non-breaking, fine, O2\u2022\u2212, 2\u2032-O'
  );
  assert.deepEqual(lines, []);
});

test('a character no font draws is U+FFFD, logged once per log with its subject, never the text', () => {
  const { log, lines } = logged();
  assert.equal(onRequestText('a\uE000b\uE000', log), 'a\uFFFDb\uFFFD');
  assert.equal(onRequestText('\u{1F600} and \uE000', log), '\uFFFD and \uFFFD');
  assert.deepEqual(lines, [
    'uncovered-character U+E000 R-HSA-1',
    'uncovered-character U+1F600 R-HSA-1',
  ]);
  // a character never drawn is no fault: a joiner, a variation selector, white space
  assert.equal(onRequestText('a\u200Db\uFE0F\u00A0c', log), 'a\u200Db\uFE0F\u00A0c');
  assert.equal(lines.length, 2);
  // another PDF, another log
  const other = logged();
  onRequestText('\uE000', other.log);
  assert.deepEqual(other.lines, ['uncovered-character U+E000 R-HSA-1']);
});

test("a figure's labels: their text changed, never a tag, an attribute, a comment or a style", () => {
  const { log, lines } = logged();
  const svg =
    '<svg id="a\uE000"><title>t\uE000</title><style>.x { content: "\uE001" }</style>' +
    '<!-- a > \uE001 --><text data-x=\'>\uE001\' font-size="12px">l\u2011&#xE002;&#8209;&#60;&#x41;</text>' +
    '<text><![CDATA[c\uE003]]></text></svg>';
  assert.equal(
    labelsOnRequest(svg, log),
    '<svg id="a\uE000"><title>t\uFFFD</title><style>.x { content: "\uE001" }</style>' +
      '<!-- a > \uE001 --><text data-x=\'>\uE001\' font-size="12px">l-\uFFFD-&#60;&#x41;</text>' +
      '<text><![CDATA[c\uFFFD]]></text></svg>'
  );
  assert.deepEqual(lines, [
    'uncovered-character U+E000 R-HSA-1',
    'uncovered-character U+E002 R-HSA-1',
    'uncovered-character U+E003 R-HSA-1',
  ]);
});

test('every string of a model: a summation as markup, the rest as text, the model unchanged', () => {
  const { log } = logged();
  const model = {
    name: 'n\uE000',
    summations: ['<p><a href="https://x.invalid/\u2011">s\u2011</a></p>'],
    found: new Map([['R-HSA-1', { identifiers: ['\uE000'] }]]),
    count: 3,
    none: null,
  };
  const clean = onRequestStrings(model, log);
  assert.deepEqual(clean, {
    name: 'n\uFFFD',
    summations: ['<p><a href="https://x.invalid/\u2011">s-</a></p>'],
    found: new Map([['R-HSA-1', { identifiers: ['\uFFFD'] }]]),
    count: 3,
    none: null,
  });
  assert.equal(model.name, 'n\uE000', 'copied, not changed in place');
});

test('a long text of plain characters, and one of many replacements, read at once', () => {
  const { log, lines } = logged();
  const plain = 'a'.repeat(1_000_000);
  let start = performance.now();
  assert.equal(onRequestText(plain, log), plain);
  const marked = `${'\uE000'.repeat(100_000)}<b>`;
  assert.equal(labelsOnRequest(marked, log), `${'\uFFFD'.repeat(100_000)}<b>`);
  assert.ok(performance.now() - start < 5_000);
  start = performance.now();
  // a tag never closed, and many `<`: read in one pass
  labelsOnRequest(`${'<a '.repeat(50_000)}"`, log);
  labelsOnRequest('<style>'.repeat(20_000), log);
  assert.ok(performance.now() - start < 5_000);
  assert.deepEqual(lines, ['uncovered-character U+E000 R-HSA-1']);
});
