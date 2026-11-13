// Making a report and `pdf-export report` (spec 002 T011), on the fixture graph with the
// analysis and render stubs, printed by spec 001's printer.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

import { graphSettings, openGraph, type Graph } from '../../src/graph/connection.ts';
import { readSummary } from '../../src/preflight/files.ts';
import { Printer } from '../../src/print/print.ts';
import { reportCommand, reportSettings, SettingsError } from '../../src/report/command.ts';
import { Slots } from '../../src/report/figures.ts';
import {
  ReportError,
  brokenLinks,
  makeReport,
  missingAnchors,
  type ReportRequest,
  type ReportServices,
} from '../../src/report/report.ts';
import { REPORT_TOKENS, TOKENS, startAnalysisStub, type AnalysisStub } from '../stubs/analysis.ts';
import { startRenderStub, type RenderStub } from '../stubs/render.ts';

const skip = process.env['NEO4J_URI'] ? false : 'no fixture graph: set NEO4J_URI';
const FILES = fileURLToPath(new URL('../../ci/fixture/files/', import.meta.url));
const SITE = 'https://site.example';
/**
 * Where the data's own links go, beside the site: a reference's publication, and a link in
 * a summation (the fixture's Alpha pathway's, to example.org).
 */
const REFERENCE_HOSTS = [
  'https://pubmed.ncbi.nlm.nih.gov/',
  'https://doi.org/',
  'https://example.org/',
];
const HUMAN_OR = [
  'R-HSA-90000210',
  'R-HSA-90000200',
  'R-HSA-90000300',
  'R-HSA-90000250',
  'R-HSA-90000100',
];
const NAMES: Readonly<Record<string, string>> = {
  'R-HSA-90000210': 'Alpha sub one',
  'R-HSA-90000200': 'Alpha pathway',
  'R-HSA-90000300': 'Gamma pathway',
  'R-HSA-90000250': 'Two-parent sub',
  'R-HSA-90000100': 'beta pathway',
};

interface OutlineItem {
  title: string;
  items: OutlineItem[];
}

/** A PDF's bookmarks, each with its depth, and every link's address or landing page. */
async function read(pdf: Uint8Array): Promise<{
  outline: { title: string; depth: number }[];
  external: string[];
  /** How many links land inside the PDF. */
  internal: number;
  pages: string[];
}> {
  const task = getDocument({ data: pdf.slice() });
  const doc = await task.promise;
  const outline: { title: string; depth: number }[] = [];
  const walk = (items: readonly OutlineItem[] | null, depth: number): void => {
    for (const item of items ?? []) {
      outline.push({ title: item.title, depth });
      walk(item.items, depth + 1);
    }
  };
  walk(await doc.getOutline(), 0);
  const external: string[] = [];
  let internal = 0;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const annotations = (await page.getAnnotations()) as {
      subtype?: string;
      url?: string;
      dest?: unknown;
    }[];
    for (const annot of annotations) {
      if (annot.subtype !== 'Link') continue;
      if (typeof annot.url === 'string') external.push(annot.url);
      else if (annot.dest) internal += 1;
    }
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
  }
  await task.destroy();
  return { outline, external, internal, pages };
}

