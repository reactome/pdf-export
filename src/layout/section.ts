// An event's section (spec 001 T018), its parts in the Background's order (FR-005): name,
// location, stable identifier, type, compartments, diseases, inferred from, figure,
// summations, before and after, references, edit history, then what an analysis found.
// Parts are set apart by space, type and thin rules, never boxes (FR-016).
import type { Reference } from '../graph/queries.ts';
import type { Found, FoundRow, Place, Section } from '../model/types.ts';
import { figureHtml, figureKey, type Placement } from './figure.ts';
import { anchorOf } from '../model/build.ts';
import { Links, text } from './html.ts';

/** What laying out sections reports, for the run report and the service's log. */
export interface Report {
  /** Figures printed below the legibility floor even on a landscape page, by stable id. */
  belowFloor: string[];
  /** Sections whose figure was not given, by stable id. */
  missing: string[];
}

export interface SectionInput {
  links: Links;
  figures: ReadonlyMap<string, string>;
  /** What an analysis found, by the event's stable identifier. */
  found: ReadonlyMap<string, Found> | null;
  report: Report;
}

/** An event's heading level: the PDF's own event or a chapter's is h1, h6 the deepest. */
const level = (depth: number) => Math.min(depth + 1, 6);

/** A place: the event's full section, or a short entry linked to it (FR-004). */
export function placeHtml(place: Place, input: SectionInput): string {
  if (place.full) return sectionHtml(place.section, input);
  const { links } = input;
  return `<p class="short" style="--depth: ${String(place.depth)}">${Links.a(links.internal(place.anchor), place.event.name)} <span class="id">${text(place.event.stId)}</span></p>`;
}

export function sectionHtml(section: Section, input: SectionInput): string {
  const { links } = input;
  const { event } = section;
  const h = `h${String(level(section.depth))}`;
  const parts: string[] = [
    `<${h} id="${section.anchor}" class="name">${links.probe(section.anchor)}${Links.a(links.event(event.stId), event.name)}</${h}>`,
  ];
  const facts: [string, string][] = [];
  if (section.path.length > 0) {
    facts.push([
      'Location',
      section.path
        .map((p) => {
          const anchor = anchorOf(p.stId);
          return links.holds(anchor) ? Links.a(links.internal(anchor), p.name) : text(p.name);
        })
        .join(' <span class="sep">›</span> '),
    ]);
  }
  facts.push(['Stable identifier', `<span class="id">${text(event.stId)}</span>`]);
  if (event.kind === 'reaction' && event.category) facts.push(['Type', text(event.category)]);
  if (event.compartments.length > 0) {
    facts.push(['Compartments', event.compartments.map((c) => text(c.name)).join(', ')]);
  }
  if (section.diseases.length > 0) facts.push(['Diseases', section.diseases.map(text).join(', ')]);
  if (section.inferredFrom.length > 0) {
    facts.push([
      'Inferred from',
      section.inferredFrom
        .map((source) => {
          const anchor = anchorOf(source.stId);
          const href = links.holds(anchor) ? links.internal(anchor) : links.event(source.stId);
          return `${Links.a(href, source.name)} (${text(source.speciesName)})`;
        })
        .join('; '),
    ]);
  }
  parts.push(definitions(facts));

  if (section.figure) {
    const svg = input.figures.get(figureKey(section.figure));
    if (svg === undefined) {
      input.report.missing.push(event.stId);
    } else {
      const { html, placement } = figureHtml(svg, section.anchor, `${event.name}: figure`);
      noteFloor(input.report, event.stId, placement);
      parts.push(html);
    }
  }

  if (section.summations.length > 0) {
    // sanitised by the model (rules.ts) to the tags the website's pages allow
    parts.push(`<div class="summation">${section.summations.join('\n')}</div>`);
  }

  if (event.kind === 'reaction') {
    const order: [string, string][] = [];
    const list = (refs: typeof event.before) =>
      refs.map((r) => Links.a(links.internal(anchorOf(r.stId)), r.name)).join('; ');
    if (event.before.length > 0) order.push(['Preceded by', list(event.before)]);
    if (event.after.length > 0) order.push(['Followed by', list(event.after)]);
    if (order.length > 0) parts.push(definitions(order));
  }

  if (section.references.length > 0) {
    parts.push(
      `<p class="part">Literature references</p><ol class="references">${section.references
        .map((r) => `<li>${reference(r)}</li>`)
        .join('')}</ol>`
    );
  }

  if (section.edits.length > 0) {
    const rows = section.edits
      .map(
        (row) =>
          `<tr><td>${text(row.date)}</td><td>${text(row.kinds.map(capital).join(', '))}</td><td>${text(row.authors.join('; '))}</td></tr>`
      )
      .join('');
    parts.push(
      `<p class="part">Edit history</p><table class="edits"><thead><tr><th>Date</th><th>Action</th><th>Names</th></tr></thead><tbody>${rows}</tbody></table>`
    );
  }

  const found = input.found?.get(event.stId);
  if (found)
    parts.push(
      foundHtml('Entities found', found.entities),
      foundHtml('Interactors found', found.interactors)
    );

  return `<section class="event" style="--depth: ${String(section.depth)}">${parts.join('\n')}</section>`;
}

