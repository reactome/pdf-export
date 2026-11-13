// The report's front parts and its most significant pathways' table (spec 002 T008,
// FR-205, FR-206), in spec 001's theme and markup: the cover, the contents list, the
// introduction, the analysis's properties, the genome-wide overview's place and caption,
// and the table, each row linked to its pathway's detail. In the Background's order.
import { anchorOf } from '../model/build.ts';
import type { ContentsEntry } from '../model/types.ts';
import { figureHtml } from '../layout/figure.ts';
import { contentsHtml, formatDate, logoHtml, ownReferencesHtml } from '../layout/front.ts';
import { Links, attribute, text } from '../layout/html.ts';
import { ABOUT_REACTOME, ANALYSIS, RELEASE_LINE, fill } from '../layout/text.ts';
import type { ReportModel } from './model.ts';
import {
  KEPT,
  OVERVIEW_CAPTION,
  PAGES,
  PATHWAYS_NOTE,
  PROPERTIES,
  REPORT_TITLE,
  RESULT_LINK,
} from './text.ts';

/** The report's parts' anchors, which its contents list and bookmarks point at. */
export const PARTS = {
  contents: 'contents',
  introduction: 'introduction',
  properties: 'properties',
  overview: 'overview',
  pathways: 'pathways',
  details: 'details',
  found: 'found',
  notFound: 'not-found',
} as const;

export type ReportPart = keyof typeof PARTS;

/** Each part's name, as its heading, contents entry and running header give it. */
export const PART_NAMES: Readonly<Record<ReportPart, string>> = {
  contents: 'Contents',
  introduction: 'Introduction',
  properties: 'Analysis properties',
  overview: 'Genome-wide overview',
  pathways: 'Most significant pathways',
  details: 'Pathway details',
  found: 'Identifiers found',
  notFound: 'Identifiers not found',
};

/** Whether a type is ReactomeGSA's, whose guide explains it. */
export function isGsa(type: string): boolean {
  return type.startsWith('GSA_') || type === 'GSVA';
}

/** The result in the Pathway Browser, as the website's own pages link to one. */
export function resultLink(links: Links, token: string): string {
  return links.website(`/PathwayBrowser?analysis=${token}`);
}

/** The report's title, the PDF's: "Pathway Analysis Report - " and the analysis's name. */
export function reportTitle(model: ReportModel): string {
  return `${REPORT_TITLE} - ${model.summary.name}`;
}

export interface FrontOptions {
  links: Links;
  /** The graph's release. */
  release: number;
  /** The cover's date. */
  date: Date;
  /** The genome-wide overview's SVG; its place is left empty without it. */
  overview: string | undefined;
}

/** The front parts and the table, in order: what comes before the pathways' details. */
export function reportFrontHtml(model: ReportModel, options: FrontOptions): string {
  const { links } = options;
  return [
    reportCoverHtml(model, options),
    contentsHtml(reportContents(model), links),
    introductionHtml(options),
    propertiesHtml(model, links),
    overviewHtml(model, options),
    pathwaysHtml(model, links),
  ].join('\n');
}

export function reportCoverHtml(
  model: ReportModel,
  { links, release, date }: FrontOptions
): string {
  const parts = [
    logoHtml(),
    `<p class="title">${text(REPORT_TITLE)}</p>`,
    `<p class="name">${text(model.summary.name)}</p>`,
    `<p class="release">${text(fill(RELEASE_LINE, { release }))}</p>`,
    `<p class="date">${text(formatDate(date))}</p>`,
    `<p class="result">${Links.a(resultLink(links, model.token), RESULT_LINK)}</p>`,
    `<p class="kept">${text(KEPT)}</p>`,
  ];
  return `<div class="cover">${parts.join('\n')}</div>`;
}

/**
 * The contents list: each part after it, and under the details each pathway. The
 * identifiers found and not found are listed only when the report holds them.
 */
export function reportContents(model: ReportModel): ContentsEntry[] {
  const entry = (part: ReportPart): ContentsEntry => ({
    title: PART_NAMES[part],
    target: PARTS[part],
    depth: 0,
  });
  const entries = [
    entry('introduction'),
    entry('properties'),
    entry('overview'),
    entry('pathways'),
  ];
  if (model.pathways.length > 0) {
    entries.push(
      entry('details'),
      ...model.pathways.map((p) => ({ title: p.name, target: anchorOf(p.stId), depth: 1 }))
    );
  }
  if (
    model.found.some((f) => f.rows.length > 0) ||
    model.foundInteractors.some((f) => f.rows.length > 0)
  ) {
    entries.push(entry('found'));
  }
  if (model.notFound.length > 0) entries.push(entry('notFound'));
  return entries;
}

function heading(part: ReportPart, links: Links): string {
  return `<h1 id="${PARTS[part]}">${links.probe(PARTS[part])}${text(PART_NAMES[part])}</h1>`;
}

