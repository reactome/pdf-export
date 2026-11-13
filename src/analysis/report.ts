// The report's analysis client (spec 002 T005, research R1, contracts/analysis-api.md): the
// check of the token, then the calls a report makes, in order, each answer checked into its
// type. The check is call 1, `/resources`, with a short timeout: its 404 is
// `unknown-token`, its 410 `gone-token`, anything else or no answer `unavailable`. The
// report's resource is decided from it. Then call 2, the result filtered as the report asks;
// call 3, the result unfiltered, only when the report filters; call 4, the found elements
// of call 2's pathways, only when there are some; and call 5, the identifiers not found.
// After the check, a 404 from any call is `unknown-token` (none found is never a 404 here:
// call 4 posts only pathways call 2 gave), and a 410 `gone-token`: the result went since.
import { AnalysisError } from './error.ts';
import { canonicalToken } from './token.ts';
import { causeCode, isNumbers, isRecord, isStrings } from '../unknown.ts';

/** How long the check may take (contracts/analysis-api.md). */
export const CHECK_TIMEOUT_MS = 5_000;

const JSON_TYPE = 'application/json';

/** A resource of the result, with its pathways found, and those left by the filters. */
export interface ResourceCount {
  resource: string;
  pathways: number;
  filtered: number;
}

/** The check's answer: the token as sent, and the result's resources (call 1). */
export interface TokenCheck {
  token: string;
  resources: ResourceCount[];
}

/** The analysis's summary, as call 2 gives it. */
export interface ResultSummary {
  token: string;
  type: string;
  projection: boolean;
  interactors: boolean;
  includeDisease: boolean;
  sampleName?: string;
  fileName?: string;
  /** The species compared with, by database id, in a species comparison. */
  species?: number;
  /** ReactomeGSA's method, for a ReactomeGSA result. */
  gsaMethod?: string;
}

/** A pathway's counts for one resource, or for all of them (`TOTAL`). */
export interface Counts {
  resource: string;
  total: number;
  found: number;
  ratio: number;
}

export interface EntityCounts extends Counts {
  pValue: number;
  fdr: number;
  /** The expression columns' values, averaged; empty for other analyses. */
  exp: number[];
}

/** A pathway of the result, with its statistics under the request's filters. */
export interface ResultPathway {
  stId: string;
  dbId: number;
  name: string;
  species: { dbId: number; taxId: string; name: string };
  inDisease: boolean;
  entities: EntityCounts;
  reactions: Counts;
}

/** The result, as `GET /token/{token}` gives it with no page (calls 2 and 3). */
export interface AnalysisResult {
  summary: ResultSummary;
  columnNames: string[];
  identifiersNotFound: number;
  pathwaysFound: number;
  pathways: ResultPathway[];
  resourceSummary: ResourceCount[];
}

/** A resource and the identifiers in it. */
export interface IdentifierMap {
  resource: string;
  ids: string[];
}

/** A submitted identifier found on a pathway, with what it maps to per resource. */
export interface FoundEntity {
  id: string;
  exp: number[];
  mapsTo: IdentifierMap[];
}

/** A submitted identifier found as an interactor of a pathway's entity. */
export interface FoundInteractor {
  id: string;
  exp: number[];
  mapsTo: string[];
  interactsWith: IdentifierMap;
}

/** A pathway's found elements, as call 4 gives them, named as it was posted. */
export interface PathwayFound {
  pathway: string;
  entities: FoundEntity[];
  interactors: FoundInteractor[];
}

/** An identifier not found, with its values (call 5). */
export interface NotFound {
  id: string;
  exp: number[];
}

/** What the report asks for. */
export interface ReportFilter {
  /** As requested; undefined for the default, `TOTAL`. */
  resource?: string | undefined;
  importableOnly: boolean;
}

