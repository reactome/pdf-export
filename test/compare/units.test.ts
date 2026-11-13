// FR-012's comparison's parts that need no browser (spec 001 T035, from #165's review): the
// one printer every reported value passes through, tried with names planted everywhere in
// random layouts; the sections' order by their longest common subsequence; the constants a
// layout is read by, pinned; and the reduction's time on a large book. Layouts here are
// built directly, as pdf.js's reading would give them.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  applyRecorded,
  commonSubsequence,
  compareCommand,
  compareReduced,
  errorKind,
  withConsoleHeld,
} from '../../src/compare/compare.ts';
import {
  Output,
  SPECIES,
  ANALYSIS_TYPES,
  RESOURCES,
  type Difference,
} from '../../src/compare/output.ts';
import {
  figureBoxes,
  readLayout,
  type Box,
  type Shape,
  type Layout,
  type Line,
  type Link,
} from '../../src/compare/read.ts';
import { hash, reduce, type Reduced, type ReducedSection } from '../../src/compare/reduce.ts';
import { CONTRIBUTORS } from '../../src/layout/text.ts';
import { PLANTED, plantedFilter, plantedOperator } from './planted.ts';
import { PEOPLE } from './samples.ts';

/** Placeholder names, and more of them, to plant. */
const NAMES = [...PEOPLE, 'Quixote, Zebulon', 'Marchbanks, Ottoline', 'Fairweather, Ignatius'];
const NAME_PARTS = NAMES.flatMap((name) => name.split(/[\s,]+/)).filter((w) => w.length > 2);

/** Every string a report holds, at any depth. */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const item of value) strings(item, out);
  else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      out.push(key);
      strings(item, out);
    }
  }
  return out;
}

/** The strings a printed difference may hold: its keys, names of its own, and the shapes. */
const ALLOWED = new Set<string>([
  ...['file', 'part', 'field', 'kind', 'count', 'events', 'reference', 'new', 'recorded'],
  ...['hash', 'length', 'value', 'same', 'differs', 'yes', 'no'],
  ...['cover', 'introduction', 'analysis', 'sections', 'section', 'figure', 'contents'],
  ...['short-entries', 'title', 'diagram', 'excerpt', 'names', 'release', 'pathways'],
  ...['reactions', 'token', 'type', 'species', 'projection', 'interactors'],
  ...['identifiersFound', 'identifiersTotal', 'resource', 'missing', 'extra', 'text'],
  ...['order', 'target', 'missing-target', 'unreadable', 'name', 'location', 'stId'],
  ...['compartments', 'diseases', 'inferredFrom', 'summation', 'before', 'after'],
  ...['references', 'edits', 'entities', 'value'],
  ...SPECIES,
  ...ANALYSIS_TYPES,
  ...RESOURCES,
]);

/** Fails, naming only where, if any string is neither allowed nor of an allowed shape. */
function assertPrintable(printed: unknown, files: readonly string[], token: string): void {
  for (const text of strings(printed)) {
    const ok =
      ALLOWED.has(text) ||
      files.includes(text) ||
      text === token ||
      /^R-[A-Z]{3}-\d+$/.test(text) ||
      /^[0-9a-f]{16}$/.test(text);
    assert.ok(ok, 'a string of no allowed shape was printed');
    for (const part of NAME_PARTS) assert.ok(!text.includes(part), 'a name was printed');
  }
}

/** A seeded random number source (mulberry32), so a failure can be run again. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TOKEN = 'MjAyNjExMDQxMjAwMDBfMQ%3D%3D';

/** What a line may begin with: every label the reducer reads, and others. */
const LEADS = [
  'Stable identifier R-HSA-1234',
  'Stable Identifier: R-HSA-77',
  'Identifier: R-HSA-5',
  'Location',
  'Type',
  'Type:',
  'Species',
  'Species:',
  'Token',
  'Token:',
  'Analysis type',
  'Projection:',
  'Projected to human',
  'Interactors included',
  'Identifiers found',
  'Pathways hit',
  'Resource:',
  'Compartments',
  'Diseases',
  'Inferred from',
  'Preceded by',
  'Followed by',
  'Literature references',
  'Edit history',
  'Entities found',
  'Introduction',
  'Analysis properties',
  'Contents',
  'Table of contents',
  'Authors',
  CONTRIBUTORS,
  'Release 98. It holds 3 pathways and 4 reactions.',
  '1.',
  '2020-01-01',
  'This document is an excerpt',
  '',
];

