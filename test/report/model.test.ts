// The report model (spec 002 T006) from the analysis stub's answers.
import assert from 'node:assert/strict';
import { after, afterEach, before, describe, test } from 'node:test';

import {
  checkToken,
  readReportAnalysis,
  type ReportAnalysis,
  type ReportFilter,
} from '../../src/analysis/report.ts';
import type { SpeciesRef } from '../../src/graph/queries.ts';
import { buildReport, reportName, reportParameters } from '../../src/report/model.ts';
import { REPORT_TOKENS, startAnalysisStub, type AnalysisStub } from '../stubs/analysis.ts';

// the fixture graph's species, as the graph resolves them
const HUMAN: SpeciesRef = { dbId: 90000002, taxId: '9606', name: 'Homo sapiens' };
const MOUSE: SpeciesRef = { dbId: 90000003, taxId: '10090', name: 'Mus musculus' };
const OR = REPORT_TOKENS.overrepresentation;

describe("the report's parameters", () => {
  const read = (query: string) => reportParameters(new URLSearchParams(query));
  const number = (query: string) => {
    const parameters = read(query);
    return 'invalid' in parameters ? parameters : parameters.number;
  };

  test('clamps the number to 1–50, 25 by default or empty', () => {
    const cases: [string, number][] = [
      ['', 25],
      ['number=', 25],
      ['number=0', 1],
      ['number=-1', 1],
      ['number=1', 1],
      ['number=50', 50],
      ['number=51', 50],
      ['number=2147483647', 50],
      ['number=+7', 7],
      ['number=%201%200%20', 10],
      ['number=0x10', 16],
      ['number=%2310', 16],
      ['number=7&number=abc', 7],
    ];
    for (const [query, expected] of cases) assert.equal(number(query), expected, query);
  });

  test("refuses a number or flag that is not one, as today's framework does", () => {
    for (const query of [
      'number=abc',
      'number=1.5',
      'number=2147483648',
      'number=%2B0x10',
      'importableOnly=maybe',
    ]) {
      assert.ok('invalid' in read(query), query);
    }
    assert.deepEqual(read('number=abc'), { invalid: 'number' });
    assert.deepEqual(read('importableOnly=maybe'), { invalid: 'importableOnly' });
  });

  test("reads importableOnly as the framework's flag, and the resource as given", () => {
    const flag = (query: string) => {
      const parameters = read(query);
      return 'invalid' in parameters ? parameters : parameters.importableOnly;
    };
    for (const value of ['true', 'TRUE', 'on', 'yes', '1', '%20true%20']) {
      assert.equal(flag(`importableOnly=${value}`), true, value);
    }
    for (const value of ['', 'false', 'off', 'no', '0']) {
      assert.equal(flag(`importableOnly=${value}`), false, value);
    }
    assert.deepEqual(read('resource=uniprot&diagramProfile=Modern&analysisProfile=x'), {
      number: 25,
      resource: 'uniprot',
      importableOnly: false,
    });
    assert.deepEqual(read('resource='), { number: 25, resource: undefined, importableOnly: false });
    const twice = read('resource=UNIPROT&resource=COMPOUND');
    assert.ok(!('invalid' in twice));
    assert.equal(twice.resource, 'UNIPROT,COMPOUND');
  });
});

