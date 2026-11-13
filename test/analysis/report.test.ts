// The report's analysis client (spec 002 T005) against the analysis stub's report calls.
import assert from 'node:assert/strict';
import { after, afterEach, before, describe, test } from 'node:test';

import { AnalysisError, type AnalysisFailure } from '../../src/analysis/error.ts';
import {
  CHECK_TIMEOUT_MS,
  checkToken,
  foundElements,
  identifiersNotFound,
  readReportAnalysis,
  reportResource,
  resourceCounts,
  result,
  type ReportFilter,
} from '../../src/analysis/report.ts';
import { REPORT_TOKENS, TOKENS, startAnalysisStub, type AnalysisStub } from '../stubs/analysis.ts';

const TWO_PARENT = 'R-HSA-90000250';
const OR = REPORT_TOKENS.overrepresentation;

describe("the report's analysis client", () => {
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

  const report = async (token: string, filter: ReportFilter = { importableOnly: false }) =>
    readReportAnalysis(stub.url, await checkToken(stub.url, token), filter, { timeoutMs: 2_000 });
  const fails = (failure: AnalysisFailure) => (error: unknown) =>
    error instanceof AnalysisError && error.reason === failure;
  /** The calls made, as method and path without the base and the token. */
  const calls = (token: string) =>
    stub.requests.map((r) =>
      `${r.method} ${r.path.replace('/AnalysisService/', '')}`.replace(token, '{token}')
    );

  test('makes the calls in order: the check, the result, the found elements, the not found', async () => {
    const analysis = await report(OR);
    assert.deepEqual(calls(OR), [
      'GET token/{token}/resources',
      'GET token/{token}?resource=TOTAL&importableOnly=false&includeDisease=true',
      'POST token/{token}/found/all?resource=TOTAL',
      'GET token/{token}/notFound',
    ]);
    assert.ok(stub.requests.every((r) => r.accept === 'application/json'));
    assert.equal(analysis.resource, 'TOTAL');
    assert.equal(analysis.unfiltered, analysis.result, 'no call 3 without a filter');
    // call 4 posts call 2's pathways, one per line, as text
    const posted = stub.requests[2];
    assert.ok(posted);
    assert.equal(posted.contentType, 'text/plain');
    assert.deepEqual(
      posted.body.trim().split('\n'),
      analysis.result.pathways.map((p) => p.stId)
    );
    assert.deepEqual(
      analysis.found.map((f) => f.pathway),
      analysis.result.pathways.map((p) => p.stId)
    );
    assert.deepEqual(
      analysis.notFound.map((n) => n.id),
      ['XZ0002', 'XZ0001']
    );
  });

  test('asks for disease pathways, whatever the stored analysis says', async () => {
    // the over-representation analysis's own setting leaves them out
    const { result } = await report(OR);
    assert.equal(result.summary.includeDisease, true);
    assert.ok(result.pathways.some((p) => p.stId === TWO_PARENT && p.inDisease));
    assert.equal(result.pathwaysFound, 6);
  });

  test('sends no species: every species comes back', async () => {
    const { result } = await report(OR);
    assert.deepEqual(
      [...new Set(result.pathways.map((p) => p.species.name))],
      ['Homo sapiens', 'Mus musculus']
    );
    assert.ok(stub.requests.every((r) => !/[?&](species|page|pageSize)=/.test(r.path)));
  });

  test('makes call 3 only when the report filters', async () => {
    const unfilteredCalls = () =>
      calls(OR).filter((c) =>
        c.endsWith('?resource=TOTAL&importableOnly=false&includeDisease=true')
      ).length;
    await report(OR, { resource: 'TOTAL', importableOnly: false });
    assert.equal(unfilteredCalls(), 1, 'call 2 alone');
    stub.reset();
    const uniprot = await report(OR, { resource: 'UNIPROT', importableOnly: false });
    assert.deepEqual(calls(OR).slice(1, 3), [
      'GET token/{token}?resource=UNIPROT&importableOnly=false&includeDisease=true',
      'GET token/{token}?resource=TOTAL&importableOnly=false&includeDisease=true',
    ]);
    assert.equal(uniprot.unfiltered.pathways.length, 6);
    assert.equal(uniprot.result.pathways.length, 5);
    stub.reset();
    const importable = await report(OR, { importableOnly: true });
    assert.deepEqual(calls(OR).slice(1, 3), [
      'GET token/{token}?resource=TOTAL&importableOnly=true&includeDisease=true',
      'GET token/{token}?resource=TOTAL&importableOnly=false&includeDisease=true',
    ]);
    assert.notEqual(importable.unfiltered, importable.result);
  });

  test('makes no call 4 when call 2 has no pathway', async () => {
    const token = REPORT_TOKENS.compounds;
    const analysis = await report(token, { importableOnly: true });
    assert.deepEqual(analysis.result.pathways, []);
    assert.deepEqual(analysis.found, []);
    assert.ok(!calls(token).some((c) => c.startsWith('POST')));
    assert.ok(calls(token).includes('GET token/{token}/notFound'));
  });

  test('sends a resource the result lacks as the default, compared case and all', async () => {
    const lacked = await report(OR, { resource: 'uniprot', importableOnly: false });
    assert.equal(lacked.resource, 'TOTAL');
    assert.equal(
      calls(OR)[1],
      'GET token/{token}?resource=TOTAL&importableOnly=false&includeDisease=true'
    );
    stub.reset();
    // the expression result holds UniProt alone: its default
    const expression = await report(REPORT_TOKENS.expression, {
      resource: 'COMPOUND',
      importableOnly: false,
    });
    assert.equal(expression.resource, 'UNIPROT');
  });

  test("decides the report's resource from the result's resources", () => {
    const held = (...names: string[]) =>
      ['TOTAL', ...names].map((resource) => ({ resource, pathways: 1, filtered: 1 }));
    assert.equal(reportResource(undefined, held('UNIPROT')), 'TOTAL');
    assert.equal(reportResource('TOTAL', held('UNIPROT')), 'TOTAL');
    assert.equal(reportResource('UNIPROT', held('UNIPROT', 'COMPOUND')), 'UNIPROT');
    assert.equal(reportResource('ENSEMBL', held('UNIPROT')), 'UNIPROT');
    assert.equal(reportResource('ENSEMBL', held('UNIPROT', 'COMPOUND')), 'TOTAL');
    assert.equal(reportResource('Uniprot', held('UNIPROT', 'COMPOUND')), 'TOTAL');
  });

  test('reads the expression columns, the found values and the interactors', async () => {
    const expression = await report(REPORT_TOKENS.expression);
    assert.deepEqual(expression.result.columnNames, ['Placeholder A', 'Placeholder B']);
    assert.equal(expression.result.summary.sampleName, 'Placeholder sample');
    assert.deepEqual(expression.found[0]?.entities[0]?.exp.length, 2);
    assert.deepEqual(
      expression.notFound.map((n) => n.id),
      ['XZ0003', 'XZ0001', 'XZ0003'],
      'as the service gives them'
    );
    stub.reset();
    const interactors = await report(REPORT_TOKENS.interactors);
    assert.equal(interactors.result.summary.fileName, 'placeholder-list.txt');
    assert.deepEqual(
      interactors.found.flatMap((f) => f.interactors.map((i) => i.interactsWith.resource)),
      ['UNIPROT', 'NCBI_PROTEIN', 'UNIPROT']
    );
    stub.reset();
    const comparison = await report(REPORT_TOKENS.speciesComparison);
    assert.equal(comparison.result.summary.species, 90000003);
  });

  test("the check: the service's 404 is unknown-token, its 410 gone-token, anything else unavailable", async () => {
    const check = (token: string, timeoutMs?: number) =>
      checkToken(stub.url, token, timeoutMs === undefined ? {} : { timeoutMs });
    await assert.rejects(check(TOKENS.expired), fails('unknown-token'));
    await assert.rejects(check(REPORT_TOKENS.gone), fails('gone-token'));
    await assert.rejects(check(TOKENS.unreadable), fails('unavailable'));
    stub.refuse(1);
    await assert.rejects(check(OR), fails('unavailable'));
    const sent = stub.requests.length;
    await assert.rejects(check('notatoken'), fails('unknown-token'));
    assert.equal(stub.requests.length, sent, 'a malformed token is never sent');
    stub.slow(300);
    await assert.rejects(check(OR, 100), fails('unavailable'));
    assert.equal(CHECK_TIMEOUT_MS, 5_000);
    await assert.rejects(
      checkToken('http://127.0.0.1:1/AnalysisService', OR),
      fails('unavailable')
    );
  });

  test('sends the canonical token', async () => {
    const twice = encodeURIComponent(encodeURIComponent(OR));
    const check = await checkToken(stub.url, twice);
    assert.equal(check.token, OR);
    await readReportAnalysis(stub.url, check, { importableOnly: false });
    assert.ok(stub.requests.every((r) => r.path.includes(`/token/${OR}`)));
  });

  test('a 410 from any call after the check is gone-token, not none found', async () => {
    /** Gone at the call named, after the check and the calls before it, which is the last made. */
    const goneAt = (call: string, made: number) => (error: unknown) =>
      fails('gone-token')(error) &&
      error instanceof Error &&
      error.message.startsWith(`${call}:`) &&
      stub.requests.length === made;
    const token = REPORT_TOKENS.expression;
    for (const [after, call] of [
      [1, 'The result'],
      [2, 'The found elements'],
      [3, 'The identifiers not found'],
    ] as const) {
      stub.reset();
      stub.forget(token, after);
      await assert.rejects(report(token), goneAt(call, after + 1), call);
    }
    stub.reset();
    stub.forget(OR, 2);
    await assert.rejects(
      report(OR, { resource: 'UNIPROT', importableOnly: false }),
      goneAt('The result unfiltered', 3)
    );
  });

  test('an answer that does not fit is refused, naming no value; a failure part way is unavailable', async () => {
    assert.throws(() => resourceCounts([{ resource: 'TOTAL', pathways: '1', filtered: 1 }]));
    assert.throws(() => result({ summary: {} }));
    assert.throws(
      () => foundElements([{ pathway: 'R-HSA-1', entities: [{ id: 'XR0001', mapsTo: [{}] }] }]),
      (error: unknown) => error instanceof Error && !error.message.includes('XR0001')
    );
    assert.throws(() => identifiersNotFound([{ id: 7 }]));
    // a list left out is empty: the service writes no nulls
    assert.deepEqual(foundElements([{ pathway: 'R-HSA-1' }]), [
      { pathway: 'R-HSA-1', entities: [], interactors: [] },
    ]);
    stub.refuse(1, 1);
    await assert.rejects(report(OR), fails('unavailable'));
  });
});
