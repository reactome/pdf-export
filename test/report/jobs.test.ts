// The reports in the background (spec 002 T013, FR-210): the jobs alone, then the service's
// address answering 202 and then the PDF, on the fixture graph with the stubs.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { after, afterEach, before, describe, test } from 'node:test';

import { graphSettings, openGraph, type Graph } from '../../src/graph/connection.ts';
import { Jobs, type Job, type JobSettings } from '../../src/report/jobs.ts';
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

const SETTINGS: JobSettings<string> = {
  making: 2,
  waiting: 8,
  perClient: 2,
  budgetMs: 10_000,
  keepMs: 10_000,
  keepBytes: 1_000,
  size: (result) => result.length,
  budgetError: () => new Error('budget'),
};

/** A job taken, never refused. */
function take<T>(
  jobs: Jobs<T>,
  key: string,
  make: (signal: AbortSignal) => Promise<T>,
  client = 'c'
): Job<T> {
  const job = jobs.join(key, client, make);
  if (job === 'full' || job === 'share') throw new Error(`refused: ${job}`);
  return job;
}

describe('the jobs', () => {
  test('a second request for one key joins the report; another key starts its own', async () => {
    const jobs = new Jobs<string>(SETTINGS);
    const a = controlled();
    const first = take(jobs, 'k', a.make);
    const second = take(jobs, 'k', a.make);
    assert.equal(a.started, 1);
    assert.equal(await jobs.wait(first, 20), 'waiting');
    a.end('pdf');
    assert.equal(await jobs.wait(second, 1_000), 'done');
    assert.equal(second.state, 'ready');
    assert.equal(second.result, 'pdf');
    // kept: a later request is answered at once, nothing made again
    const later = take(jobs, 'k', a.make);
    assert.equal(await jobs.wait(later, 0), 'done');
    assert.equal(later.result, 'pdf');
    assert.equal(a.started, 1);
    const b = controlled();
    take(jobs, 'other', b.make);
    assert.equal(b.started, 1);
    jobs.clear();
  });

  test('an error goes to every request waiting and to the next, then a fresh start', async () => {
    const jobs = new Jobs<string>(SETTINGS);
    const a = controlled();
    const waiting = [take(jobs, 'k', a.make), take(jobs, 'k', a.make)];
    const waits = waiting.map((job) => jobs.wait(job, 1_000));
    a.fail(new Error('the print failed'));
    assert.deepEqual(await Promise.all(waits), ['done', 'done']);
    assert.ok(waiting.every((job) => job.state === 'failed'));
    const next = take(jobs, 'k', a.make);
    assert.equal(next.state, 'failed', 'the next request is given the error');
    assert.equal(a.started, 1);
    const fresh = take(jobs, 'k', a.make);
    assert.equal(fresh.state, 'making', 'then it is forgotten, and started again');
    assert.equal(a.started, 2);
    jobs.clear();
  });

  test('the budget ends a report as its error, from when it starts being made', async () => {
    const jobs = new Jobs<string>({ ...SETTINGS, making: 1, budgetMs: 80 });
    const a = controlled();
    const b = controlled();
    const first = take(jobs, 'a', a.make);
    const queued = take(jobs, 'b', b.make);
    assert.equal(queued.state, 'queued');
    await jobs.wait(first, 1_000);
    assert.equal(first.state, 'failed');
    assert.equal((first.error as Error).message, 'budget');
    assert.equal(a.signal?.aborted, true, "the report's work told to stop");
    // its work stops: then the queued one starts, its own budget from then
    a.fail(new Error('stopped'));
    await pause(0);
    assert.equal(queued.state, 'making');
    await pause(40);
    assert.equal(queued.state, 'making', '40 ms into its budget, it is still being made');
    b.end('pdf');
    await jobs.wait(queued, 1_000);
    assert.equal(queued.state, 'ready');
    jobs.clear();
  });

  test('a report past its budget keeps its place until its work stops: the next waits', async () => {
    const jobs = new Jobs<string>({ ...SETTINGS, making: 2, budgetMs: 50 });
    const late = controlled();
    const other = controlled();
    const third = controlled();
    const timedOut = take(jobs, 'late', late.make);
    take(jobs, 'other', other.make);
    const queued = take(jobs, 'third', third.make);
    await jobs.wait(timedOut, 1_000);
    assert.equal(timedOut.state, 'failed', 'answered at once');
    await pause(20);
    assert.equal(queued.state, 'queued', 'the timed-out work still holds its place');
    assert.equal(third.started, 0);
    assert.equal(jobs.counts.making, 2);
    // its print, say, ends: only then does the third start
    late.fail(new Error('stopped'));
    await pause(0);
    assert.equal(queued.state, 'making');
    assert.equal(third.started, 1);
    jobs.clear();
  });

  test('a request that ends its wait leaves the report to finish', async () => {
    const jobs = new Jobs<string>(SETTINGS);
    const a = controlled();
    const job = take(jobs, 'k', a.make);
    const gone = new AbortController();
    const waited = jobs.wait(job, 10_000, gone.signal);
    gone.abort();
    assert.equal(await waited, 'waiting');
    assert.equal(a.signal?.aborted, false);
    a.end('pdf');
    await pause(0);
    assert.equal(take(jobs, 'k', a.make).result, 'pdf');
    jobs.clear();
  });

  test('two made at once and eight waiting: the ninth waiting refused, a join never counted', () => {
    const jobs = new Jobs<string>(SETTINGS);
    const make = controlled().make;
    for (let i = 0; i < 2 + 8; i++) take(jobs, `k${String(i)}`, make, `client ${String(i)}`);
    assert.deepEqual(jobs.counts, { making: 2, waiting: 8, kept: 0 });
    assert.equal(jobs.join('ninth', 'someone else', make), 'full');
    // joining one queued, or one being made, takes no place
    assert.notEqual(jobs.join('k9', 'someone else', make), 'full');
    assert.notEqual(jobs.join('k0', 'someone else', make), 'full');
    jobs.clear();
  });

  test("a third waiting from one client refused while another client's is taken", () => {
    const jobs = new Jobs<string>(SETTINGS);
    const make = controlled().make;
    take(jobs, 'm1', make, 'x');
    take(jobs, 'm2', make, 'y');
    take(jobs, 'a1', make, 'a');
    take(jobs, 'a2', make, 'a');
    assert.equal(jobs.join('a3', 'a', make), 'share');
    assert.notEqual(jobs.join('b1', 'b', make), 'share');
    // a report being made is not waiting: it is not counted in the share
    assert.notEqual(jobs.join('a2', 'a', make), 'share');
    jobs.clear();
  });

  test('a kept report is dropped after the hour, by the clock', async () => {
    let now = 0;
    const jobs = new Jobs<string>({ ...SETTINGS, keepMs: 3_600_000, now: () => now });
    const a = controlled();
    take(jobs, 'k', a.make);
    a.end('pdf');
    await pause(0);
    now = 3_599_999;
    assert.equal(take(jobs, 'k', a.make).result, 'pdf');
    now = 3_600_000;
    assert.equal(jobs.counts.kept, 0);
    take(jobs, 'k', a.make);
    assert.equal(a.started, 2, 'made again');
    jobs.clear();
  });

  test('the kept reports together within the total, the oldest dropped first', async () => {
    let now = 0;
    const jobs = new Jobs<string>({ ...SETTINGS, keepBytes: 10, now: () => now });
    const made = (key: string, pdf: string): Promise<void> => {
      const c = controlled();
      const job = take(jobs, key, c.make);
      c.end(pdf);
      now += 1;
      return jobs.wait(job, 1_000).then(() => undefined);
    };
    await made('old', 'aaaa');
    await made('mid', 'bbbb');
    assert.equal(jobs.counts.kept, 2);
    await made('new', 'cccc');
    // 12 bytes would pass 10: the oldest goes
    assert.equal(jobs.counts.kept, 2);
    const again = controlled();
    take(jobs, 'old', again.make);
    assert.equal(again.started, 1, 'the oldest was dropped');
    assert.equal(take(jobs, 'mid', again.make).result, 'bbbb');
    jobs.clear();
  });

  test("a token's kept reports are dropped; a release change drops every kept report", async () => {
    const jobs = new Jobs<string>(SETTINGS);
    const kept = async (key: string): Promise<void> => {
      const c = controlled();
      const job = take(jobs, key, c.make);
      c.end('pdf');
      await jobs.wait(job, 1_000);
    };
    jobs.release(98);
    await kept('T1 9606 25 TOTAL false');
    await kept('T1 9606 10 TOTAL false');
    await kept('T2 9606 25 TOTAL false');
    jobs.dropToken('T1');
    assert.equal(jobs.counts.kept, 1);
    jobs.release(98);
    assert.equal(jobs.counts.kept, 1, 'the same release keeps them');
    jobs.release(99);
    assert.equal(jobs.counts.kept, 0);
    jobs.clear();
  });

  test('a finished report is forgotten after the keeping time', async () => {
    const jobs = new Jobs<string>({ ...SETTINGS, keepMs: 40 });
    const a = controlled();
    take(jobs, 'k', a.make);
    a.end('pdf');
    await pause(0);
    assert.equal(jobs.counts.kept, 1);
    await pause(80);
    assert.equal(jobs.counts.kept, 0);
    take(jobs, 'k', a.make);
    assert.equal(a.started, 2);
    jobs.clear();
  });
});

