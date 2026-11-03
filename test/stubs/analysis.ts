// The analysis stub (spec 001 T010): the analysis service's answers as T009 recorded them
// (research R6), on loopback, for an analysis of made-up identifiers on the fixture's
// pathways. It reads a token by the service's own rules: URL-decoded until it no longer
// changes, Base64-decoded, a stored result answered whatever the token's age, and a missing
// one 410 while its date is within 7 days (or in the future) and 404 otherwise. Its other
// answers are the service's: the catch-all 500, the servlet container's HTML 400 for an
// encoded `/`, the framework's 404 and 406, a `found/…` 404 for none found, and the found
// identifiers' CSV. Like the render stub, it answers 400 to a query parameter pdf-export
// never sends, one given twice, or a resource or importable-only setting other than
// FR-006's defaults, so a client getting one wrong fails a test instead of passing
// silently; the service itself ignores unknown ones and filters by the others.
import { createServer, type Server } from 'node:http';
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
/** A second stored analysis dated within the 7 days, so that its result going is a 410. */
const RECENT = `${stamp(new Date(Date.now() - 60 * 60 * 1000))}_2`;
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

/** The number of identifiers submitted that nothing maps to. */
export const NOT_FOUND = 1;

interface Hit {
  stId: string;
  dbId: number;
  name: string;
  species: { dbId: number; taxId: string; name: string };
  inDisease: boolean;
  /** Submitted identifier → the identifiers it maps to, on this pathway. */
  entities: Record<string, string[]>;
  /** Submitted identifier → the interactors it maps to, on this pathway. */
  interactors?: Record<string, string[]>;
  pValue: number;
}

const HUMAN = { dbId: 48887, taxId: '9606', name: 'Homo sapiens' };
const MOUSE = { dbId: 48892, taxId: '10090', name: 'Mus musculus' };

/**
 * The pathways the stored analyses hit, by p-value. The first is Reaction one's first
 * parent pathway, with entities and interactors found; one is a disease pathway the
 * fixture's graph does not hold (the analysis service reads its own data), so that the
 * count with disease pathways differs from the count without; and two are mouse's (one
 * the graph does not hold), so that a species changes it to a count of its own.
 */
const HITS: readonly Hit[] = [
  {
    stId: 'R-HSA-90000210',
    dbId: 90000210,
    name: 'Alpha sub one',
    species: HUMAN,
    inDisease: false,
    entities: { X00001: ['X00001'], X00003: ['X00003-1', 'X00003-2'] },
    interactors: { X00002: ['X00009'] },
    pValue: 1e-4,
  },
  {
    stId: 'R-HSA-90000200',
    dbId: 90000200,
    name: 'Alpha pathway',
    species: HUMAN,
    inDisease: false,
    entities: { X00001: ['X00001'], X00002: ['X00002'], X00003: ['X00003-1', 'X00003-2'] },
    pValue: 2e-4,
  },
  {
    stId: 'R-HSA-90000260',
    dbId: 90000260,
    name: 'Placeholder disease pathway',
    species: HUMAN,
    inDisease: true,
    entities: { X00002: ['X00002'] },
    pValue: 3e-3,
  },
  {
    stId: 'R-HSA-90000100',
    dbId: 90000100,
    name: 'beta pathway',
    species: HUMAN,
    inDisease: false,
    entities: { X00002: ['X00002'] },
    pValue: 4e-2,
  },
  {
    stId: 'R-MMU-90000900',
    dbId: 90000900,
    name: 'Mouse pathway',
    species: MOUSE,
    inDisease: false,
    entities: { X00001: ['X00001'] },
    pValue: 5e-1,
  },
  {
    stId: 'R-MMU-90000901',
    dbId: 90000901,
    name: 'Placeholder mouse pathway',
    species: MOUSE,
    inDisease: false,
    entities: { X00001: ['X00001'] },
    pValue: 6e-1,
  },
];

/** The stored analysis's own setting: disease pathways left out, as T009's case needed. */
const OWN_INCLUDE_DISEASE = false;

/** The CSV's rows, from the entities found over every stored pathway (research R6). */
function csv(): string {
  const rows = new Map<string, string>();
  for (const hit of HITS) {
    for (const [submitted, found] of Object.entries(hit.entities)) {
      for (const id of found) rows.set(`${submitted},${id}`, `${submitted},${id},UNIPROT`);
    }
  }
  return ['Submitted identifier,Found identifier,Resource', ...rows.values(), ''].join('\n');
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
  410: 'Gone',
  500: 'Internal Server Error',
};

