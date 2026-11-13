// The report's edit history (spec 002 T007, research R2): today's report's rule, not spec
// 001's. One row for each date and action over all six kinds of edit, sorted by date and,
// within a date, in today's fixed order; a row's names its edits' authors in their order,
// each once, five and then "et al."; an edit with no author kept as a row with no names,
// and one with no date left out (today's report fails on it, a listed difference).
import type { Edit, EditKind } from '../graph/queries.ts';
import { byCodeUnits } from '../model/rules.ts';

/** An edit's action, as a row names it. */
export type EditAction = 'Modified' | 'Revised' | 'Edited' | 'Created' | 'Authored' | 'Reviewed';

const ACTIONS: Readonly<Record<EditKind, EditAction>> = {
  modified: 'Modified',
  revised: 'Revised',
  edited: 'Edited',
  created: 'Created',
  authored: 'Authored',
  reviewed: 'Reviewed',
};

/**
 * The actions within a date in today's order: a hash map's over its six fixed keys, filled
 * by `computeIfAbsent`, which puts a new key at the head of its bucket. Created, Authored
 * and Reviewed share one, and are added in that order, so they come out reversed (spec 002
 * T019, research R2; read from today's reports and the deployed library).
 */
export const ACTION_ORDER: readonly EditAction[] = [
  'Modified',
  'Revised',
  'Edited',
  'Reviewed',
  'Authored',
  'Created',
];

/** The names a row shows before "et al.". */
export const MAX_NAMES = 5;

export interface HistoryRow {
  /** `YYYY-MM-DD`. */
  date: string;
  action: EditAction;
  /** The first five names; a null for a person the graph gives no name, printed empty. */
  names: (string | null)[];
  /** Whether more names follow the five: printed as "et al.". */
  etAl: boolean;
}

/** One event's edit history, from its edits as the graph's `edits` query reads them. */
export function editHistory(edits: readonly Edit[]): HistoryRow[] {
  const rows = new Map<
    string,
    { date: string; action: EditAction; people: Map<number, string | null> }
  >();
  for (const edit of edits) {
    if (edit.dateTime === null) continue;
    const date = edit.dateTime.slice(0, 10);
    const action = ACTIONS[edit.kind];
    const key = `${date} ${action}`;
    const row = rows.get(key) ?? { date, action, people: new Map<number, string | null>() };
    for (const author of edit.authors) {
      if (!row.people.has(author.dbId)) row.people.set(author.dbId, author.name);
    }
    rows.set(key, row);
  }
  return [...rows.values()]
    .sort(
      (a, b) =>
        byCodeUnits(a.date, b.date) ||
        ACTION_ORDER.indexOf(a.action) - ACTION_ORDER.indexOf(b.action)
    )
    .map(({ date, action, people }) => {
      const names = [...people.values()];
      return { date, action, names: names.slice(0, MAX_NAMES), etAl: names.length > MAX_NAMES };
    });
}