const skip = process.env['NEO4J_URI'] ? false : 'no fixture graph: set NEO4J_URI';
const FILES = fileURLToPath(new URL('../../ci/fixture/files/', import.meta.url));

describe('the report in the background, at its address', { skip }, () => {
  let graph: Graph;
  /** The graph as the service reads it: its release moved by `shift`, as a new release's. */
  const release = { shift: 0 };
  let shifted: Graph;
  let analysis: AnalysisStub;
  let render: RenderStub;
  let service: Service;

  before(async () => {
    graph = openGraph(graphSettings(process.env));
    shifted = {
      read: async (query, params, options) => {
        const rows = await graph.read(query, params, options);
        if (!query.includes('DBInfo')) return rows;
        return rows.map((row) => {
          const value = row['release'];
          return typeof value === 'number' ? { ...row, release: value + release.shift } : row;
        });
      },
      close: () => graph.close(),
    };
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
      work: null,
      concurrency: 2,
    };
    service = await startService(settings, {
      graph: shifted,
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
    release.shift = 0;
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
        work: null,
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

  /** Asks until the report is ready: its last answer's status. */
  const ready = async (url: string): Promise<number> => {
    let answer = await fetch(url);
    for (let i = 0; answer.status === 202 && i < 60; i++) {
      await answer.body?.cancel();
      await pause(150);
      answer = await fetch(url);
    }
    await answer.body?.cancel();
    return answer.status;
  };

  test("a kept report is dropped on the token's 410, and on a release change", async () => {
    assert.equal(await ready(address(6)), 200);
    render.slow(400);
    // kept: answered at once
    const kept = await fetch(address(6));
    assert.equal(kept.status, 200);
    await kept.body?.cancel();
    analysis.forget(REPORT_TOKENS.expression);
    const gone = await fetch(address(6));
    assert.equal(gone.status, 410);
    await gone.body?.cancel();
    analysis.reset();
    render.slow(400);
    const again = await fetch(address(6));
    assert.equal(again.status, 202, 'made again, not kept');
    await again.body?.cancel();
    render.reset();
    assert.equal(await ready(address(6)), 200);
    render.slow(400);
    release.shift = 1;
    const newRelease = await fetch(address(6));
    assert.equal(newRelease.status, 202, 'a new release: made again');
    await newRelease.body?.cancel();
    render.reset();
    assert.equal(await ready(address(6)), 200);
  });

  test("a client's third waiting is refused while another's is taken; /health counts them", async () => {
    render.slow(3_000);
    const ask = async (number: number, client: string): Promise<number> => {
      const res = await fetch(address(number), { headers: { 'X-Reactome-Client': client } });
      await res.body?.cancel();
      return res.status;
    };
    // two being made, then two of client a's waiting
    assert.deepEqual(
      [await ask(11, 'x'), await ask(12, 'x'), await ask(13, 'a'), await ask(14, 'a')],
      [202, 202, 202, 202]
    );
    const third = await fetch(address(15), { headers: { 'X-Reactome-Client': 'a' } });
    assert.equal(third.status, 503);
    assert.equal(third.headers.get('retry-after'), '10');
    await third.body?.cancel();
    assert.equal(await ask(16, 'b'), 202, "another client's is taken");
    assert.equal(await ask(13, 'a'), 202, 'a joining request is never refused');
    const health = (await (await fetch(`${service.url}/health`)).json()) as {
      reports: { making: number; waiting: number; kept: number };
    };
    assert.equal(health.reports.making, 2);
    assert.equal(health.reports.waiting, 3);
    render.reset();
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
