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
  const root = /<svg\b[^>]*>/.exec(svg)?.[0] ?? '';
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
};

/** A number as CSS writes one, exponent and all. */
const NUMBER = String.raw`(\d*\.?\d+(?:e[+-]?\d+)?)`;

/**
 * The font sizes given to text: each `font-size` attribute or property, and the size in each
 * `font` shorthand (the first number with a unit: a bare number there is a weight), in
 * pixels, a bare number being pixels in SVG. A size in a relative unit (em, %, rem, ex …)
 * or one not known is not read, and is counted: what it is relative to is not known here.
 * Neither is a transform that scales a label; the render service's diagrams use neither.
 */
function labelSizes(svg: string): { sizes: number[]; unread: number } {
  const sizes: number[] = [];
  let unread = 0;
  const read = (value: string, unit: string) => {
    const factor = PX[unit.toLowerCase()];
    const size = Number(value) * (factor ?? NaN);
    if (size > 0) sizes.push(size);
    else unread += 1;
  };
  for (const [, value = '', unit = ''] of svg.matchAll(
    new RegExp(String.raw`font-size(?:=["']|\s*:\s*)${NUMBER}([a-z%]*)`, 'gi')
  )) {
    read(value, unit);
  }
  for (const [, shorthand = ''] of svg.matchAll(/\bfont\s*:\s*([^;"']*)/gi)) {
    const size = new RegExp(String.raw`(?<![\w.])${NUMBER}([a-z%]+)`, 'i').exec(shorthand);
    if (size) read(size[1] ?? '', size[2] ?? '');
  }
  return { sizes, unread };
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
