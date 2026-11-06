// The analysis client (spec 001 T020, research R6): reads an analysis's properties and what
// it found in each event from the analysis service's API, under FR-006's defaults (all
// resources together, no expression column, all identifiers rather than importable ones).
// The summary is read first and the found identifiers' CSV last, after every `found/…`
// call: a `found/…` 404 means none found, but also comes when the result has gone since,
// and the CSV's 404 or 410 then ends the PDF instead of it reading as none found.
import type { AnalysisProperties, Found, FoundRow } from '../model/types.ts';
import { AnalysisError } from './error.ts';
import { causeCode, isRecord, isStrings } from '../unknown.ts';
import { canonicalToken } from './token.ts';

export { AnalysisError, type AnalysisFailure } from './error.ts';

/** An event whose found lists the PDF shows. */
export type AnalysedEvent =
  | { kind: 'pathway'; stId: string }
  /** A reaction's are its first parent pathway's, filtered to its own identifiers. */
  | { kind: 'reaction'; stId: string; parent: string; identifiers: readonly string[] };

export interface AnalysisRequest {
  /** The token as the user gave it; the canonical one is sent. */
  token: string;
  /** The overlay's species, the event's (FR-006): shown, never sent to the service. */
  species: string;
  events: readonly AnalysedEvent[];
}

export interface Analysis {
  properties: AnalysisProperties;
  /** What the analysis found, by event's stable identifier. */
  found: Map<string, Found>;
}

export interface ClientOptions {
  /** How long one request may take. */
  timeoutMs?: number;
  /** The caller's own end, across every call: the service's deadline for the PDF. */
  signal?: AbortSignal;
}

/**
 * The summary's query: FR-006's defaults, disease pathways included as today's book counts
 * them, and no species, which would count that species' pathways alone (research R6).
 */
const SUMMARY = 'resource=TOTAL&importableOnly=false&includeDisease=true&pageSize=1&page=1';
/** The CSV's file name: the service names the download after it, and reads nothing in it. */
const CSV_NAME = 'found.csv';
const JSON_TYPE = 'application/json';
/** The CSV endpoint answers 406 to `application/json` alone (research R6). */
const CSV_TYPE = 'text/csv, application/json';

export interface Summary {
  summary: { token: string; type: string; projection: boolean; interactors: boolean };
  identifiersNotFound: number;
  pathwaysFound: number;
}

/** A resource and its identifiers, as the found lists give them. */
interface IdMap {
  resource: string;
  ids: string[];
}

/** An identifier of `found/entities`, and what it maps to in each resource. */
interface FoundEntity {
  id: string;
  mapsTo: IdMap[];
}

/** An identifier of `found/interactors`, and the event's identifiers it interacts with. */
interface FoundInteractor {
  id: string;
  interactsWith: IdMap;
}

