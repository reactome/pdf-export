// An event's facts from its row (spec 001 T013): every list put in its relationship's
// order, whatever order the database returned it in. Needs no graph.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { factsFromRow, type RawFacts } from '../../src/graph/queries.ts';

const ref = (n: number) => ({ dbId: n, stId: `R-HSA-${String(n)}`, name: `event ${String(n)}` });

const row: RawFacts = {
  ...ref(1),
  kind: 'reaction',
  schemaClass: 'Reaction',
  speciesName: 'Homo sapiens',
  category: null,
  hasDiagram: false,
  hasEHLD: false,
  isInferred: false,
  isInDisease: true,
  // every list scrambled: neither its order nor its reverse is the relationships' order
  species: [
    { order: 1, dbId: 21, name: 'second species' },
    { order: 0, dbId: 20, name: 'first species' },
    { order: 2, dbId: 22, name: 'third species' },
  ],
  compartments: [
    { order: 1, dbId: 31, name: 'b' },
    { order: 0, dbId: 30, name: 'a' },
    { order: 2, dbId: 32, name: 'c' },
  ],
  diseases: [
    { order: 1, dbId: 41, name: 'b' },
    { order: 0, dbId: 40, name: 'a' },
    { order: 2, dbId: 42, name: 'c' },
  ],
  inferredFrom: [],
  summations: [
    { order: 1, text: 'b' },
    { order: 0, text: 'a' },
    { order: 2, text: 'c' },
  ],
  before: [
    { order: 1, ...ref(51) },
    { order: 0, ...ref(50) },
    { order: 2, ...ref(52) },
  ],
  after: [ref(61), ref(60), ref(62)],
};

test("puts each list in its relationship's order, and the events after by database id", () => {
  const facts = factsFromRow(row);
  assert.equal(facts.species?.name, 'first species');
  assert.deepEqual(
    facts.compartments.map((c) => c.name),
    ['a', 'b', 'c']
  );
  assert.deepEqual(
    facts.diseases.map((d) => d.name),
    ['a', 'b', 'c']
  );
  assert.deepEqual(facts.summations, ['a', 'b', 'c']);
  assert.deepEqual(
    facts.before.map((e) => e.dbId),
    [50, 51, 52]
  );
  assert.deepEqual(
    facts.after.map((e) => e.dbId),
    [60, 61, 62]
  );
});

test('keeps no order field on what it returns', () => {
  const facts = factsFromRow(row);
  assert.deepEqual(Object.keys(facts.compartments[0] ?? {}).sort(), ['dbId', 'name']);
  assert.deepEqual(Object.keys(facts.before[0] ?? {}).sort(), ['dbId', 'name', 'stId']);
});