/** The report's analysis: each call's answer, checked. */
export interface ReportAnalysis {
  /** The resource the report is for, decided from the check (call 1). */
  resource: string;
  importableOnly: boolean;
  resources: ResourceCount[];
  /** Call 2: filtered by the report's resource and importable-only setting. */
  result: AnalysisResult;
  /** Call 3: the result unfiltered, when the report filters; otherwise call 2 is it. */
  unfiltered: AnalysisResult;
  /** Call 4: call 2's pathways' found elements, in call 2's order; empty with none. */
  found: PathwayFound[];
  /** Call 5: as the service gives it, unsorted and with repeats. */
  notFound: NotFound[];
}

export interface ReportClientOptions {
  /** How long one call after the check may take. */
  timeoutMs?: number;
  /** The caller's own end, across every call: the report's time budget. */
  signal?: AbortSignal;
}

/**
 * The report's resource (research R1): the one asked for if the result holds it, compared
 * case and all as today's report compares it; otherwise the result's default, the only
 * resource besides `TOTAL` when it holds just one, else `TOTAL`.
 */
export function reportResource(
  requested: string | undefined,
  resources: readonly ResourceCount[]
): string {
  const asked = requested ?? 'TOTAL';
  if (asked === 'TOTAL' || resources.some((r) => r.resource === asked)) return asked;
  const others = resources.filter((r) => r.resource !== 'TOTAL');
  return others.length === 1 && others[0] ? others[0].resource : 'TOTAL';
}

/** A call's options: where it goes, how long it may take, and the caller's end. */
interface Call {
  root: string;
  timeoutMs: number;
  signal: AbortSignal | undefined;
}

/**
 * One call's answer as JSON, `what` naming it in errors: a 404 is `unknown-token`, a 410
 * `gone-token`, and any other failure, no answer, or a body that is not JSON `unavailable`.
 */
async function call(
  { root, timeoutMs, signal }: Call,
  what: string,
  path: string,
  post?: string
): Promise<unknown> {
  const timeout = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await fetch(new URL(path, root), {
      method: post === undefined ? 'GET' : 'POST',
      headers:
        post === undefined
          ? { Accept: JSON_TYPE }
          : { Accept: JSON_TYPE, 'Content-Type': 'text/plain' },
      ...(post === undefined ? {} : { body: post }),
      // a redirect is the service failing, and the token is never sent on elsewhere
      redirect: 'error',
      signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
    });
  } catch (error) {
    // the caller's own end is its own, not the analysis service failing
    if (signal?.aborted) throw signal.reason;
    throw new AnalysisError('unavailable', `${what}: no answer (${reason(error)})`);
  }
  if (!response.ok) {
    await response.body?.cancel();
    const failure =
      response.status === 404
        ? 'unknown-token'
        : response.status === 410
          ? 'gone-token'
          : 'unavailable';
    throw new AnalysisError(
      failure,
      `${what}: the analysis service answered ${String(response.status)}`
    );
  }
  try {
    const json: unknown = await response.json();
    return json;
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    throw new AnalysisError(
      'unavailable',
      `${what}: the answer could not be read (${reason(error)})`
    );
  }
}

/** An answer read by `read`, which throws on one that does not fit: then `unavailable`. */
function checked<T>(what: string, json: unknown, read: (json: unknown) => T): T {
  try {
    return read(json);
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    throw new AnalysisError('unavailable', `${what}: not the answer expected (${why})`);
  }
}

function rootOf(base: string): string {
  return base.endsWith('/') ? base : `${base}/`;
}

/**
 * The check (call 1), made on every request for a report: the token's form first (a
 * malformed one `unknown-token`, nothing sent), then the result's resources, within
 * `timeoutMs` (5 s by default).
 */
export async function checkToken(
  base: string,
  token: string,
  { timeoutMs = CHECK_TIMEOUT_MS, signal }: ReportClientOptions = {}
): Promise<TokenCheck> {
  const canonical = canonicalToken(token);
  const what = 'The resources';
  const json = await call(
    { root: rootOf(base), timeoutMs, signal },
    what,
    `token/${canonical}/resources`
  );
  return { token: canonical, resources: checked(what, json, resourceCounts) };
}

/**
 * The report's analysis, after the check: calls 2 to 5, in order, for the resource decided
 * from the check's resources.
 */
