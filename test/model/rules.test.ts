// The parts' rules (spec 001 T015, research R2), without a graph.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Edit } from '../../src/graph/queries.ts';
import {
  coverNames,
  diseases,
  editRows,
  inferredFrom,
  sanitiseSummation,
} from '../../src/model/rules.ts';

const person = (dbId: number, surname: string) => ({ dbId, name: `${surname}, P.`, surname });
const edit = (
  dbId: number,
  kind: Edit['kind'],
  dateTime: string | null,
  authors: ReturnType<typeof person>[]
): Edit => ({ dbId, kind, dateTime, authors });

test('leaves out the disease named exactly "disease", and only that one', () => {
  assert.deepEqual(
    diseases([
      { dbId: 1, name: 'disease' },
      { dbId: 2, name: 'infectious disease' },
      { dbId: 3, name: 'Disease' },
    ]),
    ['infectious disease', 'Disease']
  );
});

test('sorts what an event was inferred from by species, then name', () => {
  const source = (name: string, speciesName: string) => ({ dbId: 0, stId: '', name, speciesName });
  assert.deepEqual(
    inferredFrom([source('b', 'Rattus'), source('z', 'Mus'), source('a', 'Rattus')]).map(
      (s) => `${s.speciesName} ${s.name}`
    ),
    ['Mus z', 'Rattus a', 'Rattus b']
  );
});

test('the edit history: drops undated and authorless edits, dates by day, sorts and groups', () => {
  const rows = editRows([
    edit(1, 'revised', '2026-03-01 10:00:00', [person(7, 'Zed')]),
    edit(2, 'edited', '2026-03-01 09:00:00', [person(5, 'Bee'), person(4, 'Aye')]),
    edit(3, 'edited', '2026-03-01 11:00:00', [person(6, 'Cee')]),
    edit(4, 'authored', '2026-01-01 08:00:00', [person(1, 'Dee')]),
    edit(5, 'reviewed', null, [person(2, 'Eee')]),
    edit(6, 'reviewed', '2026-02-01 08:00:00', []),
    edit(7, 'reviewed', '2026-01-01 09:00:00', [person(1, 'Dee')]),
  ]);
  assert.deepEqual(rows, [
    // the same date and the same authors: one row, both kinds
    { date: '2026-01-01', kinds: ['authored', 'reviewed'], authors: ['Dee, P.'] },
    // the same date and kind: one row, the authors by database id
    { date: '2026-03-01', kinds: ['edited'], authors: ['Aye, P.', 'Bee, P.', 'Cee, P.'] },
    // the same date, another kind and other authors: a row of its own
    { date: '2026-03-01', kinds: ['revised'], authors: ['Zed, P.'] },
  ]);
});

test("the cover's names: every author once, sorted", () => {
  assert.deepEqual(
    coverNames([
      [edit(1, 'authored', '2026-01-01', [person(2, 'Bee'), person(1, 'Aye')])],
      [edit(2, 'edited', '2026-01-02', [person(1, 'Aye'), person(3, 'Cee')])],
    ]),
    ['Aye, P.', 'Bee, P.', 'Cee, P.']
  );
});

test("a summation's HTML keeps its formatting and web links, and loses anything else", () => {
  const clean = sanitiseSummation(
    '<p>Text <b>bold</b> <i>it</i> <a href="https://example.org/">link</a>' +
      '<script>alert(1)</script><a href="javascript:void(0)">bad</a>' +
      '<img src="x" onerror="alert(1)"><span style="color:red">kept text</span></p>'
  );
  assert.match(clean, /<b>bold<\/b>/);
  assert.match(clean, /<i>it<\/i>/);
  assert.match(clean, /<a href="https:\/\/example.org\/">link<\/a>/);
  assert.match(clean, /kept text/);
  for (const gone of [/script/, /alert/, /javascript/, /<img/, /onerror/, /style=/, /<span/]) {
    assert.doesNotMatch(clean, gone);
  }
});
