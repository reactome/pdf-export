// The layout on the fixture's model (spec 001 T018): its parts and their order (FR-005), its
// links (FR-003), and the book's placeholders and probes (research R4).
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import {
  layoutBookFront,
  layoutBookPart,
  layoutSingle,
  pageStyles,
  type LayoutOptions,
} from '../../src/layout/document.ts';
import { figureKey } from '../../src/layout/figure.ts';
import { Links, PLACEHOLDER, PROBE } from '../../src/layout/html.ts';
import { sectionHtml } from '../../src/layout/section.ts';
import type { Document, Section } from '../../src/model/types.ts';
import { buildFixture, fixtureFigures, skipWithoutGraph, type Built } from './fixture.ts';

const SITE = 'https://site.example';

/** Where each of a list of markers first appears, in the order given; -1 where it does not. */
const positions = (html: string, markers: readonly string[]) => markers.map((m) => html.indexOf(m));

const increasing = (list: readonly number[]) =>
  list.every((n, i) => i === 0 || n > (list[i - 1] ?? 0));

/** A section's HTML, from its heading to the next section. */
function sectionOf(html: string, stId: string): string {
  const start = html.indexOf(`id="s-${stId}"`);
  assert.ok(start >= 0, `no section for ${stId}`);
  const end = html.indexOf('<section class="event"', start);
  return html.slice(start, end < 0 ? undefined : end);
}

const fullSection = (doc: Document, stId: string): Section => {
  for (const p of doc.places) if (p.full && p.section.event.stId === stId) return p.section;
  throw new Error(`no full section for ${stId}`);
};

/** Every href in some HTML. */
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1] ?? '');
const ids = (html: string) => new Set([...html.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1] ?? ''));

