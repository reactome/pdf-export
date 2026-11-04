// `pdf-export book` end to end (spec 001 T029, contracts/cli.md) on the fixture's graph and
// release files, with a figures' folder each test writes itself (as T024's tests do; T046
// writes the real one): the book written whole, one PDF per top-level pathway, or nothing
// written at all; its exit codes; no render service asked; and the run report's characters.
// Characters and names are planted in what the graph answers, through a graph that rewrites
// its rows, so the shared fixture is unchanged.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { constants as osConstants, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

import {
  bookCommand,
  outProblem,
  type BookIo,
  type BookPrinter,
  type RunReport,
} from '../../src/book/command.ts';
import {
  graphSettings,
  openGraph,
  type Graph,
  type GraphOptions,
  type GraphSettings,
} from '../../src/graph/connection.ts';
import { CHECKS } from '../../src/check/book.ts';
import { releaseInfo } from '../../src/graph/queries.ts';
import { PAGE } from '../../src/layout/figure.ts';
import { PLACEHOLDER, PROBE } from '../../src/layout/html.ts';
import { buildBook } from '../../src/model/build.ts';
import { readSummary } from '../../src/preflight/files.ts';
import {
  expectedFigures,
  manifestLine,
  MANIFEST,
  type FigureRecord,
  type Fingerprint,
} from '../../src/preflight/folder.ts';
import { Printer } from '../../src/print/print.ts';
import { startRenderStub, type RenderStub } from '../stubs/render.ts';

const skip = process.env['NEO4J_URI'] ? false : 'no fixture graph: set NEO4J_URI';
const FILES = fileURLToPath(new URL('../../ci/fixture/files/', import.meta.url));
const FIGURES = fileURLToPath(new URL('../../ci/fixture/figures/', import.meta.url));
const SITE = 'https://site.example';
const CLI = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));
const BOOK = ['Alpha pathway.pdf', 'Gamma pathway.pdf', 'beta pathway.pdf'];

/** The graph, its rows' strings rewritten: a character or a name planted. */
function rewriting(graph: Graph, text: (value: string) => string): Graph {
  return {
    async read<T>(query: string, params?: Record<string, unknown>): Promise<T[]> {
      const visit = (item: unknown): unknown => {
        if (typeof item === 'string') return text(item);
        if (Array.isArray(item)) return item.map(visit);
        if (item !== null && typeof item === 'object') {
          return Object.fromEntries(Object.entries(item).map(([k, v]) => [k, visit(v)]));
        }
        return item;
      };
      return (await graph.read<unknown>(query, params)).map(visit) as T[];
    },
    close: () => graph.close(),
  };
}

/** How `book` opens its graph, each `from` planted as its `to`. */
const planting =
  (plants: readonly [string, string][]) =>
  (settings: GraphSettings, options?: GraphOptions): Graph =>
    rewriting(openGraph(settings, options), (value) =>
      plants.reduce((v, [from, to]) => v.split(from).join(to), value)
    );

type PdfJs = Awaited<ReturnType<typeof getDocument>['promise']>;

async function reading<T>(path: string, read: (doc: PdfJs) => Promise<T>): Promise<T> {
  const task = getDocument({ data: new Uint8Array(readFileSync(path)) });
  try {
    return await read(await task.promise);
  } finally {
    await task.destroy();
  }
}

/** A PDF's text, page by page, without what is stamped in the top and bottom margins. */
function bodyText(path: string): Promise<string[]> {
  return reading(path, async (doc) => {
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const [, , , height = 0] = page.view;
      const items = (await page.getTextContent()).items.flatMap((item) => {
        if (!('str' in item)) return [];
        const y = (item.transform as number[])[5] ?? 0;
        return y > PAGE.margin && y < height - PAGE.margin ? [item.str] : [];
      });
      pages.push(items.join(''));
    }
    return pages;
  });
}

const occurrences = (text: string, of: string) => text.split(of).length - 1;

