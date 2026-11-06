// The book's preflight (spec 001 T024) on the fixture graph and files, with a figures' folder
// each test writes itself (T046 writes the real one): each fault planted is caught before
// anything is printed, and the fixture's own inputs pass. Characters are planted in what the
// graph answers, through a graph that rewrites its rows, so the shared fixture is unchanged.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';

import {
  graphSettings,
  openGraph,
  type Graph,
  type GraphSettings,
} from '../../src/graph/connection.ts';
import type { Row } from '../../src/graph/rows.ts';
import { releaseInfo, type ReleaseInfo } from '../../src/graph/queries.ts';
import { buildBook } from '../../src/model/build.ts';
import { preflightCommand } from '../../src/preflight/command.ts';
import { neededFiles, readSummary, type Summary } from '../../src/preflight/files.ts';
import {
  checkFolder,
  expectedFigures,
  manifestLine,
  MANIFEST,
  type FigureRecord,
  type Fingerprint,
} from '../../src/preflight/folder.ts';
import { preflight } from '../../src/preflight/preflight.ts';

const skip = process.env['NEO4J_URI'] ? false : 'no fixture graph: set NEO4J_URI';
const FILES = fileURLToPath(new URL('../../ci/fixture/files/', import.meta.url));
const CLI = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));

/** The graph, its rows' strings and rows rewritten: a character planted, a checksum taken. */
function rewriting(
  graph: Graph,
  text: (value: string, query: string) => string,
  row: (value: Record<string, unknown>) => Record<string, unknown> = (r) => r
): Graph {
  return {
    async read(query, params): Promise<Row[]> {
      const visit = (item: unknown): unknown => {
        if (typeof item === 'string') return text(item, query);
        if (Array.isArray(item)) return item.map(visit);
        if (item !== null && typeof item === 'object') {
          return Object.fromEntries(Object.entries(item).map(([k, v]) => [k, visit(v)]));
        }
        return item;
      };
      const rows = await graph.read(query, params);
      return rows.map((r) => row(visit(r) as Row));
    },
    close: () => Promise.resolve(),
  };
}

/** A graph whose `from` is `to` wherever a string holds it. */
const planted = (graph: Graph, from: string, to: string): Graph =>
  rewriting(graph, (value) => value.split(from).join(to));

