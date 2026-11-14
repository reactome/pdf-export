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
  MODIFIED_ROWS_LISTED,
  compareReportCommand,
  compareReports,
  reduceReportPdf,
  samePrinted,
  sameStatistic,
  unitOf,
  type ReportReduced,
} from '../../src/compare/report.ts';
import { editNames, reportEditRows, reportEntityRows } from '../../src/compare/reduce.ts';
import { Output } from '../../src/compare/output.ts';
import type { Reference, SpeciesRef } from '../../src/graph/queries.ts';
import { pageStyles } from '../../src/layout/document.ts';
import { Printer } from '../../src/print/print.ts';
import type { PathwayDetail } from '../../src/report/details.ts';
import type { HistoryRow } from '../../src/report/edits.ts';
import { buildReport, type ReportModel } from '../../src/report/model.ts';
import { reportPage } from '../../src/report/report.ts';
import { REPORT_TOKENS, startAnalysisStub } from '../stubs/analysis.ts';
import { todayReportHtml } from './today-form.ts';
import type { Line } from '../../src/compare/read.ts';

const HUMAN: SpeciesRef = { dbId: 90000002, taxId: '9606', name: 'Homo sapiens' };
const SIX = ['Placeholder, A', 'Example, B', 'Sample, C', 'Dummy, D', 'Instance, E', 'Model, F'];
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#cde"/><text x="20" y="40" style="font: normal 600 12px Roboto">Placeholder label</text></svg>';

