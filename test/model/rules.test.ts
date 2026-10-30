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
import { nearestAncestor } from '../../src/model/build.ts';

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
    // the same date and the same authors: one row, its kinds in event-pdf's order
    { date: '2026-01-01', kinds: ['authored', 'reviewed'], authors: ['Dee, P.'] },
    // the same date and kind: one row, the authors by database id
    { date: '2026-03-01', kinds: ['edited'], authors: ['Aye, P.', 'Bee, P.', 'Cee, P.'] },
    // the same date, another kind and other authors: a row of its own
    { date: '2026-03-01', kinds: ['revised'], authors: ['Zed, P.'] },
  ]);
});

test('an edit joins the row of the edit before it, not the row as it has grown', () => {
  const day = '2026-05-01 10:00:00';
  // authored A, authored B, edited B: each joins the one before, so one row
  assert.equal(
    editRows([
      edit(1, 'authored', day, [person(1, 'Aaa')]),
      edit(2, 'authored', day, [person(2, 'Bbb')]),
      edit(3, 'edited', day, [person(2, 'Bbb')]),
    ]).length,
    1
  );
  // authored A, edited A, authored C: C shares nothing with the edit before it, so two rows
  assert.equal(
    editRows([
      edit(1, 'authored', day, [person(1, 'Aaa')]),
      edit(2, 'edited', day, [person(1, 'Aaa')]),
      edit(3, 'authored', day, [person(3, 'Ccc')]),
    ]).length,
    2
  );
});

test("a row's kinds are in event-pdf's order, whatever order the edits came in", () => {
  const day = '2026-07-01 10:00:00';
  assert.deepEqual(
    editRows([
      edit(1, 'reviewed', day, [person(1, 'Aaa')]),
      edit(2, 'authored', day, [person(1, 'Aaa')]),
    ])[0]?.kinds,
    ['authored', 'reviewed']
  );
});

test('edits on one date are sorted by surname as Java compares strings', () => {
  const day = '2026-06-01 10:00:00';
  const rows = editRows([
    edit(1, 'authored', day, [person(1, 'van Dam')]),
    edit(2, 'reviewed', day, [person(2, 'Zed')]),
  ]);
  // 'Z' sorts before 'v' by code units: Zed's row first
  assert.deepEqual(
    rows.map((r) => r.authors[0]),
    ['Zed, P.', 'van Dam, P.']
  );
});

test("the cover's names: each name once, sorted by code units, case and all", () => {
  assert.deepEqual(
    coverNames([
      [edit(1, 'authored', '2026-01-01', [person(2, 'Bee'), person(1, 'Aye')])],
      [edit(2, 'edited', '2026-01-02', [person(1, 'Aye'), person(3, 'Cee')])],
      // a second person of the same name is printed once
      [edit(3, 'edited', '2026-01-03', [person(9, 'Bee'), person(10, 'bee')])],
    ]),
    ['Aye, P.', 'Bee, P.', 'Cee, P.', 'bee, P.']
  );
});

test('the ancestor that draws a pathway: the nearest a top-level pathway below it, one itself last', () => {
  assert.equal(
    nearestAncestor([
      { dbId: 1, depthFromTop: 0 },
      { dbId: 3, depthFromTop: 2 },
      { dbId: 2, depthFromTop: 1 },
    ])?.dbId,
    2
  );
  assert.equal(nearestAncestor([{ dbId: 1, depthFromTop: 0 }])?.dbId, 1);
  assert.equal(nearestAncestor<{ dbId: number; depthFromTop: number }>([]), undefined);
});

test("a summation's HTML keeps its formatting, tables and web links, and loses anything else", () => {
  const clean = sanitiseSummation(
    '<p>Text <b>bold</b> <i>it</i> <a href="https://example.org/">link</a>' +
      '<script>alert(1)</script><a href="javascript:void(0)">bad</a>' +
      '<img src="x" onerror="alert(1)"><span style="color:red">kept text</span>' +
      '<a href="/content/detail/R-HSA-1">relative</a><a href="#top">in page</a></p>' +
      '<table><tr><th colspan="2">h</th></tr><tr><td>a</td><td>b</td></tr></table>'
  );
  assert.match(clean, /<b>bold<\/b>/);
  assert.match(clean, /<i>it<\/i>/);
  assert.match(clean, /<a href="https:\/\/example.org\/">link<\/a>/);
  assert.match(clean, /<span>kept text<\/span>/);
  assert.match(clean, /<th colspan="2">h<\/th>/);
  assert.match(clean, /<td>a<\/td><td>b<\/td>/);
  // a relative or in-page link keeps its text and loses its address
  assert.match(clean, /<a>relative<\/a>/);
  assert.match(clean, /<a>in page<\/a>/);
  for (const gone of [
    /script/,
    /alert/,
    /javascript/,
    /<img/,
    /onerror/,
    /style=/,
    /\/content/,
    /#top/,
  ]) {
    assert.doesNotMatch(clean, gone);
  }
});