/** A random layout: names planted after every kind of lead, at every size, everywhere. */
function plantedLayout(next: () => number): Layout {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)] as T;
  const pages = 1 + Math.floor(next() * 5);
  const lines: Line[] = [];
  const links: Link[] = [];
  const figures: Box[] = [];
  for (let page = 0; page < pages; page++) {
    let y = 780;
    while (y > 60) {
      const size = pick([9, 10.5, 10.5, 10.5, 12, 14, 16, 18, 24, 28]);
      const lead = pick(LEADS);
      const tail = pick([
        pick(NAMES),
        `${pick(NAMES)}; ${pick(NAMES)}`,
        `R-HSA-${String(Math.floor(next() * 99))}`,
        TOKEN,
        '12',
        'yes',
        `${pick(NAMES)} 4`,
      ]);
      const text = next() < 0.2 ? Array.from(tail).join('\u2060') : `${lead} ${tail}`;
      lines.push({ page, y, x: 57 + Math.floor(next() * 3) * 12, size, text });
      if (next() < 0.15) {
        links.push({
          box: { page, x1: 57, y1: y - 2, x2: 300, y2: y + size },
          uri: null,
          landing: { page: Math.floor(next() * pages), y: 300 + next() * 500 },
        });
      }
      if (next() < 0.05) {
        figures.push({ page, x1: 100, y1: y - 120, x2: 400, y2: y - 10 });
        y -= 120;
      }
      y -= size + 4 + next() * 10;
    }
  }
  return {
    pages: Array.from({ length: pages }, () => ({ width: 595, height: 842 })),
    lines,
    links,
    figures,
  };
}

describe('what compare prints', () => {
  test('only values of their shapes: anything else as a hash and a length', () => {
    const output = new Output('fixed');
    assert.equal(output.value('analysis species', 'Homosapiens'), 'Homo sapiens');
    assert.equal(output.value('analysis type', 'overrepresentation'), 'OVERREPRESENTATION');
    assert.equal(output.value('analysis token', TOKEN), TOKEN);
    assert.equal(output.value('introduction release', 98), 98);
    assert.equal(output.value('analysis projection', true), 'yes');
    assert.equal(output.value('cover title', 'differs'), 'differs');
    for (const [key, value] of [
      ['analysis species', 'Placeholder, A'],
      ['analysis token', 'Placeholder'],
      ['analysis type', 'Type Example, B'],
      ['cover title', 'Sample, C D'],
      ['introduction release', 'Dummy'],
      ['analysis pathways', '4 Dummy'],
      ['section summation', 'Example'],
      ['no such field', 'Example'],
    ] as const) {
      const printed = output.value(key, value);
      assert.deepEqual(Object.keys(printed as object), ['hash', 'length'], key);
      assertPrintable(printed, [], TOKEN);
    }
    // a hash the reduction made is salted: equal values stay equal within a run, and the
    // printed hash is not the hash of the name
    const names = { count: 2, hash: hash('Placeholder,A') };
    const a = new Output('one').value('cover names', names) as { hash: string };
    const b = new Output('two').value('cover names', names) as { hash: string };
    assert.notEqual(a.hash, b.hash);
    assert.notEqual(a.hash, names.hash);
    assert.deepEqual(new Output('one').value('cover names', names), a);
    // a difference's own fields are checked too
    const d = new Output('x').difference({
      file: 'f.pdf',
      part: 'Dummy, E',
      field: 'Placeholder',
      kind: 'Sample',
      count: 1,
      events: ['R-HSA-1', 'Example, B'],
    } as unknown as Difference);
    assertPrintable(d, ['f.pdf'], TOKEN);
  });

  test('names planted everywhere in both sides, in random layouts: none is printed', () => {
    const output = new Output('fuzz');
    for (let seed = 1; seed <= 300; seed++) {
      const next = random(seed);
      const ref = reduce(plantedLayout(next));
      const neu = reduce(plantedLayout(next));
      const printed = compareReduced('fuzz.pdf', ref, neu).map((d) => output.difference(d));
      assertPrintable(printed, ['fuzz.pdf'], TOKEN);
    }
  });
});

