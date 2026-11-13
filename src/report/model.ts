// The report model (spec 002 T006, data-model.md): what a report shows, before any layout,
// from the request's parameters, the species the graph resolves, and the analysis's answers
// (src/analysis/report.ts). The identifiers found are gathered as today's report gathers
// them (research R1): per resource, the pathways read in the result's order, an identifier
// taken from the first pathway holding it, never a union.
import type {
  FoundEntity,
  FoundInteractor,
  NotFound,
  PathwayFound,
  ReportAnalysis,
  ResultPathway,
} from '../analysis/report.ts';
import type { SpeciesRef } from '../graph/queries.ts';

/** The pathways a report shows by default, and the most and fewest it shows. */
export const DEFAULT_NUMBER = 25;
export const MOST = 50;
export const FEWEST = 1;

/** The report's query parameters, read as today's service reads them. */
export interface ReportParameters {
  /** Clamped to 1–50. */
  number: number;
  /** As given; undefined for the default, `TOTAL`. The analysis decides what it becomes. */
  resource: string | undefined;
  importableOnly: boolean;
}

/** A number or flag that is not one: today's framework answers it 400 (research R5). */
export interface ParameterError {
  invalid: 'number' | 'importableOnly';
}

/**
 * The query, read as today's service reads it (research R5, the deployed controller): an
 * absent or empty value is the default; `number` a whole number (whitespace anywhere
 * removed, hexadecimal as `0x`, `0X` or `#`, within a Java `int`) clamped to 1–50;
 * `importableOnly` true for `true`, `on`, `yes` or `1` and false for `false`, `off`, `no`
 * or `0`, in any case and trimmed. Anything else is a `ParameterError`. Given twice, the
 * first value is read, and a resource given twice is its values joined by commas, as the
 * framework converts them (read from its source, not measured). The profiles are ignored.
 */
export function reportParameters(query: URLSearchParams): ReportParameters | ParameterError {
  const [numberText] = query.getAll('number');
  const [flagText] = query.getAll('importableOnly');
  const resources = query.getAll('resource');

  let number = DEFAULT_NUMBER;
  if (numberText !== undefined && numberText !== '') {
    const parsed = javaInt(numberText);
    if (parsed === null) return { invalid: 'number' };
    number = Math.max(FEWEST, Math.min(MOST, parsed));
  }

  let importableOnly = false;
  if (flagText !== undefined && flagText !== '') {
    const parsed = javaBoolean(flagText);
    if (parsed === null) return { invalid: 'importableOnly' };
    importableOnly = parsed;
  }

  const resource =
    resources.length === 0 || (resources.length === 1 && resources[0] === '')
      ? undefined
      : resources.join(',');
  return { number, resource, importableOnly };
}

