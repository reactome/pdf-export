// An illustration's lettering (spec 001 T008, FR-016, research R4). Its labels are drawn as
// outlines, not text, so no font size can be read; each pathway's label is one path
// (`id="PATHWAY TEXT…"`), each letter a closed subpath. The size of a label's letters is
// read from those outlines instead: the height from a line's baseline to the top of the
// letters standing on it, its cap height, taken as a font's of the same cap height.

/** Cap height over font size: Roboto's 0.711, Arial's 0.716. */
export const CAP_HEIGHT = 0.71;

/** A box: left, top, right, bottom. */
type Box = [number, number, number, number];

const TOKEN = /[A-Za-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g;

/**
 * Each subpath's box, from its points and control points (which may overshoot a curve
 * slightly: that errs large, by less than a stroke). Only absolute commands are read, as the
 * release's illustrations use: a relative command or an arc gives null, not a guess.
 */
export function outlineBoxes(d: string): Box[] | null {
  const boxes: Box[] = [];
  // whether the last box is the subpath being drawn: a move begins another
  let open = false;
  let x = 0;
  let y = 0;
  let command = '';
  let numbers: number[] = [];
  const point = (px: number, py: number) => {
    x = px;
    y = py;
    const box = open ? boxes.at(-1) : undefined;
    if (box === undefined) boxes.push([px, py, px, py]);
    else
      boxes[boxes.length - 1] = [
        Math.min(box[0], px),
        Math.min(box[1], py),
        Math.max(box[2], px),
        Math.max(box[3], py),
      ];
    open = true;
  };
  const finish = (): boolean => {
    switch (command) {
      case '':
      case 'Z':
        return numbers.length === 0;
      case 'H':
        for (const n of numbers) point(n, y);
        return numbers.length > 0;
      case 'V':
        for (const n of numbers) point(x, n);
        return numbers.length > 0;
      case 'M':
      case 'L':
      case 'C':
      case 'S':
      case 'Q':
      case 'T':
        for (let i = 0; i + 1 < numbers.length; i += 2) point(numbers[i] ?? 0, numbers[i + 1] ?? 0);
        return numbers.length > 0 && numbers.length % 2 === 0;
      default:
        return false;
    }
  };
  for (const [token] of d.matchAll(TOKEN)) {
    if (/[A-Za-z]/.test(token)) {
      if (!finish()) return null;
      if (token === 'M') open = false;
      command = token;
      numbers = [];
    } else numbers.push(Number(token));
  }
  return finish() ? boxes : null;
}

/** A label's lines: letters whose boxes overlap in height are on one line. */
function lines(boxes: Box[]): Box[][] {
  const found: { boxes: Box[]; top: number; bottom: number }[] = [];
  for (const b of [...boxes].sort((p, q) => p[3] - q[3])) {
    const line = found.find((l) => b[1] < l.bottom && b[3] > l.top);
    if (line) {
      line.boxes.push(b);
      line.top = Math.min(line.top, b[1]);
      line.bottom = Math.max(line.bottom, b[3]);
    } else found.push({ boxes: [b], top: b[1], bottom: b[3] });
  }
  return found.map((l) => l.boxes);
}

/**
 * A label's cap height: its tallest line's. One label is one text layer, at one size, so a
 * line of punctuation alone (a dash set apart, which stands on no baseline of letters) does
 * not make it smaller. A line's baseline is the bottom most of its letters share, to half a
 * unit; its cap height runs from there to the top of the letters standing on it.
 */
export function capHeight(boxes: Box[]): number | null {
  let tallest: number | null = null;
  for (const line of lines(boxes)) {
    const bottoms = new Map<number, number>();
    for (const b of line) {
      const at = Math.round(b[3] * 2) / 2;
      bottoms.set(at, (bottoms.get(at) ?? 0) + 1);
    }
    let base = 0;
    let most = 0;
    for (const [at, n] of bottoms) if (n > most) [base, most] = [at, n];
    let top = Infinity;
    for (const b of line) if (Math.abs(b[3] - base) <= 0.6) top = Math.min(top, b[1]);
    const cap = base - top;
    if (tallest === null || cap > tallest) tallest = cap;
  }
  return tallest;
}

/**
 * The scale the render service draws the illustration at: its viewport's `matrix(a 0 0 a e
 * f)`, which fits it to the figure's frame, or 1 where there is none. Anything else (a
 * rotation, a skew, unequal scales, another form) gives null.
 */
function viewportScale(svg: string): number | null {
  const at = svg.indexOf('svg-pan-zoom_viewport');
  if (at < 0) return 1;
  const start = svg.lastIndexOf('<', at);
  const end = svg.indexOf('>', at);
  const tag = svg.slice(start, end < 0 ? svg.length : end);
  const matrix = /\stransform="matrix\(([^)]*)\)"/
    .exec(tag)?.[1]
    ?.split(/[\s,]+/)
    .map(Number);
  if (matrix?.length !== 6) return null;
  const [a, b, c, d] = matrix as [number, number, number, number];
  return a > 0 && b === 0 && c === 0 && d === a ? a : null;
}

/**
 * An illustration's lettering: its smallest label's size, in the SVG's pixels, as a font's of
 * the same cap height, or null where it has none read; and how many label paths could not be
 * read (outlines in a form not read here, or all of them where the viewport is not a plain
 * scale), which the caller counts as unread labels. A transform on a label, or between it and
 * the viewport, is not known here; release 98's illustrations have none.
 */
export function lettering(svg: string): { smallest: number | null; unread: number } {
  const scale = viewportScale(svg);
  let smallest: number | null = null;
  let unread = 0;
  for (const id of svg.matchAll(/\sid="PATHWAY TEXT[^"]*"/g)) {
    const start = svg.lastIndexOf('<', id.index);
    const end = svg.indexOf('>', id.index);
    const d = /\sd="([^"]*)"/.exec(svg.slice(start, end < 0 ? svg.length : end))?.[1];
    const boxes = d === undefined ? null : outlineBoxes(d);
    const cap = boxes === null ? null : capHeight(boxes);
    if (scale === null || cap === null || !(cap > 0)) {
      unread += 1;
      continue;
    }
    const size = (cap * scale) / CAP_HEIGHT;
    if (smallest === null || size < smallest) smallest = size;
  }
  return { smallest, unread };
}
