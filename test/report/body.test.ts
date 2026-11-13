// The report's pathways' details and identifier lists (spec 002 T009), as HTML.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { checkToken, readReportAnalysis, type ReportFilter } from '../../src/analysis/report.ts';
import { graphSettings, openGraph } from '../../src/graph/connection.ts';
import type { SpeciesRef } from '../../src/graph/queries.ts';
import { CharacterLog, REPLACEMENT } from '../../src/layout/characters.ts';
import { Links } from '../../src/layout/html.ts';
import type { Report } from '../../src/layout/section.ts';
import { readDetails, type PathwayDetail } from '../../src/report/details.ts';
import {
  onRequestReport,
  reportBodyHtml,
  reportContents,
  type BodyOptions,
} from '../../src/report/layout.ts';
import { buildReport, type ReportModel } from '../../src/report/model.ts';
import { REPORT_TOKENS, startAnalysisStub, type AnalysisStub } from '../stubs/analysis.ts';

const HUMAN: SpeciesRef = { dbId: 90000002, taxId: '9606', name: 'Homo sapiens' };
const SITE = 'https://site.example';
const NO_DETAILS: ReadonlyMap<number, PathwayDetail> = new Map();
const skipGraph = process.env['NEO4J_URI'] ? false : 'no fixture graph: set NEO4J_URI';