describe("the book's preflight", { skip }, () => {
  let graph: Graph;
  let release: ReleaseInfo;
  let summary: Summary;
  let expected: Map<string, FigureRecord>;
  let print: Fingerprint;
  const dirs: string[] = [];
  const scratch = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'pdfx-preflight-'));
    dirs.push(dir);
    return dir;
  };

  /** A copy of the fixture's release files, to plant faults in. */
  const files = (): string => {
    const dir = scratch();
    cpSync(FILES, dir, { recursive: true });
    return dir;
  };

  /**
   * A figures' folder as `figures` would leave it for the fixture's book: a file per figure,
   * and the manifest, its lines given to `edit` first.
   */
  const folder = (
    edit: (lines: string[]) => string[] = (lines) => lines,
    fingerprint: Fingerprint = print
  ): string => {
    const dir = scratch();
    const lines = [manifestLine({ type: 'fingerprint', ...fingerprint })];
    for (const record of expected.values()) {
      writeFileSync(join(dir, `${record.stId}.svg`), '<svg xmlns="http://www.w3.org/2000/svg"/>');
      lines.push(manifestLine({ type: 'figure', ...record }));
    }
    lines.push(manifestLine({ type: 'complete', ...fingerprint }));
    writeFileSync(join(dir, MANIFEST), edit(lines).join(''));
    return dir;
  };

  const run = async (
    on: Graph = graph,
    settings: { files?: string; figures?: string } = {}
  ): Promise<string[]> =>
    (
      await preflight(on, await releaseInfo(on), {
        species: 'Homo sapiens',
        files: settings.files ?? FILES,
        figures: settings.figures ?? folder(),
      })
    ).faults;

  const folderFaults = (dir: string, against: ReleaseInfo = release): string[] =>
    checkFolder(dir, { release: against, summary: summary.hash, expected });

  before(async () => {
    graph = openGraph(graphSettings(process.env));
    release = await releaseInfo(graph);
    const read = readSummary(FILES);
    if (!read) throw new Error('the fixture has no EHLD summary');
    summary = read;
    expected = expectedFigures(await buildBook(graph, { illustrated: summary.illustrated }));
    print = {
      release: release.release,
      checksum: release.checksum ?? '',
      summary: summary.hash,
      content: release.release,
      build: 'test-build',
    };
  });
  after(async () => {
    await graph.close();
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  test("the fixture's inputs pass, the summary's entry for an absent event no fault", async () => {
    assert.deepEqual(await run(), []);
    // every kind of figure is among those checked
    assert.deepEqual(
      new Set([...expected.values()].map((r) => r.kind)),
      new Set(['diagram', 'ancestor', 'ehld', 'reaction'])
    );
    assert.ok(summary.illustrated.has('R-HSA-99999999'));
    assert.ok(!neededFiles(expected.values()).some((name) => name.includes('99999999')));
  });

  test("a figure's missing file is missing-file", () => {
    const dir = folder();
    unlinkSync(join(dir, 'R-HSA-90000211.svg'));
    assert.deepEqual(folderFaults(dir), ['missing-file R-HSA-90000211.svg']);
  });

  test('a line with another source or selection, a figure with no line, and a line for no figure are each stale-figure', () => {
    const swap = (stId: string, change: (record: FigureRecord) => FigureRecord) =>
      folder((lines) =>
        lines.map((line) => {
          const record = JSON.parse(line) as FigureRecord & { type: string };
          return record.type === 'figure' && record.stId === stId
            ? manifestLine({ ...change(record), type: 'figure' })
            : line;
        })
      );
    // Alpha sub one is drawn in Alpha's diagram, its reactions selected
    assert.equal(expected.get('R-HSA-90000210')?.kind, 'ancestor');
    assert.deepEqual(
      folderFaults(swap('R-HSA-90000210', (r) => ({ ...r, source: 'R-HSA-90000230' }))),
      ['stale-figure R-HSA-90000210']
    );
    assert.deepEqual(
      folderFaults(swap('R-HSA-90000210', (r) => ({ ...r, highlight: r.highlight.slice(1) }))),
      ['stale-figure R-HSA-90000210']
    );
    // a selection that is the right one's beginning
    assert.deepEqual(
      folderFaults(swap('R-HSA-90000210', (r) => ({ ...r, highlight: r.highlight.slice(0, -1) }))),
      ['stale-figure R-HSA-90000210']
    );
    assert.deepEqual(folderFaults(swap('R-HSA-90000300', (r) => ({ ...r, kind: 'diagram' }))), [
      'stale-figure R-HSA-90000300',
    ]);
    const noLine = folder((lines) =>
      lines.filter((line) => (JSON.parse(line) as { stId?: string }).stId !== 'R-HSA-90000132')
    );
    assert.deepEqual(folderFaults(noLine), ['stale-figure R-HSA-90000132']);
    const extra = folder((lines) => [
      ...lines.slice(0, -1),
      manifestLine({
        type: 'figure',
        stId: 'R-MMU-90000910',
        kind: 'reaction',
        source: 'R-MMU-90000910',
        highlight: [],
      }),
      ...lines.slice(-1),
    ]);
    assert.deepEqual(folderFaults(extra), ['stale-figure R-MMU-90000910']);
  });

  test('a folder of another checksum or release is stale-folder, of another summary stale-summary', () => {
    assert.deepEqual(folderFaults(folder(undefined, { ...print, checksum: '1' })), [
      'stale-folder 98/1 98/9007199254740993',
    ]);
    assert.deepEqual(folderFaults(folder(undefined, { ...print, release: 97 })), [
      'stale-folder 97/9007199254740993 98/9007199254740993',
    ]);
    assert.deepEqual(folderFaults(folder(undefined, { ...print, summary: 'sha256:0' })), [
      'stale-summary',
    ]);
  });

  test('a stale folder is refused as a whole, its figures not checked one by one', () => {
    const dir = folder(
      (lines) =>
        lines.filter((line) => (JSON.parse(line) as { stId?: string }).stId !== 'R-HSA-90000132'),
      { ...print, checksum: '1' }
    );
    unlinkSync(join(dir, 'R-HSA-90000211.svg'));
    assert.deepEqual(folderFaults(dir), ['stale-folder 98/1 98/9007199254740993']);
  });

  test('a manifest that is not whole is incomplete-folder, each way', () => {
    const cases: Record<string, (lines: string[]) => string[]> = {
      'no complete line': (lines) => lines.slice(0, -1),
      'a figure line after complete': (lines) => [...lines, lines[1] ?? ''],
      'a torn last line': (lines) => [...lines.slice(0, -1), (lines.at(-1) ?? '').slice(0, 20)],
      'a middle line that is not JSON': (lines) => [
        ...lines.slice(0, 2),
        '{"type": "figure"\n',
        ...lines.slice(2),
      ],
      'two lines for one figure': (lines) => [...lines.slice(0, 2), ...lines.slice(1)],
      'complete differing from the first line': (lines) => [
        ...lines.slice(0, -1),
        manifestLine({ type: 'complete', ...print, build: 'another-build' }),
      ],
      'no manifest': () => [],
    };
    for (const [name, edit] of Object.entries(cases)) {
      const dir = folder(edit);
      if (name === 'no manifest') unlinkSync(join(dir, MANIFEST));
      assert.deepEqual(folderFaults(dir), ['incomplete-folder'], name);
    }
  });

  test('a graph with no checksum is no-checksum', async () => {
    const without = rewriting(
      graph,
      (value) => value,
      (row) => ('checksum' in row ? { ...row, checksum: null } : row)
    );
    assert.equal((await releaseInfo(without)).checksum, null);
    assert.deepEqual(await run(without), ['no-checksum']);
  });

  test("a release's missing diagram, illustration or summary is missing-file", async () => {
    const dir = files();
    unlinkSync(join(dir, 'diagram/R-HSA-90000130.json'));
    unlinkSync(join(dir, 'diagram/R-HSA-90000200.graph.json'));
    unlinkSync(join(dir, 'ehld/R-HSA-90000300.svg'));
    assert.deepEqual(await run(graph, { files: dir }), [
      'missing-file diagram/R-HSA-90000130.json',
      'missing-file diagram/R-HSA-90000200.graph.json',
      'missing-file ehld/R-HSA-90000300.svg',
    ]);
    unlinkSync(join(dir, 'ehld/svgsummary.txt'));
    assert.deepEqual(await run(graph, { files: dir }), ['missing-file ehld/svgsummary.txt']);
  });

  test('a character off the list in a text is a fault naming its event; the listed ones are none', async () => {
    assert.deepEqual(
      await run(planted(graph, 'A third placeholder', 'A third \u2030 placeholder')),
      ['uncovered-character U+2030 R-HSA-90000211']
    );
    // in a top-level pathway's name: its cover and section, and each section whose location
    // prints it, each a place of its own
    assert.deepEqual(await run(planted(graph, 'Gamma pathway', 'Gamma \u2103 pathway')), [
      'uncovered-character U+2103 R-HSA-90000300',
      'uncovered-character U+2103 R-HSA-90000310',
      'uncovered-character U+2103 R-HSA-90000313',
    ]);
    assert.deepEqual(
      await run(
        planted(graph, 'A third placeholder', 'A third \u2011 \uFB01 \u02D9 \u05F3 placeholder')
      ),
      []
    );
  });

  test("a character off the list in a name only the cover prints is a fault naming its PDF's pathway", async () => {
    // an undated edit's author is on the cover, which names every edit's authors, and in no
    // section's edit history, which leaves undated edits out; planted in the edits alone,
    // not in the references that also list this placeholder
    const coverOnly = rewriting(graph, (value, query) =>
      query.includes('InstanceEdit')
        ? value.replace('Placeholder06', 'Placeholder06 \u2030')
        : value
    );
    assert.deepEqual(await run(coverOnly), ['uncovered-character U+2030 R-HSA-90000200']);
  });

  test("a character off the list in a participant's name, or in a compartment only a participant holds, is a fault naming the reaction drawing it", async () => {
    assert.deepEqual(
      await run(planted(graph, 'Placeholder protein 1', 'Placeholder \u2030 protein 1')),
      ['uncovered-character U+2030 R-HSA-90000211']
    );
    // the membrane is no event's compartment, so no section prints it: only the figure does
    assert.deepEqual(
      await run(planted(graph, 'placeholder membrane', 'placeholder \u2103 membrane')),
      ['uncovered-character U+2103 R-HSA-90000211']
    );
    assert.deepEqual(
      await run(planted(graph, 'placeholder membrane', 'placeholder \u2011\uFB01 membrane')),
      []
    );
  });

  test("a character off the list in a drawn diagram file's label is a fault naming its pathway; in a file not drawn, none", async () => {
    const label = (dir: string, stId: string, text: string): void => {
      writeFileSync(
        join(dir, `diagram/${stId}.json`),
        JSON.stringify({ stableId: stId, nodes: [{ displayName: text }], edges: [] })
      );
    };
    const dir = files();
    label(dir, 'R-HSA-90000130', 'node \u2030');
    // Alpha's diagram is drawn for Alpha and, its reactions selected, for Alpha sub one
    label(dir, 'R-HSA-90000200', 'node \u2103');
    assert.deepEqual(await run(graph, { files: dir }), [
      'uncovered-character U+2103 R-HSA-90000200',
      'uncovered-character U+2030 R-HSA-90000130',
    ]);
    const notDrawn = files();
    // Gamma's figure is its illustration; the mouse pathway is not in the human book
    label(notDrawn, 'R-HSA-90000300', 'node \u2030');
    label(notDrawn, 'R-MMU-90000900', 'node \u2030');
    label(notDrawn, 'R-HSA-90000100', 'node \u2011 \uFB01');
    assert.deepEqual(await run(graph, { files: notDrawn }), []);
  });

  test("a top-level pathway's name a file cannot hold, or two equal ignoring case, is bad-file-name", async () => {
    assert.deepEqual(await run(planted(graph, 'Gamma pathway', 'Gamma/pathway')), [
      'bad-file-name R-HSA-90000300',
    ]);
    assert.deepEqual(await run(planted(graph, 'Gamma pathway', 'ALPHA PATHWAY')), [
      'bad-file-name R-HSA-90000200',
      'bad-file-name R-HSA-90000300',
    ]);
  });

  test('a diagram file that cannot be read as JSON is bad-file, and the run reports every fault', async () => {
    const dir = files();
    writeFileSync(join(dir, 'diagram/R-HSA-90000130.json'), '{"nodes": [');
    const out: string[] = [];
    const code = await preflightCommand(
      ['--files', dir, '--figures', scratch()],
      { NEO4J_URI: process.env['NEO4J_URI'] },
      { out: (text) => out.push(text), err: () => undefined }
    );
    assert.equal(code, 1);
    assert.equal(
      out.join(''),
      'fault incomplete-folder\nfault bad-file diagram/R-HSA-90000130.json\n'
    );
  });

  test('an error during the preflight is exit 2, its error on stderr, the faults found so far printed', async () => {
    const out: string[] = [];
    const err: string[] = [];
    const both: string[] = [];
    // the graph fails at the reactions' names, after the folder's check has found its fault
    const failing = (settings: GraphSettings): Graph => {
      const real = openGraph(settings);
      return {
        read: (query, params) =>
          query.includes('-[:compartment]->(c)')
            ? Promise.reject(new Error('the planted failure'))
            : real.read(query, params),
        close: () => real.close(),
      };
    };
    const code = await preflightCommand(
      ['--files', FILES, '--figures', scratch()],
      { NEO4J_URI: process.env['NEO4J_URI'] },
      {
        out: (text) => {
          out.push(text);
          both.push('out');
        },
        err: (text) => {
          err.push(text);
          both.push('err');
        },
        open: failing,
      }
    );
    assert.equal(code, 2);
    assert.equal(out.join(''), 'fault incomplete-folder\n');
    assert.match(err.join(''), /the planted failure/);
    // the faults first, then the error
    assert.deepEqual(both, ['out', 'err']);
  });

  test("the checks' graph failing to open is exit 2, and a graph failing to close keeps the exit code", async () => {
    const call = async (open: (settings: GraphSettings) => Graph, figures: string) => {
      const out: string[] = [];
      const err: string[] = [];
      const code = await preflightCommand(
        ['--files', FILES, '--figures', figures],
        { NEO4J_URI: process.env['NEO4J_URI'] },
        { out: (text) => out.push(text), err: (text) => err.push(text), open }
      );
      return { code, out: out.join(''), err: err.join('') };
    };
    // the second open, the checks', throws at once: an error, not a rejection of the command
    let opened = 0;
    const secondThrows = (settings: GraphSettings): Graph => {
      opened += 1;
      if (opened === 2) throw new Error('the planted open failure');
      return openGraph(settings);
    };
    const thrown = await call(secondThrows, folder());
    assert.equal(thrown.code, 2);
    assert.equal(thrown.out, '');
    assert.match(thrown.err, /^The preflight stopped: the planted open failure\n$/);
    // every close rejects, after closing: the exit code is the checks', 0 and then 1
    const closeRejects = (settings: GraphSettings): Graph => {
      const real = openGraph(settings);
      return {
        read: (query, params) => real.read(query, params),
        close: async () => {
          await real.close();
          throw new Error('the planted close failure');
        },
      };
    };
    const clean = await call(closeRejects, folder());
    assert.equal(clean.code, 0);
    assert.equal(clean.out, '');
    assert.equal(
      clean.err,
      'The graph did not close: the planted close failure\n'.repeat(2),
      "both graphs, the start's and the checks'"
    );
    const faulty = await call(closeRejects, scratch());
    assert.equal(faulty.code, 1);
    assert.equal(faulty.out, 'fault incomplete-folder\n');
  });

  test('pdf-export preflight: exit 0 with no fault, 1 with each fault a line, 2 on bad arguments or no graph', async () => {
    const env: Record<string, string | undefined> = { NEO4J_URI: process.env['NEO4J_URI'] };
    const call = async (args: string[], environment = env) => {
      const out: string[] = [];
      const err: string[] = [];
      const code = await preflightCommand(args, environment, {
        out: (text) => out.push(text),
        err: (text) => err.push(text),
      });
      return { code, out: out.join(''), err: err.join('') };
    };
    assert.deepEqual(await call(['--files', FILES, '--figures', folder()]), {
      code: 0,
      out: '',
      err: '',
    });
    const dir = folder();
    unlinkSync(join(dir, 'R-HSA-90000211.svg'));
    unlinkSync(join(dir, 'R-HSA-90000132.svg'));
    const faulty = await call([`--files=${FILES}`, '--figures', dir]);
    assert.equal(faulty.code, 1);
    assert.equal(
      faulty.out,
      'fault missing-file R-HSA-90000211.svg\nfault missing-file R-HSA-90000132.svg\n'
    );
    assert.equal((await call(['--files', FILES])).code, 2);
    assert.equal((await call(['--files', FILES, '--figures', dir, '--bake', 'x'])).code, 2);
    assert.equal((await call(['--files', FILES, '--figures', dir], {})).code, 2);
    // said at once, not after the driver's half a minute of retries
    const started = Date.now();
    const unreachable = await call([
      '--graph',
      'bolt://127.0.0.1:1',
      '--files',
      FILES,
      '--figures',
      dir,
    ]);
    assert.equal(unreachable.code, 2);
    assert.equal(unreachable.out, '');
    assert.ok(Date.now() - started < 15_000, `${String(Date.now() - started)} ms`);
  });

  test('a graph address that cannot be parsed is exit 2, its error on stderr', async () => {
    // only addresses that fail to parse: one that falls back to the default port could reach
    // another database on the host
    for (const uri of ['127.0.0.1:17700', 'http://127.0.0.1:17700']) {
      const out: string[] = [];
      const err: string[] = [];
      const code = await preflightCommand(
        ['--files', FILES, '--figures', folder()],
        { NEO4J_URI: uri },
        { out: (text) => out.push(text), err: (text) => err.push(text) }
      );
      assert.equal(code, 2, uri);
      assert.equal(out.join(''), '', uri);
      assert.match(err.join(''), /^The graph cannot be read: /, uri);
    }
  });

  test('the command ends once its checks are done: no driver is left open', () => {
    // run as the command line runs it: a driver left open keeps the process alive
    const started = Date.now();
    const run = spawnSync(
      process.execPath,
      [CLI, 'preflight', '--files', FILES, '--figures', folder()],
      {
        env: { ...process.env, NEO4J_URI: process.env['NEO4J_URI'] },
        encoding: 'utf8',
        timeout: 30_000,
      }
    );
    const elapsed = Date.now() - started;
    assert.equal(run.status, 0, run.stderr);
    assert.ok(elapsed < 15_000, `${String(elapsed)} ms`);
  });
});
