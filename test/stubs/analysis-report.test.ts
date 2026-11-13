// The analysis stub's answers to the report's five calls (spec 002 T004, research R1 and
// R8, contracts/analysis-api.md), and its refusals of what pdf-export never sends.
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { after, afterEach, before, describe, test } from 'node:test';

import { REPORT_TOKENS, TOKENS, startAnalysisStub, type AnalysisStub } from './analysis.ts';

const JSON_TYPE = { Accept: 'application/json' };
const TEXT = { ...JSON_TYPE, 'Content-Type': 'text/plain' };
/** Call 2's query, for a resource and importable-only setting. */
const call2 = (resource = 'TOTAL', importableOnly = false) =>
  `resource=${resource}&importableOnly=${String(importableOnly)}&includeDisease=true`;

const SUB_ONE = 'R-HSA-90000210';
const ALPHA = 'R-HSA-90000200';
const GAMMA = 'R-HSA-90000300';
const TWO_PARENT = 'R-HSA-90000250';
const MOUSE = 'R-MMU-90000900';
const BETA = 'R-HSA-90000100';

interface Statistics {
  resource: string;
  total: number;
  found: number;
  pValue?: number;
  exp?: number[];
  curatedFound?: number;
  interactorsFound?: number;
}
interface Pathway {
  stId: string;
  species: { dbId: number; name: string };
  entities: Statistics;
  reactions: Statistics;
  inDisease: boolean;
}
interface Result {
  summary: {
    type: string;
    interactors: boolean;
    includeDisease: boolean;
    sampleName?: string;
    fileName?: string;
    species?: number;
  };
  expression: { columnNames: string[] };
  identifiersNotFound: number;
  pathwaysFound: number;
  pathways: Pathway[];
  resourceSummary: { resource: string; pathways: number; filtered: number }[];
  speciesSummary: { name: string; pathways: number; filtered: number }[];
}
interface Mapping {
  resource: string;
  ids: string[];
}
interface Found {
  pathway: string;
  entities: { id: string; exp: number[]; mapsTo: Mapping[] }[];
  interactors: { id: string; mapsTo: string[]; interactsWith: Mapping }[];
  expNames: string[];
  foundEntities: number;
  foundInteractors: number;
}

