// The report's address in the service (spec 002 T012, contracts/service.md, research R5), on
// the fixture graph with the analysis and render stubs.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { after, afterEach, before, describe, test } from 'node:test';

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

import { graphSettings, openGraph, type Graph } from '../../src/graph/connection.ts';
import { Printer } from '../../src/print/print.ts';
import {
  startService,
  type ServeSettings,
  type Service,
  type ServicePrinter,
} from '../../src/serve.ts';
import { REPORT_TOKENS, TOKENS, startAnalysisStub, type AnalysisStub } from '../stubs/analysis.ts';
import { startRenderStub, type RenderStub } from '../stubs/render.ts';

const skip = process.env['NEO4J_URI'] ? false : 'no fixture graph: set NEO4J_URI';
const FILES = fileURLToPath(new URL('../../ci/fixture/files/', import.meta.url));
const OR = REPORT_TOKENS.overrepresentation;
const SERVICE_JSON = 'application/json;charset=UTF-8';

/** The analysis service's own error body, as today's writes it. */
const body = (code: number, reason: string): string =>
  `${JSON.stringify({ code, reason, messages: [] })}\n`;

async function pages(pdf: Uint8Array): Promise<string[]> {
  const task = getDocument({ data: pdf.slice() });
  const doc = await task.promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    out.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
  }
  await task.destroy();
  return out;
}

describe("the report's address", { skip }, () => {
  let graph: Graph;
  let analysis: AnalysisStub;
  let render: RenderStub;
  let service: Service;
  /** Whether the next print fails, as a printer's fault would. */
  const printing = { fails: false };
  const lines: string[] = [];

  before(async () => {
    graph = openGraph(graphSettings(process.env));
    analysis = await startAnalysisStub();
    render = await startRenderStub();
    const settings: ServeSettings = {
      bind: '127.0.0.1',
      port: 0,
      graph: graphSettings(process.env),
      files: FILES,
      figures: null,
      render: render.url,
      analysis: analysis.url,
      site: 'https://site.invalid',
      concurrency: 2,
    };
    service = await startService(settings, {
      graph,
      log: (line) => lines.push(line),
      limits: { retryPauseMs: 20, analysisTimeoutMs: 2_000, figureTimeoutMs: 2_000 },
      startPrinter: async (): Promise<ServicePrinter> => {
        const printer = await Printer.start();
        return {
          single: (html, signal) =>
            printing.fails
              ? Promise.reject(new Error('the print failed'))
              : printer.single(html, signal),
          get connected() {
            return printer.connected;
          },
          onDisconnected: (listener) => {
            printer.onDisconnected(listener);
          },
          close: () => printer.close(),
        };
      },
    });
  });
  afterEach(() => {
    analysis.reset();
    render.reset();
    printing.fails = false;
    lines.length = 0;
  });
  after(async () => {
    await service.close();
    await render.close();
    await analysis.close();
    await graph.close();
  });

  const get = (path: string): Promise<Response> => fetch(`${service.url}${path}`);
  const address = (token: string, species = '9606', query = ''): string =>
    `/AnalysisService/report/${token}/${species}/report.pdf${query}`;

  test('the PDF, as today names it, never kept by a cache', async () => {
    const res = await get(address(OR, 'Homo_sapiens', '?number=2'));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    assert.equal(res.headers.get('content-disposition'), 'attachment; filename="report.pdf"');
    assert.equal(res.headers.get('cache-control'), 'private, no-store');
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    const pdf = new Uint8Array(await res.arrayBuffer());
    assert.equal(new TextDecoder().decode(pdf.subarray(0, 5)), '%PDF-');
    assert.ok(
      lines.every((line) => !line.includes(OR)),
      'the token never logged'
    );
  });

  test('a profile and the file name change nothing', async () => {
    const plain = await get(address(OR, '9606', '?number=1'));
    const profiled = await get(
      `/AnalysisService/report/${OR}/9606/other-name.pdf?number=1&diagramProfile=Standard&analysisProfile=Unknown&fireworksProfile=Barium%20Lithium`
    );
    assert.equal(profiled.status, 200);
    assert.equal(profiled.headers.get('content-disposition'), 'attachment; filename="report.pdf"');
    assert.deepEqual(
      await pages(new Uint8Array(await profiled.arrayBuffer())),
      await pages(new Uint8Array(await plain.arrayBuffer()))
    );
  });

  test("a number or flag that is not one: today's framework 400, before the species", async () => {
    for (const [species, query] of [
      ['9606', '?number=abc'],
      ['9606', '?number=1.5'],
      ['9606', '?importableOnly=maybe'],
      ['Unknown_species', '?number=abc'],
    ] as const) {
      const before = Date.now();
      const path = address(OR, species);
      const res = await get(`${path}${query}`);
      assert.equal(res.status, 400, query);
      assert.equal(res.headers.get('content-type'), SERVICE_JSON);
      assert.equal(res.headers.get('content-disposition'), 'inline;filename=f.txt');
      assert.equal(res.headers.get('connection'), 'close');
      assert.equal(res.headers.get('access-control-allow-origin'), '*');
      const text = await res.text();
      const json = JSON.parse(text) as { timestamp: string };
      assert.deepEqual(Object.keys(json), ['timestamp', 'status', 'error', 'path']);
      assert.equal(
        text,
        JSON.stringify({ timestamp: json.timestamp, status: 400, error: 'Bad Request', path })
      );
      assert.match(json.timestamp, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}\+00:00$/);
      assert.ok(Date.parse(json.timestamp) >= before - 1000);
    }
    assert.equal(analysis.requests.length, 0);
  });

  test('an unknown species is 404 before the token, a good or unknown one', async () => {
    for (const token of [OR, TOKENS.expired, 'notatoken']) {
      const res = await get(address(token, 'Pan_troglodytes'));
      assert.equal(res.status, 404, token);
      assert.equal(res.headers.get('content-type'), SERVICE_JSON);
      assert.equal(await res.text(), body(404, 'Not Found'));
    }
    assert.equal(analysis.requests.length, 0, 'the analysis service never asked');
  });

  test('the token: malformed or with %2F 404 before any call; unknown 404; gone 410', async () => {
    for (const token of ['notatoken', 'abc%2Fdef', `${OR.slice(0, 8)}%2F${OR.slice(8)}`]) {
      const res = await get(address(token));
      assert.equal(res.status, 404, token);
      assert.equal(await res.text(), body(404, 'Not Found'));
    }
    assert.equal(analysis.requests.length, 0, 'a malformed token is never sent');
    const unknown = await get(address(TOKENS.expired));
    assert.equal(unknown.status, 404);
    assert.equal(await unknown.text(), body(404, 'Not Found'));
    const gone = await get(address(REPORT_TOKENS.gone));
    assert.equal(gone.status, 410);
    assert.equal(await gone.text(), body(410, 'Gone'));
  });

  test('the analysis service failing is 503 with Retry-After; the print failing 500', async () => {
    analysis.refuse();
    const down = await get(address(OR));
    assert.equal(down.status, 503);
    assert.equal(down.headers.get('retry-after'), '10');
    assert.equal(down.headers.get('cache-control'), 'no-store');
    const json = JSON.parse(await down.text()) as {
      code: number;
      reason: string;
      messages: string[];
    };
    assert.deepEqual([json.code, json.reason], [503, 'Service Unavailable']);
    analysis.reset();
    printing.fails = true;
    const failed = await get(address(OR, '9606', '?number=1'));
    assert.equal(failed.status, 500);
    assert.equal(await failed.text(), body(500, 'Internal Server Error'));
  });
});