function noteFloor(report: Report, stId: string, placement: Placement): void {
  if (placement.belowFloor) report.belowFloor.push(stId);
}

function definitions(rows: readonly [string, string][]): string {
  return `<dl class="facts">${rows.map(([term, value]) => `<dt>${text(term)}</dt><dd>${value}</dd>`).join('')}</dl>`;
}

const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/** A literature reference: its authors, year, title and where it was published. */
export function reference(r: Reference): string {
  const authors =
    r.authors.length > 0 ? `${text(r.authors.join(', '))}${r.moreAuthors ? ' et al.' : ''}` : '';
  const year = r.year === null ? '' : ` (${String(r.year)})`;
  const named = `${authors}${year}`;
  // a list of authors may end in an initial's full stop: it is not doubled
  const lead = named === '' ? '' : `${named}${named.endsWith('.') ? '' : '.'} `;
  if (r.kind === 'web page') {
    return `${lead}${r.url ? Links.a(r.url, r.title) : text(r.title)}.`;
  }
  const title =
    r.pubMedId === null
      ? text(r.title)
      : Links.a(`https://pubmed.ncbi.nlm.nih.gov/${String(r.pubMedId)}/`, r.title);
  if (r.kind === 'book') {
    const chapter = r.chapterTitle ? `${text(r.chapterTitle)}. In: ` : '';
    const rest = [r.publisher, r.isbn ? `ISBN ${r.isbn}` : null].filter((x) => x !== null);
    return `${lead}${chapter}<i>${title}</i>.${rest.length > 0 ? ` ${text(rest.join(', '))}.` : ''}`;
  }
  const where = [
    r.journal === null ? null : `<i>${text(r.journal)}</i>`,
    r.volume === null ? null : String(r.volume),
    r.pages === null ? null : text(r.pages),
  ].filter((x) => x !== null);
  return `${lead}${title}.${where.length > 0 ? ` ${where.join(', ')}.` : ''}`;
}

function foundHtml(title: string, rows: readonly FoundRow[]): string {
  if (rows.length === 0) return '';
  const body = rows
    .map(
      (row) =>
        `<tr><td class="id">${text(row.identifier)}</td><td class="id">${text(row.mapsTo.join(', '))}</td><td>${text(row.resource)}</td></tr>`
    )
    .join('');
  return `<p class="part">${text(title)}</p><table class="found"><thead><tr><th>Identifier</th><th>Maps to</th><th>Resource</th></tr></thead><tbody>${body}</tbody></table>`;
}