/** A reduced PDF of these sections, each its stable identifier and a text. */
function sections(...ids: (string | [string, string])[]): Reduced {
  const list: ReducedSection[] = ids.map((id) => {
    const [stId, text] = typeof id === 'string' ? [id, 'text'] : id;
    return { stId, figure: 'none', parts: [{ part: 'summation', items: [text] }] };
  });
  return {
    cover: {
      title: { hash: hash('t'), length: 1 },
      diagram: false,
      excerpt: false,
      names: { count: 0, hash: hash('') },
    },
    introduction: { release: 98, pathways: 1, reactions: 1 },
    analysis: null,
    sections: list,
    contents: null,
    shortEntries: 0,
  };
}

const brief = (d: Difference) =>
  [d.part, d.field, d.kind, ...(d.events ?? [])].filter((w) => w !== undefined).join(' ');

describe("the sections' order", () => {
  const [A, B, C, D, E] = ['R-HSA-1', 'R-HSA-2', 'R-HSA-3', 'R-HSA-4', 'R-HSA-5'] as const;

  test('a section written twice is missing once, and nothing is out of order', () => {
    const found = compareReduced('f', sections(A, B, A, C, D, E), sections(A, B, C, D, E));
    assert.deepEqual(found.map(brief), [`sections missing ${A}`]);
  });

  test('one section moved from first to last is the one out of order', () => {
    const found = compareReduced('f', sections(A, B, C, D, E), sections(B, C, D, E, A));
    assert.deepEqual(found.map(brief), [`sections order ${A}`]);
  });

  test('each occurrence of a section written twice is compared with its own', () => {
    const found = compareReduced(
      'f',
      sections([A, 'x'], B, [A, 'y']),
      sections([A, 'x'], B, [A, 'z'])
    );
    assert.deepEqual(found.map(brief), [`section summation text ${A}`]);
  });

  test('the longest common subsequence, with repeats', () => {
    const pairs = commonSubsequence(['a', 'b', 'a', 'c'], ['b', 'a', 'c', 'a']);
    assert.equal(pairs.length, 3);
    for (const [i, j] of pairs) assert.ok(i >= 0 && j >= 0);
    // strictly increasing on both sides
    pairs.reduce(([pi, pj], [i, j]) => {
      assert.ok(i > pi && j > pj);
      return [i, j];
    });
  });
});

describe('--expected', () => {
  test('a record naming events covers only those, never a difference that names none', () => {
    const difference: Difference = {
      file: 'f.pdf',
      part: 'section',
      field: 'summation',
      kind: 'text',
      count: 2,
      events: ['R-HSA-1', 'R-HSA-2'],
    };
    const split = applyRecorded(
      [difference],
      [{ part: 'section', kind: 'text', events: ['R-HSA-1'], reason: 'rewritten' }]
    );
    assert.deepEqual(
      split.differences.map((d) => [d.events, d.count, d.recorded]),
      [
        [['R-HSA-1'], 1, 'rewritten'],
        [['R-HSA-2'], 1, undefined],
      ]
    );
    const eventless: Difference = { file: 'f.pdf', part: 'contents', kind: 'order', count: 1 };
    const none = applyRecorded(
      [eventless],
      [{ part: 'contents', kind: 'order', events: ['R-HSA-1'], reason: 'x' }]
    );
    assert.equal(none.differences[0]?.recorded, undefined);
    assert.deepEqual(none.unmatched, [0]);
    // a record for another field covers nothing, and is reported as matching nothing
    const other = applyRecorded(
      [difference],
      [{ part: 'section', field: 'references', kind: 'text', reason: 'x' }]
    );
    assert.equal(other.differences[0]?.recorded, undefined);
    assert.deepEqual(other.unmatched, [0]);
  });
});

