// The model built from the fixture graph (spec 001 T015).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';

import { graphSettings, openGraph, type Graph } from '../../src/graph/connection.ts';
import { eventByIdentifier } from '../../src/graph/queries.ts';
import { buildBook, buildSingle } from '../../src/model/build.ts';
import type { Document, Place } from '../../src/model/types.ts';

const skip = process.env['NEO4J_URI'] ? false : 'no fixture graph: set NEO4J_URI';
// the fixture's EHLD summary: the illustrated pathways
const illustrated = new Set(
  readFileSync(new URL('../../ci/fixture/files/ehld/svgsummary.txt', import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('R-'))
);
const name = (p: Place) => (p.full ? p.section.event.name : p.event.name);
const fullOf = (doc: Document, stId: string) => {
  for (const p of doc.places) if (p.full && p.section.event.stId === stId) return p.section;
  throw new Error(`no full section for ${stId}`);
};

describe('the model', { skip }, () => {
  let graph: Graph;
  let book: Document;
  before(async () => {
    graph = openGraph(graphSettings(process.env));
    book = await buildBook(graph, { illustrated });
  });
  after(async () => {
    await graph.close();
  });

  test("the book's chapters are its species' top-level pathways, by name ignoring case", () => {
    assert.deepEqual(
      book.places.filter((p) => (p.full ? p.section.depth : p.depth) === 0).map(name),
      ['Alpha pathway', 'beta pathway', 'Gamma pathway']
    );
    assert.ok(!book.places.some((p) => name(p) === 'Mouse pathway'));
  });

  test('an event is in full at its first place, a short entry elsewhere, its subtree once', () => {
    const shared = book.places.filter((p) => name(p) === 'Shared reaction');
    assert.deepEqual(
      shared.map((p) => p.full),
      [true, false]
    );
    // Two-parent sub: in full under Alpha sub two (earlier in Alpha's order), short under Alpha
    const two = book.places.filter((p) => name(p) === 'Two-parent sub');
    assert.deepEqual(
      two.map((p) => [p.full, (p.full ? p.section.path : p.path).at(-1)?.name]),
      [
        [true, 'Alpha sub two'],
        [false, 'Alpha pathway'],
      ]
    );
    // its reaction is written once, under its full place
    assert.equal(book.places.filter((p) => name(p) === 'Disease reaction').length, 1);
  });

  test('each kind of figure is chosen as the data model says', () => {
    assert.deepEqual(fullOf(book, 'R-HSA-90000200').figure, {
      kind: 'diagram',
      stId: 'R-HSA-90000200',
    });
    assert.deepEqual(fullOf(book, 'R-HSA-90000300').figure, {
      kind: 'ehld',
      stId: 'R-HSA-90000300',
    });
    assert.deepEqual(fullOf(book, 'R-HSA-90000210').figure, {
      kind: 'ancestor',
      stId: 'R-HSA-90000200',
      highlight: ['R-HSA-90000211', 'R-HSA-90000212'],
    });
    // two parents with diagrams: as graph-core, the deeper one; a top-level pathway ranks last
    assert.deepEqual(fullOf(book, 'R-HSA-90000250').figure, {
      kind: 'ancestor',
      stId: 'R-HSA-90000230',
      highlight: ['R-HSA-90000251'],
    });
    // a diagram between: only the nearer draws it, and reactions under another diagram are not selected
    assert.deepEqual(fullOf(book, 'R-HSA-90000131').figure, {
      kind: 'ancestor',
      stId: 'R-HSA-90000130',
      highlight: ['R-HSA-90000132'],
    });
    // beneath an illustration: the illustration, unselected, and recorded as such
    assert.deepEqual(fullOf(book, 'R-HSA-90000310').figure, {
      kind: 'ehld',
      stId: 'R-HSA-90000300',
      unselectedFor: 'R-HSA-90000310',
    });
    assert.deepEqual(fullOf(book, 'R-HSA-90000211').figure, {
      kind: 'reaction',
      stId: 'R-HSA-90000211',
    });
  });

  test("a section's parts follow the rules", () => {
    const disease = fullOf(book, 'R-HSA-90000251');
    assert.deepEqual(disease.diseases, ['placeholder infectious disease']);
    const r1 = fullOf(book, 'R-HSA-90000211');
    assert.deepEqual(r1.edits, [
      {
        date: '2026-01-01',
        kinds: ['authored'],
        authors: ['Placeholder01, P.', 'Placeholder02, P.'],
      },
      { date: '2026-02-01', kinds: ['reviewed'], authors: ['Placeholder03, P.'] },
      {
        date: '2026-03-01',
        kinds: ['edited'],
        authors: ['Placeholder04, P.', 'Placeholder05, P.'],
      },
    ]);
    const alpha = fullOf(book, 'R-HSA-90000200');
    assert.doesNotMatch(alpha.summations.join(''), /script|onerror|javascript/);
    assert.deepEqual(
      fullOf(book, 'R-HSA-90000120').inferredFrom.map((s) => s.speciesName),
      ['Mus musculus', 'Rattus norvegicus']
    );
  });

  test("the book's cover, release and contents", () => {
    assert.equal(book.cover.title, 'The Reactome Book');
    assert.equal(book.cover.release, 98);
    assert.equal(book.cover.figure, null);
    assert.equal(book.cover.excerpt, false);
    assert.equal(new Set(book.cover.names).size, book.cover.names.length);
    assert.deepEqual(book.cover.names, [...book.cover.names].sort());
    assert.equal(book.release.version, 98);
    assert.equal(book.release.reactions, 8);
    assert.equal(book.release.pathways, 10);
    const contents = book.contents;
    assert.ok(contents);
    assert.equal(contents[0]?.target, 'introduction');
    assert.equal(contents.at(-1)?.target, 'contents');
    // every place in the contents points at a full section
    const anchors = new Set(book.places.filter((p) => p.full).map((p) => p.section.anchor));
    for (const entry of contents.slice(1, -1)) assert.ok(anchors.has(entry.target));
  });

  test('a pathway at depth 1 holds itself and its children, no deeper', async () => {
    const found = await eventByIdentifier(graph, 'R-HSA-90000200');
    assert.ok(found && 'event' in found);
    const single = await buildSingle(graph, found.event, { depth: 1, illustrated });
    assert.deepEqual(single.places.map(name), [
      'Alpha pathway',
      'Shared reaction',
      'Alpha sub two',
      'Alpha sub one',
      'Two-parent sub',
    ]);
    // a section holds its own lists, not the raw ones
    const first = single.places[0];
    assert.ok(first?.full);
    assert.ok(!('summations' in first.section.event));
    assert.ok(!('diseases' in first.section.event));
    assert.equal(single.cover.excerpt, true);
    assert.deepEqual(single.cover.figure, { kind: 'diagram', stId: 'R-HSA-90000200' });
    assert.ok(single.contents);
    const zero = await buildSingle(graph, found.event, { depth: 0, illustrated });
    assert.equal(zero.places.length, 1);
    assert.equal(zero.contents, null);
  });

  test('a reaction alone has no contents and no figure on its cover', async () => {
    const found = await eventByIdentifier(graph, 'R-HSA-90000211');
    assert.ok(found && 'event' in found);
    const single = await buildSingle(graph, found.event, { depth: 1, illustrated });
    assert.equal(single.contents, null);
    assert.equal(single.cover.figure, null);
    assert.equal(single.cover.excerpt, false);
  });

  test('the events before and after are only those the PDF holds', async () => {
    const found = await eventByIdentifier(graph, 'R-HSA-90000210');
    assert.ok(found && 'event' in found);
    const single = await buildSingle(graph, found.event, { depth: 1, illustrated });
    const r1 = single.places.find((p) => p.full && p.section.event.stId === 'R-HSA-90000211');
    assert.ok(r1?.full);
    assert.deepEqual(
      r1.section.event.after.map((e) => e.name),
      ['Black box two']
    );
    assert.deepEqual(r1.section.event.before, []);
  });

  test("a pathway's selection leaves out reactions under another diagram", async () => {
    const { diagramChoices } = await import('../../src/graph/queries.ts');
    const choices = await diagramChoices(graph, [90000210, 90000131]);
    assert.deepEqual(choices.get(90000210)?.reactions, ['R-HSA-90000211', 'R-HSA-90000212']);
    assert.deepEqual(
      choices.get(90000131)?.ancestors.map((a) => a.stId),
      ['R-HSA-90000130']
    );
    // an ancestor's depth is its nearest top-level pathway's: Alpha sub two is one below Alpha,
    // two below beta
    const two = await diagramChoices(graph, [90000250]);
    assert.deepEqual(
      two.get(90000250)?.ancestors.map((a) => [a.stId, a.depthFromTop]),
      [
        ['R-HSA-90000200', 0],
        ['R-HSA-90000230', 1],
      ]
    );
  });
});
