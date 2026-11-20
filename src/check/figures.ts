// SC-008's figure comparison (spec 001 T034, research R8): a figure as a PDF prints it and the
// render service's SVG of it, drawn by the same means, differ in no more than 1% of their
// pixels. The SVG is printed alone by the same printer, at the size the book gives it
// (figureHtml) and with the book's @font-face rules, on a page of its own size; both PDFs are
// then rasterised by pdf.js at one scale, the PDF's page cropped to the figure's box, which
// its link to the website marks (the link that check-book finds a figure by).
import { getDocument, VerbosityLevel } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { figureHtml, measure, place } from '../layout/figure.ts';
import { fontFaceCss } from '../layout/fonts.ts';
import { isRecord } from '../unknown.ts';

/** SC-008's bound: the share of pixels that may differ. */
export const MAX_DIFFERING = 0.01;

/** Pixels a point: the scale both sides are rasterised at. */
export const SCALE = 2;

/**
 * How far two pixels' channels may be apart and still be the same pixel: anti-aliasing at a
 * shape's edge differs a little between a figure inlined in a page and one printed alone.
 */
export const TOLERANCE = 48;

/** A rasterised region: RGBA, row by row. */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** A box on a PDF page, in points, as PDF annotations give it: x1, y1, x2, y2 from the bottom. */
export type Rect = readonly [number, number, number, number];

/** What printing a part of HTML gives (src/print/print.ts's Printer.part). */
export interface FigurePrinter {
  part(html: string): Promise<Uint8Array>;
}

interface Context {
  getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
}

interface Canvases {
  create(width: number, height: number): { canvas: unknown; context: Context };
}

const isCanvases = (value: unknown): value is Canvases =>
  isRecord(value) && typeof value['create'] === 'function';

const isRect = (value: unknown): value is Rect =>
  Array.isArray(value) && value.length === 4 && value.every((n) => typeof n === 'number');

/**
 * Where a PDF draws the figure whose link ends with `address` (src/layout/html.ts's
 * `figure`): its page (1-based) and its box. Null when no page links to it.
 */
export async function figureBox(
  pdf: Uint8Array,
  address: string
): Promise<{ page: number; rect: Rect } | null> {
  const task = getDocument({ data: new Uint8Array(pdf), verbosity: VerbosityLevel.ERRORS });
  try {
    const doc = await task.promise;
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const annotations: unknown = await page.getAnnotations();
      if (!Array.isArray(annotations)) continue;
      for (const annotation of annotations) {
        if (!isRecord(annotation)) continue;
        const url = annotation['url'];
        const rect = annotation['rect'];
        if (typeof url === 'string' && url.endsWith(address) && isRect(rect)) {
          return { page: n, rect };
        }
      }
    }
    return null;
  } finally {
    await task.destroy();
  }
}

/** A page of a PDF rasterised at `scale`, or the part of it inside `rect`. */
export async function rasterise(
  pdf: Uint8Array,
  pageNumber: number,
  scale: number = SCALE,
  rect?: Rect
): Promise<Pixels> {
  const task = getDocument({ data: new Uint8Array(pdf), verbosity: VerbosityLevel.ERRORS });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const [width, height] = [Math.ceil(viewport.width), Math.ceil(viewport.height)];
    const canvases: unknown = doc.canvasFactory;
    if (!isCanvases(canvases)) throw new Error('pdf.js has no canvas to draw on');
    const { canvas, context } = canvases.create(width, height);
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    if (!rect) return { width, height, data: context.getImageData(0, 0, width, height).data };
    // the box in the canvas's pixels: x from the page's left edge, y down from its top (the
    // book's pages are not rotated)
    const [viewLeft = 0, , , viewTop = 0] = page.view;
    const [x1, y1, x2, y2] = rect;
    const left = Math.round((Math.min(x1, x2) - viewLeft) * scale);
    const top = Math.round((viewTop - Math.max(y1, y2)) * scale);
    const w = Math.round(Math.abs(x2 - x1) * scale);
    const h = Math.round(Math.abs(y2 - y1) * scale);
    return { width: w, height: h, data: context.getImageData(left, top, w, h).data };
  } finally {
    await task.destroy();
  }
}

/**
 * The share of pixels that differ: a pixel differs where any channel is more than `tolerance`
 * apart (transparent read as white). Where the sizes differ, the pixels one side has and the
 * other lacks all differ.
 */
export function differingShare(a: Pixels, b: Pixels, tolerance: number = TOLERANCE): number {
  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  const channel = (p: Pixels, x: number, y: number, c: number): number | null => {
    if (x >= p.width || y >= p.height) return null;
    const i = (y * p.width + x) * 4;
    const alpha = (p.data[i + 3] ?? 0) / 255;
    return Math.round((p.data[i + c] ?? 0) * alpha + 255 * (1 - alpha));
  };
  let differing = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) {
        const [u, v] = [channel(a, x, y, c), channel(b, x, y, c)];
        if (u === null || v === null || Math.abs(u - v) > tolerance) {
          differing++;
          break;
        }
      }
    }
  }
  return width * height === 0 ? 1 : differing / (width * height);
}

/**
 * The render service's SVG printed alone: at the size the book gives it, with the book's
 * @font-face rules (no system font stands in for its labels), on a page of its own size.
 */
export async function printedAlone(printer: FigurePrinter, svg: string): Promise<Uint8Array> {
  const { scale } = place(measure(svg));
  const { width, height } = measure(svg);
  const { html } = figureHtml(svg, 'alone-', 'figure', 'https://alone.invalid/');
  const size = (px: number): string => `${(px * scale).toFixed(2)}pt`;
  return printer.part(
    `<!doctype html><html><head><meta charset="utf-8"><style>${fontFaceCss()}
@page { size: ${size(width)} ${size(height)}; margin: 0; }
html, body { margin: 0; padding: 0; } svg { display: block; }</style></head>
<body>${html}</body></html>`
  );
}

/**
 * A figure of a PDF compared with the render service's SVG of it: the share of their pixels
 * that differ, and whether it is within SC-008's bound. Null where the PDF has no figure
 * linking to `address`.
 */
export async function compareFigure(
  pdf: Uint8Array,
  address: string,
  svg: string,
  printer: FigurePrinter
): Promise<{ share: number; within: boolean } | null> {
  const box = await figureBox(pdf, address);
  if (!box) return null;
  const ours = await rasterise(pdf, box.page, SCALE, box.rect);
  const alone = await rasterise(await printedAlone(printer, svg), 1, SCALE);
  const share = differingShare(ours, alone);
  return { share, within: share <= MAX_DIFFERING };
}
