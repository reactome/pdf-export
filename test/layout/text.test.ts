// The fixed text (spec 001 T016).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ABOUT_REACTOME,
  ANALYSIS,
  DOCUMENT_HOLDS,
  INSTITUTIONS,
  LICENCE,
  fill,
  ownReferences,
  ownReferencesOf,
} from '../../src/layout/text.ts';
import { FRONT, FRONT_PARTS } from '../../src/layout/front.ts';

test("the licence statement follows the website's: data CC0, art CC BY 4.0", () => {
  assert.match(LICENCE.text, /CC0/);
  assert.match(LICENCE.text, /CC BY 4\.0/);
  assert.equal(LICENCE.page, '/about/license');
});

test("Reactome's institutions, and the introduction's text", () => {
  assert.equal(INSTITUTIONS.length, 4);
  assert.match(ABOUT_REACTOME, /^Reactome is an open-source/);
  for (const [name, text] of Object.entries(ANALYSIS)) assert.ok(text.length > 20, name);
});

test("Reactome's own papers: newest first, each with a DOI and PubMed id", () => {
  const refs = ownReferences();
  assert.ok(refs.length >= 2);
  assert.deepEqual(
    refs.map((r) => r.year),
    [...refs.map((r) => r.year)].sort((a, b) => b - a)
  );
  for (const r of refs) {
    assert.match(r.doi, /^10\.\d{4,}\//);
    assert.ok(Number.isInteger(r.pubMedId));
    assert.ok(Array.isArray(r.authors));
  }
});

test('fill puts in the values it is given, and leaves the rest', () => {
  assert.equal(
    fill(DOCUMENT_HOLDS, { pathways: 3, reactions: 8 }),
    'This document contains 3 pathways and 8 reactions.'
  );
  assert.equal(fill('{a} {b}', { a: 1 }), '1 {b}');
});

test('references.json is read only as a list of papers, each field of its type', () => {
  const paper = {
    pubMedId: 1,
    title: 'A title',
    journal: 'A journal',
    year: 2026,
    doi: '10.1000/x',
    authors: [],
  };
  assert.deepEqual(ownReferencesOf({ references: [paper] }), [paper]);
  assert.throws(() => ownReferencesOf({}), /no references list/);
  assert.throws(() => ownReferencesOf(null), /no references list/);
  for (const bad of [
    { ...paper, pubMedId: '1' },
    { ...paper, year: 2026.5 },
    { ...paper, doi: null },
    { ...paper, authors: [1] },
    'a paper',
  ]) {
    assert.throws(() => ownReferencesOf({ references: [paper, bad] }), /reference 1 is not/);
  }
});

test("every front part is listed once, as FRONT's keys", () => {
  assert.deepEqual([...FRONT_PARTS].sort(), Object.keys(FRONT).sort());
});
