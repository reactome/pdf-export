// `pdf-export book` end to end (spec 001 T029, contracts/cli.md) on the fixture's graph and
// release files, with a figures' folder each test writes itself (as T024's tests do; T046
// writes the real one): the book written whole, one PDF per top-level pathway, or nothing
// written at all; its exit codes; no render service asked; and the run report's characters.
// Characters and names are planted in what the graph answers, through a graph that rewrites
// its rows, so the shared fixture is unchanged.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
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
import { after, before, describe, test } from 'node:test';

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

import { bookCommand, type BookIo, type RunReport } from '../../src/book/command.ts';
import {
  graphSettings,
  openGraph,
  type Graph,
  type GraphOptions,
  type GraphSettings,
} from '../../src/graph/connection.ts';
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
    // provisional until check-book (T030) checks the book
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
    rmSync(out, { recursive: true });
    writeFileSync(out, 'a file');
    assert.equal((await book(args)).code, 2);
    assert.deepEqual(readdirSync(parent), ['TheReactomeBook']);
    assert.equal(readFileSync(out, 'utf8'), 'a file');
  });

  test('exit 2 on bad arguments, and on the graph unreachable at the start', async () => {
    const { parent, args } = place();
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
    // graph whose reads fail
    const unparsable = await book(args, {}, { NEO4J_URI: '127.0.0.1:17700' });
    assert.equal(unparsable.code, 2);
    assert.match(unparsable.err, /the graph cannot be read/);
    const failing = (): Graph => ({
      read: () => Promise.reject(new Error('the planted failure')),
      close: () => Promise.resolve(),
    });
    const unreachable = await book(args, { open: failing });
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
    let printed = 0;
    const run = await book([...args, '--parallel', '1'], {
      threshold: 1,
      startPrinter: async () => {
        const printer = await Printer.start();
        return {
          part: async (html) => {
            const pdf = await printer.part(html);
            printed += 1;
            return pdf;
          },
          close: () => printer.close(),
        };
      },
    });
    assert.equal(run.code, 1, run.err);
    assert.equal(run.out, 'fault uncovered-character U+E000 R-HSA-90000132\n');
    assert.ok(printed >= 3, `${String(printed)} parts printed before it`);
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
  test('a run stopped by a signal while printing leaves no folder, temporary or not', async () => {
    const { parent, args } = place();
    const temporary = scratch();
    const child = spawn(process.execPath, [CLI, 'book', ...args, '--parallel', '1'], {
      env: { ...process.env, TMPDIR: temporary },
      stdio: 'ignore',
    });
    const ended = new Promise<number | null>((resolve) => child.once('exit', resolve));
    try {
      // stopped once its folder is there, beside the book's name, while it prints
      const deadline = Date.now() + 60_000;
      while (!readdirSync(parent).some((name) => name.startsWith('.TheReactomeBook-'))) {
        assert.ok(Date.now() < deadline, 'the run never began printing');
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      child.kill('SIGTERM');
      const stop = setTimeout(() => child.kill('SIGKILL'), 30_000);
      await ended;
      clearTimeout(stop);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    assert.notEqual(child.exitCode, 0);
    assert.deepEqual(readdirSync(parent), []);
    assert.deepEqual(readdirSync(temporary), []);
  });
});
