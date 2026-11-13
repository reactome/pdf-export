// The analysis stub (spec 001 T010, extended by spec 002 T004): the analysis service's
// answers, on loopback, for analyses of made-up identifiers on the fixture's pathways.
//
// It reads a token by the service's own rules: URL-decoded until it no longer changes,
// Base64-decoded, a stored result answered whatever the token's age, and a missing one 410
// while its date is within 7 days (or in the future) and 404 otherwise. Its other answers
// are the service's: the catch-all 500, the servlet container's HTML 400 for an encoded
// `/`, the framework's 404, 405, 406 and 415, a `found/…` 404 for none found, and the found
// identifiers' CSV.
//
// Spec 001's analyses (T009's cases, research R6) are read only at FR-006's defaults. The
// report's (spec 002 research R1 and R8) answer the report's five calls
// (contracts/analysis-api.md) as the analysis service's code does: the resources; the
// result filtered by its resource and importable-only setting and sorted by the entities'
// p-value (a stable sort), every species, with the stored analysis's own disease setting
// when the request names none; the found elements of the pathways posted, in the order
// posted and with repeats; and the identifiers not found, unpaged and with repeats.
//
// Like the render stub, it answers 400 to a query parameter pdf-export never sends, one
// given twice, or a value pdf-export never sends (for a report, a resource the result does
// not hold, compared case and all), so a client getting one wrong fails a test instead of
// passing silently; the service itself ignores unknown parameters and answers 200 with
// empty statistics for a resource it does not hold.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

const BASE = '/AnalysisService';
const DAY = 24 * 60 * 60 * 1000;

/** `yyyyMMddHHmmss` in UTC, the service's zone. */
function stamp(date: Date): string {
  return date.toISOString().replace(/\D/g, '').slice(0, 14);
}

/** A token as the service issues it: Base64 of `{date}_{counter}`, its `=` as `%3D`. */
export function issue(decoded: string): string {
  return Buffer.from(decoded).toString('base64').replaceAll('=', '%3D');
}

/** The stored analysis: answered in full, though dated long before the service's 7 days. */
const STORED = '20200101000000_1';
/** An hour before the stub was loaded: well within the service's 7 days. */
const HOUR_AGO = stamp(new Date(Date.now() - 60 * 60 * 1000));
/** A second stored analysis dated within the 7 days, so that its result going is a 410. */
const RECENT = `${HOUR_AGO}_2`;
/** A stored result the service cannot read (after an analysis-core upgrade, say). */
const UNREADABLE = '20200101000000_3';

/** The tokens of T009's cases, each as the service issued it. */
export const TOKENS = {
  /** A stored result older than 7 days: answered in full. */
  stored: issue(STORED),
  /** A stored result dated within 7 days: answered in full; 410 once forgotten. */
  recent: issue(RECENT),
  /** No result, dated within the 7 days: 410. */
  gone: issue(`${stamp(new Date(Date.now() - 2 * DAY))}_4`),
  /** No result, dated in the future: 410. */
  future: issue(`${stamp(new Date(Date.now() + DAY))}_5`),
  /** No result, dated 7 days and 12 hours ago: still within the 7 whole days, 410. */
  lastDay: issue(`${stamp(new Date(Date.now() - 7.5 * DAY))}_7`),
  /** No result, dated 8 days ago: 404. */
  expired: issue(`${stamp(new Date(Date.now() - 8 * DAY))}_6`),
  /** Base64 of text with no `_`, so no date: 404. */
  undated: issue('no date here'),
  /** Base64 of `_` alone: the date part is missing and reading it fails, the catch-all 500. */
  underscore: issue('_'),
  /** A stored result that cannot be read: the catch-all 500. */
  unreadable: issue(UNREADABLE),
} as const;

// The report's analyses, dated like RECENT, so that one forgotten is a 410.
const OVERREPRESENTATION = `${HOUR_AGO}_11`;
const EXPRESSION = `${HOUR_AGO}_12`;
const INTERACTORS = `${HOUR_AGO}_13`;
const SPECIES_COMPARISON = `${HOUR_AGO}_14`;
const COMPOUNDS = `${HOUR_AGO}_15`;

/** The report's analyses (spec 002 research R8), each as the service issued it. */
export const REPORT_TOKENS = {
  /** Over-representation, two resources (UniProt, KEGG COMPOUND), a disease pathway, mouse. */
  overrepresentation: issue(OVERREPRESENTATION),
  /** Expression with two columns and one resource; repeats among the identifiers not found. */
  expression: issue(EXPRESSION),
  /** Over-representation with interactors, through UniProt and NCBI Protein. */
  interactors: issue(INTERACTORS),
  /** A species comparison with mouse: human pathways only, so nothing found for mouse. */
  speciesComparison: issue(SPECIES_COMPARISON),
  /** KEGG COMPOUND alone, which is not importable: importable-only finds no pathway. */
  compounds: issue(COMPOUNDS),
  /** No result, dated within the 7 days: 410, on every call. */
  gone: TOKENS.gone,
} as const;

/** The number of identifiers submitted to spec 001's analysis that nothing maps to. */
export const NOT_FOUND = 1;

/** analysis-core's auxiliary resources: not importable, so left out by `importableOnly`. */
const AUXILIARY = new Set(['NCBI_PROTEIN', 'EMBL', 'COMPOUND', 'PUBCHEM_COMPOUND']);

