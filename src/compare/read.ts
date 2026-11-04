// What FR-012's comparison reads from a PDF (spec 001 T035, research R8): its lines of text,
// its links and its figures, with pdf.js, from either layout: pdf-export's or `event-pdf`'s.
// Nothing here knows which made the file; src/compare/reduce.ts reads the parts from these.
//
// - **Lines:** the pieces of text that share a baseline on a page, left to right, each with
//   its left edge and its largest size. What is in a page's top or bottom margin band (the
//   running headers and page numbers, which FR-012 does not compare; MARGIN_BAND_PT unless
//   set) and what is inside a figure (a vector diagram's labels) is left out.
// - **Links:** each link's box, its address or where in the PDF it lands.
// - **Figures:** the boxes of what is drawn: images, and painted paths that are neither thin
//   (a rule, a table's border) nor the whole page, clustered where they lie within
//   FIGURE_GAP_PT of each other, a thin path joining only the clusters it touches (a
//   diagram's connector); a cluster at least FIGURE_MIN_PT each way is a figure. A raster
//   diagram is one image; a vector one is many paths. A table drawn with thick or shaded
//   cells could be read as one, its text then left out (for T040 to check on `event-pdf`).
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';

/**
 * The bands at a page's top and bottom read as margins, by default: within pdf-export's 20 mm
 * (56.7 pt, src/layout/figure.ts), where its running headers and page numbers are, and above
 * the first line of its text area. A setting (`compare --reference-margin`): T040 sets it for
 * `event-pdf`'s files from their real margins, not known here.
 */
export const MARGIN_BAND_PT = 50;

/** Shapes nearer than this are one figure. */
export const FIGURE_GAP_PT = 30;

/** A figure is at least this wide and this tall: a logo's mark or a bullet is not. */
export const FIGURE_MIN_PT = 60;

/** A shape thinner than this either way is a rule or a border, not part of a figure. */
const THIN_PT = 2;

/** A place in a PDF: its page, counted from 0, and a height on it in points from its foot. */
export interface Spot {
  page: number;
  y: number;
}

/** A box on a page: left, bottom, right, top, in points. */
export interface Box {
  page: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Line extends Spot {
  /** Its left edge. */
  x: number;
  /** Its largest piece's size. */
  size: number;
  /** Its pieces' text, joined as pdf.js gives them. */
  text: string;
}

export interface Link {
  box: Box;
  uri: string | null;
  /** Where an internal link lands, or null. */
  landing: Spot | null;
}

export interface Layout {
  pages: { width: number; height: number }[];
  /** In reading order: by page, then from the top down. */
  lines: Line[];
  links: Link[];
  figures: Box[];
}

type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `m` then `n`: a point is taken through `m`, then through `n` (PDF's row-vector order). */
function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

/** A rectangle [x1, y1, x2, y2] through a matrix, as the box around its corners. */
function through(rect: readonly number[], m: Matrix, page: number): Box {
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = rect;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [x, y] of [
    [x1, y1],
    [x1, y2],
    [x2, y1],
    [x2, y2],
  ] as const) {
    xs.push(m[0] * x + m[2] * y + m[4]);
    ys.push(m[1] * x + m[3] * y + m[5]);
  }
  return {
    page,
    x1: Math.min(...xs),
    y1: Math.min(...ys),
    x2: Math.max(...xs),
    y2: Math.max(...ys),
  };
}

const isMatrix = (value: unknown): value is Matrix =>
  Array.isArray(value) && value.length === 6 && value.every((n) => typeof n === 'number');

const IMAGES = new Set<number>([
  OPS.paintImageXObject,
  OPS.paintInlineImageXObject,
  OPS.paintImageMaskXObject,
  OPS.paintImageXObjectRepeat,
  OPS.paintInlineImageXObjectGroup,
  OPS.paintImageMaskXObjectGroup,
  OPS.paintSolidColorImageMask,
]);

/** The shapes a page paints: images, and painted paths, each as its box. */
function shapes(fnArray: readonly number[], argsArray: readonly unknown[], page: number): Box[] {
  const boxes: Box[] = [];
  let ctm: Matrix = IDENTITY;
  const stack: Matrix[] = [];
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];
    if (fn === OPS.save || fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      const matrix: unknown =
        fn === OPS.paintFormXObjectBegin && Array.isArray(args) ? args[0] : null;
      if (isMatrix(matrix)) ctm = multiply(matrix, ctm);
    } else if (fn === OPS.restore || fn === OPS.paintFormXObjectEnd) {
      ctm = stack.pop() ?? IDENTITY;
    } else if (fn === OPS.transform && isMatrix(args)) {
      ctm = multiply(args, ctm);
    } else if (fn === OPS.constructPath && Array.isArray(args)) {
      // [how it is painted, its drawing, its box]: a path only clipped to is not drawn
      const [paint, , minMax] = args as [unknown, unknown, unknown];
      if (paint === OPS.endPath || minMax === null || typeof minMax !== 'object') continue;
      const rect = Array.from(minMax as ArrayLike<number>);
      if (rect.length === 4 && rect.every(Number.isFinite)) boxes.push(through(rect, ctm, page));
    } else if (fn !== undefined && IMAGES.has(fn)) {
      boxes.push(through([0, 0, 1, 1], ctm, page));
    }
  }
  return boxes;
}

