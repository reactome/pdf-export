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
} from '../../src/layout/text.ts';

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
