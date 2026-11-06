// `pdf-export figures` (spec 001 T046) on the fixture graph, against the render and content
// stubs: the folder it writes passes the book's checks, and each refusal, fault and stop is
// what contracts/figures.md says. The shared fixture is never changed: a missing checksum or
// a planted character comes from a graph that rewrites its rows.
import assert from 'node:assert/strict';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, afterEach, before, describe, test } from 'node:test';

import {
  graphSettings,
  openGraph,
  type Graph,
  type GraphOptions,
  type GraphSettings,
} from '../../src/graph/connection.ts';
import { releaseInfo, type ReleaseInfo } from '../../src/graph/queries.ts';
import { buildBook } from '../../src/model/build.ts';
import { readSummary } from '../../src/preflight/files.ts';
import {
  checkFolder,
  expectedFigures,
  MANIFEST,
  type FigureRecord,
} from '../../src/preflight/folder.ts';
import { figuresCommand, figuresSettings, type FiguresReport } from '../../src/figures/step.ts';
import { startContentStub, type ContentStub } from '../stubs/content.ts';
import { startRenderStub, type RenderStub } from '../stubs/render.ts';

const skip = process.env['NEO4J_URI'] ? false : 'no fixture graph: set NEO4J_URI';
const FILES = fileURLToPath(new URL('../../ci/fixture/files/', import.meta.url));
const ALPHA = 'R-HSA-90000200';
const ALPHA_SUB = 'R-HSA-90000210';
const REACTION = 'R-HSA-90000211';
const BETA = 'R-HSA-90000100';
const DELTA = 'R-HSA-90000215';

/** A graph whose rows are rewritten: a checksum taken away, a character planted. */
function rewriting(
  graph: Graph,
  rewrite: (row: Record<string, unknown>, query: string) => Record<string, unknown>
): Graph {
  return {
    async read<T>(query: string, params?: Record<string, unknown>): Promise<T[]> {
      const rows = await graph.read<Record<string, unknown>>(query, params);
      return rows.map((row) => rewrite(row, query)) as T[];
    },
    close: () => graph.close(),
  };
}

/** Every string in a value with `from` replaced by `to`. */
function replaced(value: unknown, from: string, to: string): unknown {
  if (typeof value === 'string') return value.split(from).join(to);
  if (Array.isArray(value)) return value.map((item) => replaced(item, from, to));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaced(item, from, to)])
    );
  }
  return value;
}

interface Run {
  code: number;
  out: string;
  err: string;
  dir: string;
  /** The report, parsed: reading it where none was written fails the test. */
  readonly report: FiguresReport;
  /** The manifest's lines, parsed. */
  lines: Record<string, unknown>[];
  /** The files in `--out`, sorted. */
  files: string[];
}