describe('pdf-export book', { skip }, () => {
  let expected: Map<string, FigureRecord>;
  let print: Fingerprint;
  let stub: RenderStub;
  /**
   * The test file's own folder, removed after: every folder a test writes is in it, so a run
   * stopped before `after` (killed for memory, say) leaves one folder, not one a test.
   */
  let root: string | undefined;
  const scratch = (): string => {
    root ??= mkdtempSync(join(tmpdir(), 'pdfx-book-'));
    return mkdtempSync(join(root, 'test-'));
  };

  /**
   * A figures' folder as `figures` would leave it for the fixture's book: each event's file
   * the recorded SVG of what it draws, given to `edit` with its event first, and the manifest.
   */
  const folder = (edit: (stId: string, svg: string) => string = (_, svg) => svg): string => {
    const dir = scratch();
    const lines = [manifestLine({ type: 'fingerprint', ...print })];
    for (const record of expected.values()) {
      const file = join(
        FIGURES,
        `${record.source}${record.kind === 'reaction' ? '.reaction' : ''}.svg`
      );
      writeFileSync(join(dir, `${record.stId}.svg`), edit(record.stId, readFileSync(file, 'utf8')));
      lines.push(manifestLine({ type: 'figure', ...record }));
    }
    lines.push(manifestLine({ type: 'complete', ...print }));
    writeFileSync(join(dir, MANIFEST), lines.join(''));
    return dir;
  };

  /**
   * `book` run in this process, its temporary folder (TMPDIR: the printer's pages, Chromium's
   * profile) one of its own, and what is left there after it, which should be nothing.
   */
  const book = async (
    args: string[],
    io: Partial<BookIo> = {},
    env: Record<string, string | undefined> = {
      NEO4J_URI: process.env['NEO4J_URI'],
      RENDER_SERVICE: stub.url,
    }
  ) => {
    const out: string[] = [];
    const err: string[] = [];
    const temporary = scratch();
    const was = process.env['TMPDIR'];
    process.env['TMPDIR'] = temporary;
    let code: number;
    try {
      code = await bookCommand(args, env, {
        out: (text) => out.push(text),
        err: (text) => err.push(text),
        date: new Date('2026-11-03T12:00:00Z'),
        ...io,
      });
    } finally {
      if (was === undefined) delete process.env['TMPDIR'];
      else process.env['TMPDIR'] = was;
    }
    return { code, out: out.join(''), err: err.join(''), left: readdirSync(temporary) };
  };

  /** A parent folder for the book, and the arguments that write it there. */
  const place = (figures: string = folder()) => {
    const parent = scratch();
    const out = join(parent, 'TheReactomeBook');
    const report = join(scratch(), 'report.json');
    const args = [
      ...['--files', FILES, '--figures', figures, '--site', SITE],
      ...['--out', out, '--report', report],
    ];
    return { parent, out, report, args };
  };

  const readReport = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as RunReport;

  /** A printer that keeps each part's HTML as it is printed, and runs `after` once it is. */
  const counting =
    (printed: string[], after: () => void = () => undefined) =>
    async (): Promise<BookPrinter> => {
      const printer = await Printer.start();
      return {
        part: async (html) => {
          const pdf = await printer.part(html);
          printed.push(html);
          after();
          return pdf;
        },
        close: () => printer.close(),
      };
    };

  /**
   * `book` run as a child process, sent SIGTERM once `ready` holds (polled every 10 ms, so it
   * is sent within a moment): how it exited, and its folders, which should be empty. The run
   * is given 90 s to reach its moment: the last, a part printed, came at 18 s on a busy host
   * and at 36 s with the test's processes held to 30% of a CPU (when the poll spun without
   * pause, taking that CPU, it never came within the 60 s once given). A run that ends
   * before its moment fails at once.
   */
  const signalled = async (
    ready: (run: { parent: string; temporary: string; pid: number }) => boolean,
    signals: readonly NodeJS.Signals[] = ['SIGTERM']
  ) => {
    const { parent, report, args } = place();
    const temporary = scratch();
    const child = spawn(process.execPath, [CLI, 'book', ...args, '--parallel', '1'], {
      env: { ...process.env, TMPDIR: temporary, NEO4J_URI: process.env['NEO4J_URI'] },
      stdio: 'ignore',
    });
    const ended = new Promise<void>((resolve) =>
      child.once('exit', () => {
        resolve();
      })
    );
    try {
      const deadline = Date.now() + 90_000;
      while (!ready({ parent, temporary, pid: child.pid ?? 0 })) {
        assert.ok(child.exitCode === null, 'the run ended before it was signalled');
        assert.ok(Date.now() < deadline, 'never ready to be signalled');
        // a short sleep, not setImmediate: a poll that spins takes the CPU the run needs on a
        // loaded host, and each moment is a state that lasts (a folder made, a process spawned)
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      for (const signal of signals) child.kill(signal);
      const kill = setTimeout(() => child.kill('SIGKILL'), 30_000);
      await ended;
      clearTimeout(kill);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    return {
      code: child.exitCode,
      signal: child.signalCode,
      parent: readdirSync(parent),
      temporary: readdirSync(temporary),
      report: existsSync(report) ? readReport(report) : null,
    };
  };

  before(async () => {
    stub = await startRenderStub();
    const graph = openGraph(graphSettings(process.env));
    try {
      const release = await releaseInfo(graph);
      const summary = readSummary(FILES);
      if (!summary) throw new Error('the fixture has no EHLD summary');
      expected = expectedFigures(await buildBook(graph, { illustrated: summary.illustrated }));
      print = {
        release: release.release,
        checksum: release.checksum ?? '',
        summary: summary.hash,
        content: release.release,
        build: 'test-build',
      };
    } finally {
      await graph.close();
    }
  });
  after(async () => {
    await stub.close();
    if (root) rmSync(root, { recursive: true, force: true });
  });

  test('exit 0 on the fixture: one PDF per top-level pathway and no other, finished, with no render service asked', async () => {
    const { parent, out, report, args } = place();
    // two at once, not the default four, to spare the memory of a test run's other prints
    const run = await book([...args, '--parallel', '2', '--joins', '2']);
    assert.deepEqual(run.left, [], 'left in its temporary folder');
    assert.equal(run.code, 0, run.err);
    assert.equal(run.out, '');
    // the folder moved into place, nothing beside it
    assert.deepEqual(readdirSync(parent), ['TheReactomeBook']);
    assert.deepEqual(readdirSync(out).sort(), BOOK);
    assert.deepEqual(stub.requests, [], 'a render service was asked');
    const written = readReport(report);
    assert.equal(written.outcome, 'written');
    assert.equal(written.release, 98);
    assert.deepEqual(
      written.pdfs.map((pdf) => [pdf.file, pdf.stId]),
      [
        ['Alpha pathway.pdf', 'R-HSA-90000200'],
        ['beta pathway.pdf', 'R-HSA-90000100'],
        ['Gamma pathway.pdf', 'R-HSA-90000300'],
      ]
    );
    // every figure the book needs, by kind, as the folder's manifest lists them
    const byKind = { diagram: 0, ancestor: 0, ehld: 0, reaction: 0 };
    for (const record of expected.values()) byKind[record.kind] += 1;
    assert.deepEqual(written.figures.byKind, byKind);
    assert.equal(expected.size, 18);
    assert.deepEqual(written.characters, { replaced: {}, uncovered: [] });
    assert.deepEqual(written.faults, []);
    assert.deepEqual(written.joins, { joins: 2, parallel: 2, objectStreams: false });
    assert.deepEqual(
      written.stages.map((stage) => stage.stage),
      ['preflight', 'figures', 'print', 'join', 'contents', 'parts', 'check-book']
    );
    // FR-011's check run, every check passed (T030)
    assert.deepEqual(
      written.checks,
      CHECKS.map((check) => ({ check, faults: 0 }))
    );
    assert.ok((written.stages.at(-1)?.seconds ?? 0) > 0, 'check-book not timed');
    assert.equal(written.signal, null);
    for (const pdf of written.pdfs) {
      const path = join(out, pdf.file);
      const bytes = readFileSync(path);
      assert.equal(bytes.length, pdf.bytes, pdf.file);
      const text = bytes.toString('latin1');
      // its links rewritten, saved with object streams off
      assert.ok(!text.includes(PLACEHOLDER) && !text.includes(PROBE), pdf.file);
      assert.ok(!text.includes('/ObjStm'), `${pdf.file} has object streams`);
      await reading(path, async (doc) => {
        assert.equal(doc.numPages, pdf.pages, pdf.file);
        // its outline written, its pages stamped: the last page's number at its foot
        assert.ok(((await doc.getOutline()) as unknown[] | null)?.length, pdf.file);
        const last = await doc.getPage(doc.numPages);
        const foot = (await last.getTextContent()).items.flatMap((item) =>
          'str' in item && ((item.transform as number[])[5] ?? 0) < PAGE.margin ? [item.str] : []
        );
        assert.equal(foot.join(''), String(doc.numPages), pdf.file);
        // its contents numbered (T028): every number on the contents' page past the cover
        let numbers: number[] = [];
        for (let i = 1; i <= doc.numPages && numbers.length === 0; i++) {
          const items = (await (await doc.getPage(i)).getTextContent()).items.flatMap((item) =>
            'str' in item ? [{ str: item.str, transform: item.transform as number[] }] : []
          );
          const heading = items.some(
            (item) =>
              item.str === 'Contents' &&
              Math.hypot(item.transform[2] ?? 0, item.transform[3] ?? 0) > 17
          );
          if (!heading) continue;
          numbers = items.flatMap((item) => {
            const y = item.transform[5] ?? 0;
            const x = item.transform[4] ?? 0;
            return /^\d+$/.test(item.str) && y > PAGE.margin && x > 300 ? [Number(item.str)] : [];
          });
        }
        assert.ok(numbers.length > 0, `${pdf.file}: no contents numbers`);
        assert.ok(
          numbers.every((n) => n > 1 && n <= doc.numPages),
          `${pdf.file}: ${numbers.join(' ')}`
        );
      });
    }
    assert.equal(
      written.total.pages,
      written.pdfs.reduce((n, pdf) => n + pdf.pages, 0)
    );
  });

  test('exit 1 on a figure file missing from --figures, with nothing left', async () => {
    const figures = folder();
    unlinkSync(join(figures, 'R-HSA-90000211.svg'));
    const { parent, report, args } = place(figures);
    const run = await book(args);
    assert.deepEqual(run.left, [], 'left in its temporary folder');
    assert.equal(run.code, 1, run.err);
    assert.equal(run.out, 'fault missing-file R-HSA-90000211.svg\n');
    assert.deepEqual(readdirSync(parent), []);
    const written = readReport(report);
    assert.equal(written.outcome, 'faults');
    assert.deepEqual(written.figures.missing, ['R-HSA-90000211']);
  });

  test('exit 2 on an --out that is not empty, or not a folder, which is left as it was', async () => {
    const { parent, out, args } = place();
    mkdirSync(out);
    writeFileSync(join(out, 'old.pdf'), 'an old book');
    const run = await book(args);
    assert.deepEqual(run.left, [], 'left in its temporary folder');
    assert.equal(run.code, 2);
    assert.match(run.err, /is not empty/);
    assert.deepEqual(readdirSync(parent), ['TheReactomeBook']);
    assert.deepEqual(readdirSync(out), ['old.pdf']);
    const file = place();
    writeFileSync(file.out, 'a file');
    const notAFolder = await book(file.args);
    assert.equal(notAFolder.code, 2);
    assert.match(notAFolder.err, /is not a folder/);
    assert.deepEqual(readdirSync(file.parent), ['TheReactomeBook']);
    assert.equal(readFileSync(file.out, 'utf8'), 'a file');
  });

  test('exit 2 on an --out whose folder cannot be written, said in the report, nothing left', async () => {
    const { parent, report, args } = place();
    chmodSync(parent, 0o555);
    let run;
    try {
      run = await book(args);
    } finally {
      chmodSync(parent, 0o755);
    }
    assert.equal(run.code, 2);
    assert.match(run.err, /cannot be written/);
    assert.deepEqual(run.left, [], 'left in its temporary folder');
    assert.deepEqual(readdirSync(parent), []);
    const written = readReport(report);
    assert.equal(written.outcome, 'error');
    assert.match(written.error ?? '', /cannot be written/);
  });

  test('an --out on another device than its folder (a mount point) is refused', () => {
    const { out } = place();
    mkdirSync(out);
    const real = (path: string) => statSync(path);
    assert.equal(outProblem(out, real), null);
    // the same folder, as if mounted: another device than its parent's
    const mounted = (path: string) => {
      const stat = statSync(path);
      return path === out ? { dev: stat.dev + 1, isDirectory: () => stat.isDirectory() } : stat;
    };
    assert.match(
      outProblem(out, mounted) ?? '',
      /is on another device than its folder, or a mount point/
    );
  });

  test('exit 2 on an --out that cannot be read, or is a symbolic link, each left as it was', async () => {
    // mode 000: whether it is empty cannot be read
    const unreadable = place();
    mkdirSync(unreadable.out, { mode: 0o000 });
    let run;
    try {
      run = await book(unreadable.args);
    } finally {
      chmodSync(unreadable.out, 0o755);
    }
    assert.equal(run.code, 2, run.err);
    assert.match(run.err, /cannot be read/);
    assert.deepEqual(run.left, [], 'left in its temporary folder');
    assert.deepEqual(readdirSync(unreadable.parent), ['TheReactomeBook']);
    // a link to an empty folder, and one to nothing: neither can be renamed onto
    for (const to of [scratch(), join(scratch(), 'nothing')]) {
      const linked = place();
      symlinkSync(to, linked.out);
      const refused = await book(linked.args);
      assert.equal(refused.code, 2, refused.err);
      assert.match(refused.err, /is a symbolic link/);
      assert.deepEqual(refused.left, [], 'left in its temporary folder');
      assert.deepEqual(readdirSync(linked.parent), ['TheReactomeBook']);
      assert.equal(readlinkSync(linked.out), to);
    }
  });

  test('--report: an existing one refused untouched, its folder made, or refused before the run if it cannot be', async () => {
    let opened = 0;
    const counting = (settings: GraphSettings, options?: GraphOptions): Graph => {
      opened += 1;
      return openGraph(settings, options);
    };
    // an earlier run's report is never replaced, and nothing else is done
    const existing = place();
    writeFileSync(existing.report, 'an earlier report');
    const refused = await book(existing.args, { open: counting });
    assert.equal(refused.code, 2);
    assert.match(refused.err, /--report must not exist/);
    assert.equal(readFileSync(existing.report, 'utf8'), 'an earlier report');
    assert.deepEqual(refused.left, [], 'left in its temporary folder');
    // one inside --out: refused before its folder (--out itself) is made
    const inside = place();
    const within = join(inside.out, 'reports', 'report.json');
    const insideRun = await book([...inside.args.slice(0, -1), within], { open: counting });
    assert.equal(insideRun.code, 2);
    assert.match(insideRun.err, /is inside --out/);
    assert.deepEqual(insideRun.left, [], 'left in its temporary folder');
    assert.deepEqual(readdirSync(inside.parent), []);
    // a folder that cannot be made (a file in its way): refused before the graph is read
    const blocked = place();
    const file = join(scratch(), 'a file');
    writeFileSync(file, '');
    const args = [...blocked.args.slice(0, -1), join(file, 'report.json')];
    const unmade = await book(args, { open: counting });
    assert.equal(unmade.code, 2);
    assert.match(unmade.err, /its folder cannot be written/);
    assert.deepEqual(unmade.left, [], 'left in its temporary folder');
    assert.equal(opened, 0);
    assert.deepEqual(readdirSync(blocked.parent), []);
    // a folder not there yet is made, and the report written in it
    const nested = place();
    const report = join(scratch(), 'not', 'yet', 'report.json');
    mkdirSync(nested.out);
    writeFileSync(join(nested.out, 'old.pdf'), '');
    const made = await book([...nested.args.slice(0, -1), report]);
    assert.equal(made.code, 2);
    assert.deepEqual(made.left, [], 'left in its temporary folder');
    assert.equal(readReport(report).outcome, 'error');
  });

  test('exit 2 on bad arguments, and on the graph unreachable at the start', async () => {
    const figures = folder();
    const { parent, args } = place(figures);
    const bad = [
      [...args, '--render', stub.url],
      args.filter((_, i) => i !== 2 && i !== 3),
      [...args, '--parallel', '0'],
      [...args, '--parallel', '2', '--joins', '3'],
      [...args, '--joins', 'one'],
      [...args, '--out', 'twice'],
    ];
    for (const given of bad) assert.equal((await book(given)).code, 2, given.join(' '));
    // no site, and no graph
    assert.equal((await book(args.filter((_, i) => i !== 4 && i !== 5))).code, 2);
    assert.equal((await book(args, {}, {})).code, 2);
    // an address that cannot be parsed (never one that could reach another database), and a
    // graph whose reads fail, each with a report of its own (a report is never replaced)
    const unparsable = await book(place(figures).args, {}, { NEO4J_URI: '127.0.0.1:17700' });
    assert.equal(unparsable.code, 2);
    assert.match(unparsable.err, /the graph cannot be read/);
    const failing = (): Graph => ({
      read: () => Promise.reject(new Error('the planted failure')),
      close: () => Promise.resolve(),
    });
    const unreachable = await book(place(figures).args, { open: failing });
    assert.equal(unreachable.code, 2);
    assert.deepEqual(unreachable.left, []);
    assert.match(unreachable.err, /the graph cannot be read: the planted failure/);
    assert.deepEqual(readdirSync(parent), []);
  });

  test("the run report counts FR-017's substitutions in the finished book, by code point", async () => {
    // a summation printed once (Alpha's), a reaction's name printed in its heading and its
    // contents entry (Reaction eight's), a label in its figure, drawn once, and a top-level
    // pathway's name (Alpha's), printed on its cover, in its heading, its contents entry and
    // the locations of the full sections beneath it, but neither in the short entries'
    // locations, which are not printed (Two-parent sub's later place), nor in the headers
    // stamped on its pages; and a label in beta's own figure, drawn on its cover and in its
    // section, counted twice
    const plants: [string, string][] = [
      ['A placeholder summation', 'A placeholder \uFB01summation'],
      ['Reaction eight', 'Reaction\u2011eight'],
      ['Alpha pathway', 'Alpha\u05F3pathway'],
    ];
    const figures = folder((stId, svg) =>
      stId === 'R-HSA-90000132' || stId === 'R-HSA-90000100'
        ? svg.replace(/(<text\b[^>]*>)/, '$1\u02D9')
        : svg
    );
    const { out, report, args } = place(figures);
    const run = await book([...args, '--parallel', '1'], { open: planting(plants) });
    assert.deepEqual(run.left, [], 'left in its temporary folder');
    assert.equal(run.code, 0, run.err);
    // the file named for the name as the graph has it
    assert.deepEqual(readdirSync(out).sort(), [
      'Alpha\u05F3pathway.pdf',
      'Gamma pathway.pdf',
      'beta pathway.pdf',
    ]);
    const text = new Map<string, string>();
    for (const file of readdirSync(out))
      text.set(file, (await bodyText(join(out, file))).join('\n'));
    const all = [...text.values()].join('\n');
    // the prime replacing U+05F3, as printed outside the stamps
    const primes = occurrences(all, '\u2032');
    assert.ok(primes >= 4, `${String(primes)} primes printed`);
    assert.equal(occurrences(all, 'Alpha\u2032pathway'), primes);
    assert.equal(occurrences(all, '\u05F3'), 0);
    assert.equal(occurrences(all, 'Reaction-eight'), 2);
    assert.equal(occurrences(all, 'A placeholder fisummation'), 1);
    assert.deepEqual(readReport(report).characters, {
      replaced: { 'U+02D9': 3, 'U+05F3': primes, 'U+2011': 2, 'U+FB01': 1 },
      uncovered: [],
    });
  });

  test("a character off the list in a later part's figure: exit 1 after earlier parts are printed, and nothing left", async () => {
    // a backstop for a folder changed by hand, which `figures` would have refused
    const figures = folder((stId, svg) =>
      stId === 'R-HSA-90000132' ? svg.replace(/(<text\b[^>]*>)/, '$1\uE000') : svg
    );
    const { parent, report, args } = place(figures);
    const printed: string[] = [];
    const run = await book([...args, '--parallel', '1'], {
      threshold: 1,
      startPrinter: counting(printed),
    });
    assert.equal(run.code, 1, run.err);
    assert.equal(run.out, 'fault uncovered-character U+E000 R-HSA-90000132\n');
    assert.ok(printed.length >= 3, `${String(printed.length)} parts printed before it`);
    // and its own part never printed
    assert.ok(!printed.some((html) => html.includes('id="s-R-HSA-90000132"')));
    assert.deepEqual(readdirSync(parent), []);
    // nor the printer's pages, nor Chromium's profile, in the run's temporary folder
    assert.deepEqual(run.left, []);
    const written = readReport(report);
    assert.equal(written.outcome, 'faults');
    assert.deepEqual(written.characters.uncovered, ['U+E000 R-HSA-90000132']);
    assert.deepEqual(written.pdfs, []);
  });

  test('a PDF refused after its join is discarded, and the run fails whole', async () => {
    // a name that leaves no header to stamp (white space and a joiner): the preflight passes
    // it, and stamping refuses its PDF after its links and outline are done
    const { parent, report, args } = place();
    const run = await book([...args, '--parallel', '1'], {
      open: planting([['Gamma pathway', ' \u200D ']]),
    });
    assert.equal(run.code, 2);
    assert.match(run.err, /leaves no header to stamp/);
    assert.deepEqual(run.left, [], 'left in its temporary folder');
    assert.equal(run.out, '');
    assert.deepEqual(readdirSync(parent), []);
    assert.equal(readReport(report).outcome, 'error');
    assert.ok(!existsSync(join(parent, 'TheReactomeBook')));
  });
  // a run stopped by a signal, as the browser launches and after a part has printed: one
  // test each, so each has the suite's time for a test, and a failure names its moment

  // in the folder, or in a folder of its (the run's private temporary folder)
  const begun = (dir: string, prefix: string): boolean =>
    readdirSync(dir, { withFileTypes: true }).some(
      (entry) =>
        entry.name.startsWith(prefix) ||
        (entry.isDirectory() &&
          readdirSync(join(dir, entry.name)).some((name) => name.startsWith(prefix)))
    );
  /**
   * Whether a process's children can be read (CONFIG_PROC_CHILDREN): without it, `spawned` is
   * never true, and its tests fail at once rather than at their deadline.
   */
  const childrenReadable = existsSync(
    `/proc/${String(process.pid)}/task/${String(process.pid)}/children`
  );
  /** Whether the run's browser has been spawned: a child of its process (Linux's /proc). */
  const spawned = ({ pid }: { pid: number }) => {
    let children: string[];
    try {
      children = readFileSync(`/proc/${String(pid)}/task/${String(pid)}/children`, 'utf8')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    } catch {
      return false;
    }
    return children.some((child) => {
      try {
        return /chrom|headless/i.test(readFileSync(`/proc/${child}/comm`, 'utf8'));
      } catch {
        return false;
      }
    });
  };
  type Moment = (run: { parent: string; temporary: string; pid: number }) => boolean;
  const moments: Record<string, Moment> = {
    // the printer's pages' folder, made just before the browser is launched
    'as the launch begins': ({ temporary }) => begun(temporary, 'pdf-export-'),
    // the launcher's folders, made before it has registered them for removal
    'as the browser launches': ({ temporary }) => begun(temporary, 'playwright-artifacts-'),
    'as its profile is made': ({ temporary }) =>
      begun(temporary, 'playwright_chromiumdev_profile-'),
    // a PDF written into the book's folder, its parts printed
    'after a part has printed': ({ parent }) =>
      readdirSync(parent).some(
        (name) =>
          name.startsWith('.TheReactomeBook-') &&
          readdirSync(join(parent, name)).some((file) => file.endsWith('.pdf'))
      ),
  };
  const cases: [string, Moment, NodeJS.Signals[]][] = [
    ...Object.entries(moments).map(([moment, ready]): [string, Moment, NodeJS.Signals[]] => [
      moment,
      ready,
      ['SIGTERM'],
    ]),
    // SIGINT once the browser is spawned, which the browser launcher's own handler would
    // take, closing the browser and exiting itself (130) before the run's handler, and
    // two at once, the second stopping the run while the launch is held
    ...[1, 2, 3].map((n): [string, Moment, NodeJS.Signals[]] => [
      `as the browser is spawned (${String(n)})`,
      spawned,
      ['SIGINT'],
    ]),
    ...[1, 2, 3].map((n): [string, Moment, NodeJS.Signals[]] => [
      `twice as the launcher's artifacts' folder appears (${String(n)})`,
      moments['as the browser launches'] ?? (() => false),
      ['SIGINT', 'SIGINT'],
    ]),
    ...[1, 2, 3].map((n): [string, Moment, NodeJS.Signals[]] => [
      `twice as the browser is spawned (${String(n)})`,
      spawned,
      ['SIGINT', 'SIGINT'],
    ]),
  ];
  for (const [moment, ready, sent] of cases) {
    test(`a run stopped by ${sent.join(' and ')} ${moment}: exit 128 and its number, its report written, nothing left`, async () => {
      assert.ok(
        ready !== spawned || childrenReadable,
        "a process's children cannot be read (/proc/<pid>/task/<pid>/children)"
      );
      const run = await signalled(ready, sent);
      const [first = 'SIGTERM'] = sent;
      const code = 128 + osConstants.signals[first];
      assert.deepEqual([run.code, run.signal], [code, null]);
      assert.deepEqual(run.parent, []);
      assert.deepEqual(run.temporary, []);
      assert.equal(run.report?.outcome, 'error');
      assert.equal(run.report.error, `stopped by ${first}`);
    });
  }

  test('a second signal stops a run whose browser never finishes launching', async () => {
    // a child that runs `book` with a printer whose launch never ends, as a hung browser's
    // would: the first signal is held for the launch, the second stops the run at once
    const { parent, report, args } = place();
    const dir = scratch();
    const marker = join(dir, 'launching');
    const script = join(dir, 'hung.ts');
    writeFileSync(
      script,
      [
        `import { writeFileSync } from 'node:fs';`,
        `import { bookCommand } from ${JSON.stringify(new URL('../../src/book/command.ts', import.meta.url).href)};`,
        `process.exitCode = await bookCommand(${JSON.stringify(args)}, process.env, {`,
        `  out: (text) => process.stdout.write(text),`,
        `  err: (text) => process.stderr.write(text),`,
        `  startPrinter: () => {`,
        `    writeFileSync(${JSON.stringify(marker)}, '');`,
        `    return new Promise(() => { setInterval(() => undefined, 1000); });`,
        `  },`,
        `});`,
      ].join('\n')
    );
    const child = spawn(process.execPath, [script], {
      env: { ...process.env, TMPDIR: scratch() },
      stdio: 'ignore',
    });
    const ended = new Promise<void>((resolve) =>
      child.once('exit', () => {
        resolve();
      })
    );
    const kill = setTimeout(() => child.kill('SIGKILL'), 60_000);
    try {
      while (!existsSync(marker)) {
        assert.ok(child.exitCode === null, 'the run ended before it launched');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      child.kill('SIGINT');
      // held: the run goes on waiting for its launch
      await new Promise((resolve) => setTimeout(resolve, 500));
      assert.equal(child.exitCode, null, 'the first signal was not held');
      const sent = Date.now();
      child.kill('SIGINT');
      const stopped = await Promise.race([
        ended.then(() => true),
        new Promise<boolean>((resolve) =>
          setTimeout(() => {
            resolve(false);
          }, 10_000)
        ),
      ]);
      assert.ok(stopped, 'the second signal did not stop the run');
      assert.ok(Date.now() - sent < 10_000);
    } finally {
      clearTimeout(kill);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    assert.deepEqual([child.exitCode, child.signalCode], [130, null]);
    assert.deepEqual(readdirSync(parent), []);
    assert.equal(readReport(report).error, 'stopped by SIGINT');
  });

  test('a run stopped by SIGTERM before its preflight ends writes its report too', async () => {
    // the report's folder is made at the start, the moment the run's handlers are set
    const { parent, args } = place();
    const report = join(scratch(), 'made', 'report.json');
    const temporary = scratch();
    const child = spawn(process.execPath, [CLI, 'book', ...args.slice(0, -1), report], {
      env: { ...process.env, TMPDIR: temporary },
      stdio: 'ignore',
    });
    const ended = new Promise<void>((resolve) =>
      child.once('exit', () => {
        resolve();
      })
    );
    const deadline = Date.now() + 60_000;
    while (!existsSync(dirname(report))) {
      assert.ok(Date.now() < deadline, 'the run never began');
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    child.kill('SIGTERM');
    await ended;
    assert.deepEqual([child.exitCode, child.signalCode], [143, null]);
    const written = readReport(report);
    assert.equal(written.outcome, 'error');
    assert.equal(written.error, 'stopped by SIGTERM');
    assert.deepEqual(written.pdfs, []);
    assert.deepEqual(readdirSync(parent), []);
    assert.deepEqual(readdirSync(temporary), []);
  });

  test("every text and label the book prints has FR-017's substitutions made", async () => {
    // a character planted in each field the layout prints from the graph, each to be printed
    // as its substitute and never as itself (U+05F3, as pdf.js reads a U+2011 printed back
    // as a hyphen, so a U+2011 left unsubstituted could not be told from one substituted): events before and after, inferred from,
    // diseases, compartments, edits; and a figure's label
    const plants: [string, string][] = [
      ['Shared reaction', 'Shared\u05F3reaction'],
      ['Black box two', 'Black box\u05F3two'],
      ['Mouse source', 'Mouse\u05F3source'],
      ['placeholder infectious disease', 'placeholder infectious\u05F3disease'],
      ['nucleoplasm', 'nucleo\u05F3plasm'],
      ['Placeholder08', 'Placeholder\u05F308'],
      // a reaction's type, and a reference's title, journal and chapter
      ['transition', 'trans\u05F3ition'],
      ['Placeholder web page', 'Placeholder web\u05F3page'],
      ['Placeholder Journal', 'Placeholder\u05F3Journal'],
      ['Placeholder chapter', 'Placeholder\u05F3chapter'],
    ];
    let label = '';
    const figures = folder((stId, svg) =>
      stId === 'R-HSA-90000132'
        ? svg.replace(/(<text\b[^>]*>)([^<]*)/, (_, tag: string, text: string) => {
            label = text.trim();
            return `${tag}\u02D9${text}`;
          })
        : svg
    );
    assert.ok(label.length > 0, 'no label to plant in');
    const { out, args } = place(figures);
    const run = await book([...args, '--parallel', '1'], { open: planting(plants) });
    assert.equal(run.code, 0, run.err);
    let all = '';
    for (const file of readdirSync(out)) {
      all += (await bodyText(join(out, file))).join('\n');
    }
    assert.equal(occurrences(all, '\u05F3'), 0, 'U+05F3 printed');
    assert.equal(occurrences(all, '\u02D9'), 0, 'U+02D9 printed');
    // each field: the followed and preceding reactions' lists, inferred from, diseases,
    // compartments and the edit history's names, beside their own headings
    for (const printed of [
      'Preceded by',
      'Followed by',
      'Inferred from',
      'Diseases',
      'Compartments',
      'Type',
      'Literature references',
    ]) {
      assert.ok(all.includes(printed), printed);
    }
    for (const printed of [
      'Shared\u2032reaction',
      'Black box\u2032two',
      'Mouse\u2032source',
      'infectious\u2032disease',
      'nucleo\u2032plasm',
      'Placeholder\u203208',
      'trans\u2032ition',
      'Placeholder web\u2032page',
      'Placeholder\u2032Journal',
      'Placeholder\u2032chapter',
      `\u2022${label}`,
    ]) {
      assert.ok(all.includes(printed), printed);
    }
  });

  test('a figure file removed while the book prints is a missing-file fault, nothing left', async () => {
    const figures = folder();
    const { parent, report, args } = place(figures);
    const printed: string[] = [];
    // removed once the first part is printed, Gamma's front part, whose cover drew Gamma's
    // figure, which its labels' check then passed: Gamma's section, and its cover's second
    // print, would draw it without its file
    const gone = ['R-HSA-90000300.svg'];
    const run = await book([...args, '--parallel', '1'], {
      threshold: 1,
      startPrinter: counting(printed, () => {
        if (printed.length === 1) for (const name of gone) unlinkSync(join(figures, name));
      }),
    });
    assert.equal(run.code, 1, run.err);
    assert.equal(run.out, 'fault missing-file R-HSA-90000300.svg\n');
    assert.deepEqual(run.left, [], 'left in its temporary folder');
    assert.deepEqual(readdirSync(parent), []);
    assert.equal(readReport(report).outcome, 'faults');
  });
  test("a fault FR-011's check finds: exit 1, its line, and no book", async () => {
    // a printer that drops Reaction eight's name from its heading, as a layout might
    const { parent, report, args } = place();
    const printed: string[] = [];
    const run = await book([...args, '--parallel', '2'], {
      startPrinter: async () => {
        const printer = await counting(printed)();
        return {
          part: (html) => printer.part(html.replace('>Reaction eight</a></h', '></a></h')),
          close: () => printer.close(),
        };
      },
    });
    assert.deepEqual(run.left, [], 'left in its temporary folder');
    assert.equal(run.code, 1, run.err);
    assert.equal(run.out, 'fault no-name "beta pathway.pdf" R-HSA-90000132\n');
    assert.deepEqual(readdirSync(parent), []);
    const written = readReport(report);
    assert.equal(written.outcome, 'faults');
    assert.deepEqual(written.faults, ['no-name "beta pathway.pdf" R-HSA-90000132']);
    assert.deepEqual(
      written.checks,
      CHECKS.map((check) => ({ check, faults: check === 'no-name' ? 1 : 0 }))
    );
  });

  test('a signal once the book is in place: the book written, exit 0, the signal in the report', async () => {
    const { parent, out, report, args } = place();
    class Exited extends Error {
      readonly code: number;
      constructor(code: number) {
        super(`exit ${String(code)}`);
        this.code = code;
      }
    }
    const before = process.listenerCount('SIGTERM');
    // sent as the run says the book is written, after it is moved into place
    const run = book(args, {
      err: (text) => {
        if (text.startsWith('The book: ')) process.emit('SIGTERM', 'SIGTERM');
      },
      exit: (code) => {
        throw new Exited(code);
      },
    });
    const exited = await run.then(
      () => null,
      (error: unknown) => error
    );
    assert.ok(exited instanceof Exited, `not stopped by the signal: ${String(exited)}`);
    assert.equal(exited.code, 0);
    assert.equal(process.listenerCount('SIGTERM'), before, 'its handlers left set');
    assert.deepEqual(readdirSync(parent), ['TheReactomeBook']);
    assert.deepEqual(readdirSync(out).sort(), BOOK);
    const written = readReport(report);
    assert.equal(written.outcome, 'written');
    assert.equal(written.signal, 'SIGTERM');
    assert.equal(written.error, null);
    assert.equal(written.pdfs.length, 3);
    assert.deepEqual(
      written.checks,
      CHECKS.map((check) => ({ check, faults: 0 }))
    );
  });

  test('an exception escaping the run still removes its temporary folder and handlers', async () => {
    // a graph whose close fails, and an `err` that throws on being told so: the exception
    // escapes between the run's start and its end
    const { args } = place();
    const temporary = scratch();
    const was = process.env['TMPDIR'];
    process.env['TMPDIR'] = temporary;
    const before = process.listenerCount('SIGTERM');
    try {
      await assert.rejects(
        bookCommand(
          args,
          { NEO4J_URI: process.env['NEO4J_URI'] },
          {
            out: () => undefined,
            err: (text) => {
              if (text.includes('did not close')) throw new Error('err failed');
            },
            open: (settings, options) => {
              const graph = openGraph(settings, options);
              return {
                read: (query, params, readOptions) => graph.read(query, params, readOptions),
                close: async () => {
                  await graph.close();
                  throw new Error('close failed');
                },
              };
            },
          }
        ),
        /err failed/
      );
      assert.equal(process.env['TMPDIR'], temporary, 'TMPDIR not restored');
    } finally {
      if (was === undefined) delete process.env['TMPDIR'];
      else process.env['TMPDIR'] = was;
    }
    assert.deepEqual(readdirSync(temporary), [], 'left in its temporary folder');
    assert.equal(process.listenerCount('SIGTERM'), before, 'its handlers left set');
  });
  test('nothing overflows the text column: a wide table and a long unbroken token print every part at full size', async () => {
    // release 98 has 28 human summations holding a table: one of four columns of long words
    // (as wide as such a table is), and a token of 140 characters unbroken, in a summation
    // and in a name, were wider than the text column, and Chromium shrank the whole part to
    // fit them (#160's review)
    const words = ['Phosphofructokinase', 'Glyceraldehydes', 'Triosephosphate', 'Dihydroxyacetone'];
    const row = (cells: string[]) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
    const table = `<table>${row(words)}${row([...words].reverse())}</table>`;
    const token = 'X'.repeat(140);
    const plants: [string, string][] = [
      // the token in a table's cell too, where only its places to break let the column narrow
      [
        'A third placeholder summation, first by order.',
        `<p>${token}</p>${table.replace('</table>', `${row(['Token', token])}</table>`)}`,
      ],
      ['Reaction eight', `Reaction eight ${token}`],
    ];
    const { out, args } = place();
    const run = await book([...args, '--parallel', '1'], { open: planting(plants), threshold: 1 });
    assert.deepEqual(run.left, [], 'left in its temporary folder');
    assert.equal(run.code, 0, run.err + run.out);
    // every section's body text at 10.5 pt, and its headings at 12, 16.5 and 18
    const sizes = { label: new Set<number>(), headings: new Set<number>() };
    const headings = new Set(['Reaction one', 'Shared reaction', 'beta sub sub', 'Alpha pathway']);
    for (const file of readdirSync(out)) {
      await reading(join(out, file), async (doc) => {
        for (let i = 1; i <= doc.numPages; i++) {
          for (const item of (await (await doc.getPage(i)).getTextContent()).items) {
            if (!('str' in item)) continue;
            const t = item.transform as number[];
            const size = Math.round(Math.hypot(t[2] ?? 0, t[3] ?? 0) * 100) / 100;
            if (item.str === 'Stable identifier') sizes.label.add(size);
            // a heading: at the text column's left edge, past the cover, set above the body
            // (not the same name in a contents entry, a location or a figure's label)
            const left = Math.abs((t[4] ?? 0) - PAGE.margin) < 2;
            if (i > 1 && left && headings.has(item.str) && size > 10.5) sizes.headings.add(size);
          }
        }
      });
    }
    assert.deepEqual([...sizes.label], [10.5]);
    assert.deepEqual([...sizes.headings].sort(), [12, 16.5, 18]);
  });
  test("a part Chromium printed scaled down still reads its sections' names", async () => {
    // a block wider than the text column planted in every part printed, as the layout's
    // overflow once did: Chromium prints each part scaled down whole, its text below the
    // theme's sizes, and the check reads each heading against its page's body text
    const { out, args } = place();
    const run = await book([...args, '--parallel', '2'], {
      startPrinter: async () => {
        const printer = await counting([])();
        return {
          part: (html) =>
            printer.part(
              html.replace('</body>', '<div style="width: 800px; height: 1px"></div></body>')
            ),
          close: () => printer.close(),
        };
      },
    });
    assert.deepEqual(run.left, [], 'left in its temporary folder');
    assert.equal(run.code, 0, run.err + run.out);
    // and it was scaled down: the label every section prints is below the body's 10.5 pt
    const labels = new Set<number>();
    for (const file of readdirSync(out)) {
      await reading(join(out, file), async (doc) => {
        for (let i = 1; i <= doc.numPages; i++) {
          for (const item of (await (await doc.getPage(i)).getTextContent()).items) {
            if (!('str' in item) || item.str !== 'Stable identifier') continue;
            const t = item.transform as number[];
            labels.add(Math.round(Math.hypot(t[2] ?? 0, t[3] ?? 0) * 100) / 100);
          }
        }
      });
    }
    assert.ok(labels.size > 0 && [...labels].every((size) => size < 10), [...labels].join(' '));
  });

  test('a name holding characters never drawn reads as printed', async () => {
    // a soft hyphen, a joiner, a variation selector and a control: the preflight lets them
    // through (FR-017's NEVER_DRAWN), the book prints none of them, and the check reads the
    // name without them
    const plants: [string, string][] = [
      ['Reaction eight', 'Reac\u00ADtion\u200D eight\uFE0F\u0007'],
    ];
    const run = await book([...place().args, '--parallel', '2'], { open: planting(plants) });
    assert.deepEqual(run.left, [], 'left in its temporary folder');
    assert.equal(run.code, 0, run.err + run.out);
  });
  test("a figure of many small labels on a heading's page does not set the page's body size", async () => {
    // Alpha pathway's diagram given 300 labels at 8 px: on its page, most characters are the
    // figure's, so a heading read against the page's commonest size took the facts in
    const labels = Array.from(
      { length: 300 },
      (_, i) =>
        `<text x="${String(10 + (i % 20) * 25)}" y="${String(10 + Math.floor(i / 20) * 10)}" style="font: normal 400 8px Roboto">label number ${String(i)}</text>`
    ).join('');
    const figures = folder((stId, svg) =>
      stId === 'R-HSA-90000200' ? svg.replace('</g></svg>', `${labels}</g></svg>`) : svg
    );
    const run = await book([...place(figures).args, '--parallel', '2']);
    assert.deepEqual(run.left, [], 'left in its temporary folder');
    assert.equal(run.code, 0, run.err + run.out);
  });

  test("a table's short columns keep their words whole beside a long one", async () => {
    // an edit's names, 30 of them, beside its date and action; a summation's table of a
    // name beside a column of prose: the short columns' words are never broken
    const names = Array.from({ length: 30 }, (_, i) => `Placeholder${String(i + 10)}, P.`).join(
      '; '
    );
    const prose =
      'catalyses the transfer of a phosphate group in a step of the pathway that is described here at length '.repeat(
        3
      );
    const rows = Array.from(
      { length: 4 },
      () => `<tr><td>Phosphofructokinase</td><td>${prose}</td></tr>`
    ).join('');
    const plants: [string, string][] = [
      ['Placeholder09, P.', names],
      ['A third placeholder summation, first by order.', `<table>${rows}</table>`],
    ];
    const { out, args } = place();
    const run = await book([...args, '--parallel', '2'], { open: planting(plants) });
    assert.deepEqual(run.left, [], 'left in its temporary folder');
    assert.equal(run.code, 0, run.err + run.out);
    const pieces: string[] = [];
    for (const file of readdirSync(out)) {
      await reading(join(out, file), async (doc) => {
        for (let i = 1; i <= doc.numPages; i++) {
          for (const item of (await (await doc.getPage(i)).getTextContent()).items) {
            if ('str' in item && item.str.trim() !== '') pieces.push(item.str.trim());
          }
        }
      });
    }
    // the edit history's header and dates, and the summation's names, each whole
    assert.ok(pieces.includes('Date') && pieces.includes('Action'), 'no whole header');
    assert.deepEqual(
      pieces.filter((p) => /^(Da|Dat|te|Ac|Act|ion|tion)$/.test(p)),
      []
    );
    const dates = pieces.filter((p) => p.startsWith('20') && p.includes('-'));
    assert.ok(dates.length > 0);
    for (const date of dates) assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(pieces.filter((p) => p === 'Phosphofructokinase').length, 4);
    assert.deepEqual(
      pieces.filter((p) => p !== 'Phosphofructokinase' && p.startsWith('Phospho')),
      []
    );
  });
});
