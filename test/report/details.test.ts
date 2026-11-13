// The reported pathways' details and edit history (spec 002 T007) on the fixture graph,
// whose people are placeholders (ci/fixture/README.md).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { graphSettings, openGraph, type Graph } from '../../src/graph/connection.ts';
import { edits } from '../../src/graph/queries.ts';
import { readDetails } from '../../src/report/details.ts';
import { editHistory } from '../../src/report/edits.ts';

const skip = process.env['NEO4J_URI'] ? false : 'no fixture graph: set NEO4J_URI';
const B = 90000000;
const id = (n: number): number => B + n;
const BETA = id(100);
const ALPHA = id(200);
const GAMMA = id(300);
const SUB_ONE = id(210);
const TWO_PARENT = id(250);
const REACTION_ONE = id(211);
const name = (n: number): string => `Placeholder${String(n).padStart(2, '0')}, P.`;

describe("the reported pathways' details", { skip }, () => {
  let graph: Graph;
  before(() => {
    graph = openGraph(graphSettings(process.env));
  });
  after(async () => {
    await graph.close();
  });

  /** Every query the graph is asked, in order. */
  const counted = (): { graph: Graph; queries: string[] } => {
    const queries: string[] = [];
    return {
      queries,
      graph: {
        read: (query, params, options) => {
          queries.push(query);
          return graph.read(query, params, options);
        },
        close: () => graph.close(),
      },
    };
  };

  test("reads every reported pathway's section in one batch, not one read a pathway", async () => {
    const few = counted();
    await readDetails(few.graph, [{ dbId: ALPHA }], new Set());
    const many = counted();
    const details = await readDetails(
      many.graph,
      [ALPHA, BETA, GAMMA, SUB_ONE, TWO_PARENT].map((dbId) => ({ dbId })),
      new Set(['R-HSA-90000300'])
    );
    assert.equal(details.size, 5);
    // the same queries for five pathways as for one (one more for the figures' ancestors,
    // which only pathways without a diagram need)
    assert.equal(many.queries.length, few.queries.length + 1);
  });

  test("each detail is spec 001's section: its figure, lists and references", async () => {
    const details = await readDetails(
      graph,
      [ALPHA, GAMMA, SUB_ONE].map((dbId) => ({ dbId })),
      new Set(['R-HSA-90000300'])
    );
    const alpha = details.get(ALPHA)?.section;
    assert.ok(alpha);
    assert.equal(alpha.anchor, 's-R-HSA-90000200');
    assert.deepEqual(alpha.figure, { kind: 'diagram', stId: 'R-HSA-90000200' });
    assert.equal(alpha.depth, 0);
    assert.deepEqual(alpha.path, []);
    assert.doesNotMatch(alpha.summations.join(''), /script|onerror|javascript/);
    // the report's history takes the place of spec 001's
    assert.deepEqual(alpha.edits, []);
    assert.deepEqual(details.get(GAMMA)?.section.figure, { kind: 'ehld', stId: 'R-HSA-90000300' });
    // a pathway with no diagram: its ancestor's, its reactions selected
    assert.equal(details.get(SUB_ONE)?.section.figure?.kind, 'ancestor');
    assert.deepEqual(await readDetails(graph, [], new Set()), new Map());
  });

  test('the edit history: within a date, Modified, Revised, Edited, Reviewed, Authored, Created', async () => {
    const history = (await readDetails(graph, [{ dbId: BETA }], new Set())).get(BETA)?.history;
    // beta's created (six authors), modified (none) and authored edits share a date, at
    // other times of day, and are read in id order: created, modified, authored
    assert.deepEqual(
      history?.map((r) => [r.date, r.action]),
      [
        ['2026-01-04', 'Modified'],
        ['2026-01-04', 'Authored'],
        ['2026-01-04', 'Created'],
      ]
    );
    const alpha = (await readDetails(graph, [{ dbId: ALPHA }], new Set())).get(ALPHA)?.history;
    assert.deepEqual(
      alpha?.map((r) => [r.date, r.action]),
      [
        ['2025-12-01', 'Created'],
        ['2026-01-02', 'Authored'],
        ['2026-05-01', 'Modified'],
      ],
      'sorted by date'
    );
  });

  test('six names become five and "et al.", in the edit\'s authors\' order', async () => {
    const history = (await readDetails(graph, [{ dbId: BETA }], new Set())).get(BETA)?.history;
    const created = history?.find((r) => r.action === 'Created');
    assert.deepEqual(created, {
      date: '2026-01-04',
      action: 'Created',
      names: [name(6), name(2), name(5), name(1), name(4)],
      etAl: true,
    });
    assert.deepEqual(
      history?.find((r) => r.action === 'Authored'),
      {
        date: '2026-01-04',
        action: 'Authored',
        names: [name(9), name(10)],
        etAl: false,
      }
    );
  });

  test('an authorless edit is kept as a row with no names', async () => {
    const history = (await readDetails(graph, [{ dbId: BETA }], new Set())).get(BETA)?.history;
    assert.deepEqual(
      history?.find((r) => r.action === 'Modified'),
      {
        date: '2026-01-04',
        action: 'Modified',
        names: [],
        etAl: false,
      }
    );
  });

  test('an undated edit is left out rather than failing; two of one kind on a date are one row', async () => {
    // Reaction one: an undated revised and created, an authorless revised, two edited on one date
    const list = (await edits(graph, [REACTION_ONE])).get(REACTION_ONE) ?? [];
    assert.ok(list.some((e) => e.dateTime === null));
    assert.deepEqual(
      editHistory(list).map((r) => [r.date, r.action, r.names]),
      [
        ['2026-01-01', 'Authored', [name(1), name(2)]],
        ['2026-02-01', 'Reviewed', [name(3)]],
        ['2026-03-01', 'Edited', [name(4), name(5)]],
        ['2026-04-01', 'Revised', []],
      ]
    );
  });
});

describe('the edit history rule', () => {
  const person = (n: number) => ({ dbId: n, name: name(n), surname: null });
  const at = (
    dateTime: string | null,
    kind: 'authored' | 'edited',
    authors: number[],
    dbId = 1
  ) => ({
    dbId,
    kind,
    dateTime,
    authors: authors.map(person),
  });

  test('a person named on two edits of one row is named once; exactly five has no "et al."', () => {
    const rows = editHistory([
      at('2026-01-01 10:00:00', 'edited', [1, 2, 3], 1),
      at('2026-01-01 12:00:00', 'edited', [3, 4, 5], 2),
    ]);
    assert.deepEqual(rows, [
      {
        date: '2026-01-01',
        action: 'Edited',
        names: [name(1), name(2), name(3), name(4), name(5)],
        etAl: false,
      },
    ]);
  });

  test("within a date, today's order: Modified, Revised, Edited, Reviewed, Authored, Created", () => {
    const kinds = ['created', 'modified', 'authored', 'edited', 'reviewed', 'revised'] as const;
    const rows = editHistory(
      kinds.map((kind, i) => ({ dbId: i + 1, kind, dateTime: '2026-01-01', authors: [] }))
    );
    assert.deepEqual(
      rows.map((r) => r.action),
      ['Modified', 'Revised', 'Edited', 'Reviewed', 'Authored', 'Created']
    );
  });

  test('a null name is kept, printed empty', () => {
    const rows = editHistory([
      {
        dbId: 1,
        kind: 'authored',
        dateTime: '2026-01-01',
        authors: [{ dbId: 9, name: null, surname: null }],
      },
    ]);
    assert.deepEqual(rows[0]?.names, [null]);
  });
});