/** A book-like layout: a contents list of every section, then the sections. */
function book(count: number): Layout {
  const lines: Line[] = [];
  const links: Link[] = [];
  const figures: Box[] = [];
  const perPage = 60;
  const contentsPages = Math.ceil(count / perPage);
  lines.push({ page: 1, y: 790, x: 57, size: 18, text: 'Contents' });
  for (let n = 0; n < count; n++) {
    const page = 1 + Math.floor(n / perPage);
    const y = 770 - (n % perPage) * 12;
    lines.push({ page, y, x: 57, size: 10.5, text: `Event ${String(n)} ${String(n + 2)}` });
    const target = contentsPages + 1 + Math.floor(n / 4);
    const top = 780 - (n % 4) * 180;
    links.push({
      box: { page, x1: 57, y1: y - 2, x2: 400, y2: y + 10 },
      uri: null,
      landing: { page: target, y: top + 20 },
    });
  }
  for (let n = 0; n < count; n++) {
    const page = contentsPages + 1 + Math.floor(n / 4);
    const top = 780 - (n % 4) * 180;
    lines.push(
      { page, y: top, x: 57, size: 16, text: `Event ${String(n)}` },
      { page, y: top - 20, x: 57, size: 10.5, text: 'Location Parent' },
      { page, y: top - 34, x: 57, size: 10.5, text: `Stable identifier R-HSA-${String(n)}` },
      { page, y: top - 48, x: 57, size: 10.5, text: 'Compartments cytosol' },
      { page, y: top - 118, x: 57, size: 10.5, text: 'A summation, written for this test.' },
      { page, y: top - 126, x: 57, size: 10.5, text: 'Its second line.' },
      { page, y: top - 134, x: 57, size: 10.5, text: 'Literature references' }
    );
    // literature, each linked to its record, as a real section's is
    for (let r = 0; r < 4; r++) {
      const y = top - 142 - r * 9;
      lines.push({ page, y, x: 62, size: 10.5, text: `${String(r + 1)}. A reference.` });
      links.push({
        box: { page, x1: 62, y1: y - 2, x2: 300, y2: y + 8 },
        uri: `https://pubmed.example/${String(n * 4 + r)}`,
        landing: null,
      });
    }
    links.push({
      box: { page, x1: 57, y1: top - 2, x2: 300, y2: top + 16 },
      uri: `https://site.example/content/detail/R-HSA-${String(n)}`,
      landing: null,
    });
    figures.push({ page, x1: 100, y1: top - 115, x2: 400, y2: top - 55 });
  }
  lines.sort((a, b) => a.page - b.page || b.y - a.y);
  const pages = contentsPages + 1 + Math.ceil(count / 4);
  return {
    pages: Array.from({ length: pages }, () => ({ width: 595, height: 842 })),
    lines,
    links,
    figures,
  };
}

describe('the reduction at scale', () => {
  test('4,000 sections with a contents list of 4,000 entries reduce in seconds', () => {
    const layout = book(4000);
    const start = performance.now();
    const reduced = reduce(layout);
    const seconds = (performance.now() - start) / 1000;
    assert.equal(reduced.sections.length, 4000);
    assert.equal(reduced.contents?.length, 4000);
    assert.ok(reduced.contents.every((entry, n) => entry.target === `R-HSA-${String(n)}`));
    // #165's reduction took 31 s on this layout (and #165's review measured 115 s on its
    // own); about 1.3 s now
    assert.ok(seconds < 8, `${seconds.toFixed(1)} s`);
  });
});

