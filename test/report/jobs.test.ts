// The reports in the background (spec 002 T013, FR-210): the jobs alone, then the service's
// address answering 202 and then the PDF, on the fixture graph with the stubs.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { after, afterEach, before, describe, test } from 'node:test';

import { graphSettings, openGraph, type Graph } from '../../src/graph/connection.ts';
import { Jobs, type JobSettings } from '../../src/report/jobs.ts';
import { startService, type ServeSettings, type Service } from '../../src/serve.ts';
import { REPORT_TOKENS, startAnalysisStub, type AnalysisStub } from '../stubs/analysis.ts';
import { startRenderStub, type RenderStub } from '../stubs/render.ts';

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface Controlled {
  make: (signal: AbortSignal) => Promise<string>;
  started: number;
  signal: AbortSignal | null;
  end: (value: string) => void;
  fail: (error: Error) => void;
}

/** A report made by hand: `end` finishes it, `fail` ends it in an error. */
function controlled(): Controlled {
  let resolve: (value: string) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const state: Controlled = {
    started: 0,
    signal: null,
    end: (value) => {
      resolve(value);
    },
    fail: (error) => {
      reject(error);
    },
    make: (signal) => {
      state.started += 1;
      state.signal = signal;
      return new Promise<string>((res, rej) => {
        resolve = res;
        reject = rej;
      });
    },
  };
  return state;
}

const SETTINGS: JobSettings = {
  making: 2,
  budgetMs: 10_000,
  keepMs: 10_000,
  budgetError: () => new Error('budget'),
};

describe('the jobs', () => {
  test('a second request for one key joins the report; another key starts its own', async () => {
    const jobs = new Jobs<string>(SETTINGS);
    const a = controlled();
    const first = jobs.join('k', a.make);
    const second = jobs.join('k', a.make);
    assert.equal(a.started, 1);
    assert.equal(await jobs.wait(first, 20), 'waiting');
    a.end('pdf');
    assert.equal(await jobs.wait(second, 1_000), 'done');
    assert.equal(second.state, 'ready');
    assert.equal(second.result, 'pdf');
    // kept: a later request is answered at once, nothing made again
    const later = jobs.join('k', a.make);
    assert.equal(await jobs.wait(later, 0), 'done');
    assert.equal(later.result, 'pdf');
    assert.equal(a.started, 1);
    const b = controlled();
    jobs.join('other', b.make);
    assert.equal(b.started, 1);
    jobs.clear();
  });

  test('an error goes to every request waiting and to the next, then a fresh start', async () => {
    const jobs = new Jobs<string>(SETTINGS);
    const a = controlled();
    const waiting = [jobs.join('k', a.make), jobs.join('k', a.make)];
    const waits = waiting.map((job) => jobs.wait(job, 1_000));
    a.fail(new Error('the print failed'));
    assert.deepEqual(await Promise.all(waits), ['done', 'done']);
    assert.ok(waiting.every((job) => job.state === 'failed'));
    const next = jobs.join('k', a.make);
    assert.equal(next.state, 'failed', 'the next request is given the error');
    assert.equal(a.started, 1);
    const fresh = jobs.join('k', a.make);
    assert.equal(fresh.state, 'making', 'then it is forgotten, and started again');
    assert.equal(a.started, 2);
    jobs.clear();
  });

  test('the budget ends a report as its error, from when it starts being made', async () => {
    const jobs = new Jobs<string>({ ...SETTINGS, making: 1, budgetMs: 80 });
    const a = controlled();
    const b = controlled();
    const first = jobs.join('a', a.make);
    const queued = jobs.join('b', b.make);
    assert.equal(queued.state, 'queued');
    await jobs.wait(first, 1_000);
    assert.equal(first.state, 'failed');
    assert.equal((first.error as Error).message, 'budget');
    assert.equal(a.signal?.aborted, true, "the report's work told to stop");
    // the queued one's budget began only when it started: 40 ms into it, it is still being made
    assert.equal(queued.state, 'making');
    await pause(40);
    assert.equal(queued.state, 'making');
    b.end('pdf');
    await jobs.wait(queued, 1_000);
    assert.equal(queued.state, 'ready');
    jobs.clear();
  });

  test('a request that ends its wait leaves the report to finish', async () => {
    const jobs = new Jobs<string>(SETTINGS);
    const a = controlled();
    const job = jobs.join('k', a.make);
    const gone = new AbortController();
    const waited = jobs.wait(job, 10_000, gone.signal);
    gone.abort();
    assert.equal(await waited, 'waiting');
    assert.equal(a.signal?.aborted, false);
    a.end('pdf');
    await pause(0);
    assert.equal(jobs.join('k', a.make).result, 'pdf');
    jobs.clear();
  });

  test('no more made at once than the setting; the rest wait their turn in order', async () => {
    const jobs = new Jobs<string>({ ...SETTINGS, making: 1 });
    const a = controlled();
    const b = controlled();
    jobs.join('a', a.make);
    const second = jobs.join('b', b.make);
    assert.deepEqual([a.started, b.started], [1, 0]);
    assert.deepEqual(jobs.counts, { queued: 1, making: 1, ready: 0, failed: 0 });
    a.end('pdf');
    await pause(0);
    assert.equal(b.started, 1);
    assert.equal(second.state, 'making');
    jobs.clear();
  });

  test('a finished report is forgotten after the keeping time', async () => {
    const jobs = new Jobs<string>({ ...SETTINGS, keepMs: 40 });
    const a = controlled();
    jobs.join('k', a.make);
    a.end('pdf');
    await pause(0);
    assert.equal(jobs.counts.ready, 1);
    await pause(80);
    assert.equal(jobs.counts.ready, 0);
    jobs.join('k', a.make);
    assert.equal(a.started, 2);
    jobs.clear();
  });
});

