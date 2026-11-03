// An illustration's lettering (spec 001 T008, FR-016, research R4). Its labels are drawn as
// outlines, not text, so no font size can be read; each pathway's label is one path
// (`id="PATHWAY TEXT…"`), each letter a closed subpath. The size of a label's letters is
// read from those outlines instead: the height from a line's baseline to the top of the
// letters standing on it, its cap height, taken as a font's of the same cap height.

/** Cap height over font size: Roboto's 0.711, Arial's 0.716. */
export const CAP_HEIGHT = 0.71;

/** A box: left, top, right, bottom. */
type Box = [number, number, number, number];

const TOKEN = /[A-Za-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

/** The numbers each absolute command takes, a whole number of times. */
const ARITY: Readonly<Record<string, number>> = { M: 2, L: 2, T: 2, H: 1, V: 1, S: 4, Q: 4, C: 6 };

/**
 * Each subpath's box, from its points and control points (which may overshoot a curve
 * slightly: that errs large, by less than a stroke). Only absolute commands are read, as the
 * release's illustrations use: a relative command, an arc or a command with the wrong count
 * of numbers gives null, not a guess.
 */
export function outlineBoxes(d: string): Box[] | null {
  const boxes: Box[] = [];
  // whether the last box is the subpath being drawn: a move or a close ends it
  let open = false;
  let x = 0;
  let y = 0;
  // where the subpath began, which a close returns to
  let startX = 0;
  let startY = 0;
  let command = '';
  let numbers: number[] = [];
  const point = (px: number, py: number) => {
    if (!open) {
      // a subpath begins at a move's point, or, begun without one, at the current point
      if (command === 'M') [x, y] = [px, py];
      [startX, startY] = [x, y];
      boxes.push([x, y, x, y]);
      open = true;
    }
    x = px;
    y = py;
    const box = boxes[boxes.length - 1] as Box;
    boxes[boxes.length - 1] = [
      Math.min(box[0], px),
      Math.min(box[1], py),
      Math.max(box[2], px),
      Math.max(box[3], py),
    ];
  };
  const finish = (): boolean => {
    if (command === '' || command === 'Z') return numbers.length === 0;
    const arity = ARITY[command];
    if (arity === undefined || numbers.length === 0 || numbers.length % arity !== 0) return false;
    if (command === 'H') for (const n of numbers) point(n, y);
    else if (command === 'V') for (const n of numbers) point(x, n);
    else for (let i = 0; i < numbers.length; i += 2) point(numbers[i] ?? 0, numbers[i + 1] ?? 0);
    return true;
  };
  for (const [token] of d.matchAll(TOKEN)) {
    if (/^[A-Za-z]$/.test(token)) {
      if (!finish()) return null;
      if (token === 'M') open = false;
      if (token === 'Z') {
        // the current point returns to the subpath's start, and the next one begins there
        [x, y] = [startX, startY];
        open = false;
      }
      command = token;
      numbers = [];
    } else numbers.push(Number(token));
  }
  return finish() ? boxes : null;
}

/** Whether one box lies within another: a letter's hole (the counter of B, O or d). */
const within = (inner: Box, outer: Box) =>
  inner !== outer &&
  inner[0] >= outer[0] &&
  inner[1] >= outer[1] &&
  inner[2] <= outer[2] &&
  inner[3] <= outer[3];

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
 * not make it smaller. A letter's holes are left out first, so they do not vote for a
 * baseline of their own. A line's baseline is the bottom most of its letters share, to half
 * a unit; its cap height runs from there to the top of the letters standing on it, so a line
 * with ascenders (l, d, G) reads a little tall, by up to the ascender's height over the
 * capitals', which errs large.
 */
export function capHeight(boxes: Box[]): number | null {
  let tallest: number | null = null;
  for (const all of lines(boxes)) {
    const line = all.filter((b) => !all.some((outer) => within(b, outer)));
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

/** A plain scale from a `matrix(a 0 0 a e f)`, or null for anything else. */
function plainScale(transform: string | undefined): number | null {
  const matrix = /^\s*matrix\(([^)]*)\)\s*$/
    .exec(transform ?? '')?.[1]
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (matrix?.length !== 6) return null;
  const [a, b, c, d] = matrix as [number, number, number, number];
  return a > 0 && b === 0 && c === 0 && d === a ? a : null;
}

const ATTRIBUTE = (name: string) => new RegExp(`\\s${name}="([^"]*)"`);
const TRANSFORM = ATTRIBUTE('transform');
const CLASS = ATTRIBUTE('class');
const ID = ATTRIBUTE('id');
const D = ATTRIBUTE('d');

/**
 * An illustration's lettering: its smallest label's size, in the SVG's pixels, as a font's of
 * the same cap height, or null where it has none read; and how many label paths could not be
 * read, which the caller counts as unread labels. A label is not read when its outlines are
 * in a form not read here, or when it, or a group it is in, is transformed (other than the
 * render service's viewport, whose plain scale fits the illustration to the figure's frame
 * and is applied; a viewport that is not a plain scale leaves every label inside it unread).
 * The groups are followed through the markup in one pass of its tags.
 */
export function lettering(svg: string): { smallest: number | null; unread: number } {
  let smallest: number | null = null;
  let unread = 0;
  // for each open group: the scale it applies, or null where it transforms otherwise
  const groups: (number | null)[] = [];
  for (const [tag, close, name = '', attributes = ''] of svg.matchAll(
    /<(\/?)(g|path)\b([^>]*)>/g
  )) {
    if (name === 'g') {
      if (close) groups.pop();
      else if (!attributes.trimEnd().endsWith('/')) {
        const transform = TRANSFORM.exec(attributes)?.[1];
        const viewport = /\bsvg-pan-zoom_viewport\b/.test(CLASS.exec(attributes)?.[1] ?? '');
        groups.push(transform === undefined ? 1 : viewport ? plainScale(transform) : null);
      }
      continue;
    }
    if (close || !(ID.exec(attributes)?.[1] ?? '').startsWith('PATHWAY TEXT')) continue;
    let scale: number | null = TRANSFORM.test(tag) ? null : 1;
    for (const g of groups) scale = scale === null || g === null ? null : scale * g;
    const d = D.exec(attributes)?.[1];
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