interface Species {
  dbId: number;
  taxId: string;
  name: string;
}

/** A submitted identifier found on a pathway: what it maps to, per resource. */
interface Entity {
  id: string;
  exp: number[];
  mapsTo: { resource: string; ids: string[] }[];
}

/** A submitted identifier found as an interactor of a pathway's entity. */
interface Interactor {
  id: string;
  exp: number[];
  mapsTo: string[];
  interactsWith: { resource: string; ids: string[] };
}

interface Hit {
  stId: string;
  dbId: number;
  name: string;
  species: Species;
  llp: boolean;
  inDisease: boolean;
  entities: Entity[];
  interactors: Interactor[];
  /** The entities' p-value, the same for every resource here. */
  pValue: number;
  /** The pathway's entities, found or not. */
  total: number;
  /** The pathway's reactions; those found are as many as its entities found, up to these. */
  reactions: number;
}

type AnalysisType = 'OVERREPRESENTATION' | 'EXPRESSION' | 'SPECIES_COMPARISON';

interface Result {
  type: AnalysisType;
  projection: boolean;
  interactors: boolean;
  /** The stored analysis's own disease setting, used when a request names none. */
  includeDisease: boolean;
  sampleName?: string;
  fileName?: string;
  /** The species compared with, by database id, in a species comparison. */
  species?: number;
  columns: string[];
  hits: Hit[];
  notFound: { id: string; exp: number[] }[];
  /** Spec 001's: read only at FR-006's defaults, and by species and page. */
  defaultsOnly: boolean;
}

/** UniProt mappings, as spec 001's analysis has them: submitted identifier → mapped ones. */
function uniprot(map: Record<string, string[]>): Entity[] {
  return Object.entries(map).map(([id, ids]) => ({
    id,
    exp: [],
    mapsTo: [{ resource: 'UNIPROT', ids }],
  }));
}

/** One submitted identifier mapping to `ids` in `resource`, with its values. */
function entity(id: string, resource: string, ids: string[], exp: number[] = []): Entity {
  return { id, exp, mapsTo: [{ resource, ids }] };
}

function interactor(id: string, to: string, resource: string, ids: string[]): Interactor {
  return { id, exp: [], mapsTo: [to], interactsWith: { resource, ids } };
}

// Spec 001's species, by the database ids of Reactome's own graph, as T009 recorded them.
const HUMAN = { dbId: 48887, taxId: '9606', name: 'Homo sapiens' };
const MOUSE = { dbId: 48892, taxId: '10090', name: 'Mus musculus' };
// The report's, by the fixture graph's, so that a report picks its pathways by the species
// it resolves from the graph.
const FIXTURE_HUMAN = { dbId: 90000002, taxId: '9606', name: 'Homo sapiens' };
const FIXTURE_MOUSE = { dbId: 90000003, taxId: '10090', name: 'Mus musculus' };

/** A pathway of the fixture graph, as the analysis service names it. */
function pathway(
  stId: string,
  name: string,
  rest: Omit<Hit, 'stId' | 'dbId' | 'name' | 'species' | 'llp' | 'inDisease' | 'interactors'> &
    Partial<Pick<Hit, 'llp' | 'inDisease' | 'interactors'>>
): Hit {
  return {
    stId,
    dbId: Number(stId.split('-')[2]),
    name,
    species: stId.startsWith('R-MMU-') ? FIXTURE_MOUSE : FIXTURE_HUMAN,
    llp: true,
    inDisease: false,
    interactors: [],
    ...rest,
  };
}

/**
 * Spec 001's analysis: the pathways it hits, by p-value. The first is Reaction one's first
 * parent pathway, with entities and interactors found; one is a disease pathway the
 * fixture's graph does not hold (the analysis service reads its own data), so that the
 * count with disease pathways differs from the count without; and two are mouse's (one
 * the graph does not hold), so that a species changes it to a count of its own.
 */
