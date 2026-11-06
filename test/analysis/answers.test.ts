// The analysis service's answers checked into their types (spec 001 T020's client): an
// answer that fits is read, and anything else is refused as not the answer, which the
// client reports as `unavailable`. Needs no service.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkSummary, entityRows, interactorRows } from '../../src/analysis/client.ts';

const summary = {
  summary: { token: 'T', type: 'OVERREPRESENTATION', projection: true, interactors: false },
  identifiersNotFound: 2,
  pathwaysFound: 10,
};

test('a summary is read with the fields the PDF uses, and refused without one of them', () => {
  assert.deepEqual(checkSummary({ ...summary, other: 1 }), summary);
  for (const bad of [
    null,
    [],
    { ...summary, summary: null },
    { ...summary, pathwaysFound: '10' },
    { ...summary, summary: { ...summary.summary, projection: 'true' } },
    { ...summary, summary: { ...summary.summary, token: undefined } },
  ]) {
    assert.throws(() => checkSummary(bad), /not the summary/);
  }
});

test("a found list's entities: a row for each resource an identifier maps to in", () => {
  const json = {
    identifiers: [
      {
        id: 'P1',
        mapsTo: [
          { resource: 'UNIPROT', ids: ['P1'] },
          { resource: 'ENSEMBL', ids: ['E1', 'E2'] },
        ],
      },
    ],
  };
  assert.deepEqual(entityRows(json), [
    { identifier: 'P1', mapsTo: ['P1'], resource: 'UNIPROT' },
    { identifier: 'P1', mapsTo: ['E1', 'E2'], resource: 'ENSEMBL' },
  ]);
  for (const bad of [
    null,
    {},
    { identifiers: [{ mapsTo: [] }] },
    { identifiers: [{ id: 'P1', mapsTo: {} }] },
    { identifiers: [{ id: 'P1', mapsTo: [{ resource: 'UNIPROT', ids: 'P1' }] }] },
    { identifiers: [{ id: 'P1', mapsTo: [{ ids: ['P1'] }] }] },
  ]) {
    assert.throws(() => entityRows(bad), /not a found list/, JSON.stringify(bad));
  }
});

test("a found list's interactors: a row for each, what it interacts with checked", () => {
  const json = { identifiers: [{ id: 'Q1', interactsWith: { resource: 'UNIPROT', ids: ['P1'] } }] };
  assert.deepEqual(interactorRows(json), [
    { identifier: 'Q1', mapsTo: ['P1'], resource: 'UNIPROT' },
  ]);
  for (const bad of [
    { identifiers: [{ id: 'Q1' }] },
    { identifiers: [{ id: 'Q1', interactsWith: { resource: 'UNIPROT', ids: [1] } }] },
    { identifiers: 'Q1' },
  ]) {
    assert.throws(() => interactorRows(bad), /not a found list/, JSON.stringify(bad));
  }
});