describe('the constants a layout is read by', () => {
  /** A contents entry landing `above` points over a section's heading. */
  const landing = (above: number): string | null => {
    const layout: Layout = {
      pages: [0, 1, 2].map(() => ({ width: 595, height: 842 })),
      lines: [
        { page: 1, y: 790, x: 57, size: 18, text: 'Contents' },
        { page: 1, y: 770, x: 57, size: 10.5, text: 'Event 3' },
        { page: 2, y: 500, x: 57, size: 16, text: 'Event' },
        { page: 2, y: 480, x: 57, size: 10.5, text: 'Stable identifier R-HSA-1' },
        { page: 2, y: 460, x: 57, size: 10.5, text: 'A summation.' },
      ],
      links: [
        {
          box: { page: 1, x1: 57, y1: 768, x2: 300, y2: 780 },
          uri: null,
          landing: { page: 2, y: 500 + above },
        },
      ],
      figures: [],
    };
    return reduce(layout).contents?.[0]?.target ?? null;
  };

  test('LANDING_PT: a landing 76 pt above a heading is on it, one 160 pt above is not', () => {
    assert.equal(landing(76), 'R-HSA-1');
    assert.equal(landing(160), null);
  });

  test('FIGURE_MIN_PT: a 50 pt square is not a figure, a 70 pt one is', () => {
    const square = (side: number): Box => ({
      page: 0,
      x1: 100,
      y1: 100,
      x2: 100 + side,
      y2: 100 + side,
    });
    assert.equal(figureBoxes([square(50)], 595, 842).length, 0);
    assert.equal(figureBoxes([square(70)], 595, 842).length, 1);
  });

  test('FIGURE_GAP_PT: shapes 20 pt apart are one figure, 45 pt apart two', () => {
    const two = (gap: number): Box[] => [
      { page: 0, x1: 100, y1: 100, x2: 170, y2: 170 },
      { page: 0, x1: 170 + gap, y1: 100, x2: 240 + gap, y2: 170 },
    ];
    assert.equal(figureBoxes(two(20), 595, 842).length, 1);
    assert.equal(figureBoxes(two(45), 595, 842).length, 2);
  });
});

