// The analysis report's comparison by meaning (spec 002 T019, FR-208), on reports printed
// here from the analysis stub's answers and made-up details: the same report twice is the
// same, and a difference planted in each part is found there, printed as counts and hashes,
// never a name or a submitted identifier. Every name is a placeholder; today's reports are
// never used in tests (their labels are for the comparison's run to add).
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { checkToken, readReportAnalysis } from '../../src/analysis/report.ts';
import {
  compareReportCommand,
  compareReports,
  reduceReportPdf,
  sameStatistic,
  type ReportReduced,
} from '../../src/compare/report.ts';
import { Output } from '../../src/compare/output.ts';
import type { SpeciesRef } from '../../src/graph/queries.ts';
import { pageStyles } from '../../src/layout/document.ts';
import { Printer } from '../../src/print/print.ts';
import type { PathwayDetail } from '../../src/report/details.ts';
import type { HistoryRow } from '../../src/report/edits.ts';
import { buildReport, type ReportModel } from '../../src/report/model.ts';
import { reportPage } from '../../src/report/report.ts';
import { REPORT_TOKENS, startAnalysisStub } from '../stubs/analysis.ts';

const HUMAN: SpeciesRef = { dbId: 90000002, taxId: '9606', name: 'Homo sapiens' };
const SIX = ['Placeholder, A', 'Example, B', 'Sample, C', 'Dummy, D', 'Instance, E', 'Model, F'];
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#cde"/><text x="20" y="40" style="font: normal 600 12px Roboto">Placeholder label</text></svg>';

/** A made-up detail for a pathway: spec 001's section and an edit history. */
function detail(
  stId: string,
  name: string,
  history: HistoryRow[],
  compartments = ['cytosol']
): PathwayDetail {
  const dbId = Number(stId.split('-')[2]);
  return {
    section: {
      anchor: `s-${stId}`,
      event: {
        kind: 'pathway',
        dbId,
        stId,
        name,
        schemaClass: 'Pathway',
        speciesName: 'Homo sapiens',
        category: null,
        hasDiagram: true,
        hasEHLD: false,
        isInferred: false,
        isInDisease: false,
        species: { dbId: 90000002, name: 'Homo sapiens' },
        compartments: compartments.map((c, i) => ({ dbId: i + 1, name: c })),
        before: [],
        after: [],
      },
      path: [],
      figure: { kind: 'diagram', stId },
      diseases: [],
      inferredFrom: [],
      summations: ['<p>A made-up summation.</p>'],
      references: [],
      edits: [],
      depth: 0,
    },
    history,
  };
}

const CREATED: HistoryRow = {
  date: '2026-01-04',
  action: 'Created',
  names: SIX.slice(0, 5),
  etAl: true,
};
const HISTORY: HistoryRow[] = [
  CREATED,
  { date: '2026-01-04', action: 'Authored', names: ['Placeholder, A', 'Example, B'], etAl: false },
];

