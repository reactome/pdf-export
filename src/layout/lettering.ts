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

/**
 * Whether one box lies within another, and is not the same: a letter's hole (the counter of
 * B, O or d). A glyph within a neighbour's box (a full stop under a T's arm) is dropped too,
 * which costs that glyph's vote only, as the neighbour stands on the same baseline.
 */
const within = (inner: Box, outer: Box) =>
  inner[0] >= outer[0] &&
  inner[1] >= outer[1] &&
  inner[2] <= outer[2] &&
  inner[3] <= outer[3] &&
  inner.some((v, i) => v !== outer[i]);

/**
 * A label's lines: the letters whose heights overlap, directly or through others between
 * them, found in order of their tops, so a dot or an accent met first does not begin a line
 * of its own that the letters beneath it miss.
 */
function lines(boxes: Box[]): Box[][] {
  const found: { boxes: Box[]; bottom: number }[] = [];
  for (const b of [...boxes].sort((p, q) => p[1] - q[1])) {
    const line = found.at(-1);
    if (line && b[1] < line.bottom) {
      line.boxes.push(b);
      line.bottom = Math.max(line.bottom, b[3]);
    } else found.push({ boxes: [b], bottom: b[3] });
  }
  return found.map((l) => l.boxes);
}

/**
 * A label's cap height: its tallest line's. One label is one text layer, at one size, so a
 * line of punctuation alone (a dash set apart, which stands on no baseline of letters) does
 * not make it smaller. A letter's holes are left out first, so they do not vote for a
 * baseline of their own. A line's baseline is the bottom most of its letters share, to half
 * a unit, the lower on a tie (a mark set high, a prime or a quote, does not stand on it); its
 * cap height runs from there to the top of the letters standing on it. So a line with
 * ascenders (l, d, G) reads a little tall, by up to the ascender's height over the capitals'
 * (errs large), and a line with neither capitals nor ascenders reads its x-height (errs
 * small); a pathway's name has capitals.
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
    for (const [at, n] of bottoms)
      if (n > most || (n === most && at > base)) [base, most] = [at, n];
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

/** An attribute's value, in either quotes, or undefined. */
function attribute(attributes: string, name: string): string | undefined {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(attributes);
  return match ? (match[1] ?? match[2]) : undefined;
}

/**
 * A tag: its name and attributes, a quoted value holding no `>` of its own. XML allows no `<`
 * in a tag, quoted or not, so none is matched: a tag left open, or a quote, ends at the next
 * `<`, and the scan stays linear.
 */
const TAG = /<(\/?)([A-Za-z][\w:.-]*)((?:[^<>"']|"[^"<]*"|'[^'<]*')*)>/g;

/** Elements whose content is not drawn where it stands: a label there is unread. */
const UNDRAWN = new Set([
  'defs',
  'symbol',
  'clippath',
  'mask',
  'pattern',
  'marker',
  'title',
  'desc',
  'metadata',
]);

/** An element's name without its namespace prefix, in lower case. */
const local = (name: string) => name.slice(name.lastIndexOf(':') + 1).toLowerCase();

/** The markup without its comments and character data, which may hold tags that are not. */
function withoutComments(svg: string): string {
  const kept: string[] = [];
  let at = 0;
  // each kind's next start, searched again only once passed, so the whole is linear
  let comment = svg.indexOf('<!--');
  let data = svg.indexOf('<![CDATA[');
  for (;;) {
    if (comment >= 0 && comment < at) comment = svg.indexOf('<!--', at);
    if (data >= 0 && data < at) data = svg.indexOf('<![CDATA[', at);
    const open = comment < 0 ? data : data < 0 ? comment : Math.min(comment, data);
    if (open < 0) break;
    kept.push(svg.slice(at, open));
    const end = svg.indexOf(open === comment ? '-->' : ']]>', open);
    if (end < 0) return kept.join('');
    at = end + 3;
  }
  kept.push(svg.slice(at));
  return kept.join('');
}

/**
 * An illustration's lettering: its smallest label's size, in the SVG's pixels, as a font's of
 * the same cap height, or null where it has none read; and how many label paths could not be
 * read, which the caller counts as unread labels. A label is not read when its outlines are
 * in a form not read here; when it, or an element it is in, is transformed (by attribute or
 * style), other than the render service's viewport, whose plain scale fits the illustration
 * to the figure's frame and is applied (a viewport that is not a plain scale leaves every
 * label inside it unread); or when it is in a nested `<svg>`, or in content not drawn where
 * it stands (`<defs>`, `<symbol>`, a clip path, mask, pattern or marker, a title, a
 * description or metadata), or after a close tag that skipped open elements. The elements are followed through the markup in one
 * pass of its tags, its comments and character data left out, names known with a prefix or
 * in capitals, and a close tag ending the element it names. Markup this does not read as a
 * browser would (a style element's rules, `display="none"`, an unquoted value, an entity in
 * an id, a name in capitals taken as SVG's) is not looked for: the render service writes
 * none of it.
 */
export function lettering(svg: string): { smallest: number | null; unread: number } {
  let smallest: number | null = null;
  let unread = 0;
  /** What an element applies to what it holds: a scale, or null where it is not known. */
  const applies = (name: string, attributes: string, depth: number): number | null => {
    if (UNDRAWN.has(local(name)) || (local(name) === 'svg' && depth > 0)) return null;
    const transform = attribute(attributes, 'transform');
    const styled = /transform\s*:\s*([^;]*)/i.exec(attribute(attributes, 'style') ?? '')?.[1];
    const viewport = (attribute(attributes, 'class') ?? '')
      .split(/\s+/)
      .includes('svg-pan-zoom_viewport');
    if (!viewport) return transform === undefined && styled === undefined ? 1 : null;
    // the viewport writes its scale twice, by attribute and by style (to six figures): they agree
    const scale = plainScale(transform);
    const again = styled === undefined ? scale : plainScale(styled);
    return scale !== null && again !== null && Math.abs(again - scale) <= 1e-5 * scale
      ? scale
      : null;
  };
  // for each open element: its name, and the scale it applies, or null where it is not known
  const open: { name: string; scale: number | null }[] = [];
  // a close tag that skipped open elements: the markup is not what it seems, so no label after
  // it is read
  let malformed = false;
  const markup = withoutComments(svg);
  // up to the last `>`: past it no tag can end, and a tail of `<` would be searched from each
  for (const [, close, name = '', attributes = ''] of markup
    .slice(0, markup.lastIndexOf('>') + 1)
    .matchAll(TAG)) {
    if (close) {
      // it ends the element it names, and any left open inside it; a stray one, nothing
      const at = open.map((e) => e.name).lastIndexOf(local(name));
      if (at >= 0) {
        if (at !== open.length - 1) malformed = true;
        open.length = at;
      }
      continue;
    }
    const selfClosing = attributes.trimEnd().endsWith('/');
    const own = applies(name, attributes, open.length);
    if (local(name) === 'path' && (attribute(attributes, 'id') ?? '').startsWith('PATHWAY TEXT')) {
      let scale = own;
      for (const e of open) scale = scale === null || e.scale === null ? null : scale * e.scale;
      const d = attribute(attributes, 'd');
      const boxes = d === undefined ? null : outlineBoxes(d);
      const cap = boxes === null ? null : capHeight(boxes);
      if (malformed || scale === null || cap === null || !(cap > 0)) unread += 1;
      else {
        const size = (cap * scale) / CAP_HEIGHT;
        if (smallest === null || size < smallest) smallest = size;
      }
    }
    if (!selfClosing) open.push({ name: local(name), scale: own });
  }
  return { smallest, unread };
}
