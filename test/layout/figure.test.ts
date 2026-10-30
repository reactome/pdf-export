// A figure's size on the page (spec 001 T018, FR-016, research R4).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  FLOOR_PT,
  LANDSCAPE,
  PORTRAIT,
  figureHtml,
  figureKey,
  measure,
  place,
} from '../../src/layout/figure.ts';

/** An SVG of a size, with labels of the given sizes, in each way an SVG can give one. */
function svg(width: number, height: number, labels: number[] = [12]): string {
  const text = labels
    .map((size, i) =>
      i % 3 === 0
        ? `<text style="font: normal 600 ${String(size)}px Roboto">a</text>`
        : i % 3 === 1
          ? `<text font-size="${String(size)}">b</text>`
          : `<text style="font-size: ${String(size)}px">c</text>`
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}" viewBox="0 0 ${String(width)} ${String(height)}"><defs><clipPath id="clip-1"/></defs><g clip-path="url(#clip-1)">${text}</g></svg>`;
}

describe("a figure's size", () => {
  test('is read from the viewBox, or else the width and height', () => {
    assert.deepEqual(measure(svg(300, 200)), {
      width: 300,
      height: 200,
      smallestLabel: 12,
      unreadLabels: 0,
    });
    assert.deepEqual(measure('<svg width="40px" height="30"><text>x</text></svg>'), {
      width: 40,
      height: 30,
      smallestLabel: null,
      unreadLabels: 0,
    });
    assert.throws(() => measure('<svg><text>x</text></svg>'), /no size/);
  });

  test('its smallest label sets it, in whichever way the label gives its size', () => {
    assert.equal(measure(svg(100, 100, [80, 12, 16])).smallestLabel, 12);
    assert.equal(measure(svg(100, 100, [16, 80, 9])).smallestLabel, 9);
    assert.equal(measure(svg(100, 100, [16, 7, 80])).smallestLabel, 7);
  });

  test('a size in any absolute unit is read as pixels; a relative one is counted unread', () => {
    const label = (size: string) =>
      measure(`<svg width="9" height="9"><text font-size="${size}">a</text></svg>`);
    const read: [string, number][] = [
      ['12', 12],
      ['12.5px', 12.5],
      ['1e1px', 10],
      ['6pt', 8],
      ['12PT', 16],
      ['1pc', 16],
      ['0.5in', 48],
      ['2.54cm', 96],
      ['25.4mm', 96],
    ];
    for (const [size, px] of read) {
      const measured = label(size);
      assert.ok(Math.abs((measured.smallestLabel ?? NaN) - px) < 1e-9, size);
      assert.equal(measured.unreadLabels, 0, size);
    }
    for (const size of ['0.6em', '100%', '1rem', '1ex', '2vw', '3foo']) {
      assert.deepEqual([label(size).smallestLabel, label(size).unreadLabels], [null, 1], size);
    }
    // in the shorthand, the size is the first number with a unit: a bare number is a weight,
    // and a line height after it is not a size
    const shorthand = (font: string) =>
      measure(`<svg width="9" height="9"><text style="font: ${font}">a</text></svg>`);
    assert.equal(shorthand('normal 600 9pt/1.2em Roboto').smallestLabel, 12);
    assert.equal(shorthand('600 12px/14px Roboto').unreadLabels, 0);
    assert.deepEqual(
      [shorthand('600 1.5em Roboto').smallestLabel, shorthand('600 1.5em Roboto').unreadLabels],
      [null, 1]
    );
  });

  test('a label whose size cannot be read is not taken as legible', () => {
    const mixed = place(
      measure(
        '<svg width="300" height="200"><text font-size="12">a</text><text font-size="0.5em">b</text></svg>'
      )
    );
    assert.equal(mixed.unmeasured, true);
  });

  test('one with no label to measure, as an illustration, is placed by its size and reported', () => {
    const placed = place(measure('<svg width="1600" height="1000"><path d="M0 0"/></svg>'));
    assert.equal(placed.unmeasured, true);
    assert.equal(placed.landscape, false);
    assert.equal(place(measure(svg(300, 200))).unmeasured, false);
  });

  test('a figure that fits is in the text, never larger than its own size', () => {
    assert.deepEqual(place(measure(svg(300, 200))), {
      scale: 0.75,
      landscape: false,
      belowFloor: false,
      unmeasured: false,
    });
    const wide = place(measure(svg(1000, 200)));
    assert.equal(wide.landscape, false);
    assert.ok(Math.abs(wide.scale - PORTRAIT.width / 1000) < 1e-9);
    assert.ok(wide.scale * 12 >= FLOOR_PT);
  });

  test('one whose labels would print below 5 pt in the text gets a landscape page', () => {
    // 12 px labels allow about 1,155 px in portrait and 1,750 px in landscape (research R4)
    const placed = place(measure(svg(1500, 400)));
    assert.equal(placed.landscape, true);
    assert.equal(placed.belowFloor, false);
    assert.ok(Math.abs(placed.scale - LANDSCAPE.width / 1500) < 1e-9);
    assert.ok(placed.scale * 12 >= FLOOR_PT);
  });

  test('one still below the floor there is at the largest the page allows, and reported', () => {
    const placed = place(measure(svg(4000, 600)));
    assert.deepEqual(
      { landscape: placed.landscape, belowFloor: placed.belowFloor },
      { landscape: true, belowFloor: true }
    );
    assert.ok(Math.abs(placed.scale - LANDSCAPE.width / 4000) < 1e-9);
  });

  test('a tall one that landscape would print smaller stays in portrait, reported', () => {
    const placed = place(measure(svg(600, 3000)));
    assert.equal(placed.landscape, false);
    assert.equal(placed.belowFloor, true);
    assert.ok(Math.abs(placed.scale - PORTRAIT.height / 3000) < 1e-9);
  });

  test('its HTML: ids prefixed, sized in points, the landscape class where it goes', () => {
    const { html } = figureHtml(svg(300, 200), 's-R-HSA-1', 'Event: figure');
    assert.match(html, /^<div class="figure"><svg /);
    assert.match(html, / width="225\.00pt" height="150\.00pt"/);
    assert.match(html, /id="s-R-HSA-1-clip-1"/);
    assert.match(html, /url\(#s-R-HSA-1-clip-1\)/);
    assert.match(html, /aria-label="Event: figure"/);
    assert.doesNotMatch(html, /width="300"/);
    assert.match(figureHtml(svg(1500, 400), 'p', 'x').html, /^<div class="figure landscape">/);
  });

  test("its key: an ancestor's diagram is keyed by what it selects", () => {
    assert.equal(figureKey({ kind: 'diagram', stId: 'R-HSA-1' }), 'diagram/R-HSA-1');
    assert.notEqual(
      figureKey({ kind: 'ancestor', stId: 'R-HSA-1', highlight: ['R-HSA-2'] }),
      figureKey({ kind: 'ancestor', stId: 'R-HSA-1', highlight: ['R-HSA-3'] })
    );
  });
});
