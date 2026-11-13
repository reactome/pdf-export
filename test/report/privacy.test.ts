// What users submitted stays theirs (spec 002 T015, FR-211, research R7): the service's log
// holds one line a report made, without a submitted identifier or the token, and the
// printer's working pages are in the service's private folder, gone once printed, and gone
// when the service starts after a print that was killed.
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  watch,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';

import { graphSettings, openGraph, type Graph } from '../../src/graph/connection.ts';
import { startService, type ServeSettings, type Service } from '../../src/serve.ts';
import { REPORT_TOKENS, startAnalysisStub, type AnalysisStub } from '../stubs/analysis.ts';
import { startRenderStub, type RenderStub } from '../stubs/render.ts';

const skip = process.env['NEO4J_URI'] ? false : 'no fixture graph: set NEO4J_URI';
const FILES = fileURLToPath(new URL('../../ci/fixture/files/', import.meta.url));
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** What the stub's analyses were submitted with: none of it may reach the log or the folder. */
const SUBMITTED = /X[RCNMZ]\d{4}|XU\d{4}|Placeholder sample|placeholder-list/;

describe('what users submitted stays theirs', { skip }, () => {
  let graph: Graph;
  let analysis: AnalysisStub;
  let render: RenderStub;
  let scratch: string;

  before(async () => {
    graph = openGraph(graphSettings(process.env));
    analysis = await startAnalysisStub();
    render = await startRenderStub();
    scratch = mkdtempSync(join(tmpdir(), 'pdfx-privacy-'));
  });
  after(async () => {
    await render.close();
    await analysis.close();
    await graph.close();
    rmSync(scratch, { recursive: true, force: true });
  });

  const settings = (work: string): ServeSettings => ({
    bind: '127.0.0.1',
    port: 0,
    graph: graphSettings(process.env),
    files: FILES,
    figures: null,
    render: render.url,
    analysis: analysis.url,
    site: 'https://site.invalid',
    concurrency: 2,
    work,
  });
  const start = (work: string, lines: string[]): Promise<Service> =>
    startService(settings(work), {
      graph,
      log: (line) => lines.push(line),
      limits: { retryPauseMs: 20, reportWaitMs: 200 },
    });

  test("the log: one line a report made, its stages and size, no identifier, no token; the folder's pages gone", async () => {
    const work = join(scratch, 'work');
    const lines: string[] = [];
    const service = await start(work, lines);
    // every page the printer writes, by its name, as it is written there
    const written = new Set<string>();
    const watcher = watch(work, (_event, name) => {
      if (name) written.add(name);
    });
    try {
      const tokens = [
        REPORT_TOKENS.overrepresentation,
        REPORT_TOKENS.expression,
        REPORT_TOKENS.interactors,
      ];
      let requests = 0;
      for (const token of tokens) {
        const url = `${service.url}/AnalysisService/report/${token}/9606/report.pdf?number=2`;
        let answer = await fetch(url);
        requests += 1;
        for (let i = 0; answer.status === 202 && i < 60; i++) {
          await answer.body?.cancel();
          await pause(150);
          answer = await fetch(url);
          requests += 1;
        }
        assert.equal(answer.status, 200, token);
        await answer.body?.cancel();
      }
      assert.ok(requests > tokens.length, 'more requests than reports');
      const reports = lines.filter((line) => line.startsWith('report '));
      assert.equal(reports.length, tokens.length, 'one line a report, not a request');
      for (const line of reports) {
        assert.match(
          line,
          /^report [0-9a-f]{16} species=9606 number=2 pathways=\d+ analysis=\d+ms graph=\d+ms figures=\d+ms layout=\d+ms print=\d+ms size=\d+ replaced=none$/
        );
      }
      for (const line of lines) {
        assert.doesNotMatch(line, SUBMITTED, line);
        for (const token of tokens) {
          assert.ok(!line.includes(token) && !line.includes(decodeURIComponent(token)), line);
        }
      }
      assert.ok(written.size > 0, "the printer's pages were written in the working folder");
      assert.deepEqual(readdirSync(work), [], 'and are gone once printed');
      assert.equal(statSync(work).mode & 0o777, 0o700, 'private to the service');
    } finally {
      watcher.close();
      await service.close();
    }
  });

  test('a page a killed print left is gone when the service starts', async () => {
    const work = join(scratch, 'killed');
    mkdirSync(work, { recursive: true, mode: 0o755 });
    writeFileSync(join(work, '7.html'), '<p>XR0001 XZ0003</p>');
    mkdirSync(join(work, 'left'));
    const service = await start(work, []);
    try {
      assert.deepEqual(readdirSync(work), []);
      assert.equal(statSync(work).mode & 0o777, 0o700);
    } finally {
      await service.close();
    }
  });
});
