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

/**
 * An illustration as the render service gives one: its viewport scaled, by attribute and again
 * by style (to six significant figures, as the browser writes it), its labels paths.
 */
function illustration(labels: string[], viewport = 'matrix(0.5,0,0,0.5,0,10)'): string {
  const paths = labels
    .map((d, i) => `<path d="${d}" fill="white" id="PATHWAY TEXT${i ? `_${String(i)}` : ''}"/>`)
    .join('');
  const style = `transform: ${viewport.replace(/[\d.]+/g, (n) => String(Number(Number(n).toPrecision(6)))).replaceAll(',', ', ')};`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000"><g id="R-HSA-1" class="svg-pan-zoom_viewport" transform="${viewport}" style="${style}"><g id="BG"><path d="M0 0H9V9Z"/></g>${paths}</g></svg>`;
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

  test('a letter’s holes are not letters: they do not set the baseline', () => {
    // three Bs, each an outline and two counters, bottoms at 20, 19 and 14.5
    const b = (x: number) =>
      letter(x, 10, x + 5, 20) + letter(x + 1, 11, x + 4, 14.5) + letter(x + 1, 15.5, x + 4, 19);
    const svg = illustration([b(0) + b(6) + b(12)], 'matrix(1,0,0,1,0,0)');
    assert.equal(smallest(svg), 10 / CAP_HEIGHT);
  });

  test('a number with an exponent is read as a number', () => {
    assert.deepEqual(outlineBoxes('M1e-3 0L2 2Z'), [[0.001, 0, 2, 2]]);
    assert.deepEqual(outlineBoxes('M1E-3 0L2 2Z'), [[0.001, 0, 2, 2]]);
  });

  test('a subpath begun after a close, without a move, starts where the last one did', () => {
    assert.deepEqual(outlineBoxes('M0 0H5V10H0ZL20 20L25 25Z'), [
      [0, 0, 5, 10],
      [0, 0, 25, 25],
    ]);
    assert.deepEqual(outlineBoxes('M0 0H5V10H0ZH8V3Z'), [
      [0, 0, 5, 10],
      [0, 0, 8, 3],
    ]);
  });

  test('a command with the wrong count of numbers is not read', () => {
    for (const d of ['M0 0C1 1 2 2Z', 'M0 0Q1 1 2Z', 'M0 0S1 1 2 2 3 3Z', 'M0 0 1Z']) {
      assert.equal(outlineBoxes(d), null, d);
    }
  });

  test('a label transformed, or inside a transformed group, is not read', () => {
    const d = word(0, 20, 10);
    const own = illustration([]).replace(
      '</g></svg>',
      `<path transform="scale(0.25)" d="${d}" id="PATHWAY TEXT"/></g></svg>`
    );
    const inGroup = illustration([]).replace(
      '</g></svg>',
      `<g transform="scale(0.25)"><g><path d="${d}" id="PATHWAY TEXT"/></g></g></svg>`
    );
    for (const svg of [own, inGroup]) {
      assert.deepEqual(lettering(svg), { smallest: null, unread: 1 });
      assert.equal(place(measure(svg)).unmeasured, true);
    }
    // a group transformed and closed before the label does not count
    const before = illustration([]).replace(
      '</g></svg>',
      `<g transform="scale(0.25)"><path d="M0 0H1V1Z"/></g><path d="${d}" id="PATHWAY TEXT"/></g></svg>`
    );
    assert.deepEqual(lettering(before), { smallest: (10 * 0.5) / CAP_HEIGHT, unread: 0 });
  });

  test('lines are found whatever order their letters come in: dots do not split one', () => {
    // v, two dotted letters (i) and f: the dots overlap only f, which overlaps the rest; met
    // first, the dots and f would make a line of their own, and the dots outvote f there
    const i = (at: number) => letter(at, 11.5, at + 1.5, 13) + letter(at, 14, at + 1.5, 20);
    const vif = letter(0, 14, 5, 20) + i(6) + i(8) + letter(10, 10.8, 14, 20);
    const svg = illustration([vif], 'matrix(1,0,0,1,0,0)');
    assert.ok(Math.abs((smallest(svg) ?? 0) - 9.2 / CAP_HEIGHT) < 1e-9);
  });

  test('on a tied vote the lower bottom is the baseline: a mark set high is not', () => {
    // the prime written first, so the order of the letters cannot settle the tie
    const primeFive = letter(7, 11, 8.5, 14.5) + letter(0, 11, 6, 20);
    assert.equal(smallest(illustration([primeFive], 'matrix(1,0,0,1,0,0)')), 9 / CAP_HEIGHT);
  });

  test('two identical subpaths do not hide each other', () => {
    // two lower-case letters and a capital drawn twice, the only one: the cap height is its
    const x = (at: number) => letter(at, 13, at + 5, 20);
    const twice = x(0) + x(6) + letter(12, 10, 17, 20) + letter(12, 10, 17, 20);
    assert.equal(smallest(illustration([twice], 'matrix(1,0,0,1,0,0)')), 10 / CAP_HEIGHT);
  });

  test('markup that hides or changes a label’s scale leaves it unread', () => {
    const d = word(0, 20, 10);
    const label = `<path d="${d}" id="PATHWAY TEXT"/>`;
    const inViewport = (inner: string) =>
      illustration([]).replace('</g></svg>', `${inner}</g></svg>`);
    for (const [name, svg] of [
      ['single-quoted transform', inViewport(`<g transform='scale(0.25)'>${label}</g>`)],
      ['a link transformed', inViewport(`<a transform="scale(0.25)">${label}</a>`)],
      ['a styled transform', inViewport(`<g style="transform: scale(0.25)">${label}</g>`)],
      ['a nested svg', inViewport(`<svg width="25" viewBox="0 0 100 100">${label}</svg>`)],
      [
        'in defs, drawn by use',
        inViewport(`<defs>${label}</defs><use href="#x" transform="scale(2)"/>`),
      ],
    ] as const) {
      assert.deepEqual(lettering(svg), { smallest: null, unread: 1 }, name);
    }
  });

  test('a comment, character data or a self-closing group does not end or open a group', () => {
    const d = word(0, 20, 10);
    const svg = illustration([]).replace(
      '</g></svg>',
      `<!-- </g> --><![CDATA[ </g> ]]><g/><g /><path d="${d}" id="PATHWAY TEXT"/></g></svg>`
    );
    assert.deepEqual(lettering(svg), { smallest: (10 * 0.5) / CAP_HEIGHT, unread: 0 });
  });

  test('the viewport’s scale, by attribute and by style, must agree to the style’s six figures', () => {
    const d = word(0, 20, 10);
    const viewport = (style: string) =>
      `<svg width="1600" height="1000"><g class="svg-pan-zoom_viewport" transform="matrix(1.17130307,0,0,1.17130307,0,0)" style="${style}"><path d="${d}" id="PATHWAY TEXT"/></g></svg>`;
    const agrees = lettering(viewport('transform: matrix(1.1713, 0, 0, 1.1713, 0, 0);'));
    assert.equal(agrees.unread, 0);
    assert.ok(Math.abs((agrees.smallest ?? 0) - (10 * 1.17130307) / CAP_HEIGHT) < 1e-9);
    for (const style of ['transform: matrix(1.2, 0, 0, 1.2, 0, 0);', 'transform: scale(1.1713)']) {
      assert.deepEqual(lettering(viewport(style)), { smallest: null, unread: 1 }, style);
    }
  });

  test('a close tag ends only the element it names: a stray one does not end the viewport', () => {
    const d = word(0, 20, 10);
    const stray = illustration([]).replace(
      '</g></svg>',
      `</text></path><path d="${d}" id="PATHWAY TEXT"/></g></svg>`
    );
    assert.deepEqual(lettering(stray), { smallest: (10 * 0.5) / CAP_HEIGHT, unread: 0 });
  });

  test('the viewport is its class exactly, not one that begins with it', () => {
    const d = word(0, 20, 10);
    const svg = `<svg width="9" height="9"><g class="svg-pan-zoom_viewport-x" transform="matrix(2,0,0,2,0,0)"><path d="${d}" id="PATHWAY TEXT"/></g></svg>`;
    assert.deepEqual(lettering(svg), { smallest: null, unread: 1 });
  });

  test('elements are known with a namespace prefix or in capitals', () => {
    const label = `<path d="${word(0, 20, 10)}" id="PATHWAY TEXT"/>`;
    for (const wrap of [
      `<svg:defs>${label}</svg:defs>`,
      `<DEFS>${label}</DEFS>`,
      `<svg:svg>${label}</svg:svg>`,
    ]) {
      const svg = illustration([]).replace('</g></svg>', `${wrap}</g></svg>`);
      assert.deepEqual(lettering(svg), { smallest: null, unread: 1 }, wrap);
    }
  });

  test('many comments, or tags never closed, are read in linear time', () => {
    const label = `<path d="${word(0, 20, 10)}" id="PATHWAY TEXT"/>`;
    for (const filler of [
      '<a "' + '<a '.repeat(20_000) + "'>",
      '<!-- x -->'.repeat(40_000),
      '<![CDATA[x]]>'.repeat(40_000),
      '<a '.repeat(20_000),
    ]) {
      const svg = `<svg width="9" height="9">${label}${filler}`;
      const started = performance.now();
      lettering(svg);
      assert.ok(
        performance.now() - started < 250,
        `${filler.slice(0, 12)}: ${String(performance.now() - started)} ms`
      );
    }
  });

  test('a close tag that skips open elements leaves the labels after it unread', () => {
    const d = word(0, 20, 10);
    const svg = illustration([]).replace(
      '</g></svg>',
      `<g></svg><path d="${d}" id="PATHWAY TEXT"/></g></svg>`
    );
    assert.deepEqual(lettering(svg), { smallest: null, unread: 1 });
  });

  test('a label in a title, a description or metadata is unread', () => {
    const label = `<path d="${word(0, 20, 10)}" id="PATHWAY TEXT"/>`;
    for (const name of ['title', 'desc', 'metadata']) {
      const svg = illustration([]).replace('</g></svg>', `<${name}>${label}</${name}></g></svg>`);
      assert.deepEqual(lettering(svg), { smallest: null, unread: 1 }, name);
    }
  });

  test('an illustration with no label path is still unmeasured', () => {
    assert.equal(place(measure(illustration([]))).unmeasured, true);
  });
});
