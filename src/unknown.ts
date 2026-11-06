// What the code reads from outside (JSON, an HTTP body, a file, a thrown error) arrives as
// `unknown` and is checked into its type, nothing taken on trust: these are the checks
// several modules share. The graph's rows have their own, in src/graph/rows.ts.

/**
 * Whether a value is an object whose fields may be read by name: anything but null and
 * the primitives. A list is one too, its fields its items.
 */
export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object';
}

/** Whether a value is a list of strings. */
export function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** Whether a value is a list of numbers. */
export function isNumbers(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'number');
}

/**
 * An error's own `code`, where it has a string one: a system error's (`ENOENT`) as Node
 * gives it, or a library's own.
 */
export function errorCode(error: unknown): string | undefined {
  if (!isRecord(error)) return undefined;
  const code = error['code'];
  return typeof code === 'string' ? code : undefined;
}

/**
 * The code of an error's cause, where it has a string one: fetch's `TypeError` carries the
 * socket's (`ECONNREFUSED`, say) there.
 */
export function causeCode(error: unknown): string | undefined {
  return error instanceof Error ? errorCode(error.cause) : undefined;
}
