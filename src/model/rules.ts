// The parts' rules (spec 001 T015, research R2), kept as event-pdf applies them, with lists
// in the curators' order.
import sanitizeHtml from 'sanitize-html';

import type { Edit, EventRef, Named } from '../graph/queries.ts';
import type { EditRow } from './types.ts';

/**
 * Strings compared by their code units, as Java's String.compareTo does: what today's
 * PDFs sort by, and the same on every host (localeCompare depends on the host's locale).
 */
export function byCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Diseases, leaving out the one named exactly "disease", as today. */
export function diseases(list: readonly Named[]): string[] {
  return list.filter((d) => d.name !== 'disease').map((d) => d.name);
}

/** What an event was inferred from, by species name, then name (the graph gives no order). */
export function inferredFrom<T extends EventRef & { speciesName: string }>(
  list: readonly T[]
): T[] {
  return [...list].sort(
    (a, b) => byCodeUnits(a.speciesName, b.speciesName) || byCodeUnits(a.name, b.name)
  );
}

/** The kinds of edit in event-pdf's order: a row lists its kinds so. */
const KINDS: readonly string[] = ['authored', 'edited', 'reviewed', 'revised'];

/**
 * The edit history (research R2, as event-pdf's Tables.createEditionsTable writes it):
 * edits with no date or no author dropped; the date as YYYY-MM-DD; sorted by date, then
 * the first author's surname; an edit joins the row of the edit before it when the two
 * share a date and either their kind or their authors (compared as sets, an obvious fix
 * to today's order-sensitive comparison); a row's kinds in event-pdf's order, and its
 * authors by database id.
 */
export function editRows(edits: readonly Edit[]): EditRow[] {
  const kept = edits
    .filter((e) => e.dateTime !== null && e.authors.length > 0)
    .map((e) => ({ ...e, date: (e.dateTime ?? '').slice(0, 10) }))
    .sort(
      (a, b) =>
        byCodeUnits(a.date, b.date) ||
        byCodeUnits(a.authors[0]?.surname ?? '', b.authors[0]?.surname ?? '') ||
        // ties as event-pdf leaves them: it lists edits kind by kind, then sorts stably
        KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) ||
        a.dbId - b.dbId
    );
  const sameAuthors = (a: Edit, b: Edit): boolean => {
    const ids = new Set(a.authors.map((p) => p.dbId));
    return (
      ids.size === new Set(b.authors.map((p) => p.dbId)).size &&
      b.authors.every((p) => ids.has(p.dbId))
    );
  };
  const rows: { date: string; kinds: Set<string>; authors: Map<number, string> }[] = [];
  kept.forEach((edit, i) => {
    const before = kept[i - 1];
    const row = rows.at(-1);
    if (
      row &&
      before?.date === edit.date &&
      (before.kind === edit.kind || sameAuthors(before, edit))
    ) {
      row.kinds.add(edit.kind);
      for (const a of edit.authors) row.authors.set(a.dbId, a.name);
    } else {
      rows.push({
        date: edit.date,
        kinds: new Set([edit.kind]),
        authors: new Map(edit.authors.map((a) => [a.dbId, a.name])),
      });
    }
  });
  return rows.map((row) => ({
    date: row.date,
    kinds: KINDS.filter((k) => row.kinds.has(k)),
    authors: [...row.authors.entries()].sort(([a], [b]) => a - b).map(([, name]) => name),
  }));
}

/**
 * The cover's names: every author of the edits of the events held, each name once (as
 * event-pdf removes duplicates, by name), sorted by code units, case and all.
 */
export function coverNames(edits: Iterable<readonly Edit[]>): string[] {
  const names = new Set<string>();
  for (const list of edits) for (const e of list) for (const a of e.authors) names.add(a.name);
  return [...names].sort(byCodeUnits);
}

/**
 * A summation's HTML, as the website shows it (Angular's default sanitiser, through which
 * its pages render summations, keeps text formatting, lists and tables): those tags, and
 * links to web addresses only. Scripts, styles, images and event handlers go; any other
 * tag keeps its text; a link that is relative, or to a place in the page, keeps its text
 * and loses its address, which in a PDF would point nowhere or at a section's anchor.
 */
export function sanitiseSummation(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      ...['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'sub', 'sup', 'span'],
      ...['ul', 'ol', 'li', 'a'],
      ...['table', 'caption', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td'],
    ],
    allowedAttributes: { a: ['href'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'] },
    allowedSchemes: ['http', 'https'],
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: /^https?:\/\//i.test(attribs['href'] ?? '') ? { href: attribs['href'] ?? '' } : {},
      }),
    },
    disallowedTagsMode: 'discard',
  });
}