export async function readAnalysis(
  base: string,
  request: AnalysisRequest,
  { timeoutMs = 60_000, signal }: ClientOptions = {}
): Promise<Analysis> {
  const root = base.endsWith('/') ? base : `${base}/`;
  const token = canonicalToken(request.token);

  /** One call's answer, `what` naming it in errors; `null` for a 404. */
  async function get(what: string, path: string, accept: string): Promise<Response | null> {
    let response: Response;
    try {
      response = await fetch(new URL(path, root), {
        headers: { Accept: accept },
        // a redirect is the service failing, and the token is never sent on elsewhere
        redirect: 'error',
        signal: signal
          ? AbortSignal.any([AbortSignal.timeout(timeoutMs), signal])
          : AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      // the caller's own end is its own, not the analysis service failing
      if (signal?.aborted) throw signal.reason;
      throw new AnalysisError('unavailable', `${what}: no answer (${reason(error)})`);
    }
    if (response.ok) return response;
    await response.body?.cancel();
    if (response.status === 404) return null;
    const failure = response.status === 410 ? 'gone-token' : 'unavailable';
    throw new AnalysisError(
      failure,
      `${what}: the analysis service answered ${String(response.status)}`
    );
  }

  /** A 404 where none found is not an answer: the token names no result. */
  const unknown = (what: string): AnalysisError =>
    new AnalysisError('unknown-token', `${what}: the analysis service answered 404`);

  /** The answer's body: one that cannot be read is the service failing. */
  async function body<T>(
    what: string,
    response: Response,
    read: (r: Response) => Promise<T>
  ): Promise<T> {
    try {
      return await read(response);
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      throw new AnalysisError(
        'unavailable',
        `${what}: the answer could not be read (${reason(error)})`
      );
    }
  }

  const summaryResponse = await get('The summary', `token/${token}?${SUMMARY}`, JSON_TYPE);
  if (!summaryResponse) throw unknown('The summary');
  const summary = await body('The summary', summaryResponse, async (r) =>
    checkSummary(await r.json())
  );

  // Each pathway's lists once, however many events read them
  const byPathway = new Map<string, Found>();
  for (const event of request.events) {
    const pathway = event.kind === 'reaction' ? event.parent : event.stId;
    if (byPathway.has(pathway)) continue;
    const found: Found = { entities: [], interactors: [] };
    for (const kind of ['entities', 'interactors'] as const) {
      const what = `The found ${kind} of ${pathway}`;
      const path = `token/${token}/found/${kind}/${encodeURIComponent(pathway)}?resource=TOTAL`;
      // a 404 is none found, or the result gone since: the CSV, read last, tells them apart
      const response = await get(what, path, JSON_TYPE);
      if (!response) continue;
      found[kind] = await body(what, response, async (r) =>
        kind === 'entities' ? entityRows(await r.json()) : interactorRows(await r.json())
      );
    }
    byPathway.set(pathway, found);
  }

  const csv = await get(
    'The found identifiers',
    `download/${token}/entities/found/TOTAL/${CSV_NAME}`,
    CSV_TYPE
  );
  if (!csv) throw unknown('The found identifiers');
  const identifiersFound = submittedIdentifiers(
    await body('The found identifiers', csv, (r) => r.text())
  );

  const found = new Map<string, Found>();
  for (const event of request.events) {
    const pathway = byPathway.get(event.kind === 'reaction' ? event.parent : event.stId);
    if (!pathway) continue;
    found.set(
      event.stId,
      event.kind === 'reaction' ? filterFound(pathway, event.identifiers) : pathway
    );
  }

  return {
    properties: {
      token: summary.summary.token,
      type: summary.summary.type,
      species: request.species,
      projection: summary.summary.projection,
      interactors: summary.summary.interactors,
      identifiersFound,
      identifiersTotal: identifiersFound + summary.identifiersNotFound,
      pathwaysHit: summary.pathwaysFound,
    },
    found,
  };
}

/**
 * The count of identifiers found: the CSV's distinct submitted identifiers, its first
 * column, the header skipped. One submitted identifier mapping to two is on two rows, so
 * its rows are not counted. Its values are not quoted (research R6).
 */
export function submittedIdentifiers(csv: string): number {
  const ids = new Set<string>();
  for (const line of csv.split(/\r?\n/).slice(1)) {
    if (line === '') continue;
    ids.add(line.split(',')[0] ?? '');
  }
  return ids.size;
}

/**
 * A reaction's share of its parent pathway's found lists: the rows naming one of its own
 * identifiers, each narrowed to those (an entity's maps-to, an interactor's interactions).
 */
export function filterFound(found: Found, identifiers: readonly string[]): Found {
  const own = new Set(identifiers);
  const keep = (rows: readonly FoundRow[]): FoundRow[] =>
    rows
      .map((row) => ({ ...row, mapsTo: row.mapsTo.filter((id) => own.has(id)) }))
      .filter((row) => row.mapsTo.length > 0);
  return { entities: keep(found.entities), interactors: keep(found.interactors) };
}

/** The summary's answer, checked: anything else is not the summary. */
export function checkSummary(json: unknown): Summary {
  const summary = isRecord(json) ? json['summary'] : undefined;
  if (!isRecord(json) || !isRecord(summary)) throw new Error('not the summary');
  const { identifiersNotFound, pathwaysFound } = json;
  const { token, type, projection, interactors } = summary;
  if (
    typeof identifiersNotFound !== 'number' ||
    typeof pathwaysFound !== 'number' ||
    typeof token !== 'string' ||
    typeof type !== 'string' ||
    typeof projection !== 'boolean' ||
    typeof interactors !== 'boolean'
  ) {
    throw new Error('not the summary');
  }
  return { summary: { token, type, projection, interactors }, identifiersNotFound, pathwaysFound };
}

/** An identifier map, a resource and its identifiers, or null for anything else. */
function idMap(value: unknown): IdMap | null {
  if (!isRecord(value)) return null;
  const { resource, ids } = value;
  return typeof resource === 'string' && isStrings(ids) ? { resource, ids } : null;
}

/**
 * A found list's identifiers, each read by `read` (null for one that is not of its kind):
 * a list with anything else in it is not the answer.
 */
function identifiersOf<T>(
  json: unknown,
  read: (identifier: Readonly<Record<string, unknown>>, id: string) => T | null
): T[] {
  const identifiers = isRecord(json) ? json['identifiers'] : undefined;
  if (!Array.isArray(identifiers)) throw new Error('not a found list');
  return identifiers.map((identifier: unknown) => {
    const id = isRecord(identifier) ? identifier['id'] : undefined;
    const found = isRecord(identifier) && typeof id === 'string' ? read(identifier, id) : null;
    if (found === null) throw new Error('not a found list');
    return found;
  });
}

/** A row per identifier and resource it maps to in. */
export function entityRows(json: unknown): FoundRow[] {
  const identifiers = identifiersOf<FoundEntity>(json, (identifier, id) => {
    const { mapsTo } = identifier;
    if (!Array.isArray(mapsTo)) return null;
    const maps = mapsTo.map(idMap);
    return maps.every((map) => map !== null) ? { id, mapsTo: maps } : null;
  });
  return identifiers.flatMap((identifier) =>
    identifier.mapsTo.map((to) => ({
      identifier: identifier.id,
      mapsTo: to.ids,
      resource: to.resource,
    }))
  );
}

/** A row per interactor: the event's identifiers it interacts with, and their resource. */
export function interactorRows(json: unknown): FoundRow[] {
  const identifiers = identifiersOf<FoundInteractor>(json, (identifier, id) => {
    const interactsWith = idMap(identifier['interactsWith']);
    return interactsWith === null ? null : { id, interactsWith };
  });
  return identifiers.map((identifier) => ({
    identifier: identifier.id,
    mapsTo: identifier.interactsWith.ids,
    resource: identifier.interactsWith.resource,
  }));
}

/** An error's name, and its cause's code where there is one (ECONNREFUSED, say). */
function reason(error: unknown): string {
  const name = error instanceof Error ? error.name : String(error);
  const code = causeCode(error);
  return code === undefined ? name : `${name}: ${code}`;
}