const SPEC_001: Result = {
  type: 'OVERREPRESENTATION',
  projection: true,
  interactors: true,
  // the stored analysis's own setting: disease pathways left out, as T009's case needed
  includeDisease: false,
  sampleName: '',
  columns: [],
  notFound: [{ id: 'X00099', exp: [] }],
  defaultsOnly: true,
  hits: [
    {
      stId: 'R-HSA-90000210',
      dbId: 90000210,
      name: 'Alpha sub one',
      species: HUMAN,
      llp: true,
      inDisease: false,
      entities: uniprot({ X00001: ['X00001'], X00003: ['X00003-1', 'X00003-2'] }),
      interactors: [
        {
          id: 'X00002',
          exp: [],
          mapsTo: ['X00002'],
          interactsWith: { resource: 'UNIPROT', ids: ['X00009'] },
        },
      ],
      pValue: 1e-4,
      total: 10,
      reactions: 4,
    },
    {
      stId: 'R-HSA-90000200',
      dbId: 90000200,
      name: 'Alpha pathway',
      species: HUMAN,
      llp: true,
      inDisease: false,
      entities: uniprot({
        X00001: ['X00001'],
        X00002: ['X00002'],
        X00003: ['X00003-1', 'X00003-2'],
      }),
      interactors: [],
      pValue: 2e-4,
      total: 10,
      reactions: 4,
    },
    {
      stId: 'R-HSA-90000260',
      dbId: 90000260,
      name: 'Placeholder disease pathway',
      species: HUMAN,
      llp: true,
      inDisease: true,
      entities: uniprot({ X00002: ['X00002'] }),
      interactors: [],
      pValue: 3e-3,
      total: 10,
      reactions: 4,
    },
    {
      stId: 'R-HSA-90000100',
      dbId: 90000100,
      name: 'beta pathway',
      species: HUMAN,
      llp: true,
      inDisease: false,
      entities: uniprot({ X00002: ['X00002'] }),
      interactors: [],
      pValue: 4e-2,
      total: 10,
      reactions: 4,
    },
    {
      stId: 'R-MMU-90000900',
      dbId: 90000900,
      name: 'Mouse pathway',
      species: MOUSE,
      llp: true,
      inDisease: false,
      entities: uniprot({ X00001: ['X00001'] }),
      interactors: [],
      pValue: 5e-1,
      total: 10,
      reactions: 4,
    },
    {
      stId: 'R-MMU-90000901',
      dbId: 90000901,
      name: 'Placeholder mouse pathway',
      species: MOUSE,
      llp: true,
      inDisease: false,
      entities: uniprot({ X00001: ['X00001'] }),
      interactors: [],
      pValue: 6e-1,
      total: 10,
      reactions: 4,
    },
  ],
};

/**
 * The report's analyses, on the fixture graph's pathways, stored out of their p-values'
 * order so that the stub's sort is what orders them. Each pathway's own diagram, or the
 * one that holds it, is among the render stub's recorded figures.
 */