describe("the analysis report's comparison (FR-208)", { timeout: 600_000 }, () => {
  let printer: Printer;
  let model: ReportModel;
  let dir: string;
  let baseline: ReportReduced;
  const details = (
    m: ReportModel,
    history = HISTORY,
    compartments?: string[]
  ): Map<number, PathwayDetail> =>
    new Map(
      m.pathways.slice(0, 2).map((p) => [p.dbId, detail(p.stId, p.name, history, compartments)])
    );
  let count = 0;
  /** A report printed from a model and details, and read back. */
  const printed = async (
    m: ReportModel,
    d: ReadonlyMap<number, PathwayDetail>,
    figures: ReadonlyMap<string, string> = new Map()
  ): Promise<{ reduced: ReportReduced; path: string }> => {
    const html = reportPage(m, d, {
      site: 'https://site.example',
      release: 98,
      date: new Date(Date.UTC(2026, 10, 13)),
      figures,
      styles: pageStyles(),
    });
    const path = join(dir, `${String(++count)}.pdf`);
    writeFileSync(path, await printer.single(html));
    return { reduced: await reduceReportPdf(path), path };
  };
  const differences = (ref: ReportReduced, neu: ReportReduced): string[] =>
    compareReports('report.pdf', ref, neu).map((d) =>
      `${d.part} ${d.field ?? ''} ${d.kind}`.replace('  ', ' ')
    );

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'pdfx-compare-report-'));
    printer = await Printer.start();
    const stub = await startAnalysisStub();
    try {
      const check = await checkToken(stub.url, REPORT_TOKENS.expression);
      model = buildReport(
        await readReportAnalysis(stub.url, check, { importableOnly: false }),
        HUMAN,
        25,
        null
      );
    } finally {
      await stub.close();
    }
    baseline = (await printed(model, details(model))).reduced;
  });
  after(async () => {
    await printer.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('every part is read, and the same report twice differs in nothing', async () => {
    assert.equal(baseline.cover.title, 'same');
    assert.equal(baseline.cover.release, 98);
    assert.equal(baseline.cover.link, true);
    assert.ok(baseline.reduced.analysis, 'the properties');
    assert.equal(baseline.pathways?.length, model.pathways.length);
    assert.equal(baseline.reduced.sections.length, model.pathways.length);
    assert.deepEqual(
      baseline.found?.map((f) => f.counts),
      [[3, 5]]
    );
    assert.equal(baseline.notFound?.length, 2);
    const again = (await printed(model, details(model))).reduced;
    assert.deepEqual(differences(baseline, again), []);
  });

  test('the cover: the analysis named otherwise', async () => {
    const renamed = { ...model, summary: { ...model.summary, name: 'Placeholder other sample' } };
    assert.deepEqual(differences(baseline, (await printed(renamed, details(renamed))).reduced), [
      'cover name value',
    ]);
  });

  test('the properties: a value', async () => {
    const other = { ...model, pathwaysHit: model.pathwaysHit + 1 };
    assert.deepEqual(differences(baseline, (await printed(other, details(other))).reduced), [
      'analysis pathways value',
    ]);
  });

  test('the pathways: their order, and a statistic', async () => {
    const [first, second, ...rest] = model.pathways;
    assert.ok(first && second);
    const swapped = { ...model, pathways: [second, first, ...rest] };
    const found = differences(baseline, (await printed(swapped, details(swapped))).reduced);
    assert.ok(found.includes('pathways rows order'), found.join('; '));
    const changed = {
      ...model,
      pathways: [
        {
          ...first,
          statistics: {
            ...first.statistics,
            entities: { ...first.statistics.entities, pValue: 0.5 },
          },
        },
        second,
        ...rest,
      ],
    };
    assert.deepEqual(differences(baseline, (await printed(changed, details(changed))).reduced), [
      'pathways statistics value',
    ]);
  });

  test("a detail: its compartments; its edit history's names as a set, past five the et al. alone", async () => {
    const compartments = await printed(model, details(model, HISTORY, ['nucleoplasm']));
    assert.deepEqual(differences(baseline, compartments.reduced), ['section compartments text']);
    // the same names in another order, and another five of six: the same
    const reordered: HistoryRow[] = [
      { date: '2026-01-04', action: 'Created', names: SIX.slice(1, 6), etAl: true },
      {
        date: '2026-01-04',
        action: 'Authored',
        names: ['Example, B', 'Placeholder, A'],
        etAl: false,
      },
    ];
    assert.deepEqual(
      differences(baseline, (await printed(model, details(model, reordered))).reduced),
      []
    );
    // another name: a difference
    const renamed: HistoryRow[] = [
      CREATED,
      {
        date: '2026-01-04',
        action: 'Authored',
        names: ['Placeholder, A', 'Sample, C'],
        etAl: false,
      },
    ];
    assert.deepEqual(
      differences(baseline, (await printed(model, details(model, renamed))).reduced),
      ['section edits text']
    );
  });

  test('a figure present on one side only', async () => {
    const figures = new Map(model.pathways.slice(0, 1).map((p) => [`diagram/${p.stId}`, SVG]));
    const found = differences(baseline, (await printed(model, details(model), figures)).reduced);
    assert.deepEqual(found, ['figure extra']);
  });

  test('the identifiers found: a value; the identifiers not found: one gone', async () => {
    const [resource] = model.found;
    assert.ok(resource);
    const [row, ...others] = resource.rows;
    assert.ok(row);
    const valued = {
      ...model,
      found: [{ ...resource, rows: [{ ...row, exp: [9, 9] }, ...others] }],
    };
    assert.deepEqual(differences(baseline, (await printed(valued, details(valued))).reduced), [
      'found entities missing',
      'found entities extra',
    ]);
    const fewer = { ...model, notFound: model.notFound.slice(1) };
    assert.deepEqual(differences(baseline, (await printed(fewer, details(fewer))).reduced), [
      'not-found rows missing',
    ]);
  });

  test('the command: counts and hashes, never a name or a submitted identifier; exit 1 on a difference', async () => {
    const renamed = { ...model, summary: { ...model.summary, name: 'Placeholder other sample' } };
    const a = await printed(model, details(model));
    const b = await printed(renamed, details(renamed));
    const out: string[] = [];
    const err: string[] = [];
    const code = await compareReportCommand([a.path, b.path], {
      out: (text) => out.push(text),
      err: (text) => err.push(text),
      output: new Output('salt'),
    });
    assert.equal(code, 1);
    const report = out.join('');
    assert.match(report, /"part": "cover"/);
    for (const secret of [
      ...SIX,
      'Placeholder sample',
      'Placeholder other sample',
      'XR0001',
      'XZ0001',
    ]) {
      assert.ok(!report.includes(secret), secret);
    }
    assert.equal(
      await compareReportCommand([a.path, a.path], { out: () => undefined, err: () => undefined }),
      0
    );
    assert.equal(
      await compareReportCommand([a.path], { out: () => undefined, err: () => undefined }),
      2
    );
  });
});

test('a statistic agrees where it prints the same at three significant figures', () => {
  assert.ok(sameStatistic(6e-4, 6.0e-4));
  assert.ok(sameStatistic(1.25e-4, 1.2500001e-4));
  assert.ok(sameStatistic(0.0012, 0.00120004));
  assert.ok(!sameStatistic(0.0012, 0.0013));
  assert.ok(!sameStatistic(1.25e-4, 1.26e-4));
  assert.ok(!sameStatistic(12, 13));
});
