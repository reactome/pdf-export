// The single-event service (spec 001 T022, contracts/service.md), against the render and
// analysis stubs and the fixture graph: each answer in the contract's order, every figure
// drawn on request with the token as the render service is to receive it, a figure that
// cannot be drawn left out and logged, the concurrency limit and the deadline (and nothing
// done past it, a hanging graph, figure or print among them), a browser that dies, the
// health answer, and FR-017's characters in the texts and the labels, logged once per PDF.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { after, afterEach, before, describe, test } from 'node:test';

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

import { graphSettings, openGraph, type Graph } from '../src/graph/connection.ts';
import { Printer } from '../src/print/print.ts';
import {
  SettingsError,
  serveSettings,
  startService,
  type ServeSettings,
  type Service,
  type ServicePrinter,
} from '../src/serve.ts';
import { startAnalysisStub, TOKENS, type AnalysisStub } from './stubs/analysis.ts';
import { startRenderStub, type RenderStub } from './stubs/render.ts';
import { skipWithoutGraph } from './layout/fixture.ts';

const FILES = fileURLToPath(new URL('../ci/fixture/files/', import.meta.url));
const BETA = 'R-HSA-90000100';
const REACTION = 'R-HSA-90000211';
const COMPLEX = 'R-HSA-90000400';
const REASONS = new Set([
  'bad-depth',
  'not-an-event',
  'no-event',
  'unknown-token',
  'gone-token',
  'unavailable',
]);

/** A PDF's text, page by page, joined. */
async function textOf(pdf: Uint8Array): Promise<string> {
  const task = getDocument({ data: pdf.slice() });
  const doc = await task.promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
  }
  await task.destroy();
  return pages.join('\n');
}

/** A PDF's bookmarks, each with its depth. */
async function outlineOf(pdf: Uint8Array): Promise<{ title: string; depth: number }[]> {
  const task = getDocument({ data: pdf.slice() });
  const doc = await task.promise;
  const entries: { title: string; depth: number }[] = [];
  type Item = { title: string; items: Item[] };
  const walk = (items: Item[] | null, depth: number) => {
    for (const item of items ?? []) {
      entries.push({ title: item.title, depth });
      walk(item.items, depth + 1);
    }
  };
  walk(await doc.getOutline(), 0);
  await task.destroy();
  return entries;
}

/** A port nothing listens on. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) =>
    server.close(() => {
      resolve();
    })
  );
  return port;
}

/**
 * The fixture graph, with texts planted on request (each key replaced by its value in every
 * row), failing on request, as a graph that cannot answer does, and never answering a query
 * that matches `hanging`, as a stalled read does.
 */
function plantingGraph(): Graph & {
  planted: Map<string, string>;
  failing: boolean;
  hanging: RegExp | null;
} {
  const real = openGraph(graphSettings(process.env));
  const graph = {
    planted: new Map<string, string>(),
    failing: false,
    hanging: null as RegExp | null,
    async read<T>(query: string, params?: Record<string, unknown>): Promise<T[]> {
      if (graph.failing) {
        throw new Error('Could not reach bolt://graph.invalid:7687 for /data/graph.db');
      }
      if (graph.hanging?.test(query)) return new Promise<T[]>(() => undefined);
      const rows = await real.read<T>(query, params);
      if (graph.planted.size === 0) return rows;
      let json = JSON.stringify(rows);
      for (const [from, to] of graph.planted) json = json.replaceAll(from, to);
      return JSON.parse(json) as T[];
    },
    close: () => real.close(),
  };
  return graph;
}

/**
 * T019's printer, its prints and starts counted: each print hanging while `hang` is set; the
 * printer seen as gone while `down` is; `goes()` telling the service it went; and every start
 * after the first failing while `failing` is set.
 */
