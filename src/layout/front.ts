// The front parts (spec 001 T018): the cover, the introduction, the analysis's properties
// and the contents list, before the sections (FR-002, FR-006). Their text is T016's.
import { readFileSync } from 'node:fs';

import { prefixIds } from '../figures/prefix.ts';
import type { AnalysisProperties, ContentsEntry, Document } from '../model/types.ts';
import { coverFigureHtml, figureKey } from './figure.ts';
import { Links, text } from './html.ts';
import {
  ABOUT_REACTOME,
  ANALYSIS,
  CONTRIBUTORS,
  DOCUMENT_HOLDS,
  EXCERPT,
  INSTITUTIONS,
  LICENCE,
  RELEASE_LINE,
  fill,
  ownReferences,
} from './text.ts';

/** The front parts' anchors, which the contents list and the book's links point at. */
export const FRONT = {
  introduction: 'introduction',
  analysis: 'analysis',
  contents: 'contents',
} as const;

/**
 * Reactome's logo, the website's positive imagotype (content/about/logo.mdx, which invites
 * its use), with its own colours (FR-015).
 */
const LOGO = prefixIds(readFileSync(new URL('logo.svg', import.meta.url), 'utf8'), 'logo').replace(
  /<svg\b/,
  '<svg role="img" aria-label="Reactome"'
);

export function coverHtml(
  doc: Document,
  links: Links,
  figures: ReadonlyMap<string, string>,
  date: Date
): string {
  const { cover } = doc;
  const parts = [`<div class="logo">${LOGO}</div>`, `<p class="title">${text(cover.title)}</p>`];
  if (cover.release !== null) {
    parts.push(`<p class="release">${text(fill(RELEASE_LINE, { release: cover.release }))}</p>`);
  }
  const svg = cover.figure ? figures.get(figureKey(cover.figure)) : undefined;
  if (svg !== undefined) parts.push(coverFigureHtml(svg, `${cover.title}: figure`));
  if (cover.excerpt) {
    parts.push(`<p class="excerpt">${Links.a(links.website(EXCERPT.page), EXCERPT.text)}</p>`);
  }
  if (cover.names.length > 0) {
    parts.push(
      `<p class="part">${text(CONTRIBUTORS)}</p><p class="names">${text(cover.names.join(', '))}</p>`
    );
  }
  parts.push(
    `<ul class="institutions">${INSTITUTIONS.map((i) => `<li>${text(i)}</li>`).join('')}</ul>`,
    `<p class="licence">${licence(links)}</p>`,
    `<p class="date">${text(formatDate(date))}</p>`
  );
  return `<div class="cover">${parts.join('\n')}</div>`;
}

/** The licence statement, its licences and the website's page linked. */
function licence(links: Links): string {
  const linked: [string, string][] = [
    ['CC0 1.0', LICENCE.links.cc0],
    ['CC BY 4.0', LICENCE.links.ccBy],
    ['Reactome’s licence agreement', links.website(LICENCE.page)],
  ];
  let html = text(LICENCE.text);
  for (const [phrase, href] of linked) html = html.replace(text(phrase), Links.a(href, phrase));
  return html;
}

/** A date as the cover gives it: 30 October 2026. */
export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function introductionHtml(doc: Document, links: Links): string {
  const references = ownReferences()
    .map((r) => {
      const authors =
        r.authors.length > 0
          ? `${text(r.authors.join(', '))} (${String(r.year)}). `
          : `(${String(r.year)}). `;
      return `<li>${authors}${Links.a(`https://doi.org/${r.doi}`, r.title)}. <i>${text(r.journal)}</i>.</li>`;
    })
    .join('');
  return `<section class="front" data-part="introduction">
<h1 id="${FRONT.introduction}">${links.probe(FRONT.introduction)}Introduction</h1>
<p>${text(ABOUT_REACTOME)}</p>
<p>${text(fill(RELEASE_LINE, { release: doc.release.version }))}. ${text(
    fill(DOCUMENT_HOLDS, { pathways: doc.release.pathways, reactions: doc.release.reactions })
  )}</p>
<p class="part">Reactome’s own references</p>
<ol class="references">${references}</ol>
</section>`;
}

/** The type's explanation, from the website's analysis guide (T016). */
const EXPLAINED: Readonly<Record<string, string>> = {
  OVERREPRESENTATION: ANALYSIS.overrepresentation,
  EXPRESSION: ANALYSIS.expression,
  SPECIES_COMPARISON: ANALYSIS.speciesComparison,
  GSA: ANALYSIS.gsa,
};

export function analysisHtml(properties: AnalysisProperties, links: Links): string {
  const rows: [string, string][] = [
    ['Token', `<span class="id">${text(properties.token)}</span>`],
    ['Type', text(properties.type)],
    ['Species', text(properties.species)],
    ['Projected to human', properties.projection ? 'Yes' : 'No'],
    ['Interactors included', properties.interactors ? 'Yes' : 'No'],
    [
      'Identifiers found',
      `${String(properties.identifiersFound)} of ${String(properties.identifiersTotal)}`,
    ],
    ['Pathways hit', String(properties.pathwaysHit)],
  ];
  const notes = [
    EXPLAINED[properties.type],
    properties.interactors ? ANALYSIS.interactors : undefined,
    ANALYSIS.entitiesFound,
  ].filter((note) => note !== undefined);
  return `<section class="front" data-part="analysis">
<h1 id="${FRONT.analysis}">${links.probe(FRONT.analysis)}Analysis properties</h1>
<dl class="facts">${rows.map(([term, value]) => `<dt>${text(term)}</dt><dd>${value}</dd>`).join('')}</dl>
${notes.map((note) => `<p>${text(note)}</p>`).join('\n')}
</section>`;
}

/**
 * The contents list. Each entry's page number is a placeholder of fixed width, which the
 * second pass fills (T019, research R4) without moving anything else.
 */
export function contentsHtml(entries: readonly ContentsEntry[], links: Links): string {
  const items = entries
    .map(
      (entry) =>
        `<li style="--depth: ${String(entry.depth)}">${Links.a(links.internal(entry.target), entry.title)}<span class="page" data-target="${entry.target}">0</span></li>`
    )
    .join('');
  return `<section class="front" data-part="contents">
<h1 id="${FRONT.contents}">${links.probe(FRONT.contents)}Contents</h1>
<ol class="contents">${items}</ol>
</section>`;
}
