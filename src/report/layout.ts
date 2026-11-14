// The report's front parts and its most significant pathways' table (spec 002 T008,
// FR-205, FR-206), in spec 001's theme and markup: the cover, the contents list, the
// introduction, the analysis's properties, the genome-wide overview's place and caption,
// and the table, each row linked to its pathway's detail. In the Background's order.
import { anchorOf } from '../model/build.ts';
import type { ContentsEntry } from '../model/types.ts';
import { CharacterLog, onRequestStrings } from '../layout/characters.ts';
import { figureHtml, type FigureSvgs } from '../layout/figure.ts';
import { contentsHtml, formatDate, logoHtml, ownReferencesHtml } from '../layout/front.ts';
import { Links, attribute, text } from '../layout/html.ts';
import { ABOUT_REACTOME, ANALYSIS, RELEASE_LINE, fill } from '../layout/text.ts';
import type { PathwayDetail } from './details.ts';
import type {
  FoundIdentifiers,
  FoundInteractors,
  FoundRow,
  InteractorRow,
  ReportModel,
  ReportedPathway,
  ResourceTable,
} from './model.ts';
import type { Reference } from '../graph/queries.ts';
import type { Report } from '../layout/section.ts';
import { reference, referenceLead, referenceTitle, sectionHtml } from '../layout/section.ts';
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
  if (holdsFound(model)) entries.push(entry('found'));
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

// The pathways' details and the identifier lists (spec 002 T009).

/** A resource's name as the website shows it; its code where it has no other. */
const RESOURCE_NAMES: Readonly<Record<string, string>> = {
  UNIPROT: 'UniProt',
  ENSEMBL: 'Ensembl',
  CHEBI: 'ChEBI',
  COMPOUND: 'KEGG Compound',
  MIRBASE: 'miRBase',
  NCBI_PROTEIN: 'NCBI Protein',
  NCBI_NUCLEOTIDE: 'NCBI Nucleotide',
  IUPHAR: 'IUPHAR',
  EMBL: 'EMBL',
  PUBCHEM_COMPOUND: 'PubChem Compound',
};

export function resourceName(resource: string): string {
  return RESOURCE_NAMES[resource] ?? resource;
}

/** The expression columns' headers and a row's values in them. */
function valueHeads(columns: readonly string[]): string {
  return columns.map((c) => `<th>${text(c)}</th>`).join('');
}

function valueCells(exp: readonly number[], columns: readonly string[]): string {
  return columns.map((_c, i) => `<td>${text(String(exp[i] ?? ''))}</td>`).join('');
}

function table(heads: string, rows: string): string {
  return `<table class="found"><thead><tr>${heads}</tr></thead><tbody>${rows}</tbody></table>`;
}

function entityTable(rows: readonly FoundRow[], columns: readonly string[]): string {
  return table(
    `<th>Identifier</th><th>Maps to</th>${valueHeads(columns)}`,
    rows
      .map(
        (r) =>
          `<tr><td class="id">${text(r.id)}</td><td class="id">${text(r.mapsTo.join(', '))}</td>${valueCells(r.exp, columns)}</tr>`
      )
      .join('')
  );
}

function interactorTable(rows: readonly InteractorRow[], columns: readonly string[]): string {
  return table(
    `<th>Identifier</th><th>Interactor</th><th>Interacts with</th>${valueHeads(columns)}`,
    rows
      .map(
        (r) =>
          `<tr><td class="id">${text(r.id)}</td><td class="id">${text(r.mapsTo.join(', '))}</td><td class="id">${text(r.interactsWith.join(', '))}</td>${valueCells(r.exp, columns)}</tr>`
      )
      .join('')
  );
}

/** A pathway's tables per resource, each left out when empty. */
function perResource<R>(
  title: string,
  tables: readonly ResourceTable<R>[],
  write: (rows: readonly R[]) => string
): string {
  return tables
    .filter((t) => t.rows.length > 0)
    .map(
      (t) => `<p class="part">${text(`${title}: ${resourceName(t.resource)}`)}</p>${write(t.rows)}`
    )
    .join('\n');
}

/** The report's edit history (T007), in spec 001's table. */
function historyHtml(detail: PathwayDetail | undefined): string {
  const rows = detail?.history ?? [];
  if (rows.length === 0) return '';
  const body = rows
    .map((row) => {
      const names = row.names.map((name) => name ?? '').join('; ');
      return `<tr><td>${text(row.date)}</td><td>${text(row.action)}</td><td>${text(row.etAl ? `${names} et al.` : names)}</td></tr>`;
    })
    .join('');
  return `<p class="part">Edit history</p><table class="edits"><thead><tr><th>Date</th><th>Action</th><th>Names</th></tr></thead><tbody>${body}</tbody></table>`;
}

export interface DetailsInput {
  links: Links;
  figures: FigureSvgs;
  /** What the figures' layout reports: those missing, below the floor or unmeasured. */
  report: Report;
}

/**
 * A literature reference as the analysis report prints it (spec 002 T027, decided 14 Nov
 * 2026: today's form for a book and a web page, read from `reactome/analysis-report`'s
 * `ApaStyle`; research R9). An article is spec 001's, which today's matches.
 *
 * - **A web page:** its title, then "Retrieved from" and its address, linked; today's names
 *   no authors and no year for one.
 * - **A book:** its authors and year, then its chapter's title and the book's, parted by a
 *   comma, in italics, then its pages after a comma; today's prints no publisher or ISBN.
 */