export async function readReportAnalysis(
  base: string,
  check: TokenCheck,
  filter: ReportFilter,
  { timeoutMs = 60_000, signal }: ReportClientOptions = {}
): Promise<ReportAnalysis> {
  const options: Call = { root: rootOf(base), timeoutMs, signal };
  const { token, resources } = check;
  const resource = reportResource(filter.resource, resources);
  const { importableOnly } = filter;

  /** Call 2 or 3: every pathway, every species, disease pathways included. */
  const read = async (what: string, r: string, b: boolean): Promise<AnalysisResult> => {
    const query = new URLSearchParams({
      resource: r,
      importableOnly: String(b),
      includeDisease: 'true',
    });
    return checked(what, await call(options, what, `token/${token}?${query.toString()}`), result);
  };

  const filtered = await read('The result', resource, importableOnly);
  const unfiltered =
    resource !== 'TOTAL' || importableOnly
      ? await read('The result unfiltered', 'TOTAL', false)
      : filtered;

  const ids = filtered.pathways.map((p) => p.stId);
  let found: PathwayFound[] = [];
  // the service cannot take an empty body: with no pathway, nothing is asked
  if (ids.length > 0) {
    const what = 'The found elements';
    const json = await call(
      options,
      what,
      `token/${token}/found/all?resource=TOTAL`,
      `${ids.join('\n')}\n`
    );
    found = checked(what, json, foundElements);
  }

  const what = 'The identifiers not found';
  const notFound = checked(
    what,
    await call(options, what, `token/${token}/notFound`),
    identifiersNotFound
  );

  return { resource, importableOnly, resources, result: filtered, unfiltered, found, notFound };
}

// The answers' readers: each throws on anything that does not fit, naming the field, never
// a value (a value may be a submitted identifier).

function record(value: unknown, what: string): Readonly<Record<string, unknown>> {
  if (!isRecord(value) || Array.isArray(value)) throw new Error(`${what} is not an object`);
  return value;
}

function list(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${what} is not a list`);
  return value;
}

function text(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new Error(`${what} is not text`);
  return value;
}

function number(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${what} is not a number`);
  }
  return value;
}

function flag(value: unknown, what: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${what} is not a flag`);
  return value;
}

/** Values the service leaves out when it has none (it writes no nulls): empty then. */
function values(value: unknown, what: string): number[] {
  if (value === undefined) return [];
  if (!isNumbers(value)) throw new Error(`${what} is not a list of numbers`);
  return value;
}

function strings(value: unknown, what: string): string[] {
  if (!isStrings(value)) throw new Error(`${what} is not a list of text`);
  return value;
}

/** An optional field: absent (the service writes no nulls), or read by `read`. */
function optional<T>(value: unknown, read: (value: unknown) => T): T | undefined {
  return value === undefined ? undefined : read(value);
}

export function resourceCounts(json: unknown): ResourceCount[] {
  return list(json, 'the resources').map((item) => {
    const r = record(item, 'a resource');
    return {
      resource: text(r['resource'], 'a resource'),
      pathways: number(r['pathways'], "a resource's pathways"),
      filtered: number(r['filtered'], "a resource's filtered pathways"),
    };
  });
}

function counts(value: unknown, what: string): Counts {
  const c = record(value, what);
  return {
    resource: text(c['resource'], `${what}' resource`),
    total: number(c['total'], `${what}' total`),
    found: number(c['found'], `${what}' found`),
    ratio: number(c['ratio'], `${what}' ratio`),
  };
}