describe('making a report', { skip }, () => {
  let graph: Graph;
  let analysis: AnalysisStub;
  let render: RenderStub;
  let printer: Printer;
  const lines: string[] = [];
  before(async () => {
    graph = openGraph(graphSettings(process.env));
    analysis = await startAnalysisStub();
    render = await startRenderStub();
    printer = await Printer.start();
  });
  after(async () => {
    await printer.close();
    await render.close();
    await analysis.close();
    await graph.close();
  });

  const services = (): ReportServices => ({
    graph,
    printer,
    analysis: analysis.url,
    render: render.url,
    site: SITE,
    illustrated: readSummary(FILES)?.illustrated ?? new Set(),
    slots: new Slots(2),
    log: (line) => lines.push(line),
    retryPauseMs: 10,
    now: () => new Date(Date.UTC(2026, 10, 13)),
  });
  const request = (over: Partial<ReportRequest> = {}): ReportRequest => ({
    token: REPORT_TOKENS.overrepresentation,
    species: 'Homo_sapiens',
    number: 25,
    resource: undefined,
    importableOnly: false,
    ...over,
  });

  let made: Awaited<ReturnType<typeof read>> & { pdf: Uint8Array };
  test('the outline: the parts in order, each pathway under the details', async () => {
    const { pdf } = await makeReport(request(), services());
    made = { pdf, ...(await read(pdf)) };
    assert.deepEqual(made.outline, [
      { title: 'Contents', depth: 0 },
      { title: 'Introduction', depth: 0 },
      { title: 'Analysis properties', depth: 0 },
      { title: 'Genome-wide overview', depth: 0 },
      { title: 'Most significant pathways', depth: 0 },
      { title: 'Pathway details', depth: 0 },
      ...HUMAN_OR.map((stId) => ({ title: NAMES[stId] ?? stId, depth: 1 })),
      { title: 'Identifiers found', depth: 0 },
      { title: 'Identifiers not found', depth: 0 },
    ]);
  });

  test("every link lands inside the PDF or goes to the site (a reference's, to its publication)", async () => {
    assert.equal(await brokenLinks(made.pdf), 0);
    // inside: the contents list's 12 entries, and the table's 5 rows, each printed
    assert.ok(made.internal >= 12 + HUMAN_OR.length, String(made.internal));
    const elsewhere = made.external.filter(
      (url) => !url.startsWith(`${SITE}/`) && !REFERENCE_HOSTS.some((host) => url.startsWith(host))
    );
    assert.deepEqual(elsewhere, []);
    // the table's rows and the contents land inside: the site's links are the rest
    assert.ok(made.external.some((url) => url.startsWith(`${SITE}/content/detail/R-HSA-90000200`)));
  });

  test('the link checks: an anchor the page lacks before the print, a landing nowhere after', async () => {
    assert.deepEqual(missingAnchors('<a href="#a">a</a><a href="#b">b</a><p id="a"></p>'), ['b']);
    assert.deepEqual(missingAnchors('<a href="#a">a</a><h1 id="a">a</h1>'), []);
    const hidden = await printer.print(
      '<!doctype html><html><body><a href="#gone">to</a><div id="gone" style="display:none">x</div></body></html>',
      true
    );
    assert.equal(await brokenLinks(hidden), 1);
  });

  test('a running header names the report, or the part; the cover has none', () => {
    const [cover = '', ...rest] = made.pages;
    assert.ok(!cover.includes('Pathway Analysis Report - '));
    assert.ok(rest.some((page) => page.includes('Pathway Analysis Report - OVERREPRESENTATION')));
    const last = rest.at(-1) ?? '';
    // the part's header and its heading
    assert.equal(last.split('Identifiers not found').length - 1, 2, last);
    assert.ok(last.includes(String(made.pages.length)), "the last page's number");
  });

  test("number=50 against the stub's largest token returns all of its pathways in the species", async () => {
    const { model, pdf } = await makeReport(request({ number: 50 }), services());
    assert.deepEqual(
      model.pathways.map((p) => p.stId),
      HUMAN_OR
    );
    const { outline } = await read(pdf);
    assert.equal(outline.filter((e) => e.depth === 1).length, HUMAN_OR.length);
  });

  test('the species before the token; a token gone is gone-token', async () => {
    analysis.reset();
    await assert.rejects(
      makeReport(request({ species: 'Pan troglodytes', token: TOKENS.gone }), services()),
      (error: unknown) => error instanceof ReportError && error.reason === 'no-species'
    );
    assert.equal(analysis.requests.length, 0, 'the analysis service never asked');
    await assert.rejects(
      makeReport(request({ token: REPORT_TOKENS.gone }), services()),
      (error: unknown) => error instanceof ReportError && error.reason === 'gone-token'
    );
  });

  test('`pdf-export report` writes the report to its file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pdfx-report-'));
    try {
      const out = join(dir, 'report.pdf');
      const said: string[] = [];
      const code = await reportCommand(
        [
          '--token',
          REPORT_TOKENS.expression,
          '--species',
          '9606',
          '--number',
          '2',
          '-o',
          out,
          '--files',
          FILES,
          '--render',
          render.url,
          '--analysis',
          analysis.url,
          '--site',
          SITE,
        ],
        process.env,
        { out: (text) => said.push(text), err: (text) => said.push(text) }
      );
      assert.equal(code, 0, said.join(''));
      assert.ok(existsSync(out));
      assert.equal(readFileSync(out).subarray(0, 5).toString(), '%PDF-');
      // the report's one log line, then where it was written
      assert.equal(said.length, 2, said.join(''));
      assert.match(said[0] ?? '', /^report [0-9a-f]{16} species=9606 number=2 /);
      assert.equal(said[1], `${out}: 2 pathways\n`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("`pdf-export report`'s settings", () => {
  const env = { NEO4J_URI: 'bolt://127.0.0.1:1' };
  const base = ['--token', 't', '--species', '9606', '-o', 'r.pdf', '--files', FILES];
  const rest = ['--render', 'http://r', '--analysis', 'http://a', '--site', SITE];

  test('reads the request: the number clamped, importable-only a switch', () => {
    const settings = reportSettings([...base, ...rest, '--number', '51', '--importable-only'], env);
    assert.deepEqual(settings.request, {
      token: 't',
      species: '9606',
      number: 50,
      resource: undefined,
      importableOnly: true,
    });
    assert.equal(reportSettings([...base, ...rest], env).request.number, 25);
    assert.equal(reportSettings([...base, ...rest], env).request.importableOnly, false);
    assert.equal(reportSettings([...base, ...rest], env).concurrency, 2);
  });

  test('refuses an unknown flag, a repeat, a number that is not one, a missing setting', () => {
    for (const args of [
      [...base, ...rest, '--colour', 'x'],
      [...base, ...rest, '--token', 'u'],
      [...base, ...rest, '--number', 'abc'],
      [...base, ...rest, '--importable-only=yes'],
      base,
    ]) {
      assert.throws(() => reportSettings(args, env), SettingsError, args.join(' '));
    }
  });
});
