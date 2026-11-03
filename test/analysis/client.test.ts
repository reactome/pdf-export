import assert from 'node:assert/strict';
import { after, afterEach, before, describe, test } from 'node:test';

import {
  AnalysisError,
  filterFound,
  readAnalysis,
  submittedIdentifiers,
  type AnalysedEvent,
  type AnalysisFailure,
} from '../../src/analysis/client.ts';
import { canonicalToken } from '../../src/analysis/token.ts';
import { NOT_FOUND, TOKENS, startAnalysisStub, type AnalysisStub } from '../stubs/analysis.ts';

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
    for (const given of [token, encodeURIComponent(encodeURIComponent(token)), bare]) {
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

test('the canonical token is padded Base64 with its = as %3D, however often it was encoded', () => {
  assert.equal(canonicalToken('QUJD'), 'QUJD');
  assert.equal(canonicalToken('QUI'), 'QUI%3D');
  assert.equal(canonicalToken('QQ%3D%3D'), 'QQ%3D%3D');
  assert.equal(canonicalToken('QQ%25253D%25253D'), 'QQ%3D%3D');
});
