// An illustration's lettering, read from its outlines (spec 001 T008, FR-016, research R4).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { measure, place } from '../../src/layout/figure.ts';
import { CAP_HEIGHT, lettering, outlineBoxes } from '../../src/layout/lettering.ts';

/** The smallest lettering's size, or null where any label was not read. */
const smallest = (svg: string) => {
  const read = lettering(svg);
  return read.unread > 0 ? null : read.smallest;
};

/** A letter as a box: left, top, right, bottom, drawn as the release's outlines are. */
const letter = (l: number, t: number, r: number, b: number) =>
  `M${String(l)} ${String(t)}H${String(r)}V${String(b)}H${String(l)}Z`;

/** A word on a baseline: two capitals of a height, a lower-case letter and a descender. */
function word(x: number, baseline: number, cap: number): string {
  return [
    letter(x, baseline - cap, x + 5, baseline),
    letter(x + 6, baseline - cap, x + 11, baseline),
    letter(x + 12, baseline - cap * 0.7, x + 17, baseline),
    letter(x + 18, baseline - cap * 0.7, x + 22, baseline + cap * 0.3),
  ].join('');
}

/** An illustration as the render service gives one: its viewport scaled, its labels paths. */
function illustration(labels: string[], viewport = 'matrix(0.5,0,0,0.5,0,10)'): string {
  const paths = labels
    .map((d, i) => `<path d="${d}" fill="white" id="PATHWAY TEXT${i ? `_${String(i)}` : ''}"/>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000"><g id="R-HSA-1" class="svg-pan-zoom_viewport" transform="${viewport}"><g id="BG"><path d="M0 0H9V9Z"/></g>${paths}</g></svg>`;
}

describe("an illustration's lettering", () => {
  test('is its labels’ cap height, at the viewport’s scale, as a font’s', () => {
    const svg = illustration([word(0, 20, 10)]);
    assert.equal(smallest(svg), (10 * 0.5) / CAP_HEIGHT);
    const measured = measure(svg);
    assert.equal(measured.smallestLabel, (10 * 0.5) / CAP_HEIGHT);
    assert.equal(place(measured).unmeasured, false);
  });

  test('is the smallest label’s', () => {
    const svg = illustration([word(0, 20, 10), word(100, 60, 8), word(200, 90, 12)]);
    assert.equal(smallest(svg), (8 * 0.5) / CAP_HEIGHT);
  });

  test('a label is its tallest line’s: punctuation set apart does not shrink it', () => {
    const dashes = letter(0, 30, 3, 31.6) + letter(4, 30, 7, 31.6);
    assert.equal(smallest(illustration([word(0, 20, 10) + dashes])), (10 * 0.5) / CAP_HEIGHT);
  });

  test('a glyph off the baseline is not counted in a line’s cap height', () => {
    // a descender, and a bracket rising above the capitals and below the baseline: neither
    // stands on the baseline, so the cap height stays 10
    const bracket = letter(30, 8, 32, 23);
    const svg = illustration([word(0, 20, 10) + bracket], 'matrix(1,0,0,1,0,0)');
    assert.equal(smallest(svg), 10 / CAP_HEIGHT);
  });

  test('with no viewport, the drawing is at its own scale', () => {
    const svg = `<svg width="1366" height="768"><path d="${word(0, 20, 10)}" id="PATHWAY TEXT"/></svg>`;
    assert.equal(smallest(svg), 10 / CAP_HEIGHT);
  });

  test('a viewport that is not a plain scale gives no reading', () => {
    for (const viewport of ['matrix(0.5,0.1,0,0.5,0,0)', 'matrix(0.5,0,0,0.6,0,0)', 'scale(0.5)']) {
      const svg = illustration([word(0, 20, 10)], viewport);
      assert.equal(smallest(svg), null, viewport);
      assert.equal(place(measure(svg)).unmeasured, true, viewport);
    }
  });

  test('outlines that cannot be read in full give no reading', () => {
    for (const d of [
      'm0 0h5v10h-5z',
      'm0 0l5 0l0 10z',
      'M0 0A5 5 0 0 1 10 10Z',
      'M0 0L5',
      'M0 0H',
    ]) {
      assert.equal(outlineBoxes(d), null, d);
    }
    // one unreadable label makes the whole illustration unmeasured, not its others' size
    const svg = illustration([word(0, 20, 10), 'm0 0h5v10h-5z']);
    assert.equal(smallest(svg), null);
    assert.equal(place(measure(svg)).unmeasured, true);
  });

  test('every absolute command is read, each subpath a box', () => {
    assert.deepEqual(outlineBoxes('M1 2L3 4C5 6 7 8 9 0ZM10 10H12V14S13 15 14 16Q1 2 3 4T5 6Z'), [
      [1, 0, 9, 8],
      [1, 2, 14, 16],
    ]);
  });

  test('text and lettering are both labels: the smaller sets the size', () => {
    const lettered = illustration([word(0, 20, 10)]);
    const larger = lettered.replace('</svg>', '<text font-size="20">a</text></svg>');
    assert.equal(measure(larger).smallestLabel, (10 * 0.5) / CAP_HEIGHT);
    const smaller = lettered.replace('</svg>', '<text font-size="3">a</text></svg>');
    assert.equal(measure(smaller).smallestLabel, 3);
    const unread = lettered.replace('</svg>', '<text font-size="1em">a</text></svg>');
    assert.equal(place(measure(unread)).unmeasured, true);
  });

  test('unread lettering beside text leaves the figure unmeasured', () => {
    const svg = illustration(['m0 0h5v10h-5z']).replace(
      '</svg>',
      '<text font-size="20">a</text></svg>'
    );
    assert.equal(measure(svg).unreadLabels, 1);
    assert.equal(place(measure(svg)).unmeasured, true);
  });

  test('an illustration with no label path is still unmeasured', () => {
    assert.equal(place(measure(illustration([]))).unmeasured, true);
  });
});