describe('pdf-export figures', { skip }, () => {
  let render: RenderStub;
  let content: ContentStub;
  let release: ReleaseInfo;
  let summary: string;
  let expected: Map<string, FigureRecord>;
  const dirs: string[] = [];
  const scratch = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'pdfx-figures-'));
    dirs.push(dir);
    return dir;
  };

  before(async () => {
    render = await startRenderStub();
    content = await startContentStub();
    const graph = openGraph(graphSettings(process.env));
    try {
      release = await releaseInfo(graph);
      const read = readSummary(FILES);
      if (!read) throw new Error('the fixture has no EHLD summary');
      summary = read.hash;
      expected = expectedFigures(
        await buildBook(graph, { species: 'Homo sapiens', illustrated: read.illustrated })
      );
    } finally {
      await graph.close();
    }
  });
  afterEach(() => {
    render.reset();
    content.reset();
  });
  after(async () => {
    await render.close();
    await content.close();
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  /**
   * A run with the stubs, a new `--out` and a report beside it; `flags` added or replacing.
   * Its timeout is 10 s, as the stubs answer at once: one of 0.5 s was missed under load (a
   * read after a figure timed out, stopping the run as `deployment-unanswered`), as the stubs
   * answer from this process, and a process kept from a CPU for half a second misses it. A
   * test of a timeout sets its own.
   */
  const figures = async (
    flags: Record<string, string> = {},
    open?: (settings: GraphSettings, options?: GraphOptions) => Graph,
    retryPauseMs = 10
  ): Promise<Run> => {
    const work = scratch();
    const settings: Record<string, string> = {
      '--files': FILES,
      '--render': render.url,
      '--content': content.url,
      '--out': join(work, 'figures'),
      '--parallel': '2',
      '--timeout': '10',
      '--report': join(work, 'report.json'),
      ...flags,
    };
    let out = '';
    let err = '';
    const code = await figuresCommand(Object.entries(settings).flat(), process.env, {
      out: (text) => (out += text),
      err: (text) => (err += text),
      retryPauseMs,
      ...(open ? { open } : {}),
    });
    const dir = settings['--out'] ?? '';
    const manifest = join(dir, MANIFEST);
    const report = existsSync(settings['--report'] ?? '')
      ? (JSON.parse(readFileSync(settings['--report'] ?? '', 'utf8')) as FiguresReport)
      : null;
    return {
      code,
      out,
      err,
      dir,
      get report(): FiguresReport {
        if (report === null) throw new Error('no report was written');
        return report;
      },
      lines: existsSync(manifest)
        ? readFileSync(manifest, 'utf8')
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line) as Record<string, unknown>)
        : [],
      files: existsSync(dir) ? readdirSync(dir).sort() : [],
    };
  };

  const figureLines = (run: Run): string[] =>
    run.lines.filter((line) => line['type'] === 'figure').map((line) => String(line['stId']));
  const hasComplete = (run: Run): boolean => run.lines.some((l) => l['type'] === 'complete');
  const renders = (): string[] => render.requests.filter((path) => path.startsWith('/render/'));

  test("draws one file per figure the fixture's book needs, and a manifest the book accepts", async () => {
    const run = await figures();
    assert.equal(run.code, 0, run.err);
    assert.deepEqual(
      run.files,
      [...[...expected.keys()].map((stId) => `${stId}.svg`), MANIFEST].sort()
    );
    // every kind, each drawn by its source, an ancestor's with the event's selection
    const counts = Object.fromEntries(
      Object.entries(run.report.figures).map(([kind, c]) => [kind, [c.needed, c.written]])
    );
    assert.deepEqual(counts, { diagram: [5, 5], reaction: [8, 8], ancestor: [3, 3], ehld: [2, 2] });
    assert.ok(renders().includes(`/render/${ALPHA}.svg?highlight=${REACTION}%2CR-HSA-90000212`));
    assert.match(readFileSync(join(run.dir, `${ALPHA_SUB}.svg`), 'utf8'), /data-highlight=/);
    assert.equal(run.lines[0]?.['type'], 'fingerprint');
    assert.deepEqual(run.lines[0], {
      type: 'fingerprint',
      release: release.release,
      checksum: release.checksum,
      summary,
      content: 98,
      build: '000000000000',
    });
    assert.ok(hasComplete(run));
    assert.deepEqual(checkFolder(run.dir, { release, summary, expected }), []);
    assert.equal(run.report.complete, true);
    assert.equal(run.report.stopped, null);
    assert.deepEqual(run.report.missing, []);
  });

  test('refuses an --out that is not empty, before any request', async () => {
    const dir = scratch();
    writeFileSync(join(dir, 'old.svg'), '<svg/>');
    const run = await figures({ '--out': dir });
    assert.equal(run.code, 2);
    assert.deepEqual(run.files, ['old.svg']);
    assert.deepEqual(render.requests, []);
    assert.match(run.report.refused ?? '', /--out/);
  });

  test('refuses a render build of unknown, files that are not local, or a graph with no checksum', async () => {
    render.health.build = 'unknown';
    const unknown = await figures();
    assert.equal(unknown.code, 2);
    assert.match(unknown.err, /build is unknown/);
    render.health.build = '000000000000';
    render.health.files = 'download';
    const remote = await figures();
    assert.equal(remote.code, 2);
    assert.match(remote.err, /local files/);
    render.reset();
    const noChecksum = await figures({}, (settings, options) =>
      rewriting(openGraph(settings, options), (row, query) =>
        query.includes('DBInfo') ? { ...row, checksum: null } : row
      )
    );
    assert.equal(noChecksum.code, 2);
    assert.match(noChecksum.err, /no DBInfo checksum/);
    for (const run of [unknown, remote, noChecksum]) {
      assert.deepEqual(run.files, []);
      assert.ok(!existsSync(run.dir));
    }
    assert.deepEqual(renders(), []);
  });

  test("a build changed between a figure's render and the read after it stops the run", async () => {
    render.onRender((stId) => {
      if (stId === REACTION) render.health.build = '111111111111';
    });
    const run = await figures({ '--parallel': '1' });
    assert.equal(run.code, 1);
    assert.ok(!run.files.includes(`${REACTION}.svg`));
    assert.ok(!figureLines(run).includes(REACTION));
    assert.ok(!hasComplete(run));
    // stopped at once: nothing drawn after it
    assert.equal(renders().at(-1), `/render/${REACTION}.svg?layout=reaction`);
    assert.ok(figureLines(run).length < expected.size - 1);
    // the report is written for a stop too
    assert.equal(run.report.stopped?.reason, 'deployment-changed');
    assert.equal(run.report.complete, false);
  });

  test('a deployment changed is read after an unanswered figure, and stops the run there', async () => {
    render.refuse(REACTION, 504);
    render.onRender((stId) => {
      if (stId === REACTION) render.health.build = '111111111111';
    });
    const run = await figures({ '--parallel': '1' });
    assert.equal(run.code, 1);
    assert.equal(run.report.stopped?.reason, 'deployment-changed');
    // the reaction tried twice, and nothing asked after it
    assert.deepEqual(renders().slice(-2), [
      `/render/${REACTION}.svg?layout=reaction`,
      `/render/${REACTION}.svg?layout=reaction`,
    ]);
  });

  test('a stop ends the figures in flight at once', async () => {
    // two at once: the first figure held unanswered, the second changing the build
    const [first, second] = [...expected.keys()];
    render.refuse(first ?? '', 'timeout');
    render.onRender((stId, refused) => {
      if (stId === second && !refused) render.health.build = '111111111111';
    });
    const started = Date.now();
    const run = await figures({ '--timeout': '5' });
    assert.equal(run.code, 1);
    assert.equal(run.report.stopped?.reason, 'deployment-changed');
    // not the held figure's two tries of 5 s, nor even one: under 4 s, not 2, so a loaded
    // host's pauses (the preflight's graph reads included) do not reach it
    assert.ok(Date.now() - started < 4000, String(Date.now() - started));
    assert.ok(!run.files.includes(`${first ?? ''}.svg`));
  });

  test('files no longer local, read after a figure, stop the run likewise', async () => {
    render.onRender((stId) => {
      if (stId === REACTION) render.health.files = 'download';
    });
    const run = await figures({ '--parallel': '1' });
    assert.equal(run.code, 1);
    assert.ok(!run.files.includes(`${REACTION}.svg`));
    assert.ok(!figureLines(run).includes(REACTION));
    assert.equal(run.report.stopped?.reason, 'deployment-changed');
  });

  test('a content release changed likewise stops the run', async () => {
    render.onRender((stId) => {
      if (stId === REACTION) content.release = 99;
    });
    const run = await figures({ '--parallel': '1' });
    assert.equal(run.code, 1);
    assert.ok(!run.files.includes(`${REACTION}.svg`));
    assert.ok(!figureLines(run).includes(REACTION));
    assert.ok(!hasComplete(run));
    assert.equal(run.report.stopped?.reason, 'deployment-changed');
  });

  test("a 404, a 500 and a label fault are each a figure's own: the rest are drawn", async () => {
    render.refuse(DELTA, 404);
    render.refuse(REACTION, 500);
    render.label(BETA, 'node \u2030');
    const run = await figures();
    assert.equal(run.code, 1);
    const faults = new Map(run.report.missing.map(({ stId, cause }) => [stId, cause]));
    assert.deepEqual(
      faults,
      new Map([
        [DELTA, 'refused'],
        [REACTION, 'failed'],
        [BETA, 'label'],
      ])
    );
    assert.match(
      run.report.missing.find(({ stId }) => stId === BETA)?.detail ?? '',
      /uncovered-character U\+2030 R-HSA-90000100/
    );
    // its health unchanged, a 500 is no stop
    assert.equal(run.report.stopped, null);
    for (const stId of faults.keys()) {
      assert.match(run.out, new RegExp(`^fault missing-figure ${stId} `, 'm'));
      assert.ok(!run.files.includes(`${stId}.svg`), stId);
      assert.ok(!figureLines(run).includes(stId), stId);
    }
    const drawn = [...expected.keys()].filter((stId) => !faults.has(stId));
    assert.deepEqual(figureLines(run).sort(), drawn.sort());
    for (const stId of drawn) assert.ok(run.files.includes(`${stId}.svg`), stId);
    assert.ok(!hasComplete(run));
    // nothing left part written
    assert.deepEqual(
      run.files.filter((name) => name.endsWith('.part')),
      []
    );
  });

  test('a figure unanswered after its retry, health unchanged, is named and leaves no complete', async () => {
    render.refuse(REACTION, 504);
    const run = await figures();
    assert.equal(run.code, 1);
    assert.equal(run.report.stopped, null);
    assert.deepEqual(
      run.report.missing.map(({ stId, cause }) => [stId, cause]),
      [[REACTION, 'unanswered']]
    );
    assert.match(run.out, new RegExp(`^fault missing-figure ${REACTION} unanswered$`, 'm'));
    assert.ok(!hasComplete(run));
    assert.ok(!run.files.includes(`${REACTION}.svg`));
    const rest = [...expected.keys()].filter((stId) => stId !== REACTION);
    assert.deepEqual(figureLines(run).sort(), rest.sort());
  });

  test('a content service not answering the read after a figure stops the run', async () => {
    render.onRender((stId) => {
      if (stId === REACTION) content.silence();
    });
    // the silent read ends by its timeout, 2 s: long enough for the reads before it
    const run = await figures({ '--parallel': '1', '--timeout': '2' });
    assert.equal(run.code, 1);
    assert.ok(!run.files.includes(`${REACTION}.svg`));
    assert.ok(!hasComplete(run));
    assert.equal(run.report.stopped?.reason, 'deployment-unanswered');
  });

  test('a render service gone silent mid-run stops it at once, saying why', async () => {
    let drawn = 0;
    render.onRender(() => {
      if (++drawn === 3) render.silence();
    });
    const started = Date.now();
    // the silent reads end by their timeout, 2 s: long enough for the reads before them
    const run = await figures({ '--timeout': '2' });
    assert.equal(run.code, 1);
    assert.ok(!hasComplete(run));
    assert.equal(run.report.stopped?.reason, 'deployment-unanswered');
    // without waiting through the rest: the figures asked for are counted, and the time is
    // bounded only loosely (a held figure's two tries and a read, 6 s; the rest, 18 figures
    // two at once at two tries of 2 s, would be 36 s)
    assert.ok(renders().length < 8, String(renders().length));
    assert.ok(Date.now() - started < 15_000, String(Date.now() - started));
    assert.match(run.err, /stopped: deployment-unanswered/);
  });

  test('a render service answering its health but 504 to every figure trips the breaker', async () => {
    render.refuseAll(504);
    // one at a time: the breaker is two figures unanswered in a row, each tried twice
    const run = await figures({ '--parallel': '1' });
    assert.equal(run.code, 1);
    assert.equal(run.report.stopped?.reason, 'breaker-unanswered');
    assert.ok(!hasComplete(run));
    assert.equal(run.report.missing.length, 2);
    assert.equal(renders().length, 4);
    assert.ok(run.report.missing.every(({ cause }) => cause === 'unanswered'));
  });

  test('figures unanswered with answers between them do not trip the breaker', async () => {
    // one at a time, every third or so unanswered (by sources no other figure draws), never
    // two in a row: each answer between them starts the count again
    const sources = ['R-HSA-90000220', 'R-HSA-90000251', REACTION, 'R-HSA-90000216'];
    for (const source of sources) render.refuse(source, 504);
    const run = await figures({ '--parallel': '1' });
    assert.equal(run.code, 1);
    assert.equal(run.report.stopped, null);
    assert.deepEqual(
      run.report.missing.map(({ stId }) => stId),
      sources
    );
    assert.equal(figureLines(run).length, expected.size - sources.length);
  });

  test('ten figures in a row failing (500) do not trip the breaker', async () => {
    // the first ten figures, one at a time: by their sources, as two share one (a request
    // left over from an earlier test cannot use up a refusal kept for each source)
    const first = [...expected.values()].slice(0, 10);
    for (const { source } of first) render.refuse(source, 500);
    const run = await figures({ '--parallel': '1' });
    assert.equal(run.code, 1);
    assert.equal(run.report.stopped, null);
    assert.deepEqual(
      run.report.missing.map(({ stId }) => stId),
      first.map(({ stId }) => stId)
    );
    assert.ok(run.report.missing.every(({ cause }) => cause === 'failed'));
    assert.equal(figureLines(run).length, expected.size - 10);
  });

  test('nor do 500s answered slowly for longer than five timeouts in all', async () => {
    render.refuseAll(500);
    render.slow(200);
    const started = Date.now();
    // 18 figures one at a time, 0.2 s each: 3.6 s, past five timeouts of 0.5 s
    const run = await figures({ '--parallel': '1', '--timeout': '0.5' });
    assert.ok(Date.now() - started > 2500);
    assert.equal(run.code, 1);
    assert.equal(run.report.stopped, null);
    assert.equal(run.report.missing.length, expected.size);
  });

  test('no figure answered for five timeouts, its health answering, trips the breaker', async () => {
    // every figure slower than its timeout, ten at once (the count's 20 is never reached), a
    // retry's pause of 2.1 s: each figure takes 5.1 s, and the breaker's silence is 7.5 s
    // (five timeouts of 1.5 s, above three and the pause, 6.6 s), when the other eight, begun
    // at 5.1 s and a little more, are in the pause after their first try, until 8.7 s
    render.slow(20_000);
    const run = await figures({ '--parallel': '10', '--timeout': '1.5' }, undefined, 2100);
    const drawing = render.times.at(render.requests.findIndex((p) => p.startsWith('/render/')));
    const ended = Date.now();
    assert.equal(run.code, 1);
    assert.equal(run.report.stopped?.reason, 'breaker-silent');
    assert.match(run.report.stopped.detail, /for 7\.5 s$/);
    // stopped as the silence ended, the figures in flight with it: their pauses cut short,
    // not waited out, timed from the drawing's start, after the preflight. These timings
    // were a timeout of 0.4 s and a pause of 0.6 s, the bound 2.3 s for a silence of 2 s and
    // pauses ending at 2.4 s, which a loaded host missed. With these, a run ended at 7.5 s,
    // at 8.05 s at most with its event loop held 600 ms of every second, and a run waiting
    // out its pauses at 8.8 s: the bound of 8.3 s is about 0.25 s above the one and 0.5 s
    // below the other. The time carries the check: a stop leaves no retry to count (a
    // figure checks for a stop before each try), so a run waiting out its pauses asks for
    // no more figures
    assert.ok(drawing !== undefined && ended - drawing < 8300, String(ended - (drawing ?? 0)));
    assert.deepEqual(figureLines(run), []);
  });

  test("a healthy service's pause after a 503 does not trip the silent breaker", async () => {
    // a timeout of 1 s, the service's own pause of 5 s: five timeouts would end the run
    // during the first figure's pause
    const [first] = [...expected.values()];
    render.refuse(first?.source ?? '', 503, 1);
    const run = await figures({ '--parallel': '1', '--timeout': '1' }, undefined, 5000);
    assert.equal(run.code, 0, JSON.stringify(run.report.stopped));
    assert.ok(hasComplete(run));
  });

  test('an unreachable content or render service is exit 2', async () => {
    const gone = await startContentStub();
    await gone.close();
    const noContent = await figures({ '--content': gone.url });
    assert.equal(noContent.code, 2);
    assert.match(noContent.err, /content service cannot be read/);
    const goneRender = await startRenderStub();
    await goneRender.close();
    const noRender = await figures({ '--render': goneRender.url });
    assert.equal(noRender.code, 2);
    assert.match(noRender.err, /render service cannot be read/);
    assert.deepEqual(renders(), []);
    // probed before the preflight: said at once, though the preflight would find a fault
    const files = scratch();
    cpSync(FILES, files, { recursive: true });
    unlinkSync(join(files, 'diagram', `${ALPHA}.graph.json`));
    const first = await figures({ '--render': goneRender.url, '--files': files });
    assert.equal(first.code, 2);
    assert.deepEqual(first.report.preflight, []);
  });

  test("the fingerprint is the deployment's after the preflight, not the probe's", async () => {
    // a build changed while the preflight runs: the folder is the new build's, and whole
    const run = await figures({}, (settings, options) =>
      rewriting(openGraph(settings, options), (row, query) => {
        if (query.includes('WHERE r:ReactionLikeEvent')) render.health.build = '222222222222';
        return row;
      })
    );
    assert.equal(run.code, 0, run.err);
    assert.equal(run.lines[0]?.['build'], '222222222222');
    assert.ok(hasComplete(run));
  });

  test('a content service answering another release is refused before any drawing', async () => {
    content.release = 97;
    const run = await figures();
    assert.equal(run.code, 2);
    assert.match(run.err, /release 97/);
    assert.deepEqual(renders(), []);
    assert.deepEqual(run.files, []);
  });

  test('a missing release file and an uncovered character each fail before any figure is asked for', async () => {
    const files = scratch();
    cpSync(FILES, files, { recursive: true });
    unlinkSync(join(files, 'diagram', `${ALPHA}.graph.json`));
    const missing = await figures({ '--files': files });
    assert.equal(missing.code, 1);
    assert.match(missing.out, new RegExp(`^fault missing-file diagram/${ALPHA}.graph.json$`, 'm'));
    const uncovered = await figures({}, (settings, options) =>
      rewriting(
        openGraph(settings, options),
        (row) => replaced(row, 'A third placeholder', 'A third \u2030 placeholder') as typeof row
      )
    );
    assert.equal(uncovered.code, 1);
    assert.match(uncovered.out, /^fault uncovered-character U\+2030 R-HSA-90000211$/m);
    // only the deployment's probes, made before the preflight
    assert.deepEqual(render.requests, ['/health', '/health']);
    assert.deepEqual(content.requests, ['/data/database/version', '/data/database/version']);
    assert.deepEqual(uncovered.report.preflight, ['uncovered-character U+2030 R-HSA-90000211']);
  });

  test('a graph failing during the checks is exit 2, the faults found before it printed', async () => {
    const files = scratch();
    cpSync(FILES, files, { recursive: true });
    unlinkSync(join(files, 'diagram', `${ALPHA}.graph.json`));
    const run = await figures({ '--files': files }, (settings, options) => {
      const graph = openGraph(settings, options);
      return {
        read: <T>(query: string, params?: Record<string, unknown>): Promise<T[]> =>
          query.includes('WHERE r:ReactionLikeEvent')
            ? Promise.reject(new Error('the graph failed'))
            : graph.read<T>(query, params),
        close: () => graph.close(),
      };
    });
    assert.equal(run.code, 2);
    assert.match(run.err, /the graph failed/);
    assert.match(run.out, new RegExp(`^fault missing-file diagram/${ALPHA}.graph.json$`, 'm'));
    assert.deepEqual(renders(), []);
  });

  test("an existing --report is refused before anything else, an earlier run's report kept", async () => {
    const work = scratch();
    const report = join(work, 'report.json');
    writeFileSync(report, '{"complete":true}\n');
    const run = await figures({ '--out': join(work, 'figures'), '--report': report });
    assert.equal(run.code, 2);
    assert.match(run.err, /--report must not exist/);
    assert.equal(readFileSync(report, 'utf8'), '{"complete":true}\n');
    assert.deepEqual(render.requests, []);
    assert.deepEqual(content.requests, []);
  });

  test("a refusal writes its report, the report's folder made, its exit kept", async () => {
    content.release = 97;
    const work = scratch();
    const report = join(work, 'runC', 'report.json');
    const run = await figures({ '--out': join(work, 'runC'), '--report': report });
    assert.equal(run.code, 2);
    assert.match(run.report.refused ?? '', /release 97/);
    assert.deepEqual(readdirSync(join(work, 'runC')), ['report.json']);
  });

  test('a report that cannot be written is said, and the run keeps its exit', async () => {
    const work = scratch();
    const notFolder = join(work, 'a-file');
    writeFileSync(notFolder, '');
    const run = await figures({ '--report': join(notFolder, 'report.json') });
    assert.equal(run.code, 0, run.err);
    assert.match(run.err, /The report could not be written/);
    assert.ok(hasComplete(run));
  });

  test("the run's own error is exit 2, the figures' faults so far printed", async () => {
    const work = scratch();
    const dir = join(work, 'figures');
    const [first] = [...expected.values()];
    render.refuse(first?.source ?? '', 404);
    let drawn = 0;
    render.onRender((_stId, refused) => {
      // the folder made read-only: the next file cannot be written
      if (!refused && ++drawn === 2) chmodSync(dir, 0o500);
    });
    try {
      const run = await figures({ '--out': dir, '--parallel': '1' });
      assert.equal(run.code, 2);
      assert.match(run.err, /The figures' run stopped: EACCES/);
      assert.match(run.out, new RegExp(`^fault missing-figure ${first?.stId ?? ''} refused$`, 'm'));
      assert.equal(run.report.stopped?.reason, 'error');
      assert.ok(!hasComplete(run));
    } finally {
      chmodSync(dir, 0o700);
    }
  });

  test('a figure timing out once, and one answering 504 once, are drawn on their retry', async () => {
    render.refuse(REACTION, 'timeout', 1);
    render.refuse(ALPHA, 504, 1);
    // the held try ends by its timeout, 2 s: long enough for the reads after each figure
    const run = await figures({ '--timeout': '2' });
    assert.equal(run.code, 0, run.err);
    assert.ok(run.files.includes(`${REACTION}.svg`));
    assert.ok(run.files.includes(`${ALPHA}.svg`));
    assert.equal(
      renders().filter((p) => p === `/render/${REACTION}.svg?layout=reaction`).length,
      2
    );
    assert.equal(renders().filter((p) => p === `/render/${ALPHA}.svg`).length, 2);
  });
});

