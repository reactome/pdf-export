// The layout (spec 001 T018, FR-005, FR-016): a Document as HTML pages for Chromium to print.
// A single event's PDF is one page of HTML, printed whole, with its running headers and page
// numbers in @page margin boxes. The book is printed in parts and joined (research R4): its
// front part (cover, introduction, contents) and parts of sections, with placeholder links
// and probes, and no headers or numbers, which are stamped after the join (T027).
import { readFileSync } from 'node:fs';

import type { AnalysisProperties, Document, Found, Place } from '../model/types.ts';
import { fontFaceCss } from './fonts.ts';
import { FRONT, analysisHtml, contentsHtml, coverHtml, introductionHtml } from './front.ts';
import { Links, attribute, cssString, text } from './html.ts';
import { placeHtml, type Report } from './section.ts';
import { themeCss } from './theme.ts';

export type { Report } from './section.ts';

/** The pages' stylesheets: the theme's variables, the fonts' faces and the pages' own rules. */
export interface Styles {
  theme: string;
  fonts: string;
  pages: string;
}

let styles: Styles | undefined;

/** The stylesheets, compiled once. */
export function pageStyles(): Styles {
  styles ??= {
    theme: themeCss(),
    fonts: fontFaceCss(),
    pages: readFileSync(new URL('pages.css', import.meta.url), 'utf8'),
  };
  return styles;
}

export interface LayoutOptions {
  /** The website's address, for links to its pages (FR-003). */
  site: string;
  /** The cover's date. */
  date: Date;
  /** The figures' SVGs, by figureKey. A section whose figure is missing is written without it. */
  figures: ReadonlyMap<string, string>;
  styles: Styles;
  /** A single event's analysis: its properties and what it found, by stable identifier. */
  analysis?: { properties: AnalysisProperties; found: ReadonlyMap<string, Found> } | null;
}

export interface Laid {
  html: string;
  report: Report;
}

/** The anchors a document holds: its full sections and its front parts. */
function held(doc: Document, analysis: boolean): Set<string> {
  const anchors = new Set<string>([FRONT.introduction]);
  if (analysis) anchors.add(FRONT.analysis);
  if (doc.contents) anchors.add(FRONT.contents);
  for (const place of doc.places) if (place.full) anchors.add(place.section.anchor);
  return anchors;
}

/** A single event's PDF: cover, introduction, analysis, contents, then its sections. */
export function layoutSingle(doc: Document, options: LayoutOptions): Laid {
  const analysis = options.analysis ?? null;
  const links = new Links(false, options.site, held(doc, analysis !== null));
  const report: Report = { belowFloor: [], missing: [] };
  const body = [
    coverHtml(doc, links, options.figures, options.date),
    introductionHtml(doc, links),
    analysis ? analysisHtml(analysis.properties, links) : '',
    doc.contents ? contentsHtml(doc.contents, links) : '',
    `<div class="sections">${sections(doc.places, links, options, report)}</div>`,
  ];
  const headers = runningHeaders(doc.cover.title);
  return {
    html: page(doc.cover.title, 'single', body.join('\n'), options.styles, headers),
    report,
  };
}

/** The book's front part: cover, introduction and contents. */
export function layoutBookFront(doc: Document, options: LayoutOptions): Laid {
  const links = new Links(true, options.site, held(doc, false));
  const body = [
    coverHtml(doc, links, options.figures, options.date),
    introductionHtml(doc, links),
    doc.contents ? contentsHtml(doc.contents, links) : '',
  ];
  return {
    html: page(doc.cover.title, 'book', body.join('\n'), options.styles, ''),
    report: { belowFloor: [], missing: [] },
  };
}

/** A part of the book's sections: the places T025 gives it, in document order. */
export function layoutBookPart(
  doc: Document,
  places: readonly Place[],
  options: LayoutOptions
): Laid {
  const links = new Links(true, options.site, held(doc, false));
  const report: Report = { belowFloor: [], missing: [] };
  const body = `<div class="sections">${sections(places, links, options, report)}</div>`;
  return { html: page(doc.cover.title, 'book', body, options.styles, ''), report };
}

function sections(
  places: readonly Place[],
  links: Links,
  options: LayoutOptions,
  report: Report
): string {
  const found = options.analysis?.found ?? null;
  return places
    .map((place) => placeHtml(place, { links, figures: options.figures, found, report }))
    .join('\n');
}

/**
 * A single event's running headers and page numbers (FR-016): the event's name, or a front
 * part's name on its pages; a number on every page but the cover. The header's text is in
 * the theme's on-surface-variant colour, its type the theme's body-small.
 */
function runningHeaders(event: string): string {
  const box = (content: string) =>
    `content: ${content}; font-family: Roboto, 'Noto Sans', 'Noto Sans Symbols 2', 'Noto Sans Math'; font-size: var(--mat-sys-body-small-size); color: var(--mat-sys-on-surface-variant);`;
  const header = (name: string) => `@top-center { ${box(cssString(name))} }`;
  return [
    `@page { ${header(event)} @bottom-center { ${box('counter(page)')} } }`,
    `@page introduction { ${header('Introduction')} }`,
    `@page analysis { ${header('Analysis properties')} }`,
    `@page contents { ${header('Contents')} }`,
    '@page cover { @top-center { content: none; } @bottom-center { content: none; } }',
  ].join('\n');
}

function page(
  title: string,
  mode: 'book' | 'single',
  body: string,
  css: Styles,
  extra: string
): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${text(title)}</title>
<style>${css.fonts}</style>
<style>${css.theme}</style>
<style>${css.pages}</style>
<style>${extra}</style>
</head>
<body class="${attribute(mode)}">
${body}
</body>
</html>
`;
}