export function reportReference(r: Reference): string {
  if (r.kind === 'web page') {
    return r.url === null
      ? `${text(r.title)}.`
      : `${text(r.title)}. Retrieved from ${Links.a(r.url, r.url)}`;
  }
  if (r.kind === 'book') {
    const chapter = r.chapterTitle === null ? '' : `${text(r.chapterTitle)}, `;
    const pages = r.pages === null ? '' : `, ${text(r.pages)}`;
    return `${referenceLead(r)}<i>${chapter}${referenceTitle(r)}</i>${pages}.`;
  }
  // an article as spec 001's, its title trimmed of white space, commas and full stops at
  // either end, as today's `ApaStyle` trims it before its own full stop
  return reference({ ...r, title: r.title.replace(/^[\s,.]+|[\s,.]+$/g, '') });
}

/**
 * One pathway's detail: spec 001's section for it, with the report's edit history in place
 * of spec 001's and its stable identifier linked to its page, then its entities found per
 * resource and, with interactors, its interactors. A pathway the graph does not hold has its
 * name, identifier and tables alone.
 */
export function detailHtml(
  model: ReportModel,
  pathway: ReportedPathway,
  detail: PathwayDetail | undefined,
  input: DetailsInput
): string {
  const tail = [
    historyHtml(detail),
    perResource('Entities found', pathway.entities, (rows) => entityTable(rows, model.columns)),
    perResource('Interactors found', pathway.interactors, (rows) =>
      interactorTable(rows, model.columns)
    ),
  ]
    .filter((part) => part !== '')
    .join('\n');
  if (detail) {
    // a level below the parts' headings, so the outline holds each pathway under the details
    return sectionHtml(
      { ...detail.section, depth: 1 },
      {
        links: input.links,
        figures: input.figures,
        found: null,
        report: input.report,
        analysisReport: { tail, linkStId: true, reference: reportReference },
      }
    );
  }
  const anchor = anchorOf(pathway.stId);
  return `<section class="event" style="--depth: 1">
<h2 id="${attribute(anchor)}" class="name">${input.links.probe(anchor)}${Links.a(input.links.event(pathway.stId), pathway.name)}</h2>
<dl class="facts"><dt>Stable identifier</dt><dd><a href="${attribute(input.links.event(pathway.stId))}"><span class="id">${text(pathway.stId)}</span></a></dd></dl>
${tail}
</section>`;
}

/** The details part: a heading, then each reported pathway's detail; none without pathways. */
export function detailsHtml(
  model: ReportModel,
  details: ReadonlyMap<number, PathwayDetail>,
  input: DetailsInput
): string {
  if (model.pathways.length === 0) return '';
  return `<section class="front" data-part="${PARTS.details}">
${heading('details', input.links)}
</section>
<div class="sections">${model.pathways
    .map((p) => detailHtml(model, p, details.get(p.dbId), input))
    .join('\n')}</div>`;
}

/** Whether the report holds any identifier found, an entity's or an interactor's. */
export function holdsFound(model: ReportModel): boolean {
  return (
    model.found.some((f) => f.rows.length > 0) ||
    model.foundInteractors.some((f) => f.rows.length > 0)
  );
}

/**
 * The identifiers found: per resource, what each maps to with its values, the heading
 * counting the Reactome entities they map to; then the interactors apart. Left out when
 * there are none.
 */
export function foundHtml(model: ReportModel, links: Links): string {
  if (!holdsFound(model)) return '';
  const entities = model.found
    .filter((f) => f.rows.length > 0)
    .map(
      (f: FoundIdentifiers) =>
        `<p class="part">${text(`${resourceName(f.resource)}: ${String(f.rows.length)} identifiers mapping to ${String(f.entities)} Reactome entities`)}</p>${entityTable(f.rows, model.columns)}`
    );
  const interactors = model.foundInteractors
    .filter((f) => f.rows.length > 0)
    .map(
      (f: FoundInteractors) =>
        `<p class="part">${text(`Interactors through ${resourceName(f.resource)}: ${String(f.rows.length)}`)}</p>${interactorTable(f.rows, model.columns)}`
    );
  return section('found', [...entities, ...interactors].join('\n'), links);
}

/** The identifiers not found, sorted, each once, with their values; left out when none. */
export function notFoundHtml(model: ReportModel, links: Links): string {
  if (model.notFound.length === 0) return '';
  const rows = model.notFound
    .map((n) => `<tr><td class="id">${text(n.id)}</td>${valueCells(n.exp, model.columns)}</tr>`)
    .join('');
  return section('notFound', table(`<th>Identifier</th>${valueHeads(model.columns)}`, rows), links);
}

/**
 * The model and the details as a report made on request prints them (FR-207, spec 001
 * FR-017): every string's characters no font draws printed as U+FFFD and logged once, in
 * the log the figures' labels share.
 */
export function onRequestReport(
  model: ReportModel,
  details: ReadonlyMap<number, PathwayDetail>,
  log: CharacterLog
): { model: ReportModel; details: Map<number, PathwayDetail> } {
  return {
    model: onRequestStrings(model, log),
    details: onRequestStrings(new Map(details), log),
  };
}

export interface BodyOptions extends FrontOptions {
  figures: FigureSvgs;
  report: Report;
}

/** The whole report's body, every part in the Background's order. */
export function reportBodyHtml(
  model: ReportModel,
  details: ReadonlyMap<number, PathwayDetail>,
  options: BodyOptions
): string {
  const { links } = options;
  return [
    reportFrontHtml(model, options),
    detailsHtml(model, details, options),
    foundHtml(model, links),
    notFoundHtml(model, links),
  ]
    .filter((part) => part !== '')
    .join('\n');
}