/** Spring's reading of an `Integer`: null for what it refuses. */
function javaInt(text: string): number | null {
  const trimmed = text.replace(/\s/g, '');
  const hex = /^(-?)(?:0x|0X|#)([0-9a-fA-F]+)$/.exec(trimmed);
  let value: number;
  if (hex) value = Number.parseInt(`${hex[1] ?? ''}${hex[2] ?? ''}`, 16);
  else if (/^[+-]?[0-9]+$/.test(trimmed)) value = Number.parseInt(trimmed, 10);
  else return null;
  return value >= -2_147_483_648 && value <= 2_147_483_647 ? value : null;
}

/**
 * Spring's reading of a `Boolean`. A value of spaces alone is no value there, which
 * today's report then fails on; here it is the default.
 */
function javaBoolean(text: string): boolean | null {
  const value = text.trim().toLowerCase();
  if (value === '') return false;
  if (['true', 'on', 'yes', '1'].includes(value)) return true;
  if (['false', 'off', 'no', '0'].includes(value)) return false;
  return null;
}

/** A found identifier on one resource's table: what it maps to there, and its values. */
export interface FoundRow {
  id: string;
  exp: number[];
  mapsTo: string[];
}

/** An interactor on one resource's table: what it is, its values, what it interacts with. */
export interface InteractorRow {
  id: string;
  exp: number[];
  /** The interactor's own accessions. */
  mapsTo: string[];
  /** The pathway's entities it interacts with, in the table's resource. */
  interactsWith: string[];
}

/** One resource's table: its rows, by the order the caller says. */
export interface ResourceTable<R> {
  resource: string;
  rows: R[];
}

/** One of the reported pathways: the analysis's statistics, and what it found per resource. */
export interface ReportedPathway {
  stId: string;
  dbId: number;
  name: string;
  statistics: {
    entities: { found: number; total: number; ratio: number; pValue: number; fdr: number };
    /** The reactions' columns, unfiltered as today's report shows them (call 3 when made). */
    reactions: { found: number; total: number; ratio: number };
    /** The averaged expression values, one per column. */
    exp: number[];
  };
  /** Its found entities, one table per resource the report is for, in that order. */
  entities: ResourceTable<FoundRow>[];
  /** Its found interactors, by the resource they interact through, likewise. */
  interactors: ResourceTable<InteractorRow>[];
}

/** One resource's identifiers found, over every pathway of the result. */
export interface FoundIdentifiers {
  resource: string;
  /** Sorted by identifier, each from the first pathway in the result's order holding it. */
  rows: FoundRow[];
  /** The Reactome entities they map to: the union of every pathway's mapped accessions. */
  entities: number;
}

/** One resource's interactors found, over every pathway, gathered as the entities are. */
export interface FoundInteractors {
  resource: string;
  rows: InteractorRow[];
}

/** The analysis's summary, as the report shows it. */
export interface ReportSummary {
  /** The cover's and the PDF's title: the sample's, file's, compared species', type's or token's. */
  name: string;
  type: string;
  gsaMethod: string | null;
  projection: boolean;
  interactors: boolean;
  /** The species compared with, in a species comparison. */
  comparedWith: SpeciesRef | null;
}

export interface ReportModel {
  token: string;
  species: SpeciesRef;
  number: number;
  /** The resource the report is for, decided from the result's resources. */
  resource: string;
  /** Acts only with `TOTAL`: false with any other resource. */
  importableOnly: boolean;
  summary: ReportSummary;
  /** The expression columns' names; empty for other analyses. */
  columns: string[];
  /** The distinct identifiers of the entities found, in every resource and species. */
  identifiersFound: number;
  /** Those found and those not found. */
  identifiersTotal: number;
  /** The result's pathways after its filters, in every species. */
  pathwaysHit: number;
  /** The resources the report's tables are for, in the result's order. */
  resources: string[];
  pathways: ReportedPathway[];
  found: FoundIdentifiers[];
  foundInteractors: FoundInteractors[];
  /** Sorted by identifier, without repeats. */
  notFound: NotFound[];
}

/**
 * The report's model, from the analysis's answers: the first `number` of the result's
 * pathways in the report's species, and the identifiers found and not found.
 * `comparedWith` is the species a species comparison compares with, from the graph.
 */
export function buildReport(
  analysis: ReportAnalysis,
  species: SpeciesRef,
  number: number,
  comparedWith: SpeciesRef | null
): ReportModel {
  const { result, unfiltered, found, resource } = analysis;
  const resources =
    resource === 'TOTAL'
      ? analysis.resources.map((r) => r.resource).filter((r) => r !== 'TOTAL')
      : [resource];
  const foundBy = new Map<string, PathwayFound>();
  for (const f of found) if (!foundBy.has(f.pathway)) foundBy.set(f.pathway, f);
  const reactionsBy = new Map(unfiltered.pathways.map((p) => [p.stId, p.reactions]));
  // the result's pathways in call 2's order, with their found elements
  const inOrder = result.pathways.flatMap((p) => {
    const f = foundBy.get(p.stId);
    return f ? [f] : [];
  });

  const reported = result.pathways
    .filter((p) => p.species.dbId === species.dbId)
    .slice(0, number)
    .map((p) => reportedPathway(p, foundBy.get(p.stId), reactionsBy.get(p.stId), resources));

  const identifiers = new Set(inOrder.flatMap((f) => f.entities.map((e) => e.id)));
  return {
    token: result.summary.token,
    species,
    number,
    resource,
    importableOnly: resource === 'TOTAL' && analysis.importableOnly,
    summary: {
      name: reportName(analysis, comparedWith),
      type: result.summary.type,
      gsaMethod: result.summary.gsaMethod ?? null,
      projection: result.summary.projection,
      interactors: result.summary.interactors,
      comparedWith,
    },
    columns: result.columnNames,
    identifiersFound: identifiers.size,
    identifiersTotal: identifiers.size + result.identifiersNotFound,
    pathwaysHit: result.pathwaysFound,
    resources,
    pathways: reported,
    found: resources.map((r) => foundIdentifiers(inOrder, r)),
    foundInteractors: resources.map((r) => ({
      resource: r,
      rows: firstOfEach(inOrder.flatMap((f) => interactorRows(f.interactors, r))),
    })),
    notFound: notFoundSorted(analysis.notFound),
  };
}

/**
 * The report's name, the first there is of: the sample's name, the file's, the species
 * compared with, the analysis's type, its token.
 */
export function reportName(analysis: ReportAnalysis, comparedWith: SpeciesRef | null): string {
  const { summary } = analysis.result;
  const names = [summary.sampleName, summary.fileName, comparedWith?.name, summary.type];
  return names.find((n) => n !== undefined && n !== '') ?? summary.token;
}

function reportedPathway(
  p: ResultPathway,
  found: PathwayFound | undefined,
  reactions: ResultPathway['reactions'] | undefined,
  resources: readonly string[]
): ReportedPathway {
  const r = reactions ?? p.reactions;
  return {
    stId: p.stId,
    dbId: p.dbId,
    name: p.name,
    statistics: {
      entities: {
        found: p.entities.found,
        total: p.entities.total,
        ratio: p.entities.ratio,
        pValue: p.entities.pValue,
        fdr: p.entities.fdr,
      },
      reactions: { found: r.found, total: r.total, ratio: r.ratio },
      exp: p.entities.exp,
    },
    entities: resources.map((resource) => ({
      resource,
      rows: entityRows(found?.entities ?? [], resource),
    })),
    interactors: resources.map((resource) => ({
      resource,
      rows: interactorRows(found?.interactors ?? [], resource),
    })),
  };
}

/** The entities mapping in `resource`, each with what it maps to there. */
function entityRows(entities: readonly FoundEntity[], resource: string): FoundRow[] {
  return entities.flatMap((e) => {
    const ids = e.mapsTo.filter((m) => m.resource === resource).flatMap((m) => m.ids);
    return ids.length === 0 ? [] : [{ id: e.id, exp: e.exp, mapsTo: ids }];
  });
}

/** The interactors interacting through `resource`. */
function interactorRows(
  interactors: readonly FoundInteractor[],
  resource: string
): InteractorRow[] {
  return interactors
    .filter((i) => i.interactsWith.resource === resource)
    .map((i) => ({ id: i.id, exp: i.exp, mapsTo: i.mapsTo, interactsWith: i.interactsWith.ids }));
}

/** Each identifier's first row, sorted by identifier as Java sorts text. */
function firstOfEach<R extends { id: string }>(rows: readonly R[]): R[] {
  const first = new Map<string, R>();
  for (const row of rows) if (!first.has(row.id)) first.set(row.id, row);
  return [...first.values()].sort((a, b) => byText(a.id, b.id));
}

function foundIdentifiers(inOrder: readonly PathwayFound[], resource: string): FoundIdentifiers {
  const all = inOrder.flatMap((f) => entityRows(f.entities, resource));
  return {
    resource,
    rows: firstOfEach(all),
    entities: new Set(all.flatMap((row) => row.mapsTo)).size,
  };
}

/** The identifiers not found, sorted by identifier, each once (its first values kept). */
function notFoundSorted(notFound: readonly NotFound[]): NotFound[] {
  return firstOfEach(notFound);
}

/** Java's `String.compareTo`: by UTF-16 code unit, as JavaScript compares text. */
function byText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