function countingPrinter(): {
  start: () => Promise<ServicePrinter>;
  prints: { count: number; hang: boolean; down: boolean; starts: number; failing: boolean };
  goes: () => void;
} {
  const prints = { count: 0, hang: false, down: false, starts: 0, failing: false };
  const listeners: (() => void)[] = [];
  return {
    prints,
    goes: () => {
      prints.down = true;
      for (const listener of listeners.splice(0)) listener();
    },
    start: async () => {
      prints.starts += 1;
      if (prints.failing && prints.starts > 1) throw new Error('no browser');
      const printer = await Printer.start();
      return {
        single: (html: string) => {
          prints.count += 1;
          return prints.hang ? new Promise<Uint8Array>(() => undefined) : printer.single(html);
        },
        get connected() {
          return !prints.down && printer.connected;
        },
        onDisconnected: (listener: () => void) => {
          listeners.push(listener);
          printer.onDisconnected(listener);
        },
        close: () => printer.close(),
      };
    },
  };
}

/** The health answer's count of PDFs being made, once it is 0, or the last seen. */
async function idle(url: string, withinMs = 5_000): Promise<number> {
  const until = Date.now() + withinMs;
  for (;;) {
    const { making } = (await (await fetch(`${url}/health`)).json()) as { making: number };
    if (making === 0 || Date.now() > until) return making;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** The Chromium processes this test process started, by process id. */
function ourBrowsers(): number[] {
  try {
    return execFileSync('pgrep', ['-P', String(process.pid), '-f', 'chrome-headless-shell'], {
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean)
      .map(Number);
  } catch {
    return [];
  }
}

describe('serve settings', () => {
  const env = {
    NEO4J_URI: 'bolt://127.0.0.1:1',
    RENDER_SERVICE: 'http://127.0.0.1:2',
    ANALYSIS_SERVICE: 'http://127.0.0.1:3/AnalysisService',
    REACTOME_SITE: 'https://site.invalid',
  };

  test('the defaults: loopback, port 4370, two at once, every setting from its variable', () => {
    const settings = serveSettings(['--files', FILES], env);
    assert.equal(settings.bind, '127.0.0.1');
    assert.equal(settings.port, 4370);
    assert.equal(settings.concurrency, 2);
    assert.equal(settings.graph.uri, env.NEO4J_URI);
    assert.equal(settings.graph.database, 'graph.db');
    assert.equal(settings.render, env.RENDER_SERVICE);
    assert.equal(settings.analysis, env.ANALYSIS_SERVICE);
    assert.equal(settings.site, env.REACTOME_SITE);
    assert.equal(settings.figures, null);
    const fromEnv = serveSettings(['--files', FILES], {
      ...env,
      PORT: '5000',
      BIND_ADDRESS: '::1',
    });
    assert.equal(fromEnv.port, 5000);
    assert.equal(fromEnv.bind, '::1');
  });

  test('a flag wins over its variable', () => {
    const settings = serveSettings(
      [
        '--files=/files',
        '--port',
        '4400',
        '--bind',
        '0.0.0.0',
        '--graph',
        'bolt://127.0.0.1:9',
        '--database',
        'other',
        '--render',
        'http://127.0.0.1:8',
        '--analysis',
        'http://127.0.0.1:7',
        '--site',
        'https://other.invalid',
        '--figures',
        '/figures',
        '--concurrency',
        '4',
      ],
      { ...env, PORT: '5000' }
    );
    assert.deepEqual(
      [settings.files, settings.port, settings.bind, settings.graph.uri, settings.graph.database],
      ['/files', 4400, '0.0.0.0', 'bolt://127.0.0.1:9', 'other']
    );
    assert.deepEqual(
      [settings.render, settings.analysis, settings.site, settings.figures, settings.concurrency],
      ['http://127.0.0.1:8', 'http://127.0.0.1:7', 'https://other.invalid', '/figures', 4]
    );
  });

  test('a missing, unknown, repeated or malformed setting is refused', () => {
    const refused = (args: string[], environment: Record<string, string> = env) => {
      assert.throws(() => serveSettings(args, environment), SettingsError, args.join(' '));
    };
    refused([]);
    refused(['--files', FILES], { ...env, RENDER_SERVICE: '' });
    refused(['--files', FILES], { ...env, NEO4J_URI: '' });
    refused(['--files', FILES, '--colour', 'red']);
    refused(['--files', FILES, '--files', FILES]);
    refused(['--files']);
    for (const bad of ['0', '-1', '2.5', 'two', '70000'])
      refused(['--files', FILES, '--port', bad]);
    for (const bad of ['0', 'many']) refused(['--files', FILES, '--concurrency', bad]);
  });
});

describe('the service', { skip: skipWithoutGraph }, () => {
  let render: RenderStub;
  let analysis: AnalysisStub;
  let graph: ReturnType<typeof plantingGraph>;
  let service: Service;
  const lines: string[] = [];

  const settings = (): ServeSettings => ({
    bind: '127.0.0.1',
    port: 0,
    graph: graphSettings(process.env),
    files: FILES,
    figures: null,
    render: render.url,
    analysis: analysis.url,
    site: 'https://site.invalid',
    concurrency: 1,
  });

  before(async () => {
    render = await startRenderStub();
    analysis = await startAnalysisStub();
    graph = plantingGraph();
    service = await startService(settings(), {
      graph,
      log: (line) => lines.push(line),
      limits: {
        figureTimeoutMs: 1_500,
        retryPauseMs: 20,
        analysisTimeoutMs: 2_000,
        relaunchPauseMs: 200,
      },
    });
  });
  afterEach(() => {
    render.reset();
    analysis.reset();
    graph.planted.clear();
    graph.failing = false;
    graph.hanging = null;
    lines.length = 0;
  });
  after(async () => {
    await service.close();
    await graph.close();
    await render.close();
    await analysis.close();
  });

  async function get(path: string) {
    const response = await fetch(`${service.url}${path}`);
    const body = new Uint8Array(await response.arrayBuffer());
    return { response, body };
  }

  async function refusal(path: string): Promise<[number, string]> {
    const { response, body } = await get(path);
    assert.match(response.headers.get('content-type') ?? '', /^application\/json/);
    const reason = (JSON.parse(new TextDecoder().decode(body)) as { reason: string }).reason;
    return [response.status, reason];
  }

  async function pdf(path: string): Promise<Uint8Array> {
    const { response, body } = await get(path);
    assert.equal(response.status, 200, `${path}: ${new TextDecoder().decode(body.slice(0, 200))}`);
    assert.equal(response.headers.get('content-type'), 'application/pdf');
    return body;
  }

  const uncovered = () => lines.filter((line) => line.startsWith('uncovered-character'));

  test('a pathway at depth 1: a PDF named by its stable identifier, with nested bookmarks', async () => {
    const { response, body } = await get(`/event/${BETA}.pdf`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-disposition'), `attachment; filename="${BETA}.pdf"`);
    const outline = await outlineOf(body);
    assert.ok(outline.some((entry) => entry.title === 'beta pathway'));
    assert.ok(
      outline.some((entry) => entry.depth > 0),
      'nested'
    );
    assert.match(await textOf(body), /Contents/);
    // every figure drawn on request, once each, with no token
    const figures = render.requests.filter((path) => path.startsWith('/render/'));
    assert.deepEqual(
      [...figures].sort(),
      [
        `/render/${BETA}.svg`,
        '/render/R-HSA-90000120.svg?layout=reaction',
        '/render/R-HSA-90000130.svg',
        '/render/R-HSA-90000220.svg?layout=reaction',
      ].sort()
    );
  });

  test('by versioned stable id or database id, named by its stable identifier', async () => {
    for (const id of [`${BETA}.1`, '90000100']) {
      const { response } = await get(`/event/${id}.pdf?depth=0`);
      assert.equal(response.status, 200, id);
      assert.equal(
        response.headers.get('content-disposition'),
        `attachment; filename="${BETA}.pdf"`
      );
    }
  });

  test('depth 0, and a reaction: no contents list, and fewer bookmarks', async () => {
    const one = await outlineOf(await pdf(`/event/${BETA}.pdf?depth=1`));
    const zero = await outlineOf(await pdf(`/event/${BETA}.pdf?depth=0`));
    assert.ok(zero.length < one.length, `${String(zero.length)} < ${String(one.length)}`);
    assert.ok(!zero.some((entry) => entry.title === 'Contents'));
    const reaction = await pdf(`/event/${REACTION}.pdf`);
    assert.ok((await outlineOf(reaction)).some((entry) => entry.title === 'Reaction one'));
  });

  test('a depth other than 0 or 1: 400 bad-depth, before the identifier and the token', async () => {
    for (const query of ['depth=2', 'depth=x', 'depth=', 'depth=01', 'depth=0&depth=1']) {
      assert.deepEqual(await refusal(`/event/${BETA}.pdf?${query}`), [400, 'bad-depth'], query);
    }
    assert.deepEqual(await refusal('/event/R-HSA-1.pdf?depth=2&token=QQ%3D'), [400, 'bad-depth']);
    assert.deepEqual(await refusal(`/event/${COMPLEX}.pdf?depth=2`), [400, 'bad-depth']);
  });

  test('an identifier naming nothing is 404 no-event, and a non-event 400, whatever the token', async () => {
    for (const id of ['R-HSA-1', 'R-HSA-99999999', 'nonsense', '%E0%A4%A', '12']) {
      assert.deepEqual(await refusal(`/event/${id}.pdf`), [404, 'no-event'], id);
      assert.deepEqual(await refusal(`/event/${id}.pdf?token=QQ%3D`), [404, 'no-event'], id);
    }
    assert.deepEqual(await refusal(`/event/${COMPLEX}.pdf`), [400, 'not-an-event']);
    assert.deepEqual(await refusal(`/event/${COMPLEX}.pdf?token=QQ%3D`), [400, 'not-an-event']);
    assert.deepEqual(await refusal(`/event/${COMPLEX}.pdf?token=${TOKENS.gone}`), [
      400,
      'not-an-event',
    ]);
    assert.equal(analysis.requests.length, 0, 'the analysis service never asked');
  });

  test('a malformed token is 404 unknown-token, and nothing is asked of either service', async () => {
    for (const query of [
      'token=QQ%3D',
      'token=',
      `token=${TOKENS.stored}&token=${TOKENS.stored}`,
    ]) {
      assert.deepEqual(await refusal(`/event/${BETA}.pdf?${query}`), [404, 'unknown-token'], query);
    }
    assert.equal(analysis.requests.length, 0);
    assert.equal(render.requests.length, 0);
  });

  test("the analysis service's answers: 404 unknown-token, 410 gone-token, the rest unavailable", async () => {
    assert.deepEqual(await refusal(`/event/${BETA}.pdf?token=${TOKENS.expired}`), [
      404,
      'unknown-token',
    ]);
    assert.deepEqual(await refusal(`/event/${BETA}.pdf?token=${TOKENS.gone}`), [410, 'gone-token']);
    assert.deepEqual(await refusal(`/event/${BETA}.pdf?token=${TOKENS.unreadable}`), [
      503,
      'unavailable',
    ]);
    analysis.refuse(1, 2);
    assert.deepEqual(await refusal(`/event/${BETA}.pdf?token=${TOKENS.stored}`), [
      503,
      'unavailable',
    ]);
    assert.equal(render.requests.length, 0, 'no figure drawn for a PDF not made');
  });

  test('with a token: the analysis, and every figure drawn with the token sent once encoded', async () => {
    // as issued, and encoded once more by a caller: the same token reaches the render service
    for (const token of [TOKENS.stored, encodeURIComponent(TOKENS.stored)]) {
      render.reset();
      const body = await pdf(`/event/${BETA}.pdf?token=${token}`);
      assert.match(await textOf(body), /Analysis properties/);
      const figures = render.requests.filter((path) => path.startsWith('/render/'));
      assert.equal(figures.length, 4);
      for (const path of figures) {
        const sent = /[?&]token=([^&]*)/.exec(path)?.[1];
        // %3D as the service issued it: neither `=` raw nor `%253D`
        assert.equal(sent, TOKENS.stored, path);
      }
      assert.ok(TOKENS.stored.endsWith('%3D%3D'));
    }
  });

  test("a reaction with a token: its parent's found lists, narrowed to its own identifiers", async () => {
    const text = await textOf(await pdf(`/event/${REACTION}.pdf?token=${TOKENS.stored}`));
    // the graph's identifiers of its participants: X00001 an output, X00003-1 an isoform in an
    // input complex, X00009 in a catalyst's set (an interactor's)
    for (const id of ['X00001', 'X00003-1', 'X00009']) assert.ok(text.includes(id), id);
    assert.ok(!text.includes('X00003-2'), 'an isoform the reaction does not hold');
    // its first parent pathway's lists, read once
    const found = analysis.requests.filter((r) => /\/token\/[^/]+\/found\//.test(r.path));
    assert.deepEqual(
      found.map((r) => r.path.split('?')[0]?.split('/').slice(-2).join('/')),
      ['entities/R-HSA-90000210', 'interactors/R-HSA-90000210']
    );
  });

  test('a figure that cannot be drawn: the PDF without it, logged', async () => {
    render.refuse(BETA, 404);
    const body = await pdf(`/event/${BETA}.pdf?depth=0`);
    assert.ok(body.length > 0);
    assert.deepEqual(
      lines.filter((line) => line.startsWith('missing-figure')),
      [`missing-figure diagram/${BETA}: ${BETA}: the render service answered 404`]
    );
  });

  test('at the limit: 503 unavailable at once, and the slot freed when the PDF is made', async () => {
    render.refuse(REACTION, 'timeout', 1);
    let firstAnswered = false;
    const first = fetch(`${service.url}/event/${REACTION}.pdf`).then((answer) => {
      firstAnswered = true;
      return answer;
    });
    // wait until the first holds the slot: its figure is asked for
    const until = Date.now() + 10_000;
    while (!render.requests.some((path) => path.startsWith(`/render/${REACTION}`))) {
      assert.ok(Date.now() < until, 'the first request reached its figure');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.deepEqual(await refusal(`/event/${BETA}.pdf?depth=0`), [503, 'unavailable']);
    // answered while the first is still being made, not queued behind it
    assert.equal(firstAnswered, false, 'answered at once');
    // the cheap checks still answer at the limit
    assert.deepEqual(await refusal(`/event/${BETA}.pdf?depth=2`), [400, 'bad-depth']);
    const answer = await first;
    assert.equal(answer.status, 200);
    await answer.arrayBuffer();
    assert.ok(lines.some((line) => line.startsWith(`missing-figure reaction/${REACTION}`)));
    assert.equal((await get(`/event/${BETA}.pdf?depth=0`)).response.status, 200, 'slot freed');
  });

  test('a graph that cannot answer is 503 unavailable, its error logged and not answered', async () => {
    graph.failing = true;
    const { response, body } = await get(`/event/${BETA}.pdf`);
    assert.equal(response.status, 503);
    assert.equal(new TextDecoder().decode(body), '{"reason":"unavailable"}');
    assert.ok(
      lines.some((line) => line.includes('graph.invalid')),
      'logged'
    );
    assert.equal((await get('/health')).response.status, 503);
  });

  test('a planted character in a text: U+FFFD in the PDF, one line naming it and the event', async () => {
    // a substitution (U+2011) too, which prints its hyphen and is not logged
    graph.planted.set('Reaction one', 'Reaction\u2011one \uE000');
    const text = await textOf(await pdf(`/event/${REACTION}.pdf`));
    assert.ok(text.includes('Reaction-one \uFFFD'), 'substituted, then replaced');
    assert.ok(!text.includes('\uE000'));
    assert.deepEqual(uncovered(), [`uncovered-character U+E000 ${REACTION}`]);
  });

  test("one in a figure's label: the figure kept, its label U+FFFD, one line", async () => {
    render.label(REACTION, '\uE001');
    const text = await textOf(await pdf(`/event/${REACTION}.pdf`));
    assert.ok(text.includes('\uFFFDReaction one'), 'the label replaced, in the figure');
    assert.ok(!text.includes('\uE001'));
    assert.deepEqual(uncovered(), [`uncovered-character U+E001 ${REACTION}`]);
    assert.deepEqual(
      lines.filter((line) => line.startsWith('missing-figure')),
      [],
      'the figure is not dropped'
    );
  });

  test('the same character in a text and a label: one line, not two', async () => {
    graph.planted.set('Reaction one', 'Reaction one \uE000');
    render.label(REACTION, '\uE000');
    await pdf(`/event/${REACTION}.pdf`);
    assert.deepEqual(uncovered(), [`uncovered-character U+E000 ${REACTION}`]);
  });

  test('a character a thousand times is one line; distinct characters a line each', async () => {
    graph.planted.set('Reaction one', `Reaction ${'\uE000'.repeat(1000)} \uE002 one`);
    // the event's species, which the analysis's part prints as its overlay's
    graph.planted.set('Homo sapiens', 'Homo sapiens \uE000');
    const text = await textOf(await pdf(`/event/${REACTION}.pdf?token=${TOKENS.stored}`));
    assert.match(text, /Homo sapiens \uFFFD/);
    assert.ok(!text.includes('\uE000'), 'the texts and the analysis alike');
    assert.deepEqual(uncovered(), [
      `uncovered-character U+E000 ${REACTION} token=${TOKENS.stored}`,
      `uncovered-character U+E002 ${REACTION} token=${TOKENS.stored}`,
    ]);
    // never the text
    assert.ok(lines.every((line) => !line.includes('Reaction ')));
  });

  test('health: the version, the release, and whether the other services answer', async () => {
    const { response, body } = await get('/health');
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(new TextDecoder().decode(body)), {
      version: '0.0.0',
      release: 98,
      render: true,
      analysis: true,
      printer: true,
      making: 0,
      figures: 'none',
    });
    analysis.refuse();
    const refused = JSON.parse(new TextDecoder().decode((await get('/health')).body)) as {
      analysis: boolean;
    };
    assert.equal(refused.analysis, false);
  });

  test('another route is 404, another method 405', async () => {
    assert.equal((await get('/event/R-HSA-90000100')).response.status, 404);
    assert.equal((await get('/')).response.status, 404);
    const response = await fetch(`${service.url}/event/${BETA}.pdf`, { method: 'POST' });
    assert.equal(response.status, 405);
    await response.arrayBuffer();
  });

  test('the deadline: past it, 503 unavailable, though no one call timed out', async () => {
    const quick = await startService(
      { ...settings(), render: `http://127.0.0.1:${String(await closedPort())}` },
      {
        graph,
        log: (line) => lines.push(line),
        limits: { deadlineMs: 1_500, analysisTimeoutMs: 1_000 },
      }
    );
    try {
      // each call answered within its own timeout, six of them past the deadline
      analysis.slow(500);
      const started = performance.now();
      const response = await fetch(`${quick.url}/event/${BETA}.pdf?token=${TOKENS.stored}`);
      const body = await response.text();
      assert.equal(response.status, 503);
      assert.equal(body, '{"reason":"unavailable"}');
      // well before the six calls together could end
      const took = performance.now() - started;
      assert.ok(took < 2_900, `answered at the deadline, in ${took.toFixed(0)} ms`);
      // its health says the render service does not answer
      analysis.slow(0);
      const health = (await (await fetch(`${quick.url}/health`)).json()) as { render: boolean };
      assert.equal(health.render, false);
    } finally {
      await quick.close();
    }
  });

  test('no reason carries a path, a host or a name: the body is the reason alone', async () => {
    const asked = [
      `/event/${BETA}.pdf?depth=2`,
      '/event/R-HSA-1.pdf',
      `/event/${COMPLEX}.pdf`,
      `/event/${BETA}.pdf?token=QQ%3D`,
      `/event/${BETA}.pdf?token=${TOKENS.expired}`,
      `/event/${BETA}.pdf?token=${TOKENS.gone}`,
      `/event/${BETA}.pdf?token=${TOKENS.unreadable}`,
    ];
    const bodies: string[] = [];
    for (const path of asked) bodies.push(new TextDecoder().decode((await get(path)).body));
    // the graph failing, its error naming a host and a path
    graph.failing = true;
    bodies.push(new TextDecoder().decode((await get(`/event/${BETA}.pdf`)).body));
    graph.failing = false;
    // the analysis service failing part way, its error naming a pathway
    analysis.refuse(1, 1);
    bodies.push(
      new TextDecoder().decode((await get(`/event/${BETA}.pdf?token=${TOKENS.stored}`)).body)
    );
    assert.equal(new Set(bodies.map((b) => (JSON.parse(b) as { reason: string }).reason)).size, 6);
    for (const body of bodies) {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      assert.deepEqual(Object.keys(parsed), ['reason'], body);
      assert.ok(REASONS.has(String(parsed['reason'])), body);
    }
  });

  test('a browser that dies is started again: the next PDF is made, and health says so', async () => {
    const browsers = ourBrowsers();
    assert.ok(browsers.length > 0, 'the service has a browser of its own');
    for (const pid of browsers) process.kill(pid, 'SIGKILL');
    // the next request is made by a browser started again
    const body = await pdf(`/event/${BETA}.pdf?depth=0`);
    assert.ok(body.length > 0);
    assert.ok(lines.includes('printer: the browser went; starting another'));
    assert.ok(ourBrowsers().every((pid) => !browsers.includes(pid)));
    const health = (await (await fetch(`${service.url}/health`)).json()) as { printer: boolean };
    assert.equal(health.printer, true);
  });

  test("health with the graph's read stalled: 503 within its own timeout", async () => {
    const short = await startService(settings(), {
      graph,
      log: (line) => lines.push(line),
      limits: { healthTimeoutMs: 300 },
    });
    try {
      graph.hanging = /DBInfo/;
      const response = await fetch(`${short.url}/health`, { signal: AbortSignal.timeout(10_000) });
      assert.equal(response.status, 503);
      await response.arrayBuffer();
    } finally {
      graph.hanging = null;
      await short.close();
    }
  });
});

describe(
  'when a request ends: its deadline, or its client gone',
  { skip: skipWithoutGraph },
  () => {
    let render: RenderStub;
    let analysis: AnalysisStub;
    let graph: ReturnType<typeof plantingGraph>;
    let service: Service;
    const lines: string[] = [];
    const printer = countingPrinter();
    const { prints } = printer;

    before(async () => {
      render = await startRenderStub();
      analysis = await startAnalysisStub();
      graph = plantingGraph();
      service = await startService(
        {
          bind: '127.0.0.1',
          port: 0,
          graph: graphSettings(process.env),
          files: FILES,
          figures: null,
          render: render.url,
          analysis: analysis.url,
          site: 'https://site.invalid',
          concurrency: 1,
        },
        {
          graph,
          log: (line) => lines.push(line),
          startPrinter: printer.start,
          // each wait far longer than the deadline, so only the deadline can end it in time
          limits: {
            deadlineMs: 3_000,
            figureTimeoutMs: 30_000,
            retryPauseMs: 30_000,
            analysisTimeoutMs: 30_000,
          },
        }
      );
    });
    afterEach(() => {
      render.reset();
      analysis.reset();
      graph.hanging = null;
      lines.length = 0;
      prints.count = 0;
    });
    after(async () => {
      prints.hang = false;
      await service.close();
      await graph.close();
      await render.close();
      await analysis.close();
    });

    /** A request, given up by the test itself after 15 s, so a missed deadline fails, not hangs. */
    async function ask(path: string): Promise<[number, string]> {
      const response = await fetch(`${service.url}${path}`, {
        signal: AbortSignal.timeout(15_000),
      });
      return [response.status, await response.text()];
    }

    const unavailable = [503, '{"reason":"unavailable"}'];

    test('a figure that never answers: 503 at the deadline, the work stopped, nothing printed', async () => {
      render.refuse(REACTION, 'timeout');
      assert.deepEqual(await ask(`/event/${REACTION}.pdf`), unavailable);
      assert.equal(await idle(service.url), 0, 'the work stopped');
      assert.equal(prints.count, 0, 'nothing printed after the deadline');
      // the render service is not blamed for the request's own end
      assert.deepEqual(
        lines.filter((line) => line.startsWith('missing-figure')),
        []
      );
    });

    test("a 503 from the render service: its retry's pause ends with the deadline", async () => {
      render.refuse(REACTION, 503, 1);
      assert.deepEqual(await ask(`/event/${REACTION}.pdf`), unavailable);
      assert.equal(await idle(service.url), 0, 'the pause stopped');
      assert.equal(prints.count, 0);
    });

    test('the identifier read stalled: 503 at the deadline', async () => {
      graph.hanging = /MATCH \(e:DatabaseObject \{(dbId|stId)/;
      assert.deepEqual(await ask(`/event/${REACTION}.pdf`), unavailable);
    });

    test('a later read stalled: 503 at the deadline, and the slot is free again', async () => {
      // the events' facts, read once the request holds its slot
      graph.hanging = /WHERE e:Event\s+RETURN e\.dbId AS dbId/;
      assert.deepEqual(await ask(`/event/${REACTION}.pdf`), unavailable);
      graph.hanging = null;
      assert.equal(await idle(service.url), 0, 'the slot freed');
      assert.equal((await ask(`/event/${REACTION}.pdf`))[0], 200);
    });

    test('a client that goes: its work stopped, the slot free again', async () => {
      render.refuse(REACTION, 'timeout');
      const client = new AbortController();
      const asked = fetch(`${service.url}/event/${REACTION}.pdf`, { signal: client.signal });
      const until = Date.now() + 10_000;
      while (!render.requests.some((path) => path.startsWith(`/render/${REACTION}`))) {
        assert.ok(Date.now() < until, 'the request reached its figure');
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      client.abort();
      await assert.rejects(asked);
      // well before the deadline would have ended it
      assert.equal(await idle(service.url, 1_000), 0, 'the work stopped with the client');
      assert.equal(prints.count, 0);
    });

    test('health says when the printer is gone', async () => {
      prints.down = true;
      try {
        const health = (await (await fetch(`${service.url}/health`)).json()) as {
          printer: boolean;
        };
        assert.equal(health.printer, false);
      } finally {
        prints.down = false;
      }
    });

    test('a print that never ends: 503 at the deadline all the same', async () => {
      prints.hang = true;
      assert.deepEqual(await ask(`/event/${REACTION}.pdf?depth=0`), unavailable);
      assert.equal(prints.count, 1);
    });
  }
);

describe('a browser that cannot be started again', { skip: skipWithoutGraph }, () => {
  test('is tried once per pause, not in a loop', async () => {
    const render = await startRenderStub();
    const analysis = await startAnalysisStub();
    const lines: string[] = [];
    const printer = countingPrinter();
    const service = await startService(
      {
        bind: '127.0.0.1',
        port: 0,
        graph: graphSettings(process.env),
        files: FILES,
        figures: null,
        render: render.url,
        analysis: analysis.url,
        site: 'https://site.invalid',
        concurrency: 1,
      },
      {
        log: (line) => lines.push(line),
        startPrinter: printer.start,
        limits: { relaunchPauseMs: 300 },
      }
    );
    try {
      printer.prints.failing = true;
      printer.goes();
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      // the first start, then one a pause at most: five in 1.2 s, not hundreds
      assert.ok(printer.prints.starts >= 2, String(printer.prints.starts));
      assert.ok(printer.prints.starts <= 6, String(printer.prints.starts));
      assert.ok(lines.includes('printer: the browser went; starting another'));
    } finally {
      await service.close();
      await render.close();
      await analysis.close();
    }
  });
});
