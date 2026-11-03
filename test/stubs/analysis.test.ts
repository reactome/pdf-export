import assert from 'node:assert/strict';
import { request } from 'node:http';
import { after, afterEach, before, describe, test } from 'node:test';

import { NOT_FOUND, TOKENS, issue, startAnalysisStub, type AnalysisStub } from './analysis.ts';

const PARENT = 'R-HSA-90000210';
const JSON_TYPE = { Accept: 'application/json' };
const CSV_TYPE = { Accept: 'text/csv, application/json' };
const SUMMARY = 'resource=TOTAL&importableOnly=false&includeDisease=true&pageSize=1&page=1';

interface Summary {
  summary: { token: string; includeDisease: boolean };
  pathwaysFound: number;
  identifiersNotFound: number;
  pathways: { stId: string }[];
}
interface Found {
  identifiers: { id: string }[];
  found: number;
}

describe('the analysis stub', () => {
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

  const get = (path: string, headers: Record<string, string> = JSON_TYPE) =>
    fetch(`${stub.url}${path}`, { headers });
  const summary = async (token: string, query = SUMMARY) =>
    (await (await get(`/token/${token}?${query}`)).json()) as Summary;
  /** A request with no `Accept` header at all, which fetch would add. */
  const bare = (path: string) =>
    new Promise<number | undefined>((resolve, reject) => {
      request(`${stub.url}${path}`, (res) => {
        res.resume();
        resolve(res.statusCode);
      })
        .on('error', reject)
        .end();
    });
  const csv = (token: string, headers = CSV_TYPE) =>
    get(`/download/${token}/entities/found/TOTAL/result.csv`, headers);

  test("answers a stored result's summary, though it is older than 7 days", async () => {
    const res = await get(`/token/${TOKENS.stored}?${SUMMARY}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/json;charset=UTF-8');
    const body = (await res.json()) as Summary;
    assert.equal(body.summary.token, TOKENS.stored);
    assert.equal(body.identifiersNotFound, NOT_FOUND);
    assert.equal(body.pathways.length, 1, 'paged to one pathway');
    assert.equal(body.pathways[0]?.stId, PARENT);
  });

  test("counts the pathways hit by the request's includeDisease, else by the analysis's own", async () => {
    const withDisease = await summary(TOKENS.stored);
    const own = await summary(TOKENS.stored, 'resource=TOTAL&pageSize=1&page=1');
    const without = await summary(TOKENS.stored, SUMMARY.replace('true', 'false'));
    assert.equal(withDisease.pathwaysFound, 6);
    assert.equal(withDisease.summary.includeDisease, true);
    assert.equal(own.pathwaysFound, 5);
    assert.equal(own.summary.includeDisease, false);
    assert.equal(without.pathwaysFound, 5);
  });

  test('counts another number of pathways when a species is sent', async () => {
    const human = await summary(TOKENS.stored, `${SUMMARY}&species=9606`);
    assert.equal(human.pathwaysFound, 4);
    assert.equal(
      (await summary(TOKENS.stored, `${SUMMARY}&species=Mus+musculus`)).pathwaysFound,
      2
    );
  });

  test("answers the found entities and interactors on a reaction's first parent pathway", async () => {
    const entities = await get(`/token/${TOKENS.stored}/found/entities/${PARENT}?resource=TOTAL`);
    assert.equal(entities.status, 200);
    const e = (await entities.json()) as Found;
    assert.deepEqual(
      e.identifiers.map((i) => i.id),
      ['X00001', 'X00003']
    );
    assert.equal(e.found, 2);
    const interactors = await get(
      `/token/${TOKENS.stored}/found/interactors/${PARENT}?resource=TOTAL`
    );
    assert.equal(interactors.status, 200);
    assert.deepEqual(
      ((await interactors.json()) as Found).identifiers.map((i) => i.id),
      ['X00002']
    );
  });

  test("answers 404 for a pathway's found entities or interactors when there are none", async () => {
    for (const path of [
      `/token/${TOKENS.stored}/found/entities/R-HSA-90000300?resource=TOTAL`,
      `/token/${TOKENS.stored}/found/interactors/R-HSA-90000200?resource=TOTAL`,
    ]) {
      const res = await get(path);
      assert.equal(res.status, 404, path);
      assert.deepEqual(await res.json(), { code: 404, reason: 'Not Found', messages: [] });
    }
  });

  test('lists the found identifiers in the CSV, one submitted identifier on two rows', async () => {
    const res = await csv(TOKENS.stored);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/csv;charset=UTF-8');
    const rows = (await res.text()).trim().split('\n');
    assert.equal(rows[0], 'Submitted identifier,Found identifier,Resource');
    const submitted = rows.slice(1).map((row) => row.split(',')[0]);
    assert.equal(submitted.length, 4, 'rows');
    assert.equal(new Set(submitted).size, 3, 'distinct submitted identifiers');
  });

  test("answers the CSV to no Accept or one listing text/csv, and the framework's 406 to JSON alone", async () => {
    assert.equal(await bare(`/download/${TOKENS.stored}/entities/found/TOTAL/a.csv`), 200);
    assert.equal((await csv(TOKENS.stored, { Accept: 'text/csv' })).status, 200);
    assert.equal(
      (await csv(TOKENS.stored, { Accept: 'text/csv;q=0, application/json' })).status,
      200
    );
    const refused = await csv(TOKENS.stored, JSON_TYPE);
    assert.equal(refused.status, 406);
    const body = (await refused.json()) as { status: number; error: string };
    assert.equal(body.status, 406);
    assert.equal(body.error, 'Not Acceptable');
    assert.equal((await get(`/token/${TOKENS.stored}`, { Accept: 'text/csv' })).status, 406);
  });

  test("answers each token case of T009's table", async () => {
    const cases: [string, number][] = [
      [TOKENS.gone, 410],
      [TOKENS.lastDay, 410],
      [TOKENS.future, 410],
      [TOKENS.expired, 404],
      [TOKENS.undated, 404],
      [TOKENS.underscore, 500],
      [TOKENS.unreadable, 500],
      ['not-base64!', 500],
      ['QQ=', 500],
      ['%25', 500],
      // a token nested in `%25` layers is decoded until it no longer changes
      [TOKENS.stored.replaceAll('%', '%2525'), 200],
    ];
    for (const [token, status] of cases) {
      const res = await get(`/token/${token}?${SUMMARY}`);
      assert.equal(res.status, status, token);
      if (status === 200) continue;
      const body = (await res.json()) as { code: number; messages: string[] };
      assert.equal(body.code, status, token);
      assert.equal(body.messages.length, status === 500 ? 1 : 0, token);
    }
  });

  test("answers an encoded / with the servlet container's HTML 400, and a raw one as another route", async () => {
    const encoded = await get(`/token/abc%2Fdef?${SUMMARY}`);
    assert.equal(encoded.status, 400);
    assert.match(encoded.headers.get('content-type') ?? '', /^text\/html/);
    assert.match(await encoded.text(), /^<!doctype html>/);
    const raw = await get(`/token/abc/def`);
    assert.equal(raw.status, 404);
    assert.equal(((await raw.json()) as { error: string }).error, 'Not Found');
  });

  test('answers 410 from found/… and the CSV when a recent result goes after the summary', async () => {
    stub.forget(TOKENS.recent, 1);
    assert.equal((await get(`/token/${TOKENS.recent}?${SUMMARY}`)).status, 200);
    assert.equal(
      (await get(`/token/${TOKENS.recent}/found/entities/${PARENT}?resource=TOTAL`)).status,
      410
    );
    assert.equal((await csv(TOKENS.recent)).status, 410);
  });

  test('answers 404 from the CSV when an older result goes after the summary', async () => {
    stub.forget(TOKENS.stored, 2);
    assert.equal((await get(`/token/${TOKENS.stored}?${SUMMARY}`)).status, 200);
    assert.equal(
      (await get(`/token/${TOKENS.stored}/found/entities/${PARENT}?resource=TOTAL`)).status,
      200
    );
    assert.equal((await csv(TOKENS.stored)).status, 404);
  });

  test('answers 503 on request, a given number of times', async () => {
    stub.refuse(1);
    assert.equal((await get(`/token/${TOKENS.stored}?${SUMMARY}`)).status, 503);
    assert.equal((await get(`/token/${TOKENS.stored}?${SUMMARY}`)).status, 200);
  });

  test('answers 503 on request after a given number of requests are answered', async () => {
    stub.refuse(1, 2);
    const statuses = [];
    for (let i = 0; i < 4; i++) {
      statuses.push((await get(`/token/${TOKENS.stored}?${SUMMARY}`)).status);
    }
    assert.deepEqual(statuses, [200, 200, 503, 200]);
  });

  test('answers 400 to a parameter pdf-export never sends, a bad value or a repeat', async () => {
    for (const query of [
      'includedisease=true',
      'includeDisease=yes',
      'includeDisease=true&includeDisease=true',
      'sortBy=ENTITIES_PVALUE',
    ]) {
      assert.equal((await get(`/token/${TOKENS.stored}?${query}`)).status, 400, query);
    }
    const csvQuery = `/download/${TOKENS.stored}/entities/found/TOTAL/a.csv?resource=TOTAL`;
    assert.equal((await get(csvQuery, CSV_TYPE)).status, 400);
  });

  test("answers 400 to anything but FR-006's defaults: the TOTAL resource, not importable-only", async () => {
    for (const path of [
      `/token/${TOKENS.stored}?${SUMMARY.replace('TOTAL', 'UNIPROT')}`,
      `/token/${TOKENS.stored}?${SUMMARY.replace('importableOnly=false', 'importableOnly=true')}`,
      `/token/${TOKENS.stored}/found/entities/${PARENT}?resource=ENSEMBL`,
    ]) {
      assert.equal((await get(path)).status, 400, path);
    }
    const other = await get(
      `/download/${TOKENS.stored}/entities/found/UNIPROT/result.csv`,
      CSV_TYPE
    );
    assert.equal(other.status, 400);
  });

  test('issues tokens as the service does, and records each request with its Accept', async () => {
    assert.equal(issue('20261103123127_10'), 'MjAyNjExMDMxMjMxMjdfMTA%3D');
    await get(`/token/${TOKENS.stored}?${SUMMARY}`);
    await bare(`/token/${TOKENS.stored}`);
    assert.deepEqual(stub.requests, [
      { path: `/AnalysisService/token/${TOKENS.stored}?${SUMMARY}`, accept: 'application/json' },
      { path: `/AnalysisService/token/${TOKENS.stored}`, accept: undefined },
    ]);
    stub.reset();
    assert.deepEqual(stub.requests, []);
  });
});