const REPORT: Readonly<Record<string, Result>> = {
  // Over-representation through UniProt and KEGG COMPOUND (auxiliary): Gamma pathway is
  // found through KEGG COMPOUND alone, so importable-only or UniProt leaves it out; Alpha
  // sub one and Alpha pathway tie, and X00001 maps otherwise in each; Two-parent sub is a
  // disease pathway here, which the stored analysis's own setting leaves out.
  [OVERREPRESENTATION]: {
    type: 'OVERREPRESENTATION',
    projection: true,
    interactors: false,
    includeDisease: false,
    columns: [],
    defaultsOnly: false,
    notFound: [
      { id: 'XZ0002', exp: [] },
      { id: 'XZ0001', exp: [] },
    ],
    hits: [
      pathway('R-HSA-90000100', 'beta pathway', {
        llp: false,
        entities: [entity('XR0004', 'UNIPROT', ['XU0004'])],
        pValue: 4e-2,
        total: 8,
        reactions: 3,
      }),
      pathway('R-HSA-90000210', 'Alpha sub one', {
        llp: false,
        entities: [entity('XR0001', 'UNIPROT', ['XU0001', 'XU0001-2'])],
        pValue: 1e-4,
        total: 4,
        reactions: 2,
      }),
      pathway('R-HSA-90000200', 'Alpha pathway', {
        llp: false,
        entities: [
          entity('XR0001', 'UNIPROT', ['XU0001']),
          entity('XR0002', 'UNIPROT', ['XU0002']),
          entity('XC0001', 'COMPOUND', ['XC0001']),
        ],
        pValue: 1e-4,
        total: 12,
        reactions: 5,
      }),
      pathway('R-HSA-90000300', 'Gamma pathway', {
        llp: false,
        entities: [
          entity('XC0001', 'COMPOUND', ['XC0001']),
          entity('XC0002', 'COMPOUND', ['XC0002']),
        ],
        pValue: 3e-3,
        total: 6,
        reactions: 2,
      }),
      pathway('R-HSA-90000250', 'Two-parent sub', {
        inDisease: true,
        entities: [entity('XR0003', 'UNIPROT', ['XU0003'])],
        pValue: 5e-3,
        total: 3,
        reactions: 1,
      }),
      pathway('R-MMU-90000900', 'Mouse pathway', {
        entities: [entity('XR0001', 'UNIPROT', ['XU0901'])],
        pValue: 2e-2,
        total: 5,
        reactions: 2,
      }),
    ],
  },
  // Expression, two columns, UniProt alone: XR0001 maps otherwise in Alpha sub two and
  // Alpha pathway; XZ0003 was submitted twice, with other values, and is not found.
  [EXPRESSION]: {
    type: 'EXPRESSION',
    projection: true,
    interactors: false,
    includeDisease: true,
    sampleName: 'Placeholder sample',
    columns: ['Placeholder A', 'Placeholder B'],
    defaultsOnly: false,
    notFound: [
      { id: 'XZ0003', exp: [0.5, 1] },
      { id: 'XZ0001', exp: [2, 3] },
      { id: 'XZ0003', exp: [0.75, 1] },
    ],
    hits: [
      pathway('R-HSA-90000200', 'Alpha pathway', {
        llp: false,
        entities: [
          entity('XR0001', 'UNIPROT', ['XU0001'], [1.5, -0.5]),
          entity('XR0002', 'UNIPROT', ['XU0002'], [0.25, 2]),
        ],
        pValue: 2e-3,
        total: 12,
        reactions: 5,
      }),
      pathway('R-HSA-90000230', 'Alpha sub two', {
        entities: [entity('XR0001', 'UNIPROT', ['XU0001', 'XU0001-2'], [1.5, -0.5])],
        pValue: 1e-3,
        total: 4,
        reactions: 2,
      }),
      pathway('R-HSA-90000100', 'beta pathway', {
        llp: false,
        entities: [entity('XR0004', 'UNIPROT', ['XU0004'], [-1, 0.75])],
        pValue: 3e-2,
        total: 8,
        reactions: 3,
      }),
      pathway('R-HSA-90000130', 'beta sub with diagram', {
        llp: false,
        entities: [entity('XR0004', 'UNIPROT', ['XU0004'], [-1, 0.75])],
        pValue: 3e-2,
        total: 5,
        reactions: 2,
      }),
      pathway('R-MMU-90000900', 'Mouse pathway', {
        entities: [entity('XR0001', 'UNIPROT', ['XU0901'], [1.5, -0.5])],
        pValue: 1e-2,
        total: 5,
        reactions: 2,
      }),
    ],
  },
  // With interactors, through UniProt and NCBI Protein (auxiliary); Gamma sub is found
  // through an interactor alone.
  [INTERACTORS]: {
    type: 'OVERREPRESENTATION',
    projection: false,
    interactors: true,
    includeDisease: true,
    fileName: 'placeholder-list.txt',
    columns: [],
    defaultsOnly: false,
    notFound: [{ id: 'XZ0004', exp: [] }],
    hits: [
      pathway('R-HSA-90000210', 'Alpha sub one', {
        llp: false,
        entities: [entity('XR0001', 'UNIPROT', ['XU0001'])],
        interactors: [interactor('XR0005', 'XU0005', 'UNIPROT', ['XU0001'])],
        pValue: 2e-4,
        total: 4,
        reactions: 2,
      }),
      pathway('R-HSA-90000131', 'beta sub sub', {
        entities: [entity('XN0001', 'NCBI_PROTEIN', ['XN0001'])],
        interactors: [interactor('XR0006', 'XU0006', 'NCBI_PROTEIN', ['XN0001'])],
        pValue: 4e-3,
        total: 3,
        reactions: 1,
      }),
      pathway('R-HSA-90000310', 'Gamma sub', {
        entities: [],
        interactors: [interactor('XR0005', 'XU0005', 'UNIPROT', ['XU0007'])],
        pValue: 6e-3,
        total: 3,
        reactions: 1,
      }),
    ],
  },
  // A species comparison with mouse: the human pathways the mouse genome's projection hits.
  [SPECIES_COMPARISON]: {
    type: 'SPECIES_COMPARISON',
    projection: false,
    interactors: false,
    includeDisease: true,
    species: FIXTURE_MOUSE.dbId,
    columns: [],
    defaultsOnly: false,
    notFound: [],
    hits: [
      pathway('R-HSA-90000100', 'beta pathway', {
        llp: false,
        entities: [entity('XM0002', 'UNIPROT', ['XU0004'])],
        pValue: 2e-2,
        total: 8,
        reactions: 3,
      }),
      pathway('R-HSA-90000200', 'Alpha pathway', {
        llp: false,
        entities: [entity('XM0001', 'UNIPROT', ['XU0001'])],
        pValue: 1e-2,
        total: 12,
        reactions: 5,
      }),
    ],
  },
  // KEGG COMPOUND alone.
  [COMPOUNDS]: {
    type: 'OVERREPRESENTATION',
    projection: true,
    interactors: false,
    includeDisease: true,
    columns: [],
    defaultsOnly: false,
    notFound: [{ id: 'XZ0005', exp: [] }],
    hits: [
      pathway('R-HSA-90000300', 'Gamma pathway', {
        llp: false,
        entities: [
          entity('XC0001', 'COMPOUND', ['XC0001']),
          entity('XC0002', 'COMPOUND', ['XC0002']),
        ],
        pValue: 1e-3,
        total: 6,
        reactions: 2,
      }),
      pathway('R-HSA-90000200', 'Alpha pathway', {
        llp: false,
        entities: [entity('XC0001', 'COMPOUND', ['XC0001'])],
        pValue: 2e-2,
        total: 12,
        reactions: 5,
      }),
    ],
  },
};

/** Every stored result, by its token's decoded value. */
function results(): Map<string, Result> {
  return new Map<string, Result>([
    [STORED, SPEC_001],
    [RECENT, SPEC_001],
    [UNREADABLE, SPEC_001],
    ...Object.entries(REPORT),
  ]);
}

/** A resource filter: `TOTAL` (all, or the importable ones only) or one resource. */
interface Filter {
  resource: string;
  importableOnly: boolean;
}

/** Whether a resource counts under the filter. */
function counts(filter: Filter, resource: string): boolean {
  if (filter.resource === 'TOTAL') return !filter.importableOnly || !AUXILIARY.has(resource);
  return resource === filter.resource;
}

/** A pathway's entities and interactors found under the filter. */
function foundUnder(hit: Hit, filter: Filter): { entities: Entity[]; interactors: Interactor[] } {
  return {
    entities: hit.entities.filter((e) => e.mapsTo.some((m) => counts(filter, m.resource))),
    interactors: hit.interactors.filter((i) => counts(filter, i.interactsWith.resource)),
  };
}

