// The model built from the fixture graph (spec 001 T015, T048).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';

import { graphSettings, openGraph, type Graph } from '../../src/graph/connection.ts';
import { eventByIdentifier } from '../../src/graph/queries.ts';
import { buildBook, buildSingle } from '../../src/model/build.ts';
import { sanitiseSummation } from '../../src/model/rules.ts';
import type { Document, Place } from '../../src/model/types.ts';

const skip = process.env['NEO4J_URI'] ? false : 'no fixture graph: set NEO4J_URI';
// the fixture's EHLD summary: the illustrated pathways
const illustrated = new Set(
  readFileSync(new URL('../../ci/fixture/files/ehld/svgsummary.txt', import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('R-'))
);
const name = (p: Place) => (p.full ? p.section.event.name : p.event.name);
/** An event's full section, in a PDF or the first of several that holds it. */
const fullOf = (docs: Document | readonly Document[], stId: string) => {
  for (const doc of [docs].flat())
    for (const p of doc.places) if (p.full && p.section.event.stId === stId) return p.section;
  throw new Error(`no full section for ${stId}`);
};
const depthOf = (p: Place) => (p.full ? p.section.depth : p.depth);
const pathOf = (p: Place) => (p.full ? p.section.path : p.path).map((e) => e.name);

describe('the model', { skip }, () => {
  let graph: Graph;
  let pdfs: Document[];
  /** The book's PDF for a top-level pathway. */
  const pdf = (title: string): Document => {
    const doc = pdfs.find((d) => d.cover.title === title);
    if (!doc) throw new Error(`no book PDF for ${title}`);
    return doc;
  };
  before(async () => {
    graph = openGraph(graphSettings(process.env));
    pdfs = await buildBook(graph, { illustrated });
  });
  after(async () => {
    await graph.close();
  });

  test('the book is one PDF per top-level pathway, by name ignoring case, each its own tree', () => {
    assert.deepEqual(
      pdfs.map((d) => d.cover.title),
      ['Alpha pathway', 'beta pathway', 'Gamma pathway']
    );
    for (const doc of pdfs) {
      assert.equal(doc.kind, 'book');
      // its top-level pathway first, and the only place at depth 0
      assert.deepEqual(doc.places.filter((p) => depthOf(p) === 0).map(name), [doc.cover.title]);
      assert.equal(doc.places[0] && name(doc.places[0]), doc.cover.title);
    }
    assert.ok(!pdfs.some((d) => d.places.some((p) => name(p) === 'Mouse pathway')));
  });

  test('an event is in full at its first place in a PDF, a short entry later there, its subtree once', () => {
    const alpha = pdf('Alpha pathway');
    // Two-parent sub: in full under Alpha sub two (earlier in Alpha's order), short under Alpha
    assert.deepEqual(
      alpha.places
        .filter((p) => name(p) === 'Two-parent sub')
        .map((p) => [p.full, pathOf(p).at(-1)]),
      [
        [true, 'Alpha sub two'],
        [false, 'Alpha pathway'],
      ]
    );
    // its reaction is written once, under its full place
    assert.equal(alpha.places.filter((p) => name(p) === 'Disease reaction').length, 1);
  });

  test('an event under two top-level pathways is in full in each PDF', () => {
    const [alpha, beta] = [pdf('Alpha pathway'), pdf('beta pathway')];
    for (const doc of [alpha, beta]) {
      assert.deepEqual(
        doc.places.filter((p) => name(p) === 'Shared reaction').map((p) => p.full),
        [true]
      );
    }
    // beta reaches Alpha sub two through beta sub with diagram: its subtree is in full there too
    for (const event of ['Alpha sub two', 'Two-parent sub', 'Disease reaction']) {
      const places = beta.places.filter((p) => name(p) === event);
      assert.deepEqual(
        places.map((p) => p.full),
        [true],
        event
      );
      assert.deepEqual(pathOf(places[0] as Place).slice(0, 2), [
        'beta pathway',
        'beta sub with diagram',
      ]);
    }
    assert.deepEqual(
      fullOf(beta, 'R-HSA-90000251').path.map((e) => e.name),
      ['beta pathway', 'beta sub with diagram', 'Alpha sub two', 'Two-parent sub']
    );
  });

  test("each PDF's cover names the authors of its own events' edits", () => {
    assert.deepEqual(
      pdfs.map((d) => d.cover.names),
      [
        [
          'Placeholder01, P.',
          'Placeholder02, P.',
          'Placeholder03, P.',
          'Placeholder04, P.',
          'Placeholder05, P.',
          'Placeholder06, P.',
          'Placeholder07, P.',
        ],
        ['Placeholder09, P.', 'Placeholder10, P.'],
        ['Placeholder08, P.'],
      ]
    );
  });

  test('no link targets a section in another PDF', () => {
    for (const doc of pdfs) {
      const anchors = new Set(doc.places.filter((p) => p.full).map((p) => p.section.anchor));
      const dbIds = new Set(doc.places.filter((p) => p.full).map((p) => p.section.event.dbId));
      for (const place of doc.places) {
        if (!place.full) {
          assert.ok(anchors.has(place.anchor), `${doc.cover.title}: ${place.anchor}`);
          continue;
        }
        // the events before and after are only those this PDF holds
        for (const e of [...place.section.event.before, ...place.section.event.after]) {
          assert.ok(
            dbIds.has(e.dbId),
            `${doc.cover.title}: ${place.section.event.name} → ${e.name}`
          );
        }
      }
      for (const entry of (doc.contents ?? []).slice(1, -1)) {
        assert.ok(anchors.has(entry.target), `${doc.cover.title}: ${entry.target}`);
      }
    }
    // Reaction one follows Polymerisation four (Gamma's) and precedes Inferred reaction (beta's)
    const one = fullOf(pdf('Alpha pathway'), 'R-HSA-90000211');
    assert.deepEqual(one.event.before, []);
    assert.deepEqual(
      one.event.after.map((e) => e.name),
      ['Black box two', 'Disease reaction']
    );
  });

  test('each kind of figure is chosen as the data model says', () => {
    assert.deepEqual(fullOf(pdfs, 'R-HSA-90000200').figure, {
      kind: 'diagram',
      stId: 'R-HSA-90000200',
    });
    assert.deepEqual(fullOf(pdfs, 'R-HSA-90000300').figure, {
      kind: 'ehld',
      stId: 'R-HSA-90000300',
    });
    assert.deepEqual(fullOf(pdfs, 'R-HSA-90000210').figure, {
      kind: 'ancestor',
      stId: 'R-HSA-90000200',
      highlight: ['R-HSA-90000211', 'R-HSA-90000212'],
    });
    // two parents with diagrams: as graph-core, the deeper one; a top-level pathway ranks last
    assert.deepEqual(fullOf(pdfs, 'R-HSA-90000250').figure, {
      kind: 'ancestor',
      stId: 'R-HSA-90000230',
      highlight: ['R-HSA-90000251'],
    });
    // a diagram between: only the nearer draws it, and reactions under another diagram are not selected
    assert.deepEqual(fullOf(pdfs, 'R-HSA-90000131').figure, {
      kind: 'ancestor',
      stId: 'R-HSA-90000130',
      highlight: ['R-HSA-90000132'],
    });
    // beneath an illustration: the illustration, unselected, and recorded as such
    assert.deepEqual(fullOf(pdfs, 'R-HSA-90000310').figure, {
      kind: 'ehld',
      stId: 'R-HSA-90000300',
      unselectedFor: 'R-HSA-90000310',
    });
    assert.deepEqual(fullOf(pdfs, 'R-HSA-90000211').figure, {
      kind: 'reaction',
      stId: 'R-HSA-90000211',
    });
  });

  test("a section's parts follow the rules", () => {
    const disease = fullOf(pdfs, 'R-HSA-90000251');
    assert.deepEqual(disease.diseases, ['placeholder infectious disease']);
    const r1 = fullOf(pdfs, 'R-HSA-90000211');
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
    const alpha = fullOf(pdfs, 'R-HSA-90000200');
    // its created and modified edits are the analysis report's, never spec 001's history
    assert.deepEqual(alpha.edits, [
      { date: '2026-01-02', kinds: ['authored'], authors: ['Placeholder07, P.'] },
    ]);
    assert.doesNotMatch(alpha.summations.join(''), /script|onerror|javascript/);
    // every summation sanitised, as the layout's breaks (markupBreaks) rely on it
    for (const doc of pdfs)
      for (const p of doc.places)
        if (p.full)
          for (const summation of p.section.summations)
            assert.equal(sanitiseSummation(summation), summation, p.section.event.stId);
    assert.deepEqual(
      fullOf(pdfs, 'R-HSA-90000120').inferredFrom.map((s) => s.speciesName),
      ['Mus musculus', 'Rattus norvegicus']
    );
  });

  test("each of the book's PDFs: its cover, release and contents", () => {
    for (const doc of pdfs) {
      const root = doc.places[0];
      assert.ok(root?.full);
      assert.equal(doc.cover.title, root.section.event.name);
      assert.equal(doc.cover.release, 98);
      assert.equal(doc.cover.excerpt, false);
      assert.equal(new Set(doc.cover.names).size, doc.cover.names.length);
      assert.deepEqual(doc.cover.names, [...doc.cover.names].sort());
      assert.equal(doc.release.version, 98);
      const contents = doc.contents;
      assert.ok(contents);
      assert.equal(contents[0]?.target, 'introduction');
      assert.equal(contents.at(-1)?.target, 'contents');
      assert.equal(contents.length, doc.places.length + 2);
    }
    // the cover's figure is its pathway's own: a diagram, or an illustration
    assert.deepEqual(
      pdfs.map((d) => d.cover.figure),
      [
        { kind: 'diagram', stId: 'R-HSA-90000200' },
        { kind: 'diagram', stId: 'R-HSA-90000100' },
        { kind: 'ehld', stId: 'R-HSA-90000300' },
      ]
    );
    // each counts the pathways and reactions it holds
    assert.deepEqual(
      pdfs.map((d) => [d.release.pathways, d.release.reactions]),
      [
        [5, 5],
        [5, 4],
        [2, 1],
      ]
    );
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