/** The parameters pdf-export sends to each endpoint, and the values each may take. */
const BOOLEAN = (value: string) => value === 'true' || value === 'false';
const NUMBER = (value: string) => /^[1-9]\d{0,5}$/.test(value);
// FR-006's defaults: all resources together, not importable-only
const RESOURCE = (value: string) => value === 'TOTAL';
const SUMMARY_PARAMETERS: Readonly<Record<string, (value: string) => boolean>> = {
  resource: RESOURCE,
  importableOnly: (value) => value === 'false',
  includeDisease: BOOLEAN,
  species: (value) => value.length > 0,
  pageSize: NUMBER,
  page: NUMBER,
};
const FOUND_PARAMETERS: Readonly<Record<string, (value: string) => boolean>> = {
  resource: RESOURCE,
};

type Read = { kind: 'stored'; decoded: string } | { kind: 'error'; status: 404 | 410 | 500 };

/** Whether `accept` lets the answer be `type`: no header at all lets anything. */
function accepts(accept: string | undefined, type: string): boolean {
  if (accept === undefined) return true;
  const [major] = type.split('/');
  return (
    accept
      .split(',')
      .map((part) => part.split(';').map((p) => p.trim().toLowerCase()))
      // a range with `q=0` refuses its type
      .filter((params) => !params.slice(1).some((p) => /^q=0(\.0*)?$/.test(p)))
      .some(([range]) => range === '*/*' || range === `${String(major)}/*` || range === type)
  );
}

export interface AnalysisRequest {
  /** The path and query, as sent. */
  path: string;
  /** The `Accept` header, if one was sent. */
  accept: string | undefined;
}

export interface AnalysisStub {
  /** The service's base URL: requests go to `${url}/token/{token}` and the like. */
  url: string;
  /** Every request, in order. */
  requests: AnalysisRequest[];
  /**
   * Remove a stored result after `after` more requests for its token (at once without it),
   * as when a result goes while a PDF is being made: then 410 within its 7 days, 404 after.
   */
  forget(token: string, after?: number): void;
  /** Answer 503 to the next `times` requests (every request without it). */
  refuse(times?: number): void;
  /** Restore the stored results and forget the refusals and requests, for the next test. */
  reset(): void;
  close(): Promise<void>;
}

