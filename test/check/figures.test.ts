// SC-008's comparison (T034) on a figure where the real book's are: a page puts it at a
// fractional height, as a page of text does, and its thin lines must still compare as the
// same drawing. Cropping the page at the box's rounded corner set them up to half a pixel
// apart, and 7-9% of a dense diagram's pixels differed although it was the same drawing.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { compareFigure, MAX_DIFFERING, type FigurePrinter } from '../../src/check/figures.ts';
import { figureHtml } from '../../src/layout/figure.ts';
import { pageStyles } from '../../src/layout/document.ts';
import { Printer } from '../../src/print/print.ts';

const SITE = 'https://site.invalid';
const ADDRESS = '/PathwayBrowser/#/R-HSA-1';

/** A dense drawing: thin lines, a compartment's doubled border every few pixels. */
function lines(): string {
  // thin, and at fractional heights, as a diagram's compartment borders and edges are
  const strokes = Array.from(
    { length: 90 },
    (_, i) =>
      `<line x1="10" y1="${(3.3 + i * 3.37).toFixed(2)}" x2="890" y2="${(3.3 + i * 3.37).toFixed(2)}" stroke="#e8834a" stroke-width="0.7"/>`
  ).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="310" viewBox="0 0 900 310">${strokes}</svg>`;
}

/** The figure on a page below a fractional margin, as text above it puts it. */
function onPage(printer: FigurePrinter, svg: string, marginPt: number): Promise<Uint8Array> {
  const { html } = figureHtml(svg, 'page-', 'figure', `${SITE}/`);
  const linked = html.replace(/href="[^"]*"/, `href="${SITE}${ADDRESS}"`);
  // the book's own styles, which make the link the figure's box (pages.css)
  const { fonts, pages } = pageStyles();
  return printer.part(
    `<!doctype html><html><head><meta charset="utf-8"><style>${fonts}
${pages}
@page { size: A4; margin: 0; } html, body { margin: 0; padding: 0; }
.above { height: ${String(marginPt)}pt; }</style></head>
<body><div class="above"></div>${linked}</body></html>`
  );
}

let printer: Printer;
before(async () => {
  printer = await Printer.start();
});
after(async () => {
  await printer.close();
});

test('a figure at a fractional height compares as the same drawing', async () => {
  const svg = lines();
  for (const margin of [59.42, 131.42, 294.92, 135.92]) {
    const pdf = await onPage(printer, svg, margin);
    const result = await compareFigure(pdf, ADDRESS, svg, printer);
    assert.ok(result, `the figure's link is found (margin ${String(margin)}pt)`);
    assert.ok(
      result.within,
      `margin ${String(margin)}pt: ${(result.share * 100).toFixed(2)}% differ (bound ${String(MAX_DIFFERING * 100)}%)`
    );
  }
});

test('and a different drawing still does not', async () => {
  const svg = lines();
  const pdf = await onPage(printer, svg, 69.42);
  const other = svg.replace(/stroke="#e8834a"/g, 'stroke="#1a5a9a"');
  const result = await compareFigure(pdf, ADDRESS, other, printer);
  assert.ok(result && !result.within, `a recoloured drawing: ${String(result?.share)}`);
});

test('a figure is found by its own link, not a heading that links to the same page', async () => {
  // A reaction's figure links to the reaction's page, and so does its section's heading.
  const svg = lines();
  const { html } = figureHtml(svg, 'page-', 'figure', `${SITE}/`);
  const linked = html.replace(/href="[^"]*"/, `href="${SITE}${ADDRESS}"`);
  const { fonts, pages } = pageStyles();
  const pdf = await printer.part(
    `<!doctype html><html><head><meta charset="utf-8"><style>${fonts}
${pages}
@page { size: A4; margin: 0; } html, body { margin: 0; padding: 0; }</style></head>
<body><h2><a href="${SITE}${ADDRESS}">The reaction</a></h2>${linked}</body></html>`
  );
  const result = await compareFigure(pdf, ADDRESS, svg, printer);
  assert.ok(result?.within, `${String(result?.share)} differ`);
});