function pathway(item: unknown): ResultPathway {
  const p = record(item, 'a pathway');
  const species = record(p['species'], "a pathway's species");
  const entities = record(p['entities'], "a pathway's entities");
  return {
    stId: text(p['stId'], "a pathway's stId"),
    dbId: number(p['dbId'], "a pathway's dbId"),
    name: text(p['name'], "a pathway's name"),
    species: {
      dbId: number(species['dbId'], "a pathway's species' dbId"),
      taxId: text(species['taxId'], "a pathway's species' taxId"),
      name: text(species['name'], "a pathway's species' name"),
    },
    inDisease: flag(p['inDisease'], "a pathway's inDisease"),
    entities: {
      ...counts(entities, "a pathway's entities"),
      pValue: number(entities['pValue'], "a pathway's p-value"),
      fdr: number(entities['fdr'], "a pathway's FDR"),
      exp: values(entities['exp'], "a pathway's values"),
    },
    reactions: counts(p['reactions'], "a pathway's reactions"),
  };
}

export function result(json: unknown): AnalysisResult {
  const r = record(json, 'the result');
  const s = record(r['summary'], 'the summary');
  const sampleName = optional(s['sampleName'], (v) => text(v, 'the sample name'));
  const fileName = optional(s['fileName'], (v) => text(v, 'the file name'));
  const species = optional(s['species'], (v) => number(v, 'the species compared with'));
  const gsaMethod = optional(s['gsaMethod'], (v) => text(v, "ReactomeGSA's method"));
  const expression = optional(r['expression'], (v) => record(v, 'the expression'));
  return {
    summary: {
      token: text(s['token'], 'the token'),
      type: text(s['type'], 'the type'),
      projection: flag(s['projection'], 'the projection'),
      interactors: flag(s['interactors'], 'the interactors'),
      includeDisease: flag(s['includeDisease'], 'includeDisease'),
      ...(sampleName === undefined ? {} : { sampleName }),
      ...(fileName === undefined ? {} : { fileName }),
      ...(species === undefined ? {} : { species }),
      ...(gsaMethod === undefined ? {} : { gsaMethod }),
    },
    columnNames:
      expression === undefined ? [] : strings(expression['columnNames'], 'the column names'),
    identifiersNotFound: number(r['identifiersNotFound'], 'identifiersNotFound'),
    pathwaysFound: number(r['pathwaysFound'], 'pathwaysFound'),
    pathways: list(r['pathways'], 'the pathways').map(pathway),
    resourceSummary: resourceCounts(r['resourceSummary']),
  };
}

function identifierMap(value: unknown, what: string): IdentifierMap {
  const m = record(value, what);
  return { resource: text(m['resource'], `${what}' resource`), ids: strings(m['ids'], what) };
}

/** A list the service leaves out when it has none: empty then. */
function items(value: unknown, what: string): unknown[] {
  return value === undefined ? [] : list(value, what);
}

export function foundElements(json: unknown): PathwayFound[] {
  return list(json, 'the found elements').map((item) => {
    const f = record(item, "a pathway's found elements");
    return {
      pathway: text(f['pathway'], "the found elements' pathway"),
      entities: items(f['entities'], 'the found entities').map((value) => {
        const e = record(value, 'a found entity');
        return {
          id: text(e['id'], "a found entity's id"),
          exp: values(e['exp'], "a found entity's values"),
          mapsTo: list(e['mapsTo'], "a found entity's mappings").map((m) =>
            identifierMap(m, "a found entity's mapping")
          ),
        };
      }),
      interactors: items(f['interactors'], 'the found interactors').map((value) => {
        const i = record(value, 'a found interactor');
        return {
          id: text(i['id'], "a found interactor's id"),
          exp: values(i['exp'], "a found interactor's values"),
          mapsTo: strings(i['mapsTo'], "a found interactor's mappings"),
          interactsWith: identifierMap(i['interactsWith'], "a found interactor's partner"),
        };
      }),
    };
  });
}

export function identifiersNotFound(json: unknown): NotFound[] {
  return list(json, 'the identifiers not found').map((item) => {
    const n = record(item, 'an identifier not found');
    return {
      id: text(n['id'], "an identifier not found's id"),
      exp: values(n['exp'], "an identifier not found's values"),
    };
  });
}

/** An error's name, and its cause's code where there is one (ECONNREFUSED, say). */
function reason(error: unknown): string {
  const name = error instanceof Error ? error.name : String(error);
  const code = causeCode(error);
  return code === undefined ? name : `${name}: ${code}`;
}
