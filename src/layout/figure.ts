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
  return { width, height, smallestLabel: smallestLabel(svg) };
}

/** Pixels for each absolute unit a label's size may be given in. */
const PX: Readonly<Record<string, number>> = { '': 1, px: 1, pt: 4 / 3 };

/**
 * The smallest font size given to text that is drawn: a `font-size` attribute or property,
 * or the size in a `font` shorthand, in pixels (a bare number is pixels in SVG). Relative
 * sizes (em, %, rem) are not read: what they are relative to is not known here. Neither is
 * a transform that scales a label; the render service's diagrams use neither.
 */
function smallestLabel(svg: string): number | null {
  const sizes: number[] = [];
  const read = (value: string, unit: string) => {
    const factor = PX[unit];
    if (factor !== undefined) sizes.push(Number(value) * factor);
  };
  for (const [, value = '', unit = ''] of svg.matchAll(
    /font-size(?:=["']|\s*:\s*)([\d.]+)(px|pt|em|rem|%)?/g
  )) {
    read(value, unit);
  }
  for (const [, value = '', unit = ''] of svg.matchAll(/\bfont\s*:[^;"']*?([\d.]+)(px|pt)\b/g)) {
    read(value, unit);
  }
  const drawn = sizes.filter((size) => size > 0);
  return drawn.length > 0 ? Math.min(...drawn) : null;
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
export function place({ width, height, smallestLabel }: Measured): Placement {
  const fit = (area: { width: number; height: number }) =>
    Math.min(area.width / width, area.height / height, NATURAL);
  const portrait = fit(PORTRAIT);
  const legible = (scale: number) => smallestLabel === null || scale * smallestLabel >= FLOOR_PT;
  const unmeasured = smallestLabel === null;
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
