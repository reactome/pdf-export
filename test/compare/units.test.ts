// FR-012's comparison's parts that need no browser (spec 001 T035, from #165's review): the
// one printer every reported value passes through, tried with names planted everywhere in
// random layouts; the sections' order by their longest common subsequence; the constants a
// layout is read by, pinned; and the reduction's time on a large book. Layouts here are
// built directly, as pdf.js's reading would give them.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { applyRecorded, commonSubsequence, compareReduced } from '../../src/compare/compare.ts';
import {
  Output,
  SPECIES,
  ANALYSIS_TYPES,
  RESOURCES,
  type Difference,
} from '../../src/compare/output.ts';
import {
  figureBoxes,
  type Box,
  type Layout,
  type Line,
  type Link,
} from '../../src/compare/read.ts';
import { hash, reduce, type Reduced, type ReducedSection } from '../../src/compare/reduce.ts';
import { CONTRIBUTORS } from '../../src/layout/text.ts';
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