const REFERENCE: Reference = {
  dbId: 1,
  kind: 'article',
  title: 'A made-up title of a made-up study',
  chapterTitle: null,
  journal: 'Placeholder Journal',
  volume: 4,
  pages: '39-49',
  year: 2003,
  pubMedId: null,
  isbn: null,
  url: null,
  publisher: null,
  authors: ['Placeholder, A', 'Example, B'],
  moreAuthors: false,
};

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
      references: [REFERENCE],
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
  /** The same model and details in today's form, printed and read back. */
  const today = async (
    m: ReportModel,
    d: ReadonlyMap<number, PathwayDetail>
  ): Promise<ReportReduced> => {
    const path = join(dir, `${String(++count)}.pdf`);
    writeFileSync(
      path,
      await printer.single(todayReportHtml(m, d, { release: 98, site: 'https://site.example' }))
    );
    return reduceReportPdf(path);
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
      [[3]]
    );
    // each identifier not found and its values, a cell each
    assert.equal(baseline.notFound?.length, 2 * (1 + model.columns.length));
    const again = (await printed(model, details(model))).reduced;
    assert.deepEqual(differences(baseline, again), []);
  });

  test("today's form: every part read, and the same content agrees with pdf-export's", async () => {
    const t = await today(model, details(model));
    assert.equal(t.cover.title, 'same');
    assert.equal(t.cover.release, 98);
    assert.equal(t.cover.link, true);
    assert.deepEqual(Object.keys(t.properties ?? {}).sort(), [
      'identifiersFound',
      'identifiersTotal',
      'interactors',
      'pathways',
      'projection',
      'resource',
      'species',
      'token',
      'type',
    ]);
    assert.equal(t.pathways?.length, model.pathways.length);
    assert.equal(t.reduced.sections.length, model.pathways.length);
    assert.ok((t.found?.[0]?.rows.length ?? 0) > 0, 'the identifiers found');
    assert.equal(t.notFound?.length, baseline.notFound?.length);
    assert.deepEqual(differences(t, baseline), []);
    // no references: today's "References" over nothing is as pdf-export's none
    const bare = new Map(
      [...details(model)].map(([id, d]) => [
        id,
        { ...d, section: { ...d.section, references: [] } },
      ])
    );
    assert.deepEqual(
      differences(await today(model, bare), (await printed(model, bare)).reduced),
      []
    );
  });

  test("today's form: a planted difference in each part is found", async () => {
    const [first, ...rest] = model.pathways;
    const [resource] = model.found;
    const [row, ...others] = resource?.rows ?? [];
    assert.ok(first && resource && row);
    const planted: [string, ReportModel, Map<number, PathwayDetail>, string[]][] = [];
    const add = (
      name: string,
      m: ReportModel,
      d: Map<number, PathwayDetail>,
      want: string[]
    ): void => {
      planted.push([name, m, d, want]);
    };
    const hit = { ...model, pathwaysHit: model.pathwaysHit + 1 };
    add('a property', hit, details(hit), ['analysis pathways value']);
    const stat = {
      ...model,
      pathways: [
        {
          ...first,
          statistics: { ...first.statistics, entities: { ...first.statistics.entities, fdr: 0.5 } },
        },
        ...rest,
      ],
    };
    add('a statistic', stat, details(stat), ['pathways statistics value']);
    add('compartments', model, details(model, HISTORY, ['nucleoplasm']), [
      'section compartments text',
    ]);
    const renamed: HistoryRow[] = [
      CREATED,
      {
        date: '2026-01-04',
        action: 'Authored',
        names: ['Placeholder, A', 'Sample, C'],
        etAl: false,
      },
    ];
    add("an edit's names", model, details(model, renamed), ['section edits text']);
    const retitled = new Map(
      [...details(model)].map(([id, d]) => [
        id,
        {
          ...d,
          section: { ...d.section, references: [{ ...REFERENCE, title: 'Another made-up title' }] },
        },
      ])
    );
    add('a reference', model, retitled, ['section references text']);
    const mapped = {
      ...model,
      found: [{ ...resource, rows: [{ ...row, mapsTo: ['XQ9999'] }, ...others] }],
    };
    add('an identifier found', mapped, details(mapped), [
      'found entities missing',
      'found entities extra',
    ]);
    const fewer = { ...model, notFound: model.notFound.slice(1) };
    // planted in today's, the reference: pdf-export's then has one more
    add('an identifier not found', fewer, details(fewer), ['not-found rows extra']);
    for (const [name, m, d, want] of planted) {
      assert.deepEqual(differences(await today(m, d), baseline), want, name);
    }
  });

  test("a pathway's name ending in a number, its cell touching the first statistic's", async () => {
    const [first, ...rest] = model.pathways;
    assert.ok(first);
    const numbered = {
      ...model,
      pathways: [{ ...first, name: 'Placeholder-4 and placeholder-13 signalling' }, ...rest],
    };
    const d = details(numbered);
    const { entities, reactions } = first.statistics;
    const want = [entities.found, entities.total, reactions.found, reactions.total];
    for (const reduced of [(await printed(numbered, d)).reduced, await today(numbered, d)]) {
      const row = reduced.pathways?.[0];
      assert.ok(row);
      const s = row.statistics;
      assert.deepEqual([s[0], s[1], s[5], s[6]], want);
    }
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

  test("the edit history's Modified rows: listed where pdf-export's has two or more, caught where it has one", async () => {
    const modified = (date: string): HistoryRow => ({
      date,
      action: 'Modified',
      names: ['Example, B'],
      etAl: false,
    });
    // two modified edits: pdf-export prints a row for each, today's none (listed, R9)
    const two = await printed(
      model,
      details(model, [...HISTORY, modified('2026-02-01'), modified('2026-03-01')])
    );
    const found = compareReports('report.pdf', baseline, two.reduced);
    assert.deepEqual(
      found.filter((d) => d.recorded === undefined),
      []
    );
    assert.deepEqual(
      found.map((d) => [d.part, d.field, d.kind, d.events, d.recorded]),
      [
        [
          'section',
          'edits',
          'extra',
          model.pathways.slice(0, 2).map((p) => p.stId),
          MODIFIED_ROWS_LISTED,
        ],
      ]
    );
    const out: string[] = [];
    const ours = await printed(model, details(model));
    assert.equal(
      await compareReportCommand([ours.path, two.path], {
        out: (text) => out.push(text),
        err: () => undefined,
        output: new Output('salt'),
      }),
      0
    );
    assert.match(out.join(''), /"unrecorded": 0/);
    // one modified edit: today's prints its row too, so a row missing or extra is caught
    const one = await printed(model, details(model, [...HISTORY, modified('2026-02-01')]));
    assert.deepEqual(differences(baseline, one.reduced), ['section edits text']);
    assert.deepEqual(differences(one.reduced, baseline), ['section edits text']);
    // two in pdf-export's and another Modified row in today's: that row is still missing
    const elsewhere = await printed(model, details(model, [...HISTORY, modified('2026-04-01')]));
    assert.deepEqual(
      compareReports('report.pdf', elsewhere.reduced, two.reduced)
        .filter((d) => d.recorded === undefined)
        .map((d) => `${d.part} ${d.field ?? ''} ${d.kind}`),
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

test("a printed statistic agrees within half of each one's last place", () => {
  assert.equal(unitOf('0.033'), 1e-3);
  assert.equal(unitOf('1,575'), 1);
  assert.ok(Math.abs(unitOf('1.16e-09') - 1e-11) < 1e-25);
  assert.ok(samePrinted(0.033, 1e-3, 0.0329, 1e-4));
  assert.ok(samePrinted(0.006, 1e-3, 0.0055, 1e-4));
  assert.ok(!samePrinted(0.033, 1e-3, 0.0319, 1e-4));
  assert.ok(!samePrinted(536, 1, 537, 1));
});

test("an edit row's names: the same words in either form, another word not", () => {
  assert.equal(editNames('Placeholder, A; Example, BC'), editNames('Example BC, Placeholder A'));
  assert.equal(editNames('Placeholder, A'), editNames('Placeholder A'));
  assert.notEqual(editNames('Placeholder, A'), editNames('Placeholder A, Example B'));
});

test("the identifiers found: today's three entries a row are pdf-export's rows", () => {
  const line = (text: string, cells: string[]): Line => ({
    page: 1,
    y: 500,
    x: 90,
    size: 8,
    text,
    cells,
  });
  const ours = reportEntityRows([
    line('Entities found: UniProt', ['Entities found: UniProt']),
    line('Identifier Maps to', ['Identifier', 'Maps to']),
    line('XR0001 XQ0001, XQ0002', ['XR0001', 'XQ0001, XQ0002']),
    line('XR0002 XQ0003', ['XR0002', 'XQ0003']),
  ]);
  const todays = reportEntityRows([
    line('3 submitted entities found in this pathway, mapping to 3 Reactome entities', []),
    line('Input UniProt Id Input UniProt Id', ['Input', 'UniProt Id', 'Input', 'UniProt Id']),
    line('XR0002 XQ0003 XR0001 XQ0002, XQ0001', ['XR0002', 'XQ0003', 'XR0001', 'XQ0002, XQ0001']),
  ]);
  assert.equal(ours.length, 2);
  assert.deepEqual(todays, ours);
  const other = reportEntityRows([
    line('Input UniProt Id Input UniProt Id', ['Input', 'UniProt Id', 'Input', 'UniProt Id']),
    line('XR0002 XQ0003 XR0001 XQ0002', ['XR0002', 'XQ0003', 'XR0001', 'XQ0002']),
  ]);
  assert.notDeepEqual(other, ours);
});

test("an edit history's header, repeated where the table runs onto another page, is no row's", () => {
  const rows = [
    'Date Action Author',
    '2026-01-04 Created Placeholder A',
    'Date Action Author',
    '2026-01-05 Reviewed Example B',
  ];
  assert.deepEqual(reportEditRows(rows), [
    `2026-01-04 created ${editNames('Placeholder A')}`,
    `2026-01-05 reviewed ${editNames('Example B')}`,
  ]);
});
