// The graph reader (spec 001 T013) against the fixture graph (ci/fixture/README.md).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { graphSettings, openGraph, type Graph } from '../../src/graph/connection.ts';
import {
  children,
  edits,
  eventByIdentifier,
  eventFacts,
  literature,
  release,
  topLevelPathways,
} from '../../src/graph/queries.ts';

const B = 90000000;
const id = (n: number): number => B + n;
const skip = process.env['NEO4J_URI'] ? false : 'no fixture graph: set NEO4J_URI';

describe('the graph reader', { skip }, () => {
  let graph: Graph;
  before(() => {
    graph = openGraph(graphSettings(process.env));
  });
  after(async () => {
    await graph.close();
  });

  test('reads the release from DBInfo.releaseNumber', async () => {
    assert.equal(await release(graph), 98);
  });

  test("reads a species' top-level pathways, and only its own", async () => {
    const human = await topLevelPathways(graph, 'Homo sapiens');
    assert.deepEqual(
      human.map((p) => p.name),
      ['beta pathway', 'Alpha pathway', 'Gamma pathway']
    );
    assert.equal((await topLevelPathways(graph, 'Mus musculus')).length, 1);
  });

  test('finds an event by stable id, versioned stable id or database id, and nothing else', async () => {
    assert.equal((await eventByIdentifier(graph, 'R-HSA-90000211'))?.kind, 'reaction');
    assert.equal((await eventByIdentifier(graph, 'R-HSA-90000200.1'))?.kind, 'pathway');
    assert.equal((await eventByIdentifier(graph, String(id(211))))?.stId, 'R-HSA-90000211');
    assert.equal(await eventByIdentifier(graph, 'R-HSA-90000400'), null, 'a complex');
    assert.equal(await eventByIdentifier(graph, 'R-HSA-1'), null);
  });

  test("reads a level's children in the curators' order", async () => {
    const levels = await children(graph, [id(200), id(100)]);
    assert.deepEqual(
      levels.get(id(200))?.map((c) => [c.name, c.kind]),
      [
        ['Shared reaction', 'reaction'],
        ['Alpha sub two', 'pathway'],
        ['Alpha sub one', 'pathway'],
        ['Two-parent sub', 'pathway'],
      ]
    );
    assert.deepEqual(
      levels.get(id(100))?.map((c) => c.name),
      ['Shared reaction', 'Inferred reaction']
    );
  });

  test("reads an event's facts and short lists, each in order", async () => {
    const facts = await eventFacts(graph, [id(211), id(251), id(120), id(212), id(313)]);
    const r1 = facts.get(id(211));
    assert.ok(r1);
    assert.equal(r1.kind, 'reaction');
    assert.equal(r1.category, 'transition');
    assert.equal(r1.species?.name, 'Homo sapiens');
    assert.deepEqual(
      r1.compartments.map((c) => c.name),
      ['nucleoplasm', 'cytosol']
    );
    assert.deepEqual(r1.summations, [
      "A second, plain placeholder summation, with an apostrophe's quote.",
    ]);
    assert.deepEqual(
      r1.before.map((e) => e.name),
      ['Polymerisation four']
    );
    assert.deepEqual(
      r1.after.map((e) => e.name),
      ['Black box two']
    );
    const disease = facts.get(id(251));
    assert.deepEqual(
      disease?.diseases.map((d) => d.name),
      ['placeholder infectious disease', 'disease']
    );
    assert.equal(disease.isInDisease, true);
  });

  test('reads what an event was inferred from, and not what it was inferred to', async () => {
    const facts = await eventFacts(graph, [id(120), id(910)]);
    assert.deepEqual(
      facts
        .get(id(120))
        ?.inferredFrom.map((s) => s.speciesName)
        .sort(),
      ['Mus musculus', 'Rattus norvegicus']
    );
    assert.deepEqual(facts.get(id(910))?.inferredFrom, []);
  });

  test('reads the first five references by order, with six authors and whether there are more', async () => {
    const refs = (await literature(graph, [id(211), id(220)])).get(id(211));
    assert.ok(refs);
    assert.deepEqual(
      refs.map((r) => r.title),
      [
        'Placeholder article 7',
        'Placeholder article 6',
        'Placeholder article 5',
        'Placeholder article 4',
        'Placeholder article 3',
      ]
    );
    const kinds = (await literature(graph, [id(220)])).get(id(220));
    assert.deepEqual(
      kinds?.map((r) => [r.kind, r.publisher]),
      [
        ['book', 'Placeholder Press'],
        ['web page', null],
      ]
    );
    // the eight-author article is the sixth by order, so not among the five: read it alone
    const eight = await graph.read<{ n: number }>(
      'MATCH (:Person)-[:author]->(p:LiteratureReference {title: "Placeholder article 2"}) RETURN count(*) AS n'
    );
    assert.equal(eight[0]?.n, 8);
  });

  test('reads edits with their kind, date and authors, a missing date or author included', async () => {
    const list = (await edits(graph, [id(211)])).get(id(211));
    assert.ok(list);
    assert.deepEqual([...new Set(list.map((e) => e.kind))].sort(), [
      'authored',
      'edited',
      'reviewed',
      'revised',
    ]);
    assert.ok(list.some((e) => e.dateTime === null));
    assert.ok(list.some((e) => e.authors.length === 0));
    const first = list.find((e) => e.kind === 'authored');
    assert.deepEqual(
      first?.authors.map((a) => a.surname),
      ['Placeholder01', 'Placeholder02']
    );
  });
});
