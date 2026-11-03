import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, afterEach, before, describe, test } from 'node:test';

import {
  AnalysisError,
  filterFound,
  readAnalysis,
  submittedIdentifiers,
  type AnalysedEvent,
  type AnalysisFailure,
} from '../../src/analysis/client.ts';
import {
  NOT_FOUND,
  TOKENS,
  issue,
  startAnalysisStub,
  type AnalysisStub,
} from '../stubs/analysis.ts';

const ALPHA = 'R-HSA-90000200';
const PARENT = 'R-HSA-90000210';
const REACTION = 'R-HSA-90000211';
// a pathway the analysis did not hit
const UNHIT = 'R-HSA-90000300';
const SUMMARY = 'resource=TOTAL&importableOnly=false&includeDisease=true&pageSize=1&page=1';
const JSON_TYPE = 'application/json';
const CSV_TYPE = 'text/csv, application/json';

/** The stub's submitted identifiers that map: X00001, X00002 and X00003 (on two rows). */
const FOUND = 3;

describe('the analysis client', () => {
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

  const read = (token: string, events: readonly AnalysedEvent[] = []) =>
    readAnalysis(stub.url, { token, species: 'Homo sapiens', events }, { timeoutMs: 2_000 });
  const fails = (failure: AnalysisFailure) => (error: unknown) =>
    error instanceof AnalysisError && error.reason === failure;
  const paths = () => stub.requests.map((r) => r.path.replace('/AnalysisService/', ''));

  test("reads the properties: the pathways hit with disease pathways, the identifiers found from the CSV's distinct submitted identifiers", async () => {
    const { properties } = await read(TOKENS.stored);
    assert.deepEqual(properties, {
      token: TOKENS.stored,
      type: 'OVERREPRESENTATION',
      species: 'Homo sapiens',
      projection: true,
      interactors: true,
      identifiersFound: FOUND,
      identifiersTotal: FOUND + NOT_FOUND,
      // every species' pathways, disease pathways among them (the analysis's own leaves them out)
      pathwaysHit: 6,
    });
  });

  test('sends the canonical token, each call its Accept, and asks for the CSV last', async () => {
    const token = TOKENS.stored;
    const bare = decodeURIComponent(token).replace(/=+$/, '');
    let deep = token;
    for (let i = 0; i < 1000; i++) deep = encodeURIComponent(deep);
    for (const given of [token, encodeURIComponent(encodeURIComponent(token)), bare, deep]) {
      stub.reset();
      await read(given, [{ kind: 'pathway', stId: ALPHA }]);
      assert.deepEqual(
        stub.requests.map((r) => [r.path.replace('/AnalysisService/', ''), r.accept]),
        [
          [`token/${token}?${SUMMARY}`, JSON_TYPE],
          [`token/${token}/found/entities/${ALPHA}?resource=TOTAL`, JSON_TYPE],
          [`token/${token}/found/interactors/${ALPHA}?resource=TOTAL`, JSON_TYPE],
          [`download/${token}/entities/found/TOTAL/found.csv`, CSV_TYPE],
        ],
        given
      );
    }
  });

  test("the CSV is refused to JSON alone, so the client's Accept lists text/csv", async () => {
    const res = await fetch(
      `${stub.url}/download/${TOKENS.stored}/entities/found/TOTAL/found.csv`,
      {
        headers: { Accept: JSON_TYPE },
      }
    );
    assert.equal(res.status, 406);
    await res.body?.cancel();
  });

  test("reads a pathway's found lists, and a reaction's from its parent's, filtered to its own identifiers", async () => {
    const { found } = await read(TOKENS.stored, [
      { kind: 'pathway', stId: PARENT },
      { kind: 'reaction', stId: REACTION, parent: PARENT, identifiers: ['X00003-1', 'X00009'] },
      { kind: 'pathway', stId: UNHIT },
    ]);
    assert.deepEqual(found.get(PARENT), {
      entities: [
        { identifier: 'X00001', mapsTo: ['X00001'], resource: 'UNIPROT' },
        { identifier: 'X00003', mapsTo: ['X00003-1', 'X00003-2'], resource: 'UNIPROT' },
      ],
      interactors: [{ identifier: 'X00002', mapsTo: ['X00009'], resource: 'UNIPROT' }],
    });
    assert.deepEqual(found.get(REACTION), {
      entities: [{ identifier: 'X00003', mapsTo: ['X00003-1'], resource: 'UNIPROT' }],
      interactors: [{ identifier: 'X00002', mapsTo: ['X00009'], resource: 'UNIPROT' }],
    });
    // a found/… 404 is none found
    assert.deepEqual(found.get(UNHIT), { entities: [], interactors: [] });
    // the parent's lists are asked for once
    assert.equal(paths().filter((p) => p.includes(`/found/entities/${PARENT}`)).length, 1);
  });

  test("maps the service's 404 to unknown-token, its 410 to gone-token, and other failures to unavailable", async () => {
    await assert.rejects(read(TOKENS.expired), fails('unknown-token'));
    await assert.rejects(read(TOKENS.gone), fails('gone-token'));
    await assert.rejects(read(TOKENS.unreadable), fails('unavailable'));
    stub.refuse(1);
    await assert.rejects(read(TOKENS.stored), fails('unavailable'));
    await assert.rejects(read('%'), fails('unknown-token'));
    assert.equal(stub.requests.length, 4, 'a token that cannot be decoded is never sent');
  });

  test('a malformed token is unknown-token, and nothing is sent', async () => {
    const whole = issue('20200101000000_123');
    const malformed = [
      '',
      'QQ=',
      'Xw==',
      TOKENS.underscore,
      TOKENS.undated,
      issue(`20200101000000_${'1'.repeat(20)}`),
      `${whole.slice(0, 8)}/${whole.slice(8)}`,
      `${whole.slice(0, 8)}%2F${whole.slice(8)}`,
      `${whole.slice(0, 8)}++${whole.slice(8)}`,
      `${whole}A`,
      '%25',
    ];
    for (const token of malformed) {
      await assert.rejects(read(token, [{ kind: 'pathway', stId: ALPHA }]), fails('unknown-token'));
    }
    assert.deepEqual(stub.requests, []);
  });

  test('a result gone after the summary ends the PDF as gone-token, from found/… or from the CSV', async () => {
    const events: AnalysedEvent[] = [{ kind: 'pathway', stId: PARENT }];
    stub.forget(TOKENS.recent, 1);
    await assert.rejects(read(TOKENS.recent, events), fails('gone-token'));
    assert.match(paths().at(-1) ?? '', /\/found\/entities\//);
    stub.reset();
    // the summary and both found lists answered: the CSV is the 410
    stub.forget(TOKENS.recent, 3);
    await assert.rejects(read(TOKENS.recent, events), fails('gone-token'));
    assert.match(paths().at(-1) ?? '', /^download\//);
  });

  test("a result gone after the summary, past its 7 days, is not read as none found: the CSV's 404 ends it as unknown-token", async () => {
    stub.forget(TOKENS.stored, 1);
    await assert.rejects(
      read(TOKENS.stored, [{ kind: 'pathway', stId: PARENT }]),
      fails('unknown-token')
    );
    assert.match(paths().at(-1) ?? '', /^download\//);
  });

  test('a 503 from found/… or from the CSV, after the summary, is unavailable, not none found', async () => {
    const events: AnalysedEvent[] = [{ kind: 'pathway', stId: PARENT }];
    stub.refuse(1, 1);
    await assert.rejects(read(TOKENS.stored, events), fails('unavailable'));
    assert.match(paths().at(-1) ?? '', /\/found\/entities\//);
    stub.reset();
    // the summary and both found lists answered: the CSV is the 503
    stub.refuse(1, 3);
    await assert.rejects(read(TOKENS.stored, events), fails('unavailable'));
    assert.match(paths().at(-1) ?? '', /^download\//);
  });
});

/**
 * A service answering what the stub never does, each under its own base path: a summary
 * and found lists of the wrong shape, no answer at all, and a redirect to the stub.
 */
describe('the analysis client, given answers the service should not give', () => {
  let stub: AnalysisStub;
  let odd: ReturnType<typeof createServer>;
  let base = '';
  const hanging = new Set<ServerResponse>();
  /** A summary of the right shape, so that the found lists are asked for. */
  const summary = {
    summary: { token: 'x', type: 'OVERREPRESENTATION', projection: true, interactors: true },
    identifiersNotFound: 0,
    pathwaysFound: 1,
  };
  const uniprot = (ids: string[]) => ({ resource: 'UNIPROT', ids });
  /** Each base path's one odd entity. */
  const ODD_ENTITIES: Record<string, unknown> = {
    entities: { id: 'X00001', mapsTo: ['X00001'] },
    'entities-unmapped': { id: 'X00001' },
    'entities-no-resource': { id: 'X00001', mapsTo: [{ ids: ['X00001'] }] },
    'entities-null-resource': { id: 'X00001', mapsTo: [{ resource: null, ids: ['X00001'] }] },
    'entities-no-id': { mapsTo: [uniprot(['X00001'])] },
  };
  /** Each base path's one odd interactor. */
  const ODD_INTERACTORS: Record<string, unknown> = {
    interactors: { id: 'X00002', exp: [], mapsTo: ['X00002'] },
    'interactor-ids': { id: 'X00002', interactsWith: { resource: 'UNIPROT', ids: 'X9' } },
    'interactors-no-resource': { id: 'X00002', interactsWith: { ids: ['X00009'] } },
    'interactors-no-id': { interactsWith: uniprot(['X00009']) },
  };
  before(async () => {
    stub = await startAnalysisStub();
    odd = createServer((req, res) => {
      const url = req.url ?? '/';
      const json = (body: unknown) =>
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
      if (url.startsWith('/hang/')) hanging.add(res);
      else if (url.startsWith('/redirect/'))
        res.writeHead(302, { Location: `${stub.url}/${url.replace(/^\/redirect\//, '')}` }).end();
      else if (url.startsWith('/summary/')) json({ summary: {}, pathwaysFound: '6' });
      else if (!url.includes('/found/')) json(summary);
      else {
        // under each base path, its found list is odd and the other one 404
        const bodies = url.includes('/found/entities/') ? ODD_ENTITIES : ODD_INTERACTORS;
        const name = url.split('/')[1] ?? '';
        if (Object.hasOwn(bodies, name)) json({ identifiers: [bodies[name]] });
        else res.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve) => odd.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${String((odd.address() as AddressInfo).port)}`;
  });
  after(async () => {
    for (const res of hanging) res.destroy();
    odd.closeAllConnections();
    await new Promise<void>((resolve) =>
      odd.close(() => {
        resolve();
      })
    );
    await stub.close();
  });

  const read = (
    path: string,
    {
      timeoutMs = 2_000,
      events = [{ kind: 'pathway', stId: PARENT }],
    }: {
      timeoutMs?: number;
      events?: AnalysedEvent[];
    } = {}
  ) =>
    readAnalysis(
      `${base}/${path}`,
      { token: TOKENS.stored, species: 'Homo sapiens', events },
      { timeoutMs }
    );
  const unavailable = (error: unknown) =>
    error instanceof AnalysisError && error.reason === 'unavailable';

  test('a summary of another shape is unavailable', async () => {
    // no events, so that nothing but the summary's check stops it
    await assert.rejects(read('summary', { events: [] }), unavailable);
  });

  test('found lists of another shape are unavailable', async () => {
    // entities mapping to bare strings; interactors with nothing they interact with, or
    // interacting with a string where a list belongs
    await assert.rejects(read('entities'), unavailable);
    await assert.rejects(read('interactors'), unavailable);
    await assert.rejects(read('interactor-ids'), unavailable);
  });

  test('an entity with no maps-to is unavailable', async () => {
    await assert.rejects(read('entities-unmapped'), unavailable);
  });

  test('a row with no resource, or a null one, is unavailable', async () => {
    await assert.rejects(read('entities-no-resource'), unavailable);
    await assert.rejects(read('entities-null-resource'), unavailable);
    await assert.rejects(read('interactors-no-resource'), unavailable);
  });

  test('an identifier with no id is unavailable', async () => {
    await assert.rejects(read('entities-no-id'), unavailable);
    await assert.rejects(read('interactors-no-id'), unavailable);
  });

  // bounded, so that a client with no timeout fails the test rather than hanging it
  test('a call with no answer within its time is unavailable', { timeout: 2_000 }, async () => {
    await assert.rejects(read('hang', { timeoutMs: 100 }), unavailable);
  });

  test('a redirect is unavailable, and the token is not sent on', async () => {
    await assert.rejects(read('redirect'), unavailable);
    assert.deepEqual(stub.requests, []);
  });
});

test('counts the distinct submitted identifiers, not the rows', () => {
  const csv =
    'Submitted identifier,Found identifier,Resource\r\nA,A1,UNIPROT\r\nA,A2,UNIPROT\r\nB,B,CHEBI\r\n';
  assert.equal(submittedIdentifiers(csv), 2);
  assert.equal(submittedIdentifiers('Submitted identifier,Found identifier,Resource\n'), 0);
});

test('a reaction keeps only the rows naming its own identifiers', () => {
  const found = {
    entities: [{ identifier: 'A', mapsTo: ['A1', 'A2'], resource: 'UNIPROT' }],
    interactors: [{ identifier: 'B', mapsTo: ['C'], resource: 'UNIPROT' }],
  };
  assert.deepEqual(filterFound(found, ['A2']), {
    entities: [{ identifier: 'A', mapsTo: ['A2'], resource: 'UNIPROT' }],
    interactors: [],
  });
});