/** Two boxes within `gap` of each other. */
const near = (a: Box, b: Box, gap: number): boolean =>
  a.x1 - gap <= b.x2 && b.x1 - gap <= a.x2 && a.y1 - gap <= b.y2 && b.y1 - gap <= a.y2;

const union = (a: Box, b: Box): Box => ({
  page: a.page,
  x1: Math.min(a.x1, b.x1),
  y1: Math.min(a.y1, b.y1),
  x2: Math.max(a.x2, b.x2),
  y2: Math.max(a.y2, b.y2),
});

/** Boxes joined into clusters wherever any two are within `gap`, until none are. */
function clustered(boxes: readonly Box[], gap: number): Box[] {
  let clusters: Box[] = [];
  for (const box of boxes) {
    let merged = { ...box };
    // a box may join clusters that were apart until it came
    clusters = clusters.filter((cluster) => {
      if (!near(cluster, merged, gap)) return true;
      merged = union(cluster, merged);
      return false;
    });
    clusters.push(merged);
  }
  // a merge can bring a cluster near one it was not near before
  for (let again = true; again;) {
    again = false;
    for (let i = 0; i < clusters.length && !again; i++) {
      for (let j = i + 1; j < clusters.length && !again; j++) {
        const [a, b] = [clusters[i], clusters[j]];
        if (!a || !b || !near(a, b, gap)) continue;
        clusters[i] = union(a, b);
        clusters.splice(j, 1);
        again = true;
      }
    }
  }
  return clusters;
}

/**
 * The figures among a page's shapes. The shapes that are neither thin nor all of the page
 * are clustered within FIGURE_GAP_PT; a thin shape (a diagram's connector, a line drawn as
 * a path) joins a cluster only where it touches one, so a rule or a table's border near a
 * figure is not taken in, while a connector bridges the shapes it joins. A cluster at least
 * FIGURE_MIN_PT each way is a figure.
 */
export function figureBoxes(boxes: readonly Box[], width: number, height: number): Box[] {
  const kept = boxes.filter((b) => (b.x2 - b.x1) * (b.y2 - b.y1) < 0.9 * width * height);
  const thin = (b: Box) => b.x2 - b.x1 < THIN_PT || b.y2 - b.y1 < THIN_PT;
  let clusters = clustered(
    kept.filter((b) => !thin(b)),
    FIGURE_GAP_PT
  );
  let lines = kept.filter(thin);
  for (let joined = true; joined && clusters.length > 0;) {
    const touching = lines.filter((line) => clusters.some((c) => near(c, line, 1)));
    joined = touching.length > 0;
    lines = lines.filter((line) => !touching.includes(line));
    if (joined) clusters = clustered([...clusters, ...touching], 1);
  }
  clusters = clustered(clusters, FIGURE_GAP_PT);
  return clusters.filter((c) => c.x2 - c.x1 >= FIGURE_MIN_PT && c.y2 - c.y1 >= FIGURE_MIN_PT);
}

export const inside = (x: number, y: number, box: Box): boolean =>
  x >= box.x1 - 1 && x <= box.x2 + 1 && y >= box.y1 - 1 && y <= box.y2 + 1;

type PdfJs = Awaited<ReturnType<typeof getDocument>['promise']>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object';

