// A figure on the page (spec 001 T018, FR-016, research R4): inlined, its ids prefixed with
// the section's anchor, and sized so its smallest label prints at no less than 5 pt. One
// that would print smaller at the text's width gets a landscape page of its own; one still
// too small there is printed at the largest that page allows and listed for the run report.
import type { Figure } from '../model/types.ts';
import { prefixIds } from '../figures/prefix.ts';
import { attribute } from './html.ts';

/** A4 with 20 mm margins on every side, in points. */
export const PAGE = {
  width: 595.28,
  height: 841.89,
  margin: 56.69,
} as const;

/** The text area of a portrait page, and of a landscape one. */
export const PORTRAIT = {
  width: PAGE.width - 2 * PAGE.margin,
  height: PAGE.height - 2 * PAGE.margin,
};
export const LANDSCAPE = { width: PORTRAIT.height, height: PORTRAIT.width };

/** The smallest a label may print (FR-016). */
export const FLOOR_PT = 5;

/** No figure is drawn larger than the render service's own size: a CSS pixel, 0.75 pt. */
const NATURAL = 0.75;

/** What the figures are looked up by: one drawing serves every section it is the figure of. */
export function figureKey(figure: Figure): string {
  return figure.kind === 'ancestor'
    ? `ancestor/${figure.stId}/${figure.highlight.join(',')}`
    : `${figure.kind}/${figure.stId}`;
}

export interface Measured {
  /** Its size in the SVG's own pixels. */
  width: number;
  height: number;
  /** Its smallest label, in the SVG's pixels, or none if it has no text. */
  smallestLabel: number | null;
  /** Labels whose size could not be read: relative, or in a unit not known. */
  unreadLabels: number;
}

