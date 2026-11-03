// The analysis client (spec 001 T020, research R6): reads an analysis's properties and what
// it found in each event from the analysis service's API, under FR-006's defaults (all
// resources together, no expression column, all identifiers rather than importable ones).
// The summary is read first and the found identifiers' CSV last, after every `found/…`
// call: a `found/…` 404 means none found, but also comes when the result has gone since,
// and the CSV's 404 or 410 then ends the PDF instead of it reading as none found.
import type { AnalysisProperties, Found, FoundRow } from '../model/types.ts';
import { AnalysisError } from './error.ts';
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

interface Summary {
  summary: { token: string; type: string; projection: boolean; interactors: boolean };
  identifiersNotFound: number;
  pathwaysFound: number;
}

interface FoundEntities {
  identifiers: { id: string; mapsTo: { resource: string; ids: string[] }[] }[];
}

interface FoundInteractors {
  identifiers: { id: string; interactsWith: { resource: string; ids: string[] } }[];
}

export async function readAnalysis(
  base: string,
  request: AnalysisRequest,
  { timeoutMs = 60_000 }: ClientOptions = {}
): Promise<Analysis> {
  const root = base.endsWith('/') ? base : `${base}/`;
  const token = canonicalToken(request.token);

  /** One call's answer, `what` naming it in errors; `null` for a 404. */
  async function get(what: string, path: string, accept: string): Promise<Response | null> {
    let response: Response;
    try {
      response = await fetch(new URL(path, root), {
        headers: { Accept: accept },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
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
  const unknown = (what: string) =>
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
      const json = await body(what, response, (r) => r.json());
      found[kind] = kind === 'entities' ? entityRows(json) : interactorRows(json);
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
  const keep = (rows: readonly FoundRow[]) =>
    rows
      .map((row) => ({ ...row, mapsTo: row.mapsTo.filter((id) => own.has(id)) }))
      .filter((row) => row.mapsTo.length > 0);
  return { entities: keep(found.entities), interactors: keep(found.interactors) };
}

function checkSummary(json: unknown): Summary {
  const answer = json as Partial<Summary> | null;
  const summary = answer?.summary;
  if (
    typeof answer?.identifiersNotFound !== 'number' ||
    typeof answer.pathwaysFound !== 'number' ||
    typeof summary?.token !== 'string' ||
    typeof summary.type !== 'string' ||
    typeof summary.projection !== 'boolean' ||
    typeof summary.interactors !== 'boolean'
  ) {
    throw new Error('not the summary');
  }
  return answer as Summary;
}

/** A row per identifier and resource it maps to in. */
function entityRows(json: unknown): FoundRow[] {
  const { identifiers } = json as FoundEntities;
  return identifiers.flatMap((identifier) =>
    identifier.mapsTo.map((to) => ({
      identifier: identifier.id,
      mapsTo: to.ids,
      resource: to.resource,
    }))
  );
}

/** A row per interactor: the event's identifiers it interacts with, and their resource. */
function interactorRows(json: unknown): FoundRow[] {
  const { identifiers } = json as FoundInteractors;
  return identifiers.map((identifier) => ({
    identifier: identifier.id,
    mapsTo: identifier.interactsWith.ids,
    resource: identifier.interactsWith.resource,
  }));
}

/** An error's name, and its cause's code where there is one (ECONNREFUSED, say). */
function reason(error: unknown): string {
  const name = error instanceof Error ? error.name : String(error);
  const cause =
    error instanceof Error ? (error.cause as { code?: unknown } | undefined) : undefined;
  return typeof cause?.code === 'string' ? `${name}: ${cause.code}` : name;
}