/** Where a destination lands, or null where it names no page of the PDF. */
async function land(doc: PdfJs, dest: unknown): Promise<Spot | null> {
  try {
    const explicit: unknown = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(explicit)) return null;
    const [ref, kind, left, top] = explicit as unknown[];
    let page: number;
    if (typeof ref === 'number') {
      if (!Number.isInteger(ref) || ref < 0 || ref >= doc.numPages) return null;
      page = ref;
    } else if (isRecord(ref) && 'num' in ref && 'gen' in ref) {
      page = await doc.getPageIndex(ref as { num: number; gen: number });
    } else {
      return null;
    }
    const name = isRecord(kind) && 'name' in kind ? kind['name'] : null;
    const height = name === 'XYZ' ? top : name === 'FitH' || name === 'FitBH' ? left : null;
    if (typeof height === 'number') return { page, y: height };
    const [, , , pageTop = 0] = (await doc.getPage(page + 1)).view;
    return { page, y: pageTop };
  } catch {
    return null;
  }
}

interface Piece {
  x: number;
  y: number;
  size: number;
  str: string;
}

/** A page's pieces as lines: those sharing a baseline, within a point, left to right. */
function linesOf(pieces: Piece[], page: number): Line[] {
  const lines: Line[] = [];
  const sorted = [...pieces].sort((a, b) => b.y - a.y || a.x - b.x);
  let current: Piece[] = [];
  const flush = () => {
    const [first] = current;
    if (!first) return;
    const row = current.sort((a, b) => a.x - b.x);
    lines.push({
      page,
      y: first.y,
      x: Math.min(...row.map((p) => p.x)),
      size: Math.max(...row.map((p) => p.size)),
      text: row.map((p) => p.str).join(''),
    });
    current = [];
  };
  for (const piece of sorted) {
    const [first] = current;
    if (first && Math.abs(first.y - piece.y) > 1) flush();
    current.push(piece);
  }
  flush();
  return lines;
}

/**
 * A PDF's lines, links and figures, read with pdf.js. The bytes are handed over: pdf.js may
 * detach their buffer, so a caller keeping them passes a copy. A Node Buffer is refused: give
 * a plain Uint8Array over its memory.
 */
export async function readLayout(
  data: Uint8Array,
  { margin = MARGIN_BAND_PT }: { margin?: number } = {}
): Promise<Layout> {
  // not copied: pdf.js takes the buffer it is given, which the caller gives up
  const task = getDocument({ data });
  try {
    const doc = await task.promise;
    const layout: Layout = { pages: [], lines: [], links: [], figures: [] };
    for (let i = 0; i < doc.numPages; i++) {
      const page = await doc.getPage(i + 1);
      const [, , width = 0, height = 0] = page.view;
      layout.pages.push({ width, height });
      const operators = await page.getOperatorList();
      const figures = figureBoxes(shapes(operators.fnArray, operators.argsArray, i), width, height);
      layout.figures.push(...figures);
      const pieces: Piece[] = [];
      for (const item of (await page.getTextContent()).items) {
        if (!('str' in item) || item.str === '') continue;
        const [a = 0, b = 0, c = 0, d = 0, x = 0, y = 0] = item.transform as number[];
        if (y <= margin || y >= height - margin) continue;
        if (figures.some((box) => inside(x, y, box))) continue;
        pieces.push({ x, y, size: Math.max(Math.hypot(a, b), Math.hypot(c, d)), str: item.str });
      }
      layout.lines.push(...linesOf(pieces, i).filter((line) => line.text.trim() !== ''));
      for (const annot of (await page.getAnnotations()) as unknown[]) {
        if (!isRecord(annot) || annot['subtype'] !== 'Link') continue;
        const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = (annot['rect'] as number[] | undefined) ?? [];
        const address = annot['unsafeUrl'] ?? annot['url'];
        const uri = typeof address === 'string' ? address : null;
        const dest = annot['dest'];
        layout.links.push({
          box: {
            page: i,
            x1: Math.min(x1, x2),
            y1: Math.min(y1, y2),
            x2: Math.max(x1, x2),
            y2: Math.max(y1, y2),
          },
          uri,
          landing:
            uri === null && dest !== undefined && dest !== null ? await land(doc, dest) : null,
        });
      }
      page.cleanup();
    }
    return layout;
  } finally {
    await task.destroy();
  }
}