describe("the analysis stub's report calls", () => {
  let stub: AnalysisStub;
  before(async () => {
    stub = await startAnalysisStub();
  });
  afterEach(() => {
    stub.reset();
  });
  after(async () => {
    await stub.close();
  });

  const get = (path: string) => fetch(`${stub.url}${path}`, { headers: JSON_TYPE });
  const post = (token: string, body: string, headers: Record<string, string> = TEXT, query = '') =>
    fetch(`${stub.url}/token/${token}/found/all?resource=TOTAL${query}`, {
      method: 'POST',
      headers,
      body,
    });
  const result = async (token: string, query = call2()): Promise<Result> => {
    const res = await get(`/token/${token}?${query}`);
    assert.equal(res.status, 200, query);
    return (await res.json()) as Result;
  };
  const order = async (token: string, query?: string) =>
    (await result(token, query)).pathways.map((p) => p.stId);
  const found = async (token: string, body: string): Promise<Found[]> => {
    const res = await post(token, body);
    assert.equal(res.status, 200);
    return (await res.json()) as Found[];
  };
  /** A POST with no `Content-Type` at all, which fetch would add. */
  const bare = (path: string, body: string) =>
    new Promise<number | undefined>((resolve, reject) => {
      const req = request(`${stub.url}${path}`, { method: 'POST' }, (res) => {
        res.resume();
        resolve(res.statusCode);
      }).on('error', reject);
      req.end(body);
    });

  test("call 1: each result's resources, TOTAL first, then by pathways", async () => {
    const cases: [string, [string, number][]][] = [
      [
        REPORT_TOKENS.overrepresentation,
        [
          ['TOTAL', 6],
          ['UNIPROT', 5],
          ['COMPOUND', 2],
        ],
      ],
      [
        REPORT_TOKENS.expression,
        [
          ['TOTAL', 5],
          ['UNIPROT', 5],
        ],
      ],
      [
        REPORT_TOKENS.interactors,
        [
          ['TOTAL', 3],
          ['UNIPROT', 2],
          ['NCBI_PROTEIN', 1],
        ],
      ],
      [
        REPORT_TOKENS.speciesComparison,
        [
          ['TOTAL', 2],
          ['UNIPROT', 2],
        ],
      ],
      [
        REPORT_TOKENS.compounds,
        [
          ['TOTAL', 2],
          ['COMPOUND', 2],
        ],
      ],
    ];
    for (const [token, resources] of cases) {
      const res = await get(`/token/${token}/resources`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'application/json;charset=UTF-8');
      assert.deepEqual(
        await res.json(),
        resources.map(([resource, pathways]) => ({ resource, pathways, filtered: pathways })),
        token
      );
    }
  });

  test('call 2: every species, by p-value, ties in the stored order', async () => {
    assert.deepEqual(await order(REPORT_TOKENS.overrepresentation), [
      SUB_ONE,
      ALPHA,
      GAMMA,
      TWO_PARENT,
      MOUSE,
      BETA,
    ]);
    // beta pathway and its sub-pathway tie, stored in that order
    assert.deepEqual(await order(REPORT_TOKENS.expression), [
      'R-HSA-90000230',
      ALPHA,
      MOUSE,
      BETA,
      'R-HSA-90000130',
    ]);
    const all = await result(REPORT_TOKENS.overrepresentation);
    assert.equal(all.pathwaysFound, 6);
    assert.deepEqual(
      all.speciesSummary.map((s) => [s.name, s.pathways, s.filtered]),
      [
        ['Homo sapiens', 5, 5],
        ['Mus musculus', 1, 1],
      ]
    );
    assert.equal(all.pathways[0]?.species.dbId, 90000002, "the fixture graph's species");
  });

  test("call 2: includeDisease left out reads the stored analysis's own setting", async () => {
    const own = await result(
      REPORT_TOKENS.overrepresentation,
      'resource=TOTAL&importableOnly=false'
    );
    assert.equal(own.summary.includeDisease, false);
    assert.equal(own.pathwaysFound, 5);
    assert.ok(!own.pathways.some((p) => p.stId === TWO_PARENT));
    const asked = await result(REPORT_TOKENS.overrepresentation);
    assert.equal(asked.summary.includeDisease, true);
    assert.equal(asked.pathways.find((p) => p.stId === TWO_PARENT)?.inDisease, true);
  });

  test('call 2: filtered by resource and importable-only, its statistics with them', async () => {
    const token = REPORT_TOKENS.overrepresentation;
    const importable = await result(token, call2('TOTAL', true));
    assert.deepEqual(
      importable.pathways.map((p) => p.stId),
      [SUB_ONE, ALPHA, TWO_PARENT, MOUSE, BETA],
      'Gamma pathway is found through KEGG COMPOUND alone'
    );
    const alpha = (r: Result) => r.pathways.find((p) => p.stId === ALPHA);
    assert.deepEqual(
      [alpha(importable)?.entities.found, alpha(importable)?.reactions.found],
      [2, 2]
    );
    assert.deepEqual(
      importable.resourceSummary.map((r) => [r.resource, r.pathways, r.filtered]),
      [
        ['TOTAL', 6, 5],
        ['UNIPROT', 5, 5],
        ['COMPOUND', 2, 0],
      ]
    );
    const uniprot = await result(token, call2('UNIPROT'));
    assert.deepEqual(
      uniprot.pathways.map((p) => p.stId),
      [SUB_ONE, ALPHA, TWO_PARENT, MOUSE, BETA]
    );
    assert.equal(alpha(uniprot)?.entities.resource, 'UNIPROT');
    assert.equal(alpha(uniprot)?.reactions.resource, 'UNIPROT');
    const compound = await result(token, call2('COMPOUND'));
    assert.deepEqual(
      compound.pathways.map((p) => p.stId),
      [ALPHA, GAMMA]
    );
    // call 3: the reactions' columns unfiltered differ from the filtered ones
    const total = await result(token);
    assert.deepEqual([alpha(total)?.entities.found, alpha(total)?.reactions.found], [3, 3]);
    assert.equal(alpha(total)?.reactions.resource, 'TOTAL');
    // importable-only is ignored with a resource, as the service ignores it
    assert.deepEqual(await order(token, call2('COMPOUND', true)), [ALPHA, GAMMA]);
  });

  test('call 2: KEGG COMPOUND alone finds no pathway importable-only', async () => {
    const none = await result(REPORT_TOKENS.compounds, call2('TOTAL', true));
    assert.equal(none.pathwaysFound, 0);
    assert.deepEqual(none.pathways, []);
    assert.equal((await result(REPORT_TOKENS.compounds)).pathwaysFound, 2);
  });

  test("call 2: the expression result's columns and values, and each result's summary", async () => {
    const expression = await result(REPORT_TOKENS.expression);
    assert.deepEqual(expression.expression.columnNames, ['Placeholder A', 'Placeholder B']);
    assert.equal(expression.summary.type, 'EXPRESSION');
    assert.equal(expression.summary.sampleName, 'Placeholder sample');
    assert.deepEqual(
      expression.pathways.find((p) => p.stId === ALPHA)?.entities.exp,
      [0.875, 0.75]
    );
    assert.equal(expression.identifiersNotFound, 3);

    const interactors = await result(REPORT_TOKENS.interactors);
    assert.equal(interactors.summary.interactors, true);
    assert.equal(interactors.summary.fileName, 'placeholder-list.txt');
    assert.equal(interactors.summary.sampleName, undefined);
    const gammaSub = interactors.pathways.find((p) => p.stId === 'R-HSA-90000310')?.entities;
    assert.ok(gammaSub);
    assert.deepEqual(
      [gammaSub.found, gammaSub.curatedFound, gammaSub.interactorsFound],
      [1, 0, 1],
      'found through an interactor alone'
    );
    assert.deepEqual(await order(REPORT_TOKENS.interactors, call2('NCBI_PROTEIN')), [
      'R-HSA-90000131',
    ]);
    assert.deepEqual(await order(REPORT_TOKENS.interactors, call2('TOTAL', true)), [
      SUB_ONE,
      'R-HSA-90000310',
    ]);

    const comparison = await result(REPORT_TOKENS.speciesComparison);
    assert.equal(comparison.summary.type, 'SPECIES_COMPARISON');
    assert.equal(comparison.summary.species, 90000003, 'compared with mouse');
    assert.ok(comparison.pathways.every((p) => p.species.name === 'Homo sapiens'));
    assert.deepEqual(
      comparison.speciesSummary.map((s) => s.name),
      ['Homo sapiens'],
      'nothing found for mouse'
    );
  });

  test('call 4: the pathways posted, in their order with repeats, by stable or database id', async () => {
    const answer = await found(
      REPORT_TOKENS.overrepresentation,
      [ALPHA, SUB_ONE, 'R-HSA-90000999', ALPHA, '90000300', ''].join('\n')
    );
    assert.deepEqual(
      answer.map((f) => f.pathway),
      [ALPHA, SUB_ONE, ALPHA, '90000300']
    );
    // X00001 maps otherwise on each pathway: what the report takes from the first
    const mapsTo = (f: Found | undefined) => f?.entities.find((e) => e.id === 'XR0001')?.mapsTo;
    assert.deepEqual(mapsTo(answer[0]), [{ resource: 'UNIPROT', ids: ['XU0001'] }]);
    assert.deepEqual(mapsTo(answer[1]), [{ resource: 'UNIPROT', ids: ['XU0001', 'XU0001-2'] }]);
    assert.deepEqual(
      answer[3]?.entities.map((e) => e.mapsTo),
      [[{ resource: 'COMPOUND', ids: ['XC0001'] }], [{ resource: 'COMPOUND', ids: ['XC0002'] }]],
      "KEGG COMPOUND's mappings"
    );

    const [alpha] = await found(REPORT_TOKENS.expression, ALPHA);
    assert.ok(alpha);
    assert.deepEqual(alpha.expNames, ['Placeholder A', 'Placeholder B']);
    assert.deepEqual(
      alpha.entities.map((e) => [e.id, e.exp]),
      [
        ['XR0001', [1.5, -0.5]],
        ['XR0002', [0.25, 2]],
      ]
    );

    const [gammaSub, betaSubSub] = await found(
      REPORT_TOKENS.interactors,
      'R-HSA-90000310\nR-HSA-90000131'
    );
    assert.ok(gammaSub && betaSubSub);
    assert.deepEqual(gammaSub.entities, []);
    assert.deepEqual([gammaSub.foundEntities, gammaSub.foundInteractors], [0, 1]);
    assert.deepEqual(gammaSub.interactors, [
      {
        id: 'XR0005',
        exp: [],
        mapsTo: ['XU0005'],
        interactsWith: { resource: 'UNIPROT', ids: ['XU0007'] },
      },
    ]);
    assert.equal(betaSubSub.interactors[0]?.interactsWith.resource, 'NCBI_PROTEIN');
  });

  test("call 4: another content type is the framework's 415, an empty body its 400, none found the service's 404", async () => {
    const token = REPORT_TOKENS.overrepresentation;
    const json = await post(token, ALPHA, { ...JSON_TYPE, 'Content-Type': 'application/json' });
    assert.equal(json.status, 415);
    const body = (await json.json()) as { status: number; error: string; path: string };
    assert.deepEqual(
      [body.status, body.error, body.path],
      [415, 'Unsupported Media Type', `/AnalysisService/token/${token}/found/all`]
    );
    assert.equal(await bare(`/token/${token}/found/all?resource=TOTAL`, ALPHA), 415);
    assert.equal(
      (await post(token, ALPHA, { ...JSON_TYPE, 'Content-Type': 'text/plain;charset=UTF-8' }))
        .status,
      200
    );

    const empty = await post(token, '');
    assert.equal(empty.status, 400);
    assert.deepEqual(
      [((await empty.json()) as { error: string }).error],
      ['Bad Request'],
      "the framework's, not the service's form"
    );
    const none = await post(token, '\n');
    assert.equal(none.status, 404);
    assert.deepEqual(await none.json(), { code: 404, reason: 'Not Found', messages: [] });
    assert.equal((await post(token, 'R-HSA-90000999')).status, 404);
  });

  test('call 4: refuses another resource, and a GET', async () => {
    const token = REPORT_TOKENS.overrepresentation;
    assert.equal((await post(token, ALPHA, TEXT, '&resource=TOTAL')).status, 400, 'a repeat');
    const other = await fetch(`${stub.url}/token/${token}/found/all?resource=UNIPROT`, {
      method: 'POST',
      headers: TEXT,
      body: ALPHA,
    });
    assert.equal(other.status, 400);
    const read = await get(`/token/${token}/found/all`);
    assert.equal(read.status, 405);
    assert.equal(((await read.json()) as { error: string }).error, 'Method Not Allowed');
  });

  test('call 5: the identifiers not found, unpaged, in the stored order with repeats', async () => {
    const res = await get(`/token/${REPORT_TOKENS.expression}/notFound`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), [
      { id: 'XZ0003', exp: [0.5, 1] },
      { id: 'XZ0001', exp: [2, 3] },
      { id: 'XZ0003', exp: [0.75, 1] },
    ]);
    const none = await get(`/token/${REPORT_TOKENS.speciesComparison}/notFound`);
    assert.deepEqual(await none.json(), []);
    for (const query of ['page=1&pageSize=10', 'pageSize=10']) {
      const paged = await get(`/token/${REPORT_TOKENS.expression}/notFound?${query}`);
      assert.equal(paged.status, 400, query);
    }
  });

  test('call 2: refuses what the report never sends: a species, a page, a resource the result lacks', async () => {
    const token = REPORT_TOKENS.overrepresentation;
    for (const query of [
      `${call2()}&species=9606`,
      `${call2()}&page=1&pageSize=50`,
      `${call2()}&pageSize=50`,
      call2('uniprot'),
      call2('ENSEMBL'),
      call2('NOTONE'),
      `${call2()}&resource=TOTAL`,
      `${call2()}&sortBy=ENTITIES_PVALUE`,
      'resource=TOTAL&importableOnly=1&includeDisease=true',
    ]) {
      const res = await get(`/token/${token}?${query}`);
      assert.equal(res.status, 400, query);
      const body = (await res.json()) as { code: number; messages: string[] };
      assert.equal(body.code, 400, query);
    }
    // KEGG COMPOUND is the compounds result's only resource, not the expression result's
    assert.equal((await get(`/token/${REPORT_TOKENS.compounds}?${call2('COMPOUND')}`)).status, 200);
    assert.equal(
      (await get(`/token/${REPORT_TOKENS.expression}?${call2('COMPOUND')}`)).status,
      400
    );
  });

  test('every call: a gone token is 410, an unknown one 404, a malformed one the catch-all 500', async () => {
    const cases: [string, number][] = [
      [REPORT_TOKENS.gone, 410],
      [TOKENS.expired, 404],
      [TOKENS.undated, 404],
      ['notatoken', 500],
      [TOKENS.underscore, 500],
    ];
    for (const [token, status] of cases) {
      const answers = [
        await get(`/token/${token}/resources`),
        await get(`/token/${token}?${call2()}`),
        await post(token, ALPHA),
        await get(`/token/${token}/notFound`),
      ];
      for (const res of answers) {
        assert.equal(res.status, status, `${token} ${res.url}`);
        const body = (await res.json()) as { code: number; messages: string[] };
        assert.equal(body.code, status);
        assert.equal(body.messages.length, status === 500 ? 1 : 0);
      }
    }
  });

  test("a report's result forgotten after the check is 410 on each later call", async () => {
    const token = REPORT_TOKENS.expression;
    stub.forget(token, 1);
    assert.equal((await get(`/token/${token}/resources`)).status, 200);
    assert.equal((await get(`/token/${token}?${call2()}`)).status, 410);
    assert.equal((await post(token, ALPHA)).status, 410);
    assert.equal((await get(`/token/${token}/notFound`)).status, 410);
    stub.reset();
    assert.equal((await get(`/token/${token}/resources`)).status, 200, 'restored by reset');
  });

  test('records each call with its method, content type and body, to count them', async () => {
    const token = REPORT_TOKENS.overrepresentation;
    await get(`/token/${token}/resources`);
    await post(token, `${ALPHA}\n${SUB_ONE}`);
    assert.deepEqual(stub.requests, [
      {
        method: 'GET',
        path: `/AnalysisService/token/${token}/resources`,
        accept: 'application/json',
        contentType: undefined,
        body: '',
      },
      {
        method: 'POST',
        path: `/AnalysisService/token/${token}/found/all?resource=TOTAL`,
        accept: 'application/json',
        contentType: 'text/plain',
        body: `${ALPHA}\n${SUB_ONE}`,
      },
    ]);
  });
});