/** The resources a pathway is found through. */
function resourcesOf(hit: Hit): Set<string> {
  return new Set([
    ...hit.entities.flatMap((e) => e.mapsTo.map((m) => m.resource)),
    ...hit.interactors.map((i) => i.interactsWith.resource),
  ]);
}

/** The resources a result holds, `TOTAL` first, then by pathways found, most first. */
function resourceSummary(result: Result): { resource: string; pathways: number }[] {
  const tally = new Map<string, number>();
  for (const hit of result.hits) {
    for (const resource of resourcesOf(hit)) tally.set(resource, (tally.get(resource) ?? 0) + 1);
  }
  const each = [...tally].map(([resource, pathways]) => ({ resource, pathways }));
  // Java's sort is stable too; the order among ties is the analysis's, not read here
  each.sort((a, b) => b.pathways - a.pathways);
  return [{ resource: 'TOTAL', pathways: result.hits.length }, ...each];
}

/** The mean of each column's values over the entities. */
function means(entities: readonly Entity[], columns: number): number[] {
  if (entities.length === 0) return [];
  return Array.from(
    { length: columns },
    (_, column) => entities.reduce((sum, e) => sum + (e.exp[column] ?? 0), 0) / entities.length
  );
}

/** A pathway's row in the result, its statistics under the filter. */
function pathwaySummary(result: Result, hit: Hit, filter: Filter): unknown {
  const { entities, interactors } = foundUnder(hit, filter);
  const found = entities.length + (result.interactors ? interactors.length : 0);
  const total = hit.total + (result.interactors ? hit.interactors.length : 0);
  const reactions = Math.min(hit.reactions, entities.length + interactors.length);
  return {
    stId: hit.stId,
    dbId: hit.dbId,
    name: hit.name,
    species: hit.species,
    llp: hit.llp,
    entities: {
      resource: filter.resource,
      total,
      found,
      ratio: total / 10_000,
      pValue: hit.pValue,
      fdr: Math.min(1, hit.pValue * result.hits.length),
      exp: means(entities, result.columns.length),
      ...(result.interactors
        ? {
            curatedTotal: hit.total,
            curatedFound: entities.length,
            interactorsTotal: hit.interactors.length,
            interactorsFound: interactors.length,
          }
        : {}),
    },
    reactions: {
      resource: filter.resource,
      total: hit.reactions,
      found: reactions,
      ratio: hit.reactions / 40_000,
    },
    inDisease: hit.inDisease,
  };
}

/** The CSV's rows, from the entities found over every stored pathway (research R6). */
function csv(result: Result): string {
  const rows = new Map<string, string>();
  for (const hit of result.hits) {
    for (const { id: submitted, mapsTo } of hit.entities) {
      for (const { resource, ids } of mapsTo) {
        for (const id of ids) rows.set(`${submitted},${id}`, `${submitted},${id},${resource}`);
      }
    }
  }
  return ['Submitted identifier,Found identifier,Resource', ...rows.values(), ''].join('\n');
}

/** The pathway identifiers in a posted body, read as the service reads them. */
function pathwayIds(body: string): string[] {
  const input = body.includes('=') ? (body.split('=')[1] ?? '') : body;
  const ids: string[] = [];
  for (const line of input.split('\n')) {
    for (const value of line.split(',')) {
      const id = value.trim();
      // a stable id, or what Java's Long.valueOf reads as a database id
      if (id.startsWith('R-')) ids.push(id);
      else if (/^[+-]?\d{1,18}$/.test(id)) ids.push(String(BigInt(id)));
    }
  }
  return ids;
}

/** The servlet container's page for a request it refuses, its version line left out. */
const CONTAINER_400 =
  '<!doctype html><html lang="en"><head><title>HTTP Status 400 – Bad Request</title></head>' +
  '<body><h1>HTTP Status 400 – Bad Request</h1><hr class="line" />' +
  '<p><b>Type</b> Status Report</p><p><b>Message</b> Invalid URI: noSlash</p>' +
  '<p><b>Description</b> The server cannot or will not process the request due to something ' +
  'that is perceived to be a client error (e.g., malformed request syntax, invalid request ' +
  'message framing, or deceptive request routing).</p><hr class="line" /></body></html>';

const REASONS: Readonly<Record<number, string>> = {
  400: 'Bad Request',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  410: 'Gone',
  415: 'Unsupported Media Type',
  500: 'Internal Server Error',
};

/** The parameters pdf-export sends to each endpoint, and the values each may take. */
const BOOLEAN = (value: string) => value === 'true' || value === 'false';
const NUMBER = (value: string) => /^[1-9]\d{0,5}$/.test(value);
const SUMMARY_PARAMETERS: Readonly<Record<string, (value: string) => boolean>> = {
  resource: (value) => value.length > 0,
  importableOnly: BOOLEAN,
  includeDisease: BOOLEAN,
  species: (value) => value.length > 0,
  pageSize: NUMBER,
  page: NUMBER,
};
const TOTAL_ONLY: Readonly<Record<string, (value: string) => boolean>> = {
  resource: (value) => value === 'TOTAL',
};

type Read =
  { kind: 'stored'; decoded: string; result: Result } | { kind: 'error'; status: 404 | 410 | 500 };

/**
 * Whether `accept` lets the answer be `type`: no header at all lets anything. The service
 * matches types and ignores their weights, so `q=0` refuses nothing (T009, measured).
 */