describe('the layout', { skip: skipWithoutGraph }, () => {
  let built: Built;
  let options: LayoutOptions;
  before(async () => {
    built = await buildFixture();
    options = {
      site: SITE,
      date: new Date('2026-10-30T12:00:00Z'),
      figures: fixtureFigures(built.book, built.pathway, built.reaction),
      styles: pageStyles(),
    };
  });

  test("a single pathway's parts, in order: cover, introduction, contents, sections", () => {
    const { html } = layoutSingle(built.pathway, options);
    const at = positions(html, [
      '<div class="cover">',
      'data-part="introduction"',
      'data-part="contents"',
      'id="s-R-HSA-90000100"',
      'id="s-R-HSA-90000220"',
    ]);
    assert.ok(at.every((n) => n >= 0) && increasing(at), String(at));
    assert.doesNotMatch(html, /data-part="analysis"/);
    // the cover: logo, title, figure, the excerpt note, names, institutions, licence, date
    const cover = html.slice(at[0], at[1]);
    const parts = positions(cover, [
      'aria-label="Reactome"',
      '>beta pathway</p>',
      'class="cover-figure"',
      'class="excerpt"',
      'class="names"',
      'class="institutions"',
      'class="licence"',
      '30 October 2026',
    ]);
    assert.ok(parts.every((n) => n >= 0) && increasing(parts), String(parts));
  });

  test('a reaction alone has no contents list, and its cover no figure or excerpt note', () => {
    const { html } = layoutSingle(built.reaction, options);
    assert.doesNotMatch(html, /data-part="contents"/);
    assert.doesNotMatch(html, /class="cover-figure"|class="excerpt"/);
    assert.match(html, /id="s-R-HSA-90000211"/);
  });

  test('with an analysis, its properties after the introduction, and what it found last in a section', () => {
    const { html } = layoutSingle(built.pathway, {
      ...options,
      analysis: {
        properties: {
          token: 'TOKEN1',
          type: 'OVERREPRESENTATION',
          species: 'Homo sapiens',
          projection: false,
          interactors: true,
          identifiersFound: 3,
          identifiersTotal: 5,
          pathwaysHit: 2,
        },
        found: new Map([
          [
            'R-HSA-90000100',
            {
              entities: [{ identifier: 'P00001', mapsTo: ['P00001'], resource: 'UniProt' }],
              interactors: [{ identifier: 'Q00002', mapsTo: ['P00001'], resource: 'IntAct' }],
            },
          ],
        ]),
      },
    });
    const at = positions(html, [
      'data-part="introduction"',
      'data-part="analysis"',
      'data-part="contents"',
    ]);
    assert.ok(at.every((n) => n >= 0) && increasing(at), String(at));
    const section = sectionOf(html, 'R-HSA-90000100');
    const found = positions(section, [
      'Edit history',
      'Entities found',
      'P00001',
      'Interactors found',
      'Q00002',
    ]);
    assert.ok(found.every((n) => n >= 0) && increasing(found), String(found));
  });

  test("a section's parts are in the Background's order", () => {
    // every part the fixture's events have, in the order FR-005 gives
    const order = [
      'class="name"',
      '<dt>Location</dt>',
      '<dt>Stable identifier</dt>',
      '<dt>Type</dt>',
      '<dt>Compartments</dt>',
      '<dt>Diseases</dt>',
      '<dt>Inferred from</dt>',
      'class="figure',
      'class="summation"',
      '<dt>Preceded by</dt>',
      '<dt>Followed by</dt>',
      'Literature references',
      'Edit history',
    ];
    const { html } = layoutBookPart(built.book, built.book.places, options);
    const seen = new Set<string>();
    for (const place of built.book.places) {
      if (!place.full) continue;
      const at = positions(sectionOf(html, place.section.event.stId), order);
      const present = at.filter((n) => n >= 0);
      assert.ok(increasing(present), `${place.section.event.stId}: ${String(at)}`);
      order.forEach((marker, i) => {
        if ((at[i] ?? -1) >= 0) seen.add(marker);
      });
    }
    // and the fixture has each of them somewhere
    assert.deepEqual([...seen].sort(), [...order].sort());
  });

  test("a section's figure, sized and its ids its own; a missing one is reported", () => {
    const { html } = layoutSingle(built.pathway, options);
    assert.match(
      sectionOf(html, 'R-HSA-90000100'),
      /<div class="figure"><svg [^>]*width="[\d.]+pt"/
    );
    assert.match(sectionOf(html, 'R-HSA-90000100'), /id="s-R-HSA-90000100-clip-1"/);
    const root = fullSection(built.pathway, 'R-HSA-90000100');
    assert.ok(root.figure);
    const figures = new Map(options.figures);
    figures.delete(figureKey(root.figure));
    const laid = layoutSingle(built.pathway, { ...options, figures });
    assert.deepEqual(laid.report.missing, ['R-HSA-90000100']);
    assert.doesNotMatch(sectionOf(laid.html, 'R-HSA-90000100'), /class="figure/);
  });

  test('links as FR-003 says: names to the website, the rest to their sections', () => {
    const { html } = layoutSingle(built.pathway, options);
    // each event's name to its page on the website
    assert.match(
      sectionOf(html, 'R-HSA-90000220'),
      /class="name"><a href="https:\/\/site\.example\/content\/detail\/R-HSA-90000220">Shared reaction<\/a>/
    );
    // its location to its section
    assert.match(
      sectionOf(html, 'R-HSA-90000220'),
      /<dt>Location<\/dt><dd><a href="#s-R-HSA-90000100">beta pathway<\/a>/
    );
    // what it was inferred from, not held, to the website
    assert.match(
      sectionOf(html, 'R-HSA-90000120'),
      /<dt>Inferred from<\/dt><dd><a href="https:\/\/site\.example\/content\/detail\/R-MMU-\d+">/
    );
    // every contents entry and every internal link lands on an id the document holds
    const held = ids(html);
    const internal = hrefs(html).filter((h) => h.startsWith('#'));
    assert.ok(internal.length > 5);
    for (const href of internal) assert.ok(held.has(href.slice(1)), href);
    const contents = html.slice(
      html.indexOf('data-part="contents"'),
      html.indexOf('<div class="sections">')
    );
    for (const entry of built.pathway.contents ?? []) {
      assert.ok(contents.includes(`href="#${entry.target}"`), entry.target);
      assert.ok(contents.includes(`data-target="${entry.target}"`), entry.target);
    }
  });

  test("a reaction's events before and after, those the book holds, to their sections", () => {
    const { html } = layoutBookPart(built.book, built.book.places, options);
    const one = sectionOf(html, 'R-HSA-90000211');
    assert.match(
      one,
      /<dt>Preceded by<\/dt><dd><a href="https:\/\/anchor\.invalid\/s-R-HSA-90000313">Polymerisation four<\/a><\/dd>/
    );
    assert.match(
      one,
      /<dt>Followed by<\/dt><dd>(<a href="https:\/\/anchor\.invalid\/s-R-HSA-\d+">[^<]+<\/a>(; )?)+<\/dd>/
    );
    assert.match(one, /Black box two/);
  });

  test("a location's pathway the PDF does not hold is plain text, and an inferred-from source it holds links to its section", () => {
    const section = fullSection(built.book, 'R-HSA-90000120');
    const links = new Links(false, SITE, new Set(['s-R-HSA-90000100', 's-SOURCE']));
    const html = sectionHtml(
      {
        ...section,
        path: [
          { dbId: 1, stId: 'R-HSA-90000100', name: 'Held' },
          { dbId: 2, stId: 'R-HSA-1', name: 'Not held' },
        ],
        inferredFrom: [{ dbId: 3, stId: 'SOURCE', name: 'Source', speciesName: 'Mus musculus' }],
      },
      { links, figures: new Map(), found: null, report: { belowFloor: [], missing: [] } }
    );
    assert.match(
      html,
      /<a href="#s-R-HSA-90000100">Held<\/a> <span class="sep">›<\/span> Not held<\/dd>/
    );
    assert.match(html, /<a href="#s-SOURCE">Source<\/a> \(Mus musculus\)/);
  });

  test("the book's later places are short entries, linked to the one full section (FR-004)", () => {
    const { html } = layoutBookPart(built.book, built.book.places, options);
    const shorts = [...html.matchAll(/<p class="short"[^>]*>(.*?)<\/p>/g)].map((m) => m[1] ?? '');
    assert.ok(shorts.length > 0);
    for (const entry of shorts) {
      const target = /href="https:\/\/anchor\.invalid\/(s-[^"]+)"/.exec(entry)?.[1];
      assert.ok(target && ids(html).has(target), entry);
      assert.match(entry, /<span class="id">R-HSA-\d+<\/span>$/);
    }
    // each event's full section is written once
    const anchors = [...html.matchAll(/class="name"/g)].length;
    assert.equal(anchors, built.book.places.filter((p) => p.full).length);
  });

  test('the book: placeholder links and a probe in every target; a single PDF has neither', () => {
    const front = layoutBookFront(built.book, options).html;
    const part = layoutBookPart(built.book, built.book.places, options).html;
    for (const html of [front, part]) {
      assert.ok(!hrefs(html).some((h) => h.startsWith('#')), 'a fragment link in the book');
      // every target holds its probe, first thing inside it
      for (const id of ids(html)) {
        if (!/^(s-R-[A-Z]{3}-\d+|introduction|contents)$/.test(id)) continue;
        assert.match(
          html,
          new RegExp(`id="${id}"[^>]*><a class="probe" href="${PROBE}${id}"></a>`),
          id
        );
      }
    }
    // every placeholder names a target the book holds, in some part
    const targets = new Set([...ids(front), ...ids(part)]);
    const placeholders = [...hrefs(front), ...hrefs(part)].filter((h) => h.startsWith(PLACEHOLDER));
    assert.ok(placeholders.length > 10);
    for (const href of placeholders) assert.ok(targets.has(href.slice(PLACEHOLDER.length)), href);
    // the front part holds the cover, introduction and contents, and no sections
    const at = positions(front, [
      '<div class="cover">',
      'data-part="introduction"',
      'data-part="contents"',
    ]);
    assert.ok(at.every((n) => n >= 0) && increasing(at), String(at));
    assert.doesNotMatch(front, /class="name"/);
    // the book's cover: its title and release, no figure, no excerpt note
    assert.match(front, />The Reactome Book<\/p>\n<p class="release">Reactome release 98<\/p>/);
    assert.doesNotMatch(front, /class="cover-figure"|class="excerpt"/);

    const single = layoutSingle(built.pathway, options).html;
    assert.doesNotMatch(single, /anchor\.invalid|probe\.invalid|class="probe"/);
  });

  test('running headers and page numbers in a single PDF only; the book has none printed', () => {
    const single = layoutSingle(built.pathway, options).html;
    assert.match(single, /@page \{ @top-center \{ content: "beta pathway";/);
    assert.match(single, /@bottom-center \{ content: counter\(page\);/);
    assert.match(
      single,
      /@page cover \{ @top-center \{ content: none; \} @bottom-center \{ content: none; \} \}/
    );
    for (const name of ['introduction', 'contents', 'analysis']) {
      assert.match(single, new RegExp(`@page ${name} \\{ @top-center`));
    }
    const front = layoutBookFront(built.book, options).html;
    assert.doesNotMatch(front, /@top-center|@bottom-center/);
  });
});
