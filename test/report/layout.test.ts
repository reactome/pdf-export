// The report's front parts and table (spec 002 T008), as HTML, from the stubs' answers.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { checkToken, readReportAnalysis, type ReportFilter } from '../../src/analysis/report.ts';
import type { Reference, SpeciesRef } from '../../src/graph/queries.ts';
import { Links } from '../../src/layout/html.ts';
import {
  PARTS,
  isGsa,
  reportContents,
  reportFrontHtml,
  reportReference,
  reportTitle,
  statistic,
  type FrontOptions,
} from '../../src/report/layout.ts';
import { buildReport, type ReportModel } from '../../src/report/model.ts';
import { REPORT_TOKENS, startAnalysisStub, type AnalysisStub } from '../stubs/analysis.ts';

const HUMAN: SpeciesRef = { dbId: 90000002, taxId: '9606', name: 'Homo sapiens' };
const MOUSE: SpeciesRef = { dbId: 90000003, taxId: '10090', name: 'Mus musculus' };
const SITE = 'https://site.example';
const OVERVIEW =
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect id="r" width="4" height="3"/><text style="font: normal 600 12px Roboto">Overview</text></svg>';

describe("the report's front parts and table", () => {
  let stub: AnalysisStub;
  before(async () => {
    stub = await startAnalysisStub();
  });
  after(async () => {
    await stub.close();
  });

  const model = async (
    token: string,
    filter: ReportFilter = { importableOnly: false },
    comparedWith: SpeciesRef | null = null
  ): Promise<ReportModel> =>
    buildReport(
      await readReportAnalysis(stub.url, await checkToken(stub.url, token), filter),
      HUMAN,
      25,
      comparedWith
    );
  const options = (overview: string | undefined = OVERVIEW): FrontOptions => ({
    links: new Links(false, SITE, new Set()),
    release: 98,
    date: new Date(Date.UTC(2026, 10, 13)),
    overview,
  });
  const html = async (m: ReportModel | Promise<ReportModel>, overview?: string) =>
    reportFrontHtml(await m, options(overview));
  /** The text of the `<dt>` terms of the properties. */
  const terms = (out: string): string[] =>
    [
      ...(/data-part="properties"[\s\S]*?<\/section>/.exec(out)?.[0] ?? '').matchAll(
        /<dt>([^<]*)<\/dt>/g
      ),
    ].map((m) => m[1] ?? '');

  test('the parts in order: cover, contents, introduction, properties, overview, table', async () => {
    const out = await html(model(REPORT_TOKENS.overrepresentation));
    const at = (marker: string): number => {
      const i = out.indexOf(marker);
      assert.ok(i >= 0, marker);
      return i;
    };
    const order = [
      'class="cover"',
      `id="${PARTS.contents}"`,
      `id="${PARTS.introduction}"`,
      `id="${PARTS.properties}"`,
      `id="${PARTS.overview}"`,
      `id="${PARTS.pathways}"`,
    ].map(at);
    assert.deepEqual(
      order,
      [...order].sort((a, b) => a - b)
    );
  });

  test('the cover: title, name, release, date, the link to the result, how long it is kept', async () => {
    const m = await model(REPORT_TOKENS.expression);
    const out = await html(m);
    const cover = /<div class="cover">[\s\S]*?<\/div>\n?<section/.exec(out)?.[0] ?? '';
    assert.match(cover, /<p class="title">Pathway Analysis Report<\/p>/);
    assert.match(cover, /<p class="name">Placeholder sample<\/p>/);
    assert.match(cover, /Reactome release 98/);
    assert.match(cover, /13 November 2026/);
    assert.ok(cover.includes(`href="${SITE}/PathwayBrowser?analysis=${m.token}"`));
    assert.match(cover, /7 days after your last usage/);
    assert.equal(reportTitle(m), 'Pathway Analysis Report - Placeholder sample');
  });

  test('projection and interactors are said only when set', async () => {
    // over-representation: projected, no interactors
    const projected = terms(await html(model(REPORT_TOKENS.overrepresentation)));
    assert.ok(projected.includes('Projected to human'));
    assert.ok(!projected.includes('Interactors included'));
    // with interactors: not projected
    const interacting = terms(await html(model(REPORT_TOKENS.interactors)));
    assert.ok(!interacting.includes('Projected to human'));
    assert.ok(interacting.includes('Interactors included'));
    // and the rest, always
    for (const term of [
      'Type',
      'Identifiers found',
      'Pathways hit',
      'Species',
      'Resource',
      'Token',
    ]) {
      assert.ok(projected.includes(term), term);
      assert.ok(interacting.includes(term), term);
    }
  });

  test("the properties: counts, species, resource, token, and the projection's link", async () => {
    const out = await html(
      model(REPORT_TOKENS.overrepresentation, { resource: 'UNIPROT', importableOnly: false })
    );
    assert.match(out, /<dt>Identifiers found<\/dt><dd>5 of 7<\/dd>/);
    assert.match(out, /<dt>Pathways hit<\/dt><dd>5<\/dd>/);
    assert.match(out, /<dt>Species<\/dt><dd>Homo sapiens<\/dd>/);
    assert.match(out, /<dt>Resource<\/dt><dd>UNIPROT<\/dd>/);
    assert.ok(out.includes(`href="${SITE}/documentation/inferred-events"`));
    const comparison = await html(model(REPORT_TOKENS.speciesComparison, undefined, MOUSE));
    assert.match(comparison, /<dt>Compared with<\/dt><dd>Mus musculus<\/dd>/);
  });

  test("the user guide for an analysis's type, ReactomeGSA's for a ReactomeGSA type", async () => {
    const m = await model(REPORT_TOKENS.expression);
    const guide = `href="${SITE}/documentation/userguide/analysis"`;
    const gsaGuide = `href="${SITE}/documentation/userguide/analysis/gsa"`;
    const plain = await html(m);
    assert.ok(plain.includes(guide));
    assert.ok(!plain.includes(gsaGuide));
    for (const type of ['GSA_STATISTICS', 'GSA_REGULATION', 'GSVA']) {
      const gsa = await html({
        ...m,
        summary: { ...m.summary, type, gsaMethod: 'Placeholder method' },
      });
      assert.ok(gsa.includes(gsaGuide), type);
      assert.ok(!gsa.includes(guide), type);
      assert.match(gsa, /<dt>ReactomeGSA method<\/dt><dd>Placeholder method<\/dd>/, type);
    }
    assert.equal(isGsa('EXPRESSION'), false);
  });

  test("each table row's name links to its pathway's detail", async () => {
    const m = await model(REPORT_TOKENS.overrepresentation);
    const out = await html(m);
    const table = /<table class="pathways">[\s\S]*?<\/table>/.exec(out)?.[0] ?? '';
    const rows = [
      ...table.matchAll(
        /<tr><td><a href="([^"]*)">([^<]*)<\/a><\/td>((?:<td>[^<]*<\/td>)*)<\/tr>/g
      ),
    ];
    assert.deepEqual(
      rows.map((r) => [r[1], r[2]]),
      m.pathways.map((p) => [`#s-${p.stId}`, p.name])
    );
    // Alpha pathway: 3 found of 12, its statistics as the analysis gave them
    const alpha = rows.find((r) => r[2] === 'Alpha pathway')?.[3];
    assert.equal(
      alpha,
      '<td>3</td><td>12</td><td>0.0012</td><td>1.00e-4</td><td>6.00e-4</td><td>3</td><td>5</td><td>1.25e-4</td>'
    );
  });

  test("the overview's place: its figure linked to the result and captioned, or left empty", async () => {
    const m = await model(REPORT_TOKENS.overrepresentation);
    const out = await html(m);
    const overview = /data-part="overview"[\s\S]*?<\/section>/.exec(out)?.[0] ?? '';
    assert.match(overview, /<svg/);
    assert.ok(overview.includes(`href="${SITE}/PathwayBrowser?analysis=${m.token}"`));
    assert.match(overview, /genome-wide overview of Homo sapiens/);
    const empty = /data-part="overview"[\s\S]*?<\/section>/.exec(
      reportFrontHtml(m, { ...options(), overview: undefined })
    )?.[0];
    assert.ok(empty !== undefined && !empty.includes('<svg') && !empty.includes('caption'));
  });

  test('the contents list: the parts, each pathway under the details, the not found only when there are some', async () => {
    const m = await model(REPORT_TOKENS.overrepresentation);
    assert.deepEqual(
      reportContents(m).map((e) => [e.target, e.depth]),
      [
        ['introduction', 0],
        ['properties', 0],
        ['overview', 0],
        ['pathways', 0],
        ['details', 0],
        ...m.pathways.map((p) => [`s-${p.stId}`, 1]),
        ['found', 0],
        ['not-found', 0],
      ]
    );
    const none = reportContents({ ...m, notFound: [] }).map((e) => e.target);
    assert.ok(!none.includes('not-found'));
    const comparison = await model(REPORT_TOKENS.speciesComparison);
    assert.ok(!reportContents({ ...comparison, pathways: [] }).some((e) => e.target === 'details'));
  });

  test('statistics: three significant figures, small ones as powers of ten', () => {
    assert.equal(statistic(0), '0');
    assert.equal(statistic(1), '1');
    assert.equal(statistic(0.123456), '0.123');
    assert.equal(statistic(0.0012), '0.0012');
    assert.equal(statistic(0.0001), '1.00e-4');
    assert.equal(statistic(3.14159e-12), '3.14e-12');
  });
});

describe("an article's reference in the report (T028)", () => {
  const article = (title: string): Reference => ({
    dbId: 1,
    kind: 'article',
    title,
    chapterTitle: null,
    journal: 'Placeholder Journal',
    volume: 4,
    pages: '39-49',
    year: 2003,
    pubMedId: 1,
    isbn: null,
    url: null,
    publisher: null,
    authors: ['Placeholder, A'],
    moreAuthors: false,
  });
  const plain = (markup: string): string => markup.replace(/<[^>]*>/g, '');

  test("a title ending in a full stop has one, as today's ApaStyle trims it", () => {
    const want = 'Placeholder, A (2003). A made-up title. Placeholder Journal, 4, 39-49.';
    assert.equal(plain(reportReference(article('A made-up title.'))), want);
    // white space, commas and full stops at either end, as today's trims them
    assert.equal(plain(reportReference(article(' ,A made-up title,. '))), want);
    // a full stop within the title kept
    assert.equal(
      plain(reportReference(article('A made-up title. Part 2'))),
      'Placeholder, A (2003). A made-up title. Part 2. Placeholder Journal, 4, 39-49.'
    );
  });
});
