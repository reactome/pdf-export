// SC-009's colour and font check (spec 001 T032, research R8): every colour a PDF's pages
// paint with is one of the website's light theme's, and every font it embeds is one FR-015
// names. Run on pages printed with their figures and the logo hidden (they keep their own
// colours, SC-008's to check), after the same join and stamping as the book, so the stamped
// page numbers and running headers are checked too.
//
// It reads what pdf.js paints with: each fill and stroke colour, which pdf.js gives as
// `#rrggbb` whatever the PDF's colour space; and each font the PDF embeds, by its BaseFont
// name, its subset tag (`ABCDEF+`) taken off.
import { PDFDict, PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { getDocument, OPS, VerbosityLevel } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { themeVariables } from '../layout/theme.ts';

/** A colour or font the check refuses, with the pages it is on (1-based) and its count. */
export interface LookFault {
  kind: 'colour' | 'font';
  /** `#rrggbb` for a colour; the BaseFont name, untagged, for a font. */
  value: string;
  pages: number[];
}

/**
 * FR-015's typefaces, as the PDFs embed them: Roboto, Roboto Mono, and the Noto Sans family
 * for the characters the others lack (Noto Sans, Noto Sans Math, Noto Sans Symbols 2), in any
 * weight or style (`Roboto-Bold`, `RobotoMono-Regular`, `NotoSansSymbols2-Regular`).
 */
export const FONTS: RegExp =
  /^(Roboto|RobotoMono|NotoSans|NotoSansMath|NotoSansSymbols2)(-[\w]+)?$/;

/** The theme's colours, `#rrggbb` in lower case: every --mat-sys-* value that is a colour. */
export function themeColours(
  variables: ReadonlyMap<string, string> = themeVariables()
): Set<string> {
  const colours = new Set<string>();
  for (const value of variables.values()) {
    const hex = hexOf(value);
    if (hex) colours.add(hex);
  }
  return colours;
}

/** `#rgb`, `#rrggbb` or `rgb(r, g, b)` as `#rrggbb`; null for anything else. */
export function hexOf(value: string): string | null {
  const text = value.trim().toLowerCase();
  const long = /^#([0-9a-f]{6})$/.exec(text);
  if (long) return `#${long[1] ?? ''}`;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(text);
  if (short)
    return `#${short
      .slice(1)
      .map((d) => `${d}${d}`)
      .join('')}`;
  const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(text);
  if (rgb) {
    return `#${rgb
      .slice(1)
      .map((n) => Number(n).toString(16).padStart(2, '0'))
      .join('')}`;
  }
  return null;
}

/** Every colour each page paints with, and every font the PDF embeds. */
export async function lookOf(
  pdf: Uint8Array
): Promise<{ colours: Map<string, number[]>; fonts: Set<string> }> {
  const colours = new Map<string, number[]>();
  // pdf.js's warnings off: they quote the file's content, and the book holds names
  // a copy, as a plain Uint8Array: pdf.js refuses a Buffer, and takes over the array it is given
  const task = getDocument({ data: new Uint8Array(pdf), verbosity: VerbosityLevel.ERRORS });
  try {
    const doc = await task.promise;
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const ops = await page.getOperatorList();
      ops.fnArray.forEach((fn, i) => {
        if (fn !== OPS.setFillRGBColor && fn !== OPS.setStrokeRGBColor) return;
        const args: unknown = ops.argsArray[i];
        const colour: unknown = Array.isArray(args) ? args[0] : undefined;
        if (typeof colour !== 'string') return;
        const pages = colours.get(colour) ?? colours.set(colour, []).get(colour) ?? [];
        if (pages.at(-1) !== n) pages.push(n);
      });
    }
  } finally {
    await task.destroy();
  }
  const fonts = new Set<string>();
  const lib = await PDFDocument.load(pdf, { updateMetadata: false });
  for (const [, object] of lib.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict)) continue;
    if (object.get(PDFName.of('Type')) !== PDFName.of('Font')) continue;
    const base = object.get(PDFName.of('BaseFont'));
    if (base instanceof PDFName) fonts.add(base.decodeText().replace(/^[A-Z]{6}\+/, ''));
  }
  return { colours, fonts };
}

/** The colours outside `allowed` and the fonts FR-015 does not name, each with its pages. */
export async function lookFaults(
  pdf: Uint8Array,
  allowed: ReadonlySet<string> = themeColours()
): Promise<LookFault[]> {
  const { colours, fonts } = await lookOf(pdf);
  const faults: LookFault[] = [];
  for (const [value, pages] of [...colours].sort(([a], [b]) => a.localeCompare(b))) {
    if (!allowed.has(value)) faults.push({ kind: 'colour', value, pages });
  }
  for (const value of [...fonts].sort()) {
    if (!FONTS.test(value)) faults.push({ kind: 'font', value, pages: [] });
  }
  return faults;
}

/**
 * HTML as the check prints it: the figures' drawings and the logo hidden, so only the PDF's own
 * text and layout paint. `visibility: hidden` keeps their boxes, so the pages are the book's
 * pages; a figure's link around its drawing stays, which is how check-book finds the figure.
 */
export function figuresHidden(html: string): string {
  const style = '<style>.figure svg, .logo { visibility: hidden !important; }</style>';
  return html.includes('</head>') ? html.replace('</head>', `${style}</head>`) : style + html;
}