describe("the report's details and identifier lists", () => {
  let stub: AnalysisStub;
  before(async () => {
    stub = await startAnalysisStub();
  });
  after(async () => {
    await stub.close();
  });

  const model = async (
    token: string,
    filter: ReportFilter = { importableOnly: false }
  ): Promise<ReportModel> =>
    buildReport(
      await readReportAnalysis(stub.url, await checkToken(stub.url, token), filter),
      HUMAN,
      25,
      null
    );
  const options = (): BodyOptions & { report: Report } => ({
    links: new Links(false, SITE, new Set()),
    release: 98,
    date: new Date(Date.UTC(2026, 10, 13)),
    overview: undefined,
    figures: new Map<string, string>(),
    report: { belowFloor: [], missing: [], unmeasured: [] },
  });
  const body = (m: ReportModel, details = NO_DETAILS): string =>
    reportBodyHtml(m, details, options());
  /** One part's markup, by its anchor. */
  const part = (out: string, anchor: string): string | undefined =>
    new RegExp(`<section class="front" data-part="${anchor}">[\\s\\S]*?</section>`).exec(out)?.[0];

  test('the identifiers not found, and their contents entry, left out when there are none', async () => {
    const m = await model(REPORT_TOKENS.overrepresentation);
    const out = body(m);
    assert.ok(part(out, 'not-found')?.includes('XZ0001'));
    assert.ok(out.includes('href="#not-found"'));
    const none = body({ ...m, notFound: [] });
    assert.equal(part(none, 'not-found'), undefined);
    assert.ok(!none.includes('href="#not-found"'));
    assert.ok(!none.includes('id="not-found"'));
    // the species comparison has none to begin with
    const comparison = body(await model(REPORT_TOKENS.speciesComparison));
    assert.equal(part(comparison, 'not-found'), undefined);
    assert.ok(reportContents(m).some((e) => e.target === 'not-found'));
  });

  test("the expression columns' values in place: identifiers found, not found and each pathway's", async () => {
    const out = body(await model(REPORT_TOKENS.expression));
    const found = part(out, 'found') ?? '';
    assert.match(found, /<th>Placeholder A<\/th><th>Placeholder B<\/th>/);
    assert.match(
      found,
      /<tr><td class="id">XR0001<\/td><td class="id">XU0001, XU0001-2<\/td><td>1\.5<\/td><td>-0\.5<\/td><\/tr>/
    );
    assert.match(found, /UniProt: 3 identifiers mapping to 5 Reactome entities/);
    assert.match(
      part(out, 'not-found') ?? '',
      /<tr><td class="id">XZ0001<\/td><td>2<\/td><td>3<\/td><\/tr><tr><td class="id">XZ0003<\/td><td>0\.5<\/td><td>1<\/td><\/tr>/
    );
    // Alpha pathway's own table, its mappings and values
    const alpha = /id="s-R-HSA-90000200"[\s\S]*?<\/section>/.exec(out)?.[0] ?? '';
    assert.match(alpha, /Entities found: UniProt/);
    assert.match(
      alpha,
      /<td class="id">XR0002<\/td><td class="id">XU0002<\/td><td>0\.25<\/td><td>2<\/td>/
    );
  });

  test('each pathway a detail, its stable identifier linked; KEGG Compound and the interactors apart', async () => {
    const or = body(await model(REPORT_TOKENS.overrepresentation));
    const alpha = /id="s-R-HSA-90000200"[\s\S]*?<\/section>/.exec(or)?.[0] ?? '';
    assert.ok(
      alpha.includes(
        `href="${SITE}/content/detail/R-HSA-90000200"><span class="id">R-HSA-90000200</span>`
      )
    );
    assert.match(alpha, /Entities found: KEGG Compound/);
    const interactors = body(await model(REPORT_TOKENS.interactors));
    const found = part(interactors, 'found') ?? '';
    assert.match(found, /Interactors through UniProt: 1/);
    assert.match(found, /Interactors through NCBI Protein: 1/);
    const betaSubSub = /id="s-R-HSA-90000131"[\s\S]*?<\/section>/.exec(interactors)?.[0] ?? '';
    assert.match(betaSubSub, /Interactors found: NCBI Protein/);
    assert.match(
      betaSubSub,
      /<td class="id">XR0006<\/td><td class="id">XU0006<\/td><td class="id">XN0001<\/td>/
    );
  });

  test('a character no font draws in a submitted identifier: printed as U+FFFD, logged once, the report made', async () => {
    const m = await model(REPORT_TOKENS.overrepresentation);
    const planted = JSON.parse(
      JSON.stringify(m).replaceAll('XR0001', 'XR\u{E000}01')
    ) as ReportModel;
    const lines: string[] = [];
    const log = new CharacterLog('report with-token', (line) => lines.push(line));
    const printed = onRequestReport(planted, NO_DETAILS, log);
    const out = body(printed.model, printed.details);
    assert.ok(!out.includes('\u{E000}'));
    assert.ok(out.includes(`XR${REPLACEMENT}01`));
    assert.deepEqual(lines, ['uncovered-character U+E000 report with-token']);
    assert.match(out, /id="not-found"/, 'the report is made');
  });

  describe('with the graph', { skip: skipGraph }, () => {
    test("a detail is spec 001's section, with the report's history in place of spec 001's", async () => {
      const graph = openGraph(graphSettings(process.env));
      try {
        const m = await model(REPORT_TOKENS.overrepresentation);
        const details = await readDetails(graph, m.pathways, new Set(['R-HSA-90000300']));
        const out = body(m, details);
        const alpha =
          /<section class="event"[^>]*>\s*<h1 id="s-R-HSA-90000200"[\s\S]*?<\/section>/.exec(
            out
          )?.[0] ?? '';
        assert.ok(
          alpha.includes(
            `href="${SITE}/content/detail/R-HSA-90000200"><span class="id">R-HSA-90000200</span>`
          )
        );
        // the report's rows: Created and Modified, which spec 001's history never shows
        assert.match(alpha, /<td>2025-12-01<\/td><td>Created<\/td>/);
        assert.match(alpha, /<td>2026-05-01<\/td><td>Modified<\/td><td><\/td>/);
        assert.equal(alpha.match(/Edit history/g)?.length, 1);
        // a section that still held spec 001's rows would print only the report's
        const withRows = new Map(
          [...details].map(([id, d]) => [
            id,
            {
              ...d,
              section: {
                ...d.section,
                edits: [{ date: '2026-01-02', kinds: ['authored'], authors: ['Spec 001 row'] }],
              },
            },
          ])
        );
        const kept = body(m, withRows);
        assert.ok(!kept.includes('Spec 001 row'));
        // then its entities, after the history
        assert.ok(alpha.indexOf('Edit history') < alpha.indexOf('Entities found: UniProt'));
      } finally {
        await graph.close();
      }
    });
  });
});
