import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { prefixIds } from '../../src/figures/prefix.ts';

const figure = (name: string) =>
  readFileSync(new URL(`../../ci/fixture/figures/${name}`, import.meta.url), 'utf8');

const ids = (svg: string) => [...svg.matchAll(/\sid=["']([^"']+)["']/g)].map((m) => m[1] ?? '');
const references = (svg: string) => [
  ...[...svg.matchAll(/url\((?:['"]|&quot;)?#([^'"&)\s]+)/g)].map((m) => m[1] ?? ''),
  ...[...svg.matchAll(/\s(?:xlink:)?href=["']#([^"']+)["']/g)].map((m) => m[1] ?? ''),
];

/**
 * A page with figures inlined: every id once, every reference to an id on the page, and no
 * id or local reference in a form the prefixing does not know.
 */
function assertWhole(page: string) {
  assert.doesNotMatch(page, /url\((?!\s*(['"]|&quot;)?#|\s*['"]?data:)/, 'a url() of another form');
  const all = ids(page);
  assert.equal(new Set(all).size, all.length, `ids repeated: ${all.join(' ')}`);
  for (const ref of references(page)) assert.ok(all.includes(ref), `no id ${ref}`);
}

test("two of the website's diagrams inlined together keep unique ids, each pointing at its own", () => {
  const alpha = figure('R-HSA-90000200.svg');
  const beta = figure('R-HSA-90000100.svg');
  assert.ok(
    ids(alpha).some((id) => ids(beta).includes(id)),
    'the fixture shares ids'
  );
  const page = prefixIds(alpha, 's-R-HSA-90000200') + prefixIds(beta, 's-R-HSA-90000100');
  assertWhole(page);
  assert.match(page, /url\(#s-R-HSA-90000200-clip-1\)/);
  assert.match(page, /url\(#s-R-HSA-90000100-clip-1\)/);
});

test('an illustration inlined twice, under two sections, collides with nothing', () => {
  const gamma = figure('R-HSA-90000300.svg');
  const page = prefixIds(gamma, 's-R-HSA-90000300') + prefixIds(gamma, 's-R-HSA-90000310');
  assertWhole(page);
  // its own id for the pathway no longer clashes with a section anchored on that id
  assert.ok(!ids(page).includes('R-HSA-90000300'));
});

test('leaves data: images and web addresses as they are', () => {
  const svg =
    '<svg><image href="data:image/png;base64,AAAA"/><a href="https://example.org/#top">x</a>' +
    '<use xlink:href="#shape"/><g id="shape" fill="url(\'#grad\')"/><linearGradient id="grad"/></svg>';
  const out = prefixIds(svg, 's');
  assert.match(out, /href="data:image\/png;base64,AAAA"/);
  assert.match(out, /href="https:\/\/example.org\/#top"/);
  assert.match(out, /xlink:href="#s-shape"/);
  assert.match(out, /url\('#s-grad'\)/);
  assertWhole(out);
});

test('handles the other forms of an id and a url: single quotes, and &quot; in a style', () => {
  const svg =
    "<svg><clipPath id='c'/><use href='#c'/><g style=\"clip-path: url(&quot;#c&quot;)\"/>" +
    '<g clip-path="url(#c)"/></svg>';
  const out = prefixIds(svg, 's');
  assert.match(out, /id='s-c'/);
  assert.match(out, /href='#s-c'/);
  assert.match(out, /url\(&quot;#s-c&quot;\)/);
  assert.match(out, /url\(#s-c\)/);
  assertWhole(out);
});
