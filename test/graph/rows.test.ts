// The graph's rows checked into their types: a row that fits is read as it is, and one that
// does not is refused, naming its column and never its value. Needs no graph: the queries
// read a stub's rows.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { Graph } from '../../src/graph/connection.ts';
import {
  children,
  edit,
  eventByIdentifier,
  eventFacts,
  figureNames,
  rawFacts,
  reference,
  release,
  releaseInfo,
} from '../../src/graph/queries.ts';
import {
  flag,
  maps,
  oneOf,
  RowError,
  text,
  textOrNull,
  texts,
  whole,
  wholeOrNull,
  type Row,
} from '../../src/graph/rows.ts';

/** A graph that answers every query with these rows. */
const answering = (rows: Row[]): Graph => ({
  read: () => Promise.resolve(rows),
  close: () => Promise.resolve(),
});

/** A RowError naming the column, and never the value given. */
const refused = (column: string, value?: string) => (error: unknown) => {
  assert.ok(error instanceof RowError);
  assert.match(error.message, new RegExp(`^the graph's ${column} is not `));
  if (value !== undefined) assert.ok(!error.message.includes(value), error.message);
  return true;
};

describe("a row's columns", () => {
  test('each read as its type', () => {
    const row: Row = {
      t: 'a',
      n: 3,
      b: false,
      k: 'pathway',
      l: ['x', 'y'],
      m: [{ a: 1 }],
      none: null,
    };
    assert.equal(text(row, 't'), 'a');
    assert.equal(textOrNull(row, 't'), 'a');
    assert.equal(textOrNull(row, 'none'), null);
    assert.equal(textOrNull(row, 'absent'), null);
    assert.equal(whole(row, 'n'), 3);
    assert.equal(wholeOrNull(row, 'none'), null);
    assert.equal(flag(row, 'b'), false);
    assert.equal(flag(row, 'none'), false);
    assert.equal(flag(row, 'absent'), false);
    assert.equal(oneOf(row, 'k', ['pathway', 'reaction']), 'pathway');
    assert.deepEqual(texts(row, 'l'), ['x', 'y']);
    assert.deepEqual(maps(row, 'm'), [{ a: 1 }]);
  });

  test('each refused when it is not its type, by its name alone', () => {
    const row: Row = { s: 'Placeholder01, P.', n: 1.5, b: 'true', l: ['x', 2], m: [['a']] };
    assert.throws(() => text(row, 'n'), refused('n'));
    assert.throws(() => text(row, 'absent'), refused('absent'));
    assert.throws(() => textOrNull(row, 'n'), refused('n'));
    assert.throws(() => whole(row, 's'), refused('s', 'Placeholder01'));
    assert.throws(() => whole(row, 'n'), refused('n'));
    assert.throws(() => wholeOrNull(row, 'n'), refused('n'));
    assert.throws(() => flag(row, 'b'), refused('b'));
    assert.throws(() => oneOf(row, 's', ['pathway', 'reaction']), refused('s', 'Placeholder01'));
    assert.throws(() => texts(row, 'l'), refused('l'));
    assert.throws(() => texts(row, 's'), refused('s', 'Placeholder01'));
    assert.throws(() => maps(row, 'm'), refused('m'));
  });
});

const ref = (n: number) => ({ dbId: n, stId: `R-HSA-${String(n)}`, name: `event ${String(n)}` });

const factsRow: Row = {
  ...ref(1),
  schemaClass: 'Reaction',
  kind: 'reaction',
  speciesName: 'Homo sapiens',
  category: null,
  hasDiagram: false,
  hasEHLD: false,
  isInferred: false,
  isInDisease: false,
  species: [{ order: 0, dbId: 20, name: 'a species' }],
  compartments: [{ order: null, dbId: 30, name: 'a compartment' }],
  diseases: [],
  inferredFrom: [{ ...ref(70), speciesName: 'Mus musculus' }],
  summations: [{ order: 0, text: '<b>a</b>' }],
  before: [{ order: 0, ...ref(50) }],
  after: [ref(60)],
};

describe("an event's facts", () => {
  test('a row that fits is read as it is', async () => {
    assert.deepEqual(rawFacts(factsRow), factsRow);
    const facts = await eventFacts(answering([factsRow]), [1]);
    assert.equal(facts.get(1)?.species?.name, 'a species');
  });

  test('what nothing printed reads, or reads as none, may be null or missing, as before', () => {
    const { speciesName: _speciesName, schemaClass: _schemaClass, ...bare } = factsRow;
    const read = rawFacts({
      ...bare,
      hasDiagram: null,
      species: [{ order: null, dbId: null, name: null }],
      compartments: [{ order: 0, dbId: null, name: 'a compartment' }],
      inferredFrom: [
        { dbId: null, stId: 'R-MMU-70', name: 'event 70', speciesName: 'Mus musculus' },
      ],
      summations: [{ order: 0, text: null }],
    });
    assert.equal(read.speciesName, null);
    assert.equal(read.schemaClass, null);
    assert.equal(read.hasDiagram, false);
    assert.deepEqual(read.species, [{ order: null, dbId: null, name: null }]);
    assert.equal(read.compartments[0]?.dbId, null);
    assert.equal(read.inferredFrom[0]?.dbId, null);
    assert.deepEqual(read.summations, [{ order: 0, text: null }]);
  });

  test('what would have printed "null", or thrown, is refused', () => {
    assert.throws(() => rawFacts({ ...factsRow, name: null }), refused('name'));
    assert.throws(() => rawFacts({ ...factsRow, kind: 'complex' }), refused('kind'));
    assert.throws(() => rawFacts({ ...factsRow, hasDiagram: 'true' }), refused('hasDiagram'));
    assert.throws(() => rawFacts({ ...factsRow, dbId: '1' }), refused('dbId'));
    assert.throws(
      () => rawFacts({ ...factsRow, compartments: [{ order: 0, dbId: 30, name: null }] }),
      refused('name')
    );
    assert.throws(
      () => rawFacts({ ...factsRow, before: [{ order: 0, ...ref(50), dbId: null }] }),
      refused('dbId')
    );
    assert.throws(
      () => rawFacts({ ...factsRow, after: [{ dbId: 60, stId: null, name: 'x' }] }),
      refused('stId')
    );
  });
});