function accepts(accept: string | undefined, type: string): boolean {
  if (accept === undefined) return true;
  const [major] = type.split('/');
  return accept
    .split(',')
    .map((part) => part.split(';')[0]?.trim().toLowerCase())
    .some((range) => range === '*/*' || range === `${String(major)}/*` || range === type);
}

/** The service's routes: each path's pattern and the one method it takes. */
type Route = 'summary' | 'resources' | 'notFound' | 'foundAll' | 'found' | 'download';
const ROUTES: readonly { route: Route; method: 'GET' | 'POST'; pattern: RegExp }[] = [
  { route: 'summary', method: 'GET', pattern: new RegExp(`^${BASE}/token/([^/]+)$`) },
  { route: 'resources', method: 'GET', pattern: new RegExp(`^${BASE}/token/([^/]+)/resources$`) },
  { route: 'notFound', method: 'GET', pattern: new RegExp(`^${BASE}/token/([^/]+)/notFound$`) },
  { route: 'foundAll', method: 'POST', pattern: new RegExp(`^${BASE}/token/([^/]+)/found/all$`) },
  {
    route: 'found',
    method: 'GET',
    pattern: new RegExp(`^${BASE}/token/([^/]+)/found/(entities|interactors)/([^/]+)$`),
  },
  {
    route: 'download',
    method: 'GET',
    pattern: new RegExp(`^${BASE}/download/([^/]+)/entities/found/([^/]+)/[^/]+\\.csv$`),
  },
];

export interface AnalysisRequest {
  /** `GET` or `POST`, as sent. */
  method: string;
  /** The path and query, as sent. */
  path: string;
  /** The `Accept` header, if one was sent. */
  accept: string | undefined;
  /** The `Content-Type` header, if one was sent. */
  contentType: string | undefined;
  /** The body, as sent: empty for a request without one. */
  body: string;
}

export interface AnalysisStub {
  /** The service's base URL: requests go to `${url}/token/{token}` and the like. */
  url: string;
  /** Every request, in order: one entry a call, so a test can count a report's calls. */
  requests: AnalysisRequest[];
  /**
   * Remove a stored result after `after` more requests for its token (at once without it),
   * as when a result goes while a PDF is being made: then 410 within its 7 days, 404 after.
   */
  forget(token: string, after?: number): void;
  /**
   * Answer 503 to `times` requests (every request without it), starting after `after` more
   * are answered (at once without it), as when the service fails partway through a PDF.
   */
  refuse(times?: number, after?: number): void;
  /** Answer every request `ms` late, as a loaded service does (0 to answer at once). */
  slow(ms: number): void;
  /** Restore the stored results and forget the refusals, delays and requests, for the next test. */
  reset(): void;
  close(): Promise<void>;
}