describe('the report model', () => {
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

  const analyse = async (token: string, filter: ReportFilter = { importableOnly: false }) =>
    readReportAnalysis(stub.url, await checkToken(stub.url, token), filter);
  const build = async (
    token: string,
    filter?: ReportFilter,
    species = HUMAN,
    number = 25,
    comparedWith: SpeciesRef | null = null
  ) => buildReport(await analyse(token, filter), species, number, comparedWith);

  test("reports the first number of the result's pathways in the report's species", async () => {
    const human = await build(OR);
    assert.deepEqual(
      human.pathways.map((p) => p.stId),
      ['R-HSA-90000210', 'R-HSA-90000200', 'R-HSA-90000300', 'R-HSA-90000250', 'R-HSA-90000100']
    );
    assert.deepEqual(
      (await build(OR, undefined, HUMAN, 2)).pathways.map((p) => p.stId),
      ['R-HSA-90000210', 'R-HSA-90000200']
    );
    assert.deepEqual(
      (await build(OR, undefined, MOUSE)).pathways.map((p) => p.stId),
      ['R-MMU-90000900']
    );
    // a species comparison finds nothing for the species compared with
    assert.deepEqual((await build(REPORT_TOKENS.speciesComparison, undefined, MOUSE)).pathways, []);
    // the counts span every species
    assert.equal(human.pathwaysHit, 6);
  });

  test("a resource the result lacks becomes the result's default", async () => {
    // the expression result holds one resource besides TOTAL: that one
    const one = await build(REPORT_TOKENS.expression, {
      resource: 'COMPOUND',
      importableOnly: false,
    });
    assert.equal(one.resource, 'UNIPROT');
    assert.deepEqual(one.resources, ['UNIPROT']);
    // the over-representation result holds two: TOTAL, with a table for each
    const two = await build(OR, { resource: 'ENSEMBL', importableOnly: false });
    assert.equal(two.resource, 'TOTAL');
    assert.deepEqual(two.resources, ['UNIPROT', 'COMPOUND']);
    assert.deepEqual((await build(OR, { resource: 'COMPOUND', importableOnly: false })).resources, [
      'COMPOUND',
    ]);
  });

  test('importable-only acts only with TOTAL', async () => {
    assert.equal((await build(OR, { importableOnly: true })).importableOnly, true);
    const uniprot = await build(OR, { resource: 'UNIPROT', importableOnly: true });
    assert.equal(uniprot.importableOnly, false);
  });

  test("takes the reactions' columns from the unfiltered result when the report filters", async () => {
    const model = await build(OR, { resource: 'UNIPROT', importableOnly: false });
    const alpha = model.pathways.find((p) => p.stId === 'R-HSA-90000200');
    assert.ok(alpha);
    // UniProt alone finds 2 of its reactions; all its identifiers together 3
    assert.equal(alpha.statistics.entities.found, 2);
    assert.equal(alpha.statistics.reactions.found, 3);
  });

  test("an identifier in two pathways takes the first's mappings and values", async () => {
    const model = await build(OR);
    const uniprot = model.found.find((f) => f.resource === 'UNIPROT');
    assert.ok(uniprot);
    // Alpha sub one comes before Alpha pathway, and maps XR0001 to two accessions
    assert.deepEqual(
      uniprot.rows.find((r) => r.id === 'XR0001'),
      { id: 'XR0001', exp: [], mapsTo: ['XU0001', 'XU0001-2'] }
    );
    assert.deepEqual(
      uniprot.rows.map((r) => r.id),
      ['XR0001', 'XR0002', 'XR0003', 'XR0004'],
      'sorted by identifier, each once'
    );
    // the heading's entities: every pathway's mapped accessions, mouse's among them
    assert.equal(uniprot.entities, 6);

    // read in the other order, Alpha pathway's mapping comes first, and the list is still sorted
    const analysis = await analyse(OR);
    const reversed = buildReport(
      {
        ...analysis,
        result: { ...analysis.result, pathways: [...analysis.result.pathways].reverse() },
      },
      HUMAN,
      25,
      null
    ).found.find((f) => f.resource === 'UNIPROT');
    assert.deepEqual(
      reversed?.rows.map((r) => [r.id, r.mapsTo]),
      [
        ['XR0001', ['XU0901']],
        ['XR0002', ['XU0002']],
        ['XR0003', ['XU0003']],
        ['XR0004', ['XU0004']],
      ]
    );

    const expression = await build(REPORT_TOKENS.expression);
    assert.deepEqual(
      expression.found[0]?.rows.map((r) => [r.id, r.exp, r.mapsTo]),
      [
        ['XR0001', [1.5, -0.5], ['XU0001', 'XU0001-2']],
        ['XR0002', [0.25, 2], ['XU0002']],
        ['XR0004', [-1, 0.75], ['XU0004']],
      ]
    );
    assert.deepEqual(expression.columns, ['Placeholder A', 'Placeholder B']);
  });

  test('counts the identifiers found across every resource', async () => {
    const model = await build(OR);
    // XR0001–XR0004 through UniProt, XC0001 and XC0002 through KEGG COMPOUND
    assert.equal(model.identifiersFound, 6);
    assert.equal(model.identifiersTotal, 8);
    // with one resource's table, the count still spans both
    const uniprot = await build(OR, { resource: 'UNIPROT', importableOnly: false });
    // the pathways UniProt keeps, whose entities include Alpha pathway's compound
    assert.equal(uniprot.identifiersFound, 5);
    assert.equal((await build(OR, { resource: 'UNIPROT', importableOnly: false })).found.length, 1);
    const alphaOnly = await build(OR, { resource: 'COMPOUND', importableOnly: false });
    // Alpha pathway and Gamma pathway: XR0001, XR0002 and the two compounds
    assert.equal(alphaOnly.identifiersFound, 4);
  });

  test("fills KEGG COMPOUND's tables, in the identifiers found and each pathway's detail", async () => {
    const model = await build(OR);
    assert.deepEqual(
      model.found.find((f) => f.resource === 'COMPOUND')?.rows.map((r) => r.id),
      ['XC0001', 'XC0002']
    );
    const alpha = model.pathways.find((p) => p.stId === 'R-HSA-90000200');
    assert.deepEqual(
      alpha?.entities.map((t) => [t.resource, t.rows.map((r) => r.id)]),
      [
        ['UNIPROT', ['XR0001', 'XR0002']],
        ['COMPOUND', ['XC0001']],
      ]
    );
  });

  test('splits interactors by the resource they interact through, NCBI Protein included', async () => {
    const model = await build(REPORT_TOKENS.interactors);
    assert.deepEqual(model.resources, ['UNIPROT', 'NCBI_PROTEIN']);
    assert.deepEqual(
      model.foundInteractors.map((t) => [t.resource, t.rows.map((r) => [r.id, r.interactsWith])]),
      [
        ['UNIPROT', [['XR0005', ['XU0001']]]],
        ['NCBI_PROTEIN', [['XR0006', ['XN0001']]]],
      ]
    );
    const betaSubSub = model.pathways.find((p) => p.stId === 'R-HSA-90000131');
    assert.deepEqual(
      betaSubSub?.interactors.map((t) => [t.resource, t.rows.map((r) => r.id)]),
      [
        ['UNIPROT', []],
        ['NCBI_PROTEIN', ['XR0006']],
      ]
    );
  });

  test('names the report by the sample, the file, the species compared with, the type, the token', async () => {
    const analysis = await analyse(REPORT_TOKENS.expression);
    const named = (summary: Partial<ReportAnalysis['result']['summary']>) =>
      reportName(
        {
          ...analysis,
          result: { ...analysis.result, summary: { ...analysis.result.summary, ...summary } },
        },
        'species' in summary ? MOUSE : null
      );
    assert.equal(named({ sampleName: 'S', fileName: 'F', species: 1 }), 'S');
    assert.equal(named({ sampleName: '', fileName: 'F', species: 1 }), 'F');
    assert.equal(named({ sampleName: '', fileName: '', species: 1 }), 'Mus musculus');
    assert.equal(named({ sampleName: '' }), 'EXPRESSION');
    assert.equal(named({ sampleName: '', type: '' }), analysis.result.summary.token);
    // each stub analysis by its own
    assert.equal((await build(REPORT_TOKENS.expression)).summary.name, 'Placeholder sample');
    assert.equal((await build(REPORT_TOKENS.interactors)).summary.name, 'placeholder-list.txt');
    assert.equal(
      (await build(REPORT_TOKENS.speciesComparison, undefined, HUMAN, 25, MOUSE)).summary.name,
      'Mus musculus'
    );
    assert.equal((await build(OR)).summary.name, 'OVERREPRESENTATION');
  });

  test('lists the identifiers not found sorted, without repeats', async () => {
    const model = await build(REPORT_TOKENS.expression);
    assert.deepEqual(model.notFound, [
      { id: 'XZ0001', exp: [2, 3] },
      { id: 'XZ0003', exp: [0.5, 1] },
    ]);
    assert.deepEqual(
      (await build(OR)).notFound.map((n) => n.id),
      ['XZ0001', 'XZ0002']
    );
  });
});