export async function startAnalysisStub(): Promise<AnalysisStub> {
  const requests: AnalysisRequest[] = [];
  const stored = new Set([STORED, RECENT, UNREADABLE]);
  const forgetting = new Map<string, number>();
  let refusing = 0;

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
    if (stored.has(decoded)) {
      return decoded === UNREADABLE ? { kind: 'error', status: 500 } : { kind: 'stored', decoded };
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
    const raw = req.url ?? '/';
    const accept = req.headers.accept;
    requests.push({ path: raw, accept });
    const path = raw.split('?')[0] ?? '';
    const query = new URL(raw, 'http://stub').searchParams;

    const json = (status: number, body: unknown) =>
      res
        .writeHead(status, { 'Content-Type': 'application/json;charset=UTF-8' })
        .end(JSON.stringify(body));
    /** The service's own error body. */
    const error = (status: number, messages: string[] = []) => {
      json(status, { code: status, reason: REASONS[status], messages });
    };
    /** The framework's own answer, for a route or a type it does not serve. */
    const framework = (status: 404 | 406, reason: string) => {
      json(status, {
        timestamp: new Date().toISOString().replace('Z', '+00:00'),
        status,
        error: reason,
        path,
      });
    };

    if (refusing !== 0) {
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

    const summary = new RegExp(`^${BASE}/token/([^/]+)$`).exec(path);
    const found = new RegExp(`^${BASE}/token/([^/]+)/found/(entities|interactors)/([^/]+)$`).exec(
      path
    );
    const download = new RegExp(
      `^${BASE}/download/([^/]+)/entities/found/([^/]+)/[^/]+\\.csv$`
    ).exec(path);
    const match = summary ?? found ?? download;
    if (!match?.[1]) {
      framework(404, 'Not Found');
      return;
    }
    if (download && !RESOURCE(download[2] ?? '')) {
      error(400, [`Not a resource pdf-export asks for: ${String(download[2])}`]);
      return;
    }
    const type = download ? 'text/csv' : 'application/json';
    if (!accepts(accept, type)) {
      // The CSV asked for as JSON alone gets the framework's JSON; the rest an empty 406.
      if (download) framework(406, 'Not Acceptable');
      else res.writeHead(406).end();
      return;
    }
    const allowed = summary ? SUMMARY_PARAMETERS : download ? {} : FOUND_PARAMETERS;
    const seen = new Set<string>();
    for (const [name, value] of query) {
      const valid = allowed[name];
      if (seen.has(name) || !valid?.(value)) {
        error(400, [`Not a parameter pdf-export sends, a bad value, or a repeat: ${name}`]);
        return;
      }
      seen.add(name);
    }

    const result = read(match[1]);
    if (result.kind === 'error') {
      error(
        result.status,
        result.status === 500
          ? [
              'Please get in touch with our help desk ({help-desk address}) for more details about this problem',
            ]
          : []
      );
      return;
    }

    if (download) {
      res.writeHead(200, { 'Content-Type': 'text/csv;charset=UTF-8' }).end(csv());
      return;
    }

    if (found) {
      const hit = HITS.find((h) => h.stId === found[3]);
      const map = found[2] === 'entities' ? hit?.entities : hit?.interactors;
      if (!map || Object.keys(map).length === 0) {
        error(404);
        return;
      }
      const identifiers = Object.entries(map).map(([id, to]) =>
        found[2] === 'entities'
          ? { id, exp: [], mapsTo: [{ resource: 'UNIPROT', ids: to }] }
          : { id, exp: [], mapsTo: [id], interactsWith: { resource: 'UNIPROT', ids: to } }
      );
      json(200, {
        identifiers,
        resources: found[2] === 'entities' ? ['UNIPROT'] : [],
        expNames: [],
        found: identifiers.length,
      });
      return;
    }

    // The summary: filtered by the request's includeDisease if it names one, otherwise by
    // the stored analysis's own, and by species if one is sent.
    const includeDisease = query.has('includeDisease')
      ? query.get('includeDisease') === 'true'
      : OWN_INCLUDE_DISEASE;
    const species = query.get('species');
    const hits = HITS.filter(
      (hit) =>
        (includeDisease || !hit.inDisease) &&
        (species === null || hit.species.taxId === species || hit.species.name === species)
    );
    const pageSize = Number(query.get('pageSize') ?? hits.length);
    const page = Number(query.get('page') ?? 1);
    const counts = new Map<string, number>();
    for (const hit of hits) counts.set(hit.species.name, (counts.get(hit.species.name) ?? 0) + 1);
    json(200, {
      summary: {
        token: issue(result.decoded),
        projection: true,
        interactors: true,
        type: 'OVERREPRESENTATION',
        sampleName: '',
        text: true,
        includeDisease,
      },
      expression: { columnNames: [] },
      identifiersNotFound: NOT_FOUND,
      pathwaysFound: hits.length,
      pathways: hits.slice((page - 1) * pageSize, page * pageSize).map((hit) => ({
        stId: hit.stId,
        dbId: hit.dbId,
        name: hit.name,
        species: hit.species,
        llp: true,
        entities: {
          resource: 'TOTAL',
          total: 10,
          found: Object.keys(hit.entities).length,
          ratio: 0.001,
          pValue: hit.pValue,
          fdr: Math.min(1, hit.pValue * HITS.length),
          exp: [],
        },
        reactions: { resource: 'TOTAL', total: 4, found: 1, ratio: 0.0001 },
        inDisease: hit.inDisease,
      })),
      resourceSummary: [
        { resource: 'TOTAL', pathways: hits.length, filtered: hits.length },
        { resource: 'UNIPROT', pathways: hits.length, filtered: hits.length },
      ],
      speciesSummary: [HUMAN, MOUSE]
        .filter((s) => counts.has(s.name))
        .map((s) => ({ ...s, pathways: counts.get(s.name), filtered: counts.get(s.name) })),
      warnings: ['Missing header. Using a default one.'],
    });
  });

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
    refuse(times = -1) {
      refusing = times;
    },
    reset() {
      for (const token of [STORED, RECENT, UNREADABLE]) stored.add(token);
      forgetting.clear();
      refusing = 0;
      requests.length = 0;
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        })
      );
    },
  };
}