test("figures' settings: defaults, and bad values refused", () => {
  const env = {
    NEO4J_URI: 'bolt://127.0.0.1:1',
    RENDER_SERVICE: 'http://r',
    CONTENT_SERVICE: 'http://c',
  };
  const settings = figuresSettings(['--files', 'f', '--out', 'o'], env);
  assert.equal(settings.parallel, 2);
  assert.equal(settings.timeoutMs, 60_000);
  assert.equal(settings.render, 'http://r');
  assert.equal(settings.content, 'http://c');
  assert.equal(settings.report, null);
  assert.throws(() => figuresSettings(['--files', 'f'], env), /--out is needed/);
  assert.throws(
    () => figuresSettings(['--files', 'f', '--out', 'o', '--parallel', '0'], env),
    /--parallel/
  );
  assert.throws(
    () => figuresSettings(['--files', 'f', '--out', 'o', '--timeout', '0'], env),
    /--timeout/
  );
  assert.throws(
    () => figuresSettings(['--files', 'f', '--out', 'o'], { NEO4J_URI: 'bolt://x' }),
    /--render \(or RENDER_SERVICE\)/
  );
});

test('bad arguments are exit 2', async () => {
  let err = '';
  const code = await figuresCommand(
    ['--colour', 'blue'],
    {},
    {
      out: () => undefined,
      err: (text) => (err += text),
    }
  );
  assert.equal(code, 2);
  assert.match(err, /Unknown argument: --colour/);
});

test('a graph address the driver cannot parse is exit 2, not a throw', async () => {
  let err = '';
  const code = await figuresCommand(
    [
      ...['--graph', 'not a uri', '--files', 'f', '--render', 'http://r', '--content', 'http://c'],
      ...['--out', join(tmpdir(), `pdfx-figures-never-${String(process.pid)}`)],
    ],
    {},
    { out: () => undefined, err: (text) => (err += text) }
  );
  assert.equal(code, 2);
  assert.match(err, /The graph cannot be read/);
});
