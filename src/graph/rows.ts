// A graph row's columns, checked into their types (spec 001 T013's queries): the driver
// gives each row's values as whatever the database held, so each query reads its rows
// through these, and a row that does not fit is refused, never taken on trust. An error
// names the column and the type it is not, never the value, which may be a person's name.
import { isRecord } from '../unknown.ts';

/** A row as the graph gives it, or a map within one: each value by its name, unchecked. */
export type Row = Readonly<Record<string, unknown>>;

/** A row that is not what its query returns. */
export class RowError extends Error {
  override name = 'RowError';
  constructor(column: string, what: string) {
    super(`the graph's ${column} is not ${what}`);
  }
}

/** A column's text. */
export function text(row: Row, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') throw new RowError(column, 'text');
  return value;
}

/** A column's text, or null where it has none. */
export function textOrNull(row: Row, column: string): string | null {
  const value = row[column];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new RowError(column, 'text or null');
  return value;
}

/** A column's whole number: an id, a count, an order. */
export function whole(row: Row, column: string): number {
  const value = row[column];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new RowError(column, 'a whole number');
  }
  return value;
}

/** A column's whole number, or null where it has none. */
export function wholeOrNull(row: Row, column: string): number | null {
  const value = row[column];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new RowError(column, 'a whole number or null');
  }
  return value;
}

/** A column's true or false. */
export function flag(row: Row, column: string): boolean {
  const value = row[column];
  if (typeof value !== 'boolean') throw new RowError(column, 'true or false');
  return value;
}

/** A column that is one of a few words. */
export function oneOf<const T extends string>(row: Row, column: string, words: readonly T[]): T {
  const value = row[column];
  const word = words.find((w) => w === value);
  if (word === undefined) throw new RowError(column, words.join(' or '));
  return word;
}

/** A column's list of texts. */
export function texts(row: Row, column: string): string[] {
  return list(row, column).map((item) => {
    if (typeof item !== 'string') throw new RowError(column, 'a list of texts');
    return item;
  });
}

/** A column's list of maps (a pattern comprehension's, a `collect` of maps). */
export function maps(row: Row, column: string): Row[] {
  return list(row, column).map((item) => {
    if (!isRecord(item) || Array.isArray(item)) throw new RowError(column, 'a list of maps');
    return item;
  });
}

/** A column's list, its items unchecked. */
export function list(row: Row, column: string): unknown[] {
  const value = row[column];
  if (!Array.isArray(value)) throw new RowError(column, 'a list');
  return value;
}