/** An SVG's size, from its viewBox or else its width and height, and its smallest label. */
export function measure(svg: string): Measured {
  // its root's start tag, found without a pattern that could backtrack on a stray `<svg`
  const start = svg.search(/<svg\b/);
  const end = start < 0 ? -1 : svg.indexOf('>', start);
  const root = end < 0 ? '' : svg.slice(start, end + 1);
  const box = /\sviewBox=(["'])([^"']*)\1/
    .exec(root)?.[2]
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const attr = (name: string): number => {
    const value = new RegExp(`\\s${name}=(["'])([\\d.]+)(?:px)?\\1`).exec(root)?.[2];
    return value === undefined ? NaN : Number(value);
  };
  const [width, height] =
    box?.length === 4 ? [box[2] ?? NaN, box[3] ?? NaN] : [attr('width'), attr('height')];
  if (!(width > 0 && height > 0))
    throw new Error('A figure with no size: no viewBox, width or height');
  const { sizes, unread } = labelSizes(svg);
  return {
    width,
    height,
    smallestLabel: sizes.length > 0 ? Math.min(...sizes) : null,
    unreadLabels: unread,
  };
}

/** Pixels for each absolute unit a label's size may be given in (CSS's 96 px to the inch). */
const PX: Readonly<Record<string, number>> = {
  '': 1,
  px: 1,
  pt: 96 / 72,
  pc: 16,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
};

/** A size as CSS writes one, the whole value: a number, exponent and all, and its unit. */
const SIZE = /^(\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?([a-z%]*)$/i;

/** Units of angle, which a `font` shorthand's oblique angle is given in, not its size. */
const ANGLE = /^(deg|rad|grad|turn)$/i;

/**
 * The font sizes given to text: each `font-size` attribute or property, and the size in each
 * `font` shorthand (its first number with a unit that is not an angle: a bare number there
 * is a weight, and what follows a `/` a line height), in pixels, a bare number being pixels
 * in SVG. Every size that is not one of these, relative (em, %, rem, smaller …), a keyword
 * (x-small, inherit …), a function (calc, var) or a unit not known, is counted unread: what
 * it is relative to is not known here. Text content, comments and character data are not
 * read, but a style element is (markupOf).
 * A transform that scales a label is not known either; the render service's diagrams use
 * none.
 */
function labelSizes(svg: string): { sizes: number[]; unread: number } {
  const sizes: number[] = [];
  let unread = 0;
  /** A size's value, whole; anything that is not a finite, positive size is unread. */
  const read = (value: string) => {
    const match = SIZE.exec(value.replace(/!\s*important\s*$/i, '').trim());
    const unit = match?.[2] ?? '';
    const factor = PX[unit.toLowerCase()];
    const size =
      match && factor !== undefined
        ? Number(match[0].slice(0, match[0].length - unit.length)) * factor
        : NaN;
    if (Number.isFinite(size) && size > 0) sizes.push(size);
    else unread += 1;
  };
  const markup = markupOf(svg);
  for (const [, value = ''] of markup.matchAll(
    /(?<![\w-])font-size(?:=["']|\s*:\s*)([^"';}<>]*)/gi
  )) {
    read(value);
  }
  for (const [, shorthand = ''] of markup.matchAll(/(?<![\w-])font\s*:\s*([^"';}<>]*)/gi)) {
    const size = shorthand
      .split('/')[0]
      ?.split(/\s+/)
      .find((token) => {
        const unit = SIZE.exec(token)?.[2];
        return unit !== undefined && unit !== '' && !ANGLE.test(unit);
      });
    read(size ?? '');
  }
  return { sizes, unread };
}

const STYLE = /^<(?:[\w-]+:)?style\b/i;
const STYLE_END = /<\/(?:[\w-]+:)?style\s*>/gi;

/**
 * An SVG's markup and its style elements' rules, without the text it draws, comments or
 * character data, in one pass: a tag ends at the first `>` outside a quoted value, so a `>`
 * in an attribute's value does not end it early. A `<` met outside quotes before that `>`
 * begins the next tag; what came before it is kept as markup, as a malformed tag's may
 * hold a size.
 */
function markupOf(svg: string): string {
  const kept: string[] = [];
  let at = 0;
  while (at < svg.length) {
    const open = svg.indexOf('<', at);
    if (open < 0) break;
    const skip = svg.startsWith('<!--', open)
      ? '-->'
      : svg.startsWith('<![CDATA[', open)
        ? ']]>'
        : null;
    if (skip) {
      const end = svg.indexOf(skip, open);
      at = end < 0 ? svg.length : end + skip.length;
      continue;
    }
    let close = open + 1;
    let stray = false;
    let quote = '';
    for (; close < svg.length; close++) {
      const c = svg[close];
      if (quote) {
        if (c === quote) quote = '';
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
      else if (c === '<') {
        // a < outside quotes begins a tag: the one before it was a stray < in text
        stray = true;
        break;
      }
    }
    if (stray) {
      // kept as markup, so a malformed tag's size is still read: more markup can only read
      // a label smaller, or unread, never more legible
      kept.push(svg.slice(open, close));
      at = close;
      continue;
    }
    const tag = svg.slice(open, close + 1);
    kept.push(tag);
    at = close + 1;
    if (STYLE.test(tag) && !tag.endsWith('/>')) {
      // its rules, to its end tag, or to the end of an unclosed one
      STYLE_END.lastIndex = at;
      const end = STYLE_END.exec(svg)?.index ?? svg.length;
      kept.push(svg.slice(at, end));
      at = end;
    }
  }
  return kept.join('');
}

export interface Placement {
  /** Points on the page for each of the SVG's pixels. */
  scale: number;
  landscape: boolean;
  /** Its smallest label prints below the floor even so. */
  belowFloor: boolean;
  /**
   * It has no text whose size can be read: an illustration's lettering is drawn as outlines
   * (research R3), so it is placed by its size alone and listed for the run report, its
   * lettering measured by T008.
   */
  unmeasured: boolean;
}

/**
 * Where and how large a figure prints: as large as fits the text area, never larger than
 * its own size; in the portrait text when its labels are legible there, otherwise on a
 * landscape page if that prints it larger.
 */
export function place({ width, height, smallestLabel, unreadLabels }: Measured): Placement {
  const fit = (area: { width: number; height: number }) =>
    Math.min(area.width / width, area.height / height, NATURAL);
  const portrait = fit(PORTRAIT);
  const legible = (scale: number) => smallestLabel === null || scale * smallestLabel >= FLOOR_PT;
  // a label whose size could not be read may be the smallest: it is not taken as legible
  const unmeasured = smallestLabel === null || unreadLabels > 0;
  if (legible(portrait))
    return { scale: portrait, landscape: false, belowFloor: false, unmeasured };
  const landscape = fit(LANDSCAPE);
  const scale = Math.max(portrait, landscape);
  return { scale, landscape: landscape > portrait, belowFloor: !legible(scale), unmeasured };
}

/**
 * The figure's HTML: its SVG inlined, ids prefixed, sized in points. The SVG keeps its own
 * colours and fonts (FR-015); its width and height are set here, its viewBox kept.
 */
export function figureHtml(
  svg: string,
  prefix: string,
  label: string
): { html: string; placement: Placement } {
  const measured = measure(svg);
  const placement = place(measured);
  const size = (px: number) => `${(px * placement.scale).toFixed(2)}pt`;
  const sized = prefixIds(svg, prefix).replace(/<svg\b([^>]*)>/, (_whole, attrs: string) => {
    const kept = attrs.replace(/\s(?:width|height|role|aria-label)=(["'])[^"']*\1/g, '');
    const box = /\sviewBox=/.test(kept)
      ? ''
      : ` viewBox="0 0 ${String(measured.width)} ${String(measured.height)}"`;
    return `<svg${kept}${box} width="${size(measured.width)}" height="${size(measured.height)}" role="img" aria-label="${attribute(label)}">`;
  });
  const classes = placement.landscape ? 'figure landscape' : 'figure';
  return { html: `<div class="${classes}">${sized}</div>`, placement };
}

/**
 * The cover's figure: a single pathway's diagram fitted to the cover's box. It is a
 * picture of the pathway, not where it is read (its section has it at a legible size), so
 * the floor does not apply.
 */
export function coverFigureHtml(svg: string, label: string): string {
  const { width, height } = measure(svg);
  const fitted = prefixIds(svg, 'cover').replace(/<svg\b([^>]*)>/, (_whole, attrs: string) => {
    const kept = attrs.replace(
      /\s(?:width|height|role|aria-label|preserveAspectRatio)=(["'])[^"']*\1/g,
      ''
    );
    const box = /\sviewBox=/.test(kept) ? '' : ` viewBox="0 0 ${String(width)} ${String(height)}"`;
    return `<svg${kept}${box} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${attribute(label)}">`;
  });
  return `<div class="cover-figure">${fitted}</div>`;
}