function section(part: ReportPart, body: string, links: Links): string {
  return `<section class="front" data-part="${attribute(PARTS[part])}">
${heading(part, links)}
${body}
</section>`;
}

/** Spec 001's introduction: about Reactome, the release, Reactome's own references. */
function introductionHtml({ links, release }: FrontOptions): string {
  return section(
    'introduction',
    `<p>${text(ABOUT_REACTOME)}</p>
<p>${text(fill(RELEASE_LINE, { release }))}.</p>
<p class="part">Reactome’s own references</p>
<ol class="references">${ownReferencesHtml()}</ol>`,
    links
  );
}

/** The type's explanation, from the website's analysis guide (spec 001 T016). */
function explained(type: string): string | undefined {
  if (isGsa(type)) return ANALYSIS.gsa;
  const types: Readonly<Record<string, string>> = {
    OVERREPRESENTATION: ANALYSIS.overrepresentation,
    EXPRESSION: ANALYSIS.expression,
    SPECIES_COMPARISON: ANALYSIS.speciesComparison,
  };
  return types[type];
}

export function propertiesHtml(model: ReportModel, links: Links): string {
  const { summary } = model;
  const gsa = isGsa(summary.type);
  const guide = gsa
    ? Links.a(links.website(PAGES.gsaGuide), PROPERTIES.gsaGuide)
    : Links.a(links.website(PAGES.guide), PROPERTIES.guide);
  const note = explained(summary.type);
  const rows: [string, string][] = [
    ['Type', `${text(summary.type)}.${note === undefined ? '' : ` ${text(note)}`} ${guide}`],
  ];
  if (summary.gsaMethod !== null) rows.push(['ReactomeGSA method', text(summary.gsaMethod)]);
  if (summary.comparedWith !== null) rows.push(['Compared with', text(summary.comparedWith.name)]);
  rows.push(
    ['Identifiers found', `${String(model.identifiersFound)} of ${String(model.identifiersTotal)}`],
    ['Pathways hit', String(model.pathwaysHit)]
  );
  if (summary.projection) {
    rows.push([
      'Projected to human',
      `Yes. ${Links.a(links.website(PAGES.inferred), PROPERTIES.projection)}`,
    ]);
  }
  if (summary.interactors)
    rows.push(['Interactors included', `Yes. ${text(ANALYSIS.interactors)}`]);
  rows.push(
    ['Species', text(model.species.name)],
    ['Resource', text(model.resource)],
    ['Token', `<span class="id">${text(model.token)}</span>. ${text(KEPT)}`]
  );
  return section(
    'properties',
    `<dl class="facts">${rows.map(([term, value]) => `<dt>${text(term)}</dt><dd>${value}</dd>`).join('')}</dl>
<p>${text(PROPERTIES.counts)}</p>`,
    links
  );
}

/** The genome-wide overview's place, its figure linked to the result, and its caption. */
export function overviewHtml(model: ReportModel, { links, overview }: FrontOptions): string {
  if (overview === undefined) return section('overview', '', links);
  const { html } = figureHtml(
    overview,
    'overview',
    PART_NAMES.overview,
    resultLink(links, model.token)
  );
  return section(
    'overview',
    `${html}
<p class="caption">${text(fill(OVERVIEW_CAPTION, { species: model.species.name }))}</p>`,
    links
  );
}

/** A statistic as the table prints it: three significant figures, small ones as powers. */
export function statistic(value: number): string {
  if (value !== 0 && Math.abs(value) < 1e-3) return value.toExponential(2);
  return String(Number(value.toPrecision(3)));
}

/** The most significant pathways: a row each, its name linked to its detail. */
export function pathwaysHtml(model: ReportModel, links: Links): string {
  const head = [
    'Pathway',
    'Entities found',
    'Entities total',
    'Entities ratio',
    'Entities p-value',
    'Entities FDR',
    'Reactions found',
    'Reactions total',
    'Reactions ratio',
  ];
  const rows = model.pathways
    .map((p) => {
      const { entities: e, reactions: r } = p.statistics;
      const cells = [
        Links.a(links.internal(anchorOf(p.stId)), p.name),
        String(e.found),
        String(e.total),
        statistic(e.ratio),
        statistic(e.pValue),
        statistic(e.fdr),
        String(r.found),
        String(r.total),
        statistic(r.ratio),
      ];
      return `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
    })
    .join('');
  return section(
    'pathways',
    `<p>${text(fill(PATHWAYS_NOTE, { number: model.pathways.length }))}</p>
<table class="pathways"><thead><tr>${head.map((h) => `<th>${text(h)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>
<p>${text(ANALYSIS.entitiesFound)} ${text(ANALYSIS.pValue)} ${text(ANALYSIS.fdr)}</p>`,
    links
  );
}