const skip = process.env['NEO4J_URI'] ? false : 'no fixture graph: set NEO4J_URI';
const FILES = fileURLToPath(new URL('../../ci/fixture/files/', import.meta.url));

describe('the report in the background, at its address', { skip }, () => {
  let graph: Graph;
  let analysis: AnalysisStub;
  let render: RenderStub;
  let service: Service;

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
      log: () => undefined,
      limits: {
        retryPauseMs: 20,
        analysisTimeoutMs: 2_000,
        figureTimeoutMs: 5_000,
        reportWaitMs: 150,
        reportBudgetMs: 60_000,
      },
    });
  });
  afterEach(() => {
    analysis.reset();
    render.reset();
  });
  after(async () => {
    await service.close();
    await render.close();
    await analysis.close();
    await graph.close();
  });

  const address = (number: number): string =>
    `${service.url}/AnalysisService/report/${REPORT_TOKENS.expression}/9606/report.pdf?number=${String(number)}`;
  /** The report's own calls: call 4, posted once a report. */
  const reportsMade = (): number => analysis.requests.filter((r) => r.method === 'POST').length;

  test('a slow report: 202 with Retry-After, then the PDF at the same address', async () => {
    render.slow(400);
    const first = await fetch(address(1));
    assert.equal(first.status, 202);
    assert.equal(first.headers.get('retry-after'), '10');
    assert.equal(first.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await first.json(), {
      code: 202,
      reason: 'Accepted',
      messages: ['The report is being made; ask again in 10 seconds'],
    });
    let answer = await fetch(address(1));
    for (let i = 0; answer.status === 202 && i < 40; i++) {
      await answer.body?.cancel();
      await pause(150);
      answer = await fetch(address(1));
    }
    assert.equal(answer.status, 200);
    assert.equal(answer.headers.get('content-type'), 'application/pdf');
    await answer.body?.cancel();
    assert.equal(reportsMade(), 1, 'one report for every request');
  });

  test('two requests at once for one key make one report; each request checks the token', async () => {
    render.slow(100);
    const [a, b] = await Promise.all([fetch(address(2)), fetch(address(2))]);
    await a.body?.cancel();
    await b.body?.cancel();
    let asked = 2;
    let answer = await fetch(address(2));
    asked += 1;
    for (let i = 0; answer.status === 202 && i < 40; i++) {
      await answer.body?.cancel();
      await pause(150);
      answer = await fetch(address(2));
      asked += 1;
    }
    assert.equal(answer.status, 200);
    await answer.body?.cancel();
    assert.equal(reportsMade(), 1);
    // the report's own call 1 aside, one check a request
    const checks = analysis.requests.filter((r) => r.path.endsWith('/resources')).length;
    assert.equal(checks, asked);
  });

  test('a report past its budget is 503 to the request waiting and to the next', async () => {
    const tight = await startService(
      {
        bind: '127.0.0.1',
        port: 0,
        graph: graphSettings(process.env),
        files: FILES,
        figures: null,
        render: render.url,
        analysis: analysis.url,
        site: 'https://site.invalid',
        concurrency: 2,
      },
      {
        graph,
        log: () => undefined,
        limits: { retryPauseMs: 20, reportWaitMs: 2_000, reportBudgetMs: 300 },
      }
    );
    try {
      render.slow(1_000);
      const url = `${tight.url}/AnalysisService/report/${REPORT_TOKENS.expression}/9606/report.pdf?number=5`;
      const waited = await fetch(url);
      assert.equal(waited.status, 503);
      assert.equal(waited.headers.get('retry-after'), '10');
      await waited.body?.cancel();
      const next = await fetch(url);
      assert.equal(next.status, 503, 'the next request is given the error too');
      await next.body?.cancel();
    } finally {
      render.reset();
      await tight.close();
    }
  });

  test('a browser waiting is given a page that asks again', async () => {
    render.slow(400);
    const res = await fetch(address(3), { headers: { Accept: 'text/html,application/xhtml+xml' } });
    assert.equal(res.status, 202);
    assert.match(res.headers.get('content-type') ?? '', /^text\/html/);
    const page = await res.text();
    assert.match(page, /<meta http-equiv="refresh" content="10">/);
    assert.match(page, /ask again in 10 seconds/);
  });
});
