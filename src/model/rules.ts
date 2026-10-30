// The parts' rules (spec 001 T015, research R2), kept as event-pdf applies them, with lists
// in the curators' order.
import sanitizeHtml from 'sanitize-html';

import type { Edit, EventRef, Named } from '../graph/queries.ts';
import type { EditRow } from './types.ts';

/** Diseases, leaving out the one named exactly "disease", as today. */
export function diseases(list: readonly Named[]): string[] {
  return list.filter((d) => d.name !== 'disease').map((d) => d.name);
}

/** What an event was inferred from, by species name, then name (the graph gives no order). */
export function inferredFrom<T extends EventRef & { speciesName: string }>(
  list: readonly T[]
): T[] {
  return [...list].sort(
    (a, b) => a.speciesName.localeCompare(b.speciesName) || a.name.localeCompare(b.name)
  );
}

/**
 * The edit history (research R2): edits with no date or no author dropped; the date as
 * YYYY-MM-DD; sorted by date, then the first author's surname; an edit sharing a date with
 * the row before and either its kind or its authors joins that row; each row's authors by
 * database id.
 */
export function editRows(edits: readonly Edit[]): EditRow[] {
  const kept = edits
    .filter((e) => e.dateTime !== null && e.authors.length > 0)
    .map((e) => ({ ...e, date: (e.dateTime ?? '').slice(0, 10) }))
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.authors[0]?.surname ?? '').localeCompare(b.authors[0]?.surname ?? '')
    );
  const rows: { date: string; kinds: Set<string>; authors: Map<number, string> }[] = [];
  for (const edit of kept) {
    const last = rows.at(-1);
    const ids = edit.authors.map((a) => a.dbId).sort((a, b) => a - b);
    const sameAuthors =
      last !== undefined &&
      ids.length === last.authors.size &&
      ids.every((id) => last.authors.has(id));
    if (last?.date === edit.date && (last.kinds.has(edit.kind) || sameAuthors)) {
      last.kinds.add(edit.kind);
      for (const a of edit.authors) last.authors.set(a.dbId, a.name);
    } else {
      rows.push({
        date: edit.date,
        kinds: new Set([edit.kind]),
        authors: new Map(edit.authors.map((a) => [a.dbId, a.name])),
      });
    }
  }
  return rows.map((row) => ({
    date: row.date,
    kinds: [...row.kinds],
    authors: [...row.authors.entries()].sort(([a], [b]) => a - b).map(([, name]) => name),
  }));
}

/** The cover's names: every author of the edits of the events held, sorted, each once. */
export function coverNames(edits: Iterable<readonly Edit[]>): string[] {
  const names = new Map<number, string>();
  for (const list of edits)
    for (const e of list) for (const a of e.authors) names.set(a.dbId, a.name);
  return [...names.values()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * A summation's HTML, as a page may show it: text formatting, lists and links to web
 * addresses only. Scripts, images, styles and event handlers go, and any other tag keeps
 * its text.
 */
export function sanitiseSummation(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'sub', 'sup', 'ul', 'ol', 'li', 'a'],
    allowedAttributes: { a: ['href'] },
    allowedSchemes: ['http', 'https'],
    disallowedTagsMode: 'discard',
  });
}