describe('the queries read their rows through the checks', () => {
  test("the release: a number, or the graph's own error where there is none", async () => {
    assert.equal(await release(answering([{ release: 98 }])), 98);
    await assert.rejects(release(answering([{ release: null }])), /no DBInfo.releaseNumber/);
    await assert.rejects(release(answering([])), /no DBInfo.releaseNumber/);
    await assert.rejects(release(answering([{ release: '98' }])), refused('release'));
    assert.deepEqual(await releaseInfo(answering([{ release: 98, checksum: null }])), {
      release: 98,
      checksum: null,
    });
  });

  test('something that is not an event needs no stable id; an event does', async () => {
    const notEvent = { dbId: 5, stId: null, name: 'x', schemaClass: 'X', kind: 'reaction' };
    assert.deepEqual(await eventByIdentifier(answering([{ ...notEvent, isEvent: false }]), '5'), {
      notAnEvent: true,
    });
    await assert.rejects(
      eventByIdentifier(answering([{ ...notEvent, isEvent: true }]), '5'),
      refused('stId')
    );
  });

  test("each parent's children, its own column dropped", async () => {
    const row = { parent: 1, ...ref(2), schemaClass: 'Pathway', kind: 'pathway' };
    const got = await children(answering([row]), [1]);
    assert.deepEqual(got.get(1), [{ ...ref(2), schemaClass: 'Pathway', kind: 'pathway' }]);
    await assert.rejects(children(answering([{ ...row, parent: null }]), [1]), refused('parent'));
  });

  test("a participant's name that is null is left out, as before; a name of another type too", async () => {
    const got = await figureNames(answering([{ id: 1, names: ['b', null, 'a', 3] }]), [1]);
    assert.deepEqual(got.get(1), ['a', 'b']);
  });
});

test("a reference's row: its kind from its labels, a missing optional column as null", () => {
  const row: Row = {
    event: 1,
    dbId: 9,
    labels: ['Publication', 'Book'],
    title: 'A title',
    authors: ['Placeholder01, P.'],
    moreAuthors: false,
  };
  const read = reference(row);
  assert.equal(read.kind, 'book');
  assert.equal(read.volume, null);
  assert.equal(read.publisher, null);
  assert.throws(() => reference({ ...row, volume: '12' }), refused('volume'));
  assert.equal(reference({ ...row, dbId: null }).dbId, null);
  assert.throws(() => reference({ ...row, title: null }), refused('title'));
});

test('an author with no name is read as null, as the edit history printed it before: empty', () => {
  const row: Row = {
    dbId: null,
    kind: 'authored',
    dateTime: '2026-01-01 10:00:00',
    authors: [
      { dbId: 3, name: null, surname: null },
      { dbId: 4, surname: 'Placeholder02' },
      { dbId: 5, name: 'Placeholder03, P.', surname: 'Placeholder03' },
    ],
  };
  assert.deepEqual(edit(row).authors, [
    { dbId: 3, name: null, surname: null },
    { dbId: 4, name: null, surname: 'Placeholder02' },
    { dbId: 5, name: 'Placeholder03, P.', surname: 'Placeholder03' },
  ]);
  assert.equal(edit(row).dbId, null);
});

test("an edit's row: its kind one of six, its authors each checked", () => {
  const row: Row = {
    dbId: 9,
    kind: 'reviewed',
    dateTime: null,
    authors: [{ dbId: 3, name: 'Placeholder01, P.', surname: null }],
  };
  assert.deepEqual(edit(row), row);
  assert.deepEqual(edit({ ...row, kind: 'created' }), { ...row, kind: 'created' });
  assert.throws(() => edit({ ...row, kind: 'deleted' }), refused('kind'));
  assert.throws(
    () => edit({ ...row, authors: [{ dbId: 3, name: 7, surname: null }] }),
    refused('name')
  );
  // two authors with no id would be one author in the history, the other dropped
  assert.throws(
    () => edit({ ...row, authors: [{ dbId: null, name: 'Placeholder01, P.', surname: null }] }),
    refused('dbId')
  );
});