export async function startAnalysisStub(): Promise<AnalysisStub> {
  const requests: AnalysisRequest[] = [];
  const stored = results();
  const forgetting = new Map<string, number>();
  let refusing = 0;
  /** Requests still to answer before the refusals start. */
  let refusingAfter = 0;
  let delay = 0;
  const delayed = new Set<ReturnType<typeof setTimeout>>();

  /** The service's reading of a token: `TokenUtils.getFromToken`, then `Tokenizer`. */
  function read(raw: string): Read {
    let token = raw;
    try {
      for (;;) {
        // Java's URLDecoder, which reads `+` as a space
        const next = decodeURIComponent(token.replaceAll('+', ' '));
        if (next === token) break;
        token = next;
      }
    } catch {
      return { kind: 'error', status: 500 };
    }
    // Java's basic Base64 decoder: its alphabet only, padding optional but right if given
    const padded = /^[A-Za-z0-9+/]*={0,2}$/.test(token);
    const length = token.replace(/=+$/, '').length;
    if (!padded || length % 4 === 1 || (token.includes('=') && token.length % 4 !== 0)) {
      return { kind: 'error', status: 500 };
    }
    const decoded = Buffer.from(token, 'base64').toString('latin1');
    const left = forgetting.get(decoded);
    if (left !== undefined) {
      if (left <= 0) {
        stored.delete(decoded);
        forgetting.delete(decoded);
      } else forgetting.set(decoded, left - 1);
    }
    const result = stored.get(decoded);
    if (result) {
      return decoded === UNREADABLE
        ? { kind: 'error', status: 500 }
        : { kind: 'stored', decoded, result };
    }
    if (!decoded.includes('_')) return { kind: 'error', status: 404 };
    // `_` alone: Java's split gives no date part, and reading it fails
    if (decoded.replaceAll('_', '') === '') return { kind: 'error', status: 500 };
    // Not measured: any other date the service cannot read is taken as no date.
    const date = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(decoded.split('_')[0] ?? '');
    if (!date) return { kind: 'error', status: 404 };
    const [, y, mo, d, h, mi, s] = date.map(Number);
    const when = Date.UTC(y ?? 0, (mo ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0, s ?? 0);
    // Joda's daysBetween counts whole days; `<= 7` is alive, and the future is too
    return Math.floor((Date.now() - when) / DAY) <= 7
      ? { kind: 'error', status: 410 }
      : { kind: 'error', status: 404 };
  }

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      if (delay === 0) {
        answer(req, res, body);
        return;
      }
      const timer = setTimeout(() => {
        delayed.delete(timer);
        answer(req, res, body);
      }, delay);
      delayed.add(timer);
    });
  });

  function answer(req: IncomingMessage, res: ServerResponse, body: string) {
    const raw = req.url ?? '/';
    const accept = req.headers.accept;
    const contentType = req.headers['content-type'];
    const method = req.method ?? 'GET';
    requests.push({ method, path: raw, accept, contentType, body });
    const path = raw.split('?')[0] ?? '';
    const query = new URL(raw, 'http://stub').searchParams;

    const json = (status: number, value: unknown) =>
      res
        .writeHead(status, { 'Content-Type': 'application/json;charset=UTF-8' })
        .end(JSON.stringify(value));
    /** The service's own error body. */
    const error = (status: number, messages: string[] = []) => {
      json(status, { code: status, reason: REASONS[status], messages });
    };
    /** The framework's own answer, for a route, a method, a type or a body it does not take. */
    const framework = (status: 400 | 404 | 405 | 406 | 415) => {
      json(status, {
        timestamp: new Date().toISOString().replace('Z', '+00:00'),
        status,
        error: REASONS[status],
        path,
      });
    };

    if (refusing !== 0 && refusingAfter > 0) refusingAfter -= 1;
    else if (refusing !== 0) {
      refusing -= 1;
      res.writeHead(503, { 'Content-Type': 'text/plain' }).end('Service Unavailable');
      return;
    }
    // The servlet container refuses an encoded `/` or `\` before the service sees it.
    if (/%2F|%5C/i.test(path)) {
      res
        .writeHead(400, { 'Content-Type': 'text/html;charset=utf-8', Connection: 'close' })
        .end(CONTAINER_400);
      return;
    }

    const matched = ROUTES.map((r) => ({ ...r, match: r.pattern.exec(path) })).find((r) => r.match);
    const match = matched?.match;
    if (!matched || !match?.[1]) {
      framework(404);
      return;
    }
    const { route } = matched;
    if (method !== matched.method) {
      framework(405);
      return;
    }
    // Spring matches the type a route consumes before the type it produces.
    if (route === 'foundAll' && !/^text\/plain\s*(;|$)/i.test(contentType ?? '')) {
      framework(415);
      return;
    }
    if (route === 'download' && match[2] !== 'TOTAL') {
      error(400, [`Not a resource pdf-export asks for: ${String(match[2])}`]);
      return;
    }
    const type = route === 'download' ? 'text/csv' : 'application/json';
    if (!accepts(accept, type)) {
      // The CSV asked for as JSON alone gets the framework's JSON; the rest an empty 406.
      if (route === 'download') framework(406);
      else res.writeHead(406).end();
      return;
    }
    // A body the service requires, missing: the framework's 400, before the handler runs.
    if (route === 'foundAll' && body === '') {
      framework(400);
      return;
    }
    const allowed =
      route === 'summary'
        ? SUMMARY_PARAMETERS
        : route === 'found' || route === 'foundAll'
          ? TOTAL_ONLY
          : {};
    const seen = new Set<string>();
    for (const [name, value] of query) {
      const valid = allowed[name];
      if (seen.has(name) || !valid?.(value)) {
        error(400, [`Not a parameter pdf-export sends, a bad value, or a repeat: ${name}`]);
        return;
      }
      seen.add(name);
    }

    const token = read(match[1]);
    if (token.kind === 'error') {
      error(
        token.status,
        token.status === 500
          ? [
              'Please get in touch with our help desk ({help-desk address}) for more details about this problem',
            ]
          : []
      );
      return;
    }
    const { result, decoded } = token;

    if (route === 'summary') {
      const refusal = summaryRefusal(result, query);
      if (refusal !== undefined) {
        error(400, [refusal]);
        return;
      }
    }

    switch (route) {
      case 'download':
        res.writeHead(200, { 'Content-Type': 'text/csv;charset=UTF-8' }).end(csv(result));
        return;
      case 'resources':
        json(
          200,
          resourceSummary(result).map((r) => ({ ...r, filtered: r.pathways }))
        );
        return;
      case 'notFound':
        json(200, result.notFound);
        return;
      case 'foundAll': {
        const elements = pathwayIds(body).flatMap((id) => {
          const hit = result.hits.find((h) => h.stId === id || String(h.dbId) === id);
          return hit ? [foundElements(result, hit, id)] : [];
        });
        if (elements.length === 0) error(404);
        else json(200, elements);
        return;
      }
      case 'found': {
        const hit = result.hits.find((h) => h.stId === match[3]);
        if (match[2] === 'entities') {
          if (!hit) {
            error(404);
            return;
          }
          json(200, {
            identifiers: hit.entities,
            resources: [...entityResources(hit.entities)],
            expNames: result.columns,
            found: hit.entities.length,
          });
          return;
        }
        if (!hit || hit.interactors.length === 0) {
          error(404);
          return;
        }
        json(200, {
          identifiers: hit.interactors,
          resources: [],
          expNames: result.columns,
          found: hit.interactors.length,
        });
        return;
      }
      case 'summary':
        json(200, summary(result, decoded, query));
        return;
    }
  }

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${String(port)}${BASE}`,
    requests,
    forget(token, after = 0) {
      const decoded = Buffer.from(decodeURIComponent(token), 'base64').toString('latin1');
      if (after === 0) stored.delete(decoded);
      else forgetting.set(decoded, after);
    },
    refuse(times = -1, after = 0) {
      refusing = times;
      refusingAfter = after;
    },
    slow(ms) {
      delay = ms;
    },
    reset() {
      for (const [decoded, result] of results()) stored.set(decoded, result);
      delay = 0;
      forgetting.clear();
      refusing = 0;
      refusingAfter = 0;
      requests.length = 0;
    },
    async close() {
      for (const timer of delayed) clearTimeout(timer);
      server.closeAllConnections();
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        })
      );
    },
  };
}

/** The resources the entities map to. */
function entityResources(entities: readonly Entity[]): Set<string> {
  return new Set(entities.flatMap((e) => e.mapsTo.map((m) => m.resource)));
}

/** A posted pathway's found elements, at `TOTAL`: named as it was posted. */
function foundElements(result: Result, hit: Hit, posted: string): unknown {
  return {
    pathway: posted,
    entities: hit.entities,
    interactors: hit.interactors,
    resources: [...entityResources(hit.entities)],
    expNames: result.columns,
    foundEntities: hit.entities.length,
    foundInteractors: hit.interactors.length,
  };
}

/**
 * Why a summary's parameters are ones pdf-export never sends for this analysis: spec 001's
 * only at FR-006's defaults; the report's never by species or page, and only for a resource
 * the result holds, compared case and all.
 */
function summaryRefusal(result: Result, query: URLSearchParams): string | undefined {
  const resource = query.get('resource');
  if (result.defaultsOnly) {
    if (resource !== null && resource !== 'TOTAL') return `Not FR-006's resource: ${resource}`;
    if (query.get('importableOnly') === 'true') return "Not FR-006's importable-only setting";
    return undefined;
  }
  for (const name of ['species', 'pageSize', 'page']) {
    if (query.has(name)) return `Not a parameter the report sends: ${name}`;
  }
  if (resource !== null && !resourceSummary(result).some((r) => r.resource === resource)) {
    return `Not a resource the result holds: ${resource}`;
  }
  return undefined;
}