describe('what a library writes to the console', () => {
  /** What reaches the console and standard error while `run` runs, and what it returns. */
  async function captured<T>(run: () => Promise<T>): Promise<{ text: string; value: T }> {
    let text = '';
    const warn = Reflect.get(console, 'warn') as unknown;
    const log = Reflect.get(console, 'log') as unknown;
    const write = Reflect.get(process.stderr, 'write') as unknown;
    const keep = (...args: unknown[]) => {
      text += args.map(String).join(' ');
    };
    Reflect.set(console, 'warn', keep);
    Reflect.set(console, 'log', keep);
    Reflect.set(process.stderr, 'write', (chunk: unknown) => {
      text += String(chunk);
      return true;
    });
    try {
      const value = await run();
      return { text, value };
    } finally {
      Reflect.set(console, 'warn', warn);
      Reflect.set(console, 'log', log);
      Reflect.set(process.stderr, 'write', write);
    }
  }

  test('pdf.js reads a PDF quoting its content without a word: its warnings are off', async () => {
    const bytes = await plantedOperator();
    let said = '';
    const warn = Reflect.get(console, 'warn') as unknown;
    Reflect.set(console, 'warn', (...args: unknown[]) => {
      said += args.map(String).join(' ');
    });
    try {
      await readLayout(bytes);
    } finally {
      Reflect.set(console, 'warn', warn);
    }
    assert.ok(!said.includes(PLANTED), 'pdf.js printed the planted word');
  });

  test('compare prints none of it, on standard error or the console', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'pdf-export-console-'));
    try {
      const file = join(folder, 'planted.pdf');
      writeFileSync(file, await plantedOperator());
      let err = '';
      let out = '';
      const { text } = await captured(() =>
        compareCommand([file, file], { out: (t) => (out += t), err: (t) => (err += t) })
      );
      assert.ok(!(text + err + out).includes(PLANTED), 'the planted word was printed');
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  test("a file pdf.js throws on, quoting it, is named by its error's kind alone", async () => {
    const folder = mkdtempSync(join(tmpdir(), 'pdf-export-console-'));
    try {
      const file = join(folder, 'filtered.pdf');
      writeFileSync(file, await plantedFilter());
      let err = '';
      let out = '';
      const { text, value } = await captured(() =>
        compareCommand([file, file], { out: (t) => (out += t), err: (t) => (err += t) })
      );
      assert.equal(value, 1);
      assert.ok(!(text + err + out).includes(PLANTED), 'the planted word was printed');
      assert.match(err, /^Not read: .*filtered\.pdf \([A-Za-z]+\)\n/);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  /** The console's methods replaced by ones that keep what they are given, for `run`. */
  async function spied(run: (said: string[]) => Promise<void>): Promise<string[]> {
    const said: string[] = [];
    const names = Object.keys(console).filter((n) => typeof Reflect.get(console, n) === 'function');
    const saved = names.map((n) => [n, Reflect.get(console, n) as unknown] as const);
    for (const n of names) {
      Reflect.set(console, n, (...args: unknown[]) =>
        said.push(`${n}: ${args.map(String).join(' ')}`)
      );
    }
    try {
      await run(said);
    } finally {
      for (const [n, m] of saved) Reflect.set(console, n, m);
    }
    return said;
  }

  test('every console method is held, and the calls said in one line', async () => {
    let err = '';
    const said = await spied(() =>
      withConsoleHeld(
        () => {
          console.log(PLANTED);
          console.info(PLANTED);
          console.debug(PLANTED);
          console.dir({ name: PLANTED });
          console.table([PLANTED]);
          console.trace(PLANTED);
          console.warn(PLANTED);
          console.error(new TypeError(PLANTED));
          return Promise.resolve();
        },
        (t) => (err += t)
      )
    );
    assert.deepEqual(said, []);
    assert.equal(err, '8 message(s) from a library withheld (TypeError)\n');
  });

  test("each of the console's writing methods is held", async () => {
    // the list is the test's own, so a method dropped from the code's list fails here
    const writing = [
      'log',
      'info',
      'warn',
      'error',
      'debug',
      'trace',
      'dir',
      'dirxml',
      'table',
      'group',
      'groupCollapsed',
      'groupEnd',
      'count',
      'countReset',
      'time',
      'timeEnd',
      'timeLog',
      'assert',
    ];
    for (const name of writing) {
      let err = '';
      const said = await spied(() =>
        withConsoleHeld(
          () => {
            const method = Reflect.get(console, name) as (...args: unknown[]) => void;
            if (name === 'assert') method.call(console, false, PLANTED);
            else method.call(console, PLANTED);
            return Promise.resolve();
          },
          (t) => (err += t)
        )
      );
      assert.deepEqual(said, [], name);
      assert.ok(!err.includes(PLANTED), name);
    }
  });

  test("the console's members that do not write are left alone", async () => {
    const members = ['Console', 'context', 'createTask', 'profile', 'timeStamp'];
    const before = members.map((name) => Reflect.get(console, name) as unknown);
    let during: unknown[] = [];
    await withConsoleHeld(
      () => {
        during = members.map((name) => Reflect.get(console, name) as unknown);
        return Promise.resolve();
      },
      () => undefined
    );
    assert.deepEqual(during, before);
  });

  test('the console is put back when the comparison fails, and what was held still said', async () => {
    let err = '';
    let before: unknown;
    let after: unknown;
    const said = await spied(async () => {
      before = Reflect.get(console, 'warn');
      await assert.rejects(
        withConsoleHeld(
          () => {
            console.warn(PLANTED);
            return Promise.reject(new RangeError('stopped'));
          },
          (t) => (err += t)
        ),
        RangeError
      );
      after = Reflect.get(console, 'warn');
    });
    assert.equal(after, before);
    assert.deepEqual(said, []);
    assert.equal(err, '1 message(s) from a library withheld\n');
  });

  test('compare holds the console while it compares', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'pdf-export-console-'));
    try {
      const file = join(folder, 'unread.pdf');
      writeFileSync(file, 'not a PDF');
      let err = '';
      // a library writing to the console as the comparison runs: here, as a file is not read
      const said = await spied(async () => {
        await compareCommand([file, file], {
          out: () => undefined,
          err: (t) => {
            if (t.startsWith('Not read')) console.warn(PLANTED);
            err += t;
          },
        });
      });
      assert.deepEqual(said, []);
      assert.match(err, /^2 message\(s\) from a library withheld\n$/m);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  test("a library's console messages are held while compare runs: counted, kinds only", async () => {
    let err = '';
    const warn = Reflect.get(console, 'warn') as unknown;
    await withConsoleHeld(
      () => {
        console.warn(`Unknown command "${PLANTED}"`);
        console.error(new TypeError(`no ${PLANTED}`));
        return Promise.resolve();
      },
      (t) => (err += t)
    );
    assert.equal(err, '2 message(s) from a library withheld (TypeError)\n');
    assert.equal(Reflect.get(console, 'warn'), warn);
    assert.equal(errorKind(new RangeError(PLANTED)), 'RangeError');
    const coded = Object.assign(new Error(PLANTED), { code: 'ENOENT' });
    assert.equal(errorKind(coded), 'Error ENOENT');
  });
});

describe('figures and tables', () => {
  const square = (x: number, y: number, side = 70): Box => ({
    page: 0,
    x1: x,
    y1: y,
    x2: x + side,
    y2: y + side,
  });

  test('a connector joins the shapes at its two ends into one figure', () => {
    const connector: Box = { page: 0, x1: 170, y1: 134.75, x2: 230, y2: 135.25 };
    assert.equal(figureBoxes([square(100, 100), square(230, 100)], 595, 842).length, 2);
    assert.equal(figureBoxes([square(100, 100), connector, square(230, 100)], 595, 842).length, 1);
  });

  test('a connector drawn in segments joins the shapes at its ends', () => {
    const segment = (x1: number, x2: number): Box => ({ page: 0, x1, y1: 134.75, x2, y2: 135.25 });
    const shapes = [
      square(100, 100),
      segment(170, 250),
      segment(250, 330),
      segment(330, 400),
      square(400, 100),
    ];
    assert.equal(figureBoxes(shapes, 595, 842).length, 1);
  });

  test("a connector through a reaction's small square, clipped at it, joins its two nodes", () => {
    const node = (x: number): Box => ({ page: 0, x1: x, y1: 100, x2: x + 55, y2: 170 });
    const waypoint: Box = { page: 0, x1: 298.5, y1: 133.5, x2: 301.5, y2: 136.5 };
    const edge = (x1: number, x2: number): Box => ({ page: 0, x1, y1: 134.75, x2, y2: 135.25 });
    const shapes = [node(100), edge(155, 298.5), waypoint, edge(301.5, 445), node(445)];
    const figures = figureBoxes(shapes, 595, 842);
    assert.equal(figures.length, 1);
    assert.equal((figures[0]?.x2 ?? 0) - (figures[0]?.x1 ?? 0), 400);
  });

  test('a rule between two figures, touching neither, joins nothing', () => {
    const rule: Box = { page: 0, x1: 60, y1: 219.75, x2: 500, y2: 220.25 };
    assert.equal(figureBoxes([square(100, 130), rule, square(100, 240)], 595, 842).length, 2);
  });

  test('a rule from a figure to a mark too small to be a node does not widen the figure', () => {
    const rule: Box = { page: 0, x1: 170, y1: 134.75, x2: 500, y2: 135.25 };
    const mark: Box = { page: 0, x1: 500, y1: 133.5, x2: 503, y2: 136.5 };
    const [figure] = figureBoxes([square(100, 100), rule, mark], 595, 842);
    assert.equal(figure?.x2, 170);
  });

  test("a table's cells each shaded, in rows, are not a figure; a figure of such shapes and an image is", () => {
    // today's analysis report: every cell its own rectangle, 1 pt apart, rows 20 pt tall
    const cells: Shape[] = [];
    for (let row = 0; row < 8; row++) {
      const y = 600 - row * 21;
      for (const [x1, x2] of [
        [90, 238],
        [239, 300],
        [301, 380],
        [381, 484],
        [485, 534],
      ] as const) {
        cells.push({ page: 0, x1, y1: y, x2, y2: y + 20 });
      }
    }
    assert.equal(figureBoxes(cells, 595, 842).length, 0);
    // the same with an image among them: a figure
    const image: Shape = { page: 0, x1: 300, y1: 450, x2: 400, y2: 520, image: true };
    assert.equal(figureBoxes([...cells, image], 595, 842).length, 1);
    // shapes in rows but taller than a table's row: a figure
    const tall = cells.map((c) => ({ ...c, y2: c.y1 + 45 }));
    assert.equal(figureBoxes(tall, 595, 842).length, 1);
    // shapes overlapping in a row, as a diagram's node and its label's box: a figure
    const overlapping = [...cells, { page: 0, x1: 200, y1: 600, x2: 260, y2: 620 }];
    assert.equal(figureBoxes(overlapping, 595, 842).length, 1);
  });

  test("a table's shaded header and hairline borders are not a figure", () => {
    const shapes: Box[] = [{ page: 0, x1: 60, y1: 600, x2: 540, y2: 616 }];
    for (let row = 0; row <= 9; row++) {
      const y = 616 - row * 16;
      shapes.push({ page: 0, x1: 60, y1: y - 0.25, x2: 540, y2: y + 0.25 });
    }
    for (const x of [60, 220, 380, 540]) {
      shapes.push({ page: 0, x1: x - 0.25, y1: 472, x2: x + 0.25, y2: 616 });
    }
    assert.equal(figureBoxes(shapes, 595, 842).length, 0);
  });
});

describe('the analysis and the cover, by their meaning', () => {
  const reduced = (rows: string[]) =>
    reduce({
      pages: [0, 1].map(() => ({ width: 595, height: 842 })),
      lines: [
        { page: 1, y: 790, x: 57, size: 18, text: 'Analysis' },
        ...rows.map((text, i) => ({ page: 1, y: 770 - i * 14, x: 57, size: 10.5, text })),
      ],
      links: [],
      figures: [],
    }).analysis ?? {};

  test('identifiers found as `x of y` are counts; any other form is withheld whole', () => {
    assert.deepEqual(reduced(['Identifiers found: 3 of 5']), {
      identifiersFound: { value: 3 },
      identifiersTotal: { value: 5 },
    });
    const odd = reduced(['Identifiers found: 3 of 5 of 7']);
    assert.ok(!('value' in (odd['identifiersFound'] ?? { value: 0 })), 'kept as a value');
  });

  test('a token encoded otherwise is the same token, printed in its one form', () => {
    const twice = TOKEN.replaceAll('%3D', '%253D');
    assert.deepEqual(reduced([`Token: ${twice}`]), reduced([`Token: ${TOKEN}`]));
    assert.equal(new Output('x').value('analysis token', twice), TOKEN);
  });

  test("a cover's title is said to be its file's name, or not, side by side", () => {
    const titled = (title: string): Reduced => ({
      ...sections(),
      cover: { ...sections().cover, title: { hash: hash(title), length: title.length } },
    });
    const [d] = compareReduced('Alpha.pdf', titled('Alpha'), titled('Beta'), {
      reference: 'today/Alpha.pdf',
      new: 'new/Alpha.pdf',
    });
    assert.deepEqual([d?.reference, d?.new], ['same', 'differs']);
  });
});

describe("a section's bounds", () => {
  const layout = (figurePage: number): Layout => ({
    pages: [0, 1, 2, 3].map(() => ({ width: 595, height: 842 })),
    lines: [
      { page: 0, y: 700, x: 100, size: 28, text: 'Alpha signalling pathway' },
      { page: 1, y: 780, x: 57, size: 14, text: 'Beta binds gamma' },
      { page: 1, y: 760, x: 57, size: 10.5, text: 'Stable identifier R-HSA-1' },
      { page: 1, y: 740, x: 57, size: 10.5, text: 'A summation.' },
      { page: 1, y: 726, x: 57, size: 10.5, text: 'Its second line.' },
    ],
    links: [],
    figures: [{ page: figurePage, x1: 100, y1: 500, x2: 400, y2: 700 }],
  });

  test("the first section's heading is its own, never the cover's title", () => {
    const [section] = reduce(layout(1)).sections;
    assert.deepEqual(section?.parts[0], { part: 'name', items: ['Betabindsgamma'] });
  });

  test("the last section's figure is found on a later page, however far", () => {
    assert.equal(reduce(layout(1)).sections[0]?.figure, 'figure');
    assert.equal(reduce(layout(2)).sections[0]?.figure, 'figure');
    assert.equal(reduce(layout(3)).sections[0]?.figure, 'figure');
  });
});