/**
 * The result, as `GET /token/{token}` answers it: filtered by resource and importable-only
 * setting, by the request's includeDisease if it names one and otherwise by the stored
 * analysis's own, and by species if one is sent; sorted by the entities' p-value, a stable
 * sort; paged only when a page is asked for.
 */
function summary(result: Result, decoded: string, query: URLSearchParams): unknown {
  const filter: Filter = {
    resource: query.get('resource') ?? 'TOTAL',
    importableOnly: query.get('importableOnly') === 'true',
  };
  const includeDisease = query.has('includeDisease')
    ? query.get('includeDisease') === 'true'
    : result.includeDisease;
  const species = query.get('species');
  const kept = result.hits
    .filter((hit) => {
      const { entities, interactors } = foundUnder(hit, filter);
      return (
        (includeDisease || !hit.inDisease) &&
        entities.length + interactors.length > 0 &&
        (species === null || hit.species.taxId === species || hit.species.name === species)
      );
    })
    .sort((a, b) => a.pValue - b.pValue);
  const page = query.get('page');
  const pageSize = Number(query.get('pageSize') ?? kept.length);
  const shown =
    page === null ? kept : kept.slice((Number(page) - 1) * pageSize, Number(page) * pageSize);

  const speciesHits = new Map<number, { species: Species; pathways: number; filtered: number }>();
  for (const hit of result.hits) {
    const entry = speciesHits.get(hit.species.dbId) ?? {
      species: hit.species,
      pathways: 0,
      filtered: 0,
    };
    entry.pathways += 1;
    if (kept.includes(hit)) entry.filtered += 1;
    speciesHits.set(hit.species.dbId, entry);
  }
  const values = result.hits.flatMap((hit) => hit.entities.flatMap((e) => e.exp));

  return {
    summary: {
      token: issue(decoded),
      projection: result.projection,
      interactors: result.interactors,
      type: result.type,
      ...(result.sampleName === undefined ? {} : { sampleName: result.sampleName }),
      ...(result.species === undefined ? {} : { species: result.species }),
      text: true,
      includeDisease,
      ...(result.fileName === undefined ? {} : { fileName: result.fileName }),
    },
    expression: {
      columnNames: result.columns,
      ...(values.length === 0 ? {} : { min: Math.min(...values), max: Math.max(...values) }),
    },
    identifiersNotFound: result.notFound.length,
    pathwaysFound: kept.length,
    pathways: shown.map((hit) => pathwaySummary(result, hit, filter)),
    resourceSummary: resourceSummary(result).map(({ resource, pathways }) => ({
      resource,
      pathways,
      filtered:
        resource === 'TOTAL'
          ? kept.length
          : kept.filter(
              (hit) =>
                resourcesOf(hit).has(resource) &&
                (!filter.importableOnly || !AUXILIARY.has(resource))
            ).length,
    })),
    speciesSummary: [...speciesHits.values()]
      .sort((a, b) => b.pathways - a.pathways)
      .map(({ species: s, pathways, filtered }) => ({ ...s, pathways, filtered })),
    warnings: ['Missing header. Using a default one.'],
  };
}
