// The book's links and outline after the join (spec 001 T026, research R4), on the
// fixture's book printed in parts with the threshold lowered so each PDF splits, as
// T025's tests do: every placeholder link lands on its target's heading, at the top of its
// line; no placeholder or probe is left; the outline is the contents list, nested, each
// entry landing as its link does; and a link with no probe is a fault.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString } from '@cantoo/pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

import { layoutBookFront, layoutBookPart, pageStyles } from '../../src/layout/document.ts';
import type { LayoutOptions } from '../../src/layout/document.ts';
import { PLACEHOLDER, PROBE } from '../../src/layout/html.ts';
import type { Document } from '../../src/model/types.ts';
import { rewriteLinks } from '../../src/print/links.ts';
import { writeOutline } from '../../src/print/outline.ts';
import { joinParts, printBook } from '../../src/print/parts.ts';
import { Printer } from '../../src/print/print.ts';
import {
  bookPdf,
  buildFixture,
  fixtureFigures,
  skipWithoutGraph,
  type Built,
} from '../layout/fixture.ts';

type PdfJs = Awaited<ReturnType<typeof getDocument>['promise']>;

/** A PDF read with pdf.js, let go after. */
async function reading<T>(pdf: Uint8Array, read: (doc: PdfJs) => Promise<T>): Promise<T> {
  const task = getDocument({ data: pdf.slice() });
  try {
    return await read(await task.promise);
  } finally {
    await task.destroy();
  }
}

interface Link {
  /** Counted from 1. */
  page: number;
  rect: number[];
  url: string | null;
  dest: unknown[] | null;
}

/** Every link annotation in a PDF, page by page. */
async function linksOf(doc: PdfJs): Promise<Link[]> {
  const links: Link[] = [];
  for (let page = 1; page <= doc.numPages; page++) {
    for (const a of await (await doc.getPage(page)).getAnnotations()) {
      const { subtype, rect, url, dest } = a as {
        subtype?: unknown;
        rect?: number[];
        url?: unknown;
        dest?: unknown;
      };
      if (subtype !== 'Link' || !rect) continue;
      links.push({
        page,
        rect,
        url: typeof url === 'string' ? url : null,
        dest: Array.isArray(dest) ? (dest as unknown[]) : null,
      });
    }
  }
  return links;
}

/**
 * Where an explicit destination lands, and whether its heading is there: the page holds
 * the title at a heading's size (above 11 pt: body text is 10.5, a contents entry too),
 * its baseline below the destination's height by about its size, so the view's top edge
 * is at the top of the heading's line, the whole heading shown, not a line above or below.
 */
async function landing(
  doc: PdfJs,
  dest: unknown[],
  title: string
): Promise<{ page: number; problem: string | null }> {
  const [ref, kind, , y] = dest;
  const page = (await doc.getPageIndex(ref as { num: number; gen: number })) + 1;
  if ((kind as { name?: unknown } | undefined)?.name !== 'XYZ' || typeof y !== 'number') {
    return { page, problem: `not an /XYZ destination with a height` };
  }
  if (page === 1) return { page, problem: 'lands on the cover' };
  const items = (await (await doc.getPage(page)).getTextContent()).items;
  const heading = items.find((item) => {
    if (!('str' in item) || item.str !== title) return false;
    const size = Number(item.transform[3]);
    const above = y - Number(item.transform[5]);
    return size > 11 && above >= 0.9 * size && above <= 1.6 * size;
  });
  return { page, problem: heading ? null : `no heading "${title}" just below ${String(y)}` };
}

const same = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - (b[i] ?? NaN)) < 0.01);

/** The pages at which the fixture's parts end, as T025's tests: about three sections. */
const THRESHOLD = 1;

describe('links and outline', { skip: skipWithoutGraph }, () => {
  let built: Built;
  let started: Printer | undefined;
  let options: LayoutOptions;
  /** Each PDF joined, by its title: as pdf-lib left it, and with its links and outline. */
  const joined = new Map<string, { doc: Document; copied: Uint8Array; linked: Uint8Array }>();
  before(async () => {
    built = await buildFixture();
    const printer = await Printer.start();
    started = printer;
    options = {
      site: 'https://site.example',
      date: new Date('2026-10-30T12:00:00Z'),
      figures: fixtureFigures(...built.book),
      styles: pageStyles(),
    };
    await printBook(built.book, {
      printer,
      layout: options,
      settings: { threshold: THRESHOLD, parallel: 2, joins: 1 },
      joined: async (j) => {
        const copied = await j.pdf.save({ useObjectStreams: false });
        writeOutline(j.pdf, j.doc.contents ?? [], rewriteLinks(j.pdf));
        const linked = await j.pdf.save({ useObjectStreams: false });
        joined.set(j.doc.cover.title, { doc: j.doc, copied, linked });
      },
    });
  });
  after(async () => {
    await started?.close();
  });

  test('every link lands on its target heading, at the top of its line', async () => {
    assert.deepEqual([...joined.keys()].sort(), ['Alpha pathway', 'Gamma pathway', 'beta pathway']);
    for (const [name, { doc, copied, linked }] of joined) {
      const titleOf = new Map((doc.contents ?? []).map((e) => [e.target, e.title]));
      const placeholders = (await reading(copied, linksOf)).flatMap((link) =>
        link.url?.startsWith(PLACEHOLDER)
          ? [{ ...link, anchor: decodeURIComponent(link.url.slice(PLACEHOLDER.length)) }]
          : []
      );
      // the contents list's links, the locations' and the events' before and after, across parts
      assert.ok(placeholders.length >= (doc.contents ?? []).length, name);
      await reading(linked, async (pdf) => {
        const links = await linksOf(pdf);
        for (const placeholder of placeholders) {
          const label = `${name}: page ${String(placeholder.page)}, to ${placeholder.anchor}`;
          // the same annotation, where the placeholder was
          const link = links.find(
            (l) => l.page === placeholder.page && same(l.rect, placeholder.rect)
          );
          assert.ok(link?.dest, `${label}: no destination`);
          const title = titleOf.get(placeholder.anchor);
          assert.ok(title, `${label}: not in the contents`);
          const { problem } = await landing(pdf, link.dest, title);
          assert.equal(problem, null, label);
        }
        // and a destination for each placeholder, no more
        assert.equal(
          links.filter((l) => l.dest).length,
          placeholders.length,
          `${name}: destinations`
        );
      });
    }
  });

  test("every other link is kept as printed: the website's pages", async () => {
    // each link that is neither a placeholder nor a probe (events' names and figures, to
    // the website), by page, rectangle and address, before and after
    const others = (links: Link[]) =>
      links
        .filter((l) => !l.dest && !l.url?.startsWith(PLACEHOLDER) && !l.url?.startsWith(PROBE))
        .map((l) => [l.page, l.rect.map((v) => Math.round(v * 100) / 100), l.url]);
    for (const [name, { copied, linked }] of joined) {
      const before = others(await reading(copied, linksOf));
      assert.ok(
        before.some(
          ([, , url]) => typeof url === 'string' && url.startsWith('https://site.example/')
        ),
        `${name}: no website links`
      );
      assert.deepEqual(others(await reading(linked, linksOf)), before, name);
    }
  });

  test('no placeholder or probe is left, in the annotations or the file', async () => {
    for (const [name, { doc, copied, linked }] of joined) {
      const probes = (await reading(copied, linksOf)).filter((l) => l.url?.startsWith(PROBE));
      // a probe for each full section and front part, before
      const held = doc.places.filter((p) => p.full).length + 2;
      assert.equal(probes.length, held, name);
      const left = (await reading(linked, linksOf)).filter(
        (l) => l.url?.startsWith(PLACEHOLDER) || l.url?.startsWith(PROBE)
      );
      assert.deepEqual(left, [], name);
      // every annotation a page lists is there: a probe is taken off its page, not only
      // deleted, which would leave the page listing an object that is gone
      const reloaded = await PDFDocument.load(linked);
      for (const [i, page] of reloaded.getPages().entries()) {
        const annots = page.node.Annots();
        for (let k = 0; k < (annots?.size() ?? 0); k++) {
          const annot = reloaded.context.lookup(annots?.get(k));
          assert.ok(
            annot instanceof PDFDict,
            `${name}: page ${String(i + 1)}, annotation ${String(k)}`
          );
        }
      }
      // nor the probes' objects, unreferenced, in the file
      const file = Buffer.from(linked);
      for (const address of [PLACEHOLDER, PROBE]) {
        assert.ok(Buffer.from(copied).includes(address), `${name}: ${address} before`);
        assert.ok(!file.includes(address), `${name}: ${address} after`);
      }
    }
  });

  test('the outline is the contents list, nested by depth, landing as its links do', async () => {
    interface Entry {
      title: string;
      dest: unknown[] | string | null;
      count?: number;
      items: Entry[];
    }
    const flat = (items: Entry[], depth = 0): { entry: Entry; depth: number }[] =>
      items.flatMap((entry) => [{ entry, depth }, ...flat(entry.items, depth + 1)]);
    const titles = (items: Entry[]): unknown[] =>
      items.map((item) => (item.items.length > 0 ? [item.title, titles(item.items)] : item.title));
    for (const [name, { doc, linked }] of joined) {
      await reading(linked, async (pdf) => {
        const outline = ((await pdf.getOutline()) as Entry[] | null) ?? [];
        const contents = doc.contents ?? [];
        // every entry, in the contents' order, at its depth
        assert.deepEqual(
          flat(outline).map(({ entry, depth }) => [entry.title, depth]),
          contents.map((e) => [e.title, e.depth]),
          name
        );
        for (const [i, { entry, depth }] of flat(outline).entries()) {
          const target = contents[i]?.target ?? '';
          assert.ok(Array.isArray(entry.dest), `${name}: ${entry.title}`);
          const { problem } = await landing(pdf, entry.dest, entry.title);
          assert.equal(problem, null, `${name}: ${entry.title} (${target})`);
          // the top level open, deeper entries closed
          if (entry.items.length > 0) {
            assert.equal(Math.sign(entry.count ?? 0), depth === 0 ? 1 : -1, entry.title);
          }
        }
      });
    }
    // Alpha's, whole: its later place of Two-parent sub a leaf, not repeated with its
    // subtree, and landing on its one full section (FR-004)
    await reading(joined.get('Alpha pathway')?.linked ?? new Uint8Array(), async (pdf) => {
      const outline = ((await pdf.getOutline()) as Entry[] | null) ?? [];
      assert.deepEqual(titles(outline), [
        'Introduction',
        [
          'Alpha pathway',
          [
            'Shared reaction',
            ['Alpha sub two', [['Two-parent sub', ['Disease reaction']]]],
            [
              'Alpha sub one',
              ['Reaction one', 'Black box two', ['Alpha sub one diagram child', ['Reaction nine']]],
            ],
            'Two-parent sub',
          ],
        ],
        'Contents',
      ]);
      const twoParent = flat(outline).filter(({ entry }) => entry.title === 'Two-parent sub');
      assert.equal(twoParent.length, 2);
      const [full, short] = twoParent.map(({ entry }) => entry.dest);
      assert.deepEqual(short, full);
    });
  });

  test("the outline's dictionaries are linked as the PDF reference has them", async () => {
    // read back with pdf-lib, not pdf.js, which walks only /First and /Next: each item's
    // /Parent, /Prev, /Next, /First and /Last, and its /Count, the descendants that show
    // when it is open, positive if it is, negated if not (the top level open)
    for (const [name, { doc, linked }] of joined) {
      const pdf = await PDFDocument.load(linked);
      const key = (k: string) => PDFName.of(k);
      const ref = (dict: PDFDict, k: string) => dict.get(key(k))?.toString();
      const rootRef = pdf.catalog.get(key('Outlines'));
      assert.ok(rootRef, name);
      const root = pdf.context.lookup(rootRef, PDFDict);
      assert.equal(root.get(key('Type'))?.toString(), '/Outlines', name);
      const titles: [string, number][] = [];
      /** Walks an item's children; returns how many show beneath it when it is open. */
      const walk = (item: PDFDict, itemRef: string, depth: number): number => {
        const first = item.get(key('First'));
        if (!first) {
          assert.equal(item.get(key('Last')), undefined, `${name}: /Last with no /First`);
          assert.equal(item.get(key('Count')), undefined, `${name}: /Count with no children`);
          return 0;
        }
        let shown = 0;
        let previous: string | undefined;
        let at = first.toString();
        let childRef = first;
        for (;;) {
          const child = pdf.context.lookup(childRef, PDFDict);
          const read = child.lookup(key('Title'));
          const title =
            read instanceof PDFHexString || read instanceof PDFString ? read.decodeText() : '';
          const label = `${name}: ${title}`;
          titles.push([title, depth]);
          assert.equal(ref(child, 'Parent'), itemRef, `${label}: /Parent`);
          assert.equal(ref(child, 'Prev'), previous, `${label}: /Prev`);
          const beneath = walk(child, at, depth + 1);
          const count = child.lookupMaybe(key('Count'), PDFNumber)?.asNumber();
          if (beneath > 0 || count !== undefined) {
            // open only at the top level
            assert.equal(count, depth === 0 ? beneath : -beneath, `${label}: /Count`);
          }
          shown += 1 + (count !== undefined && count > 0 ? beneath : 0);
          const next = child.get(key('Next'));
          if (!next) {
            assert.equal(ref(item, 'Last'), at, `${label}: its parent's /Last`);
            break;
          }
          previous = at;
          at = next.toString();
          childRef = next;
        }
        return shown;
      };
      const shown = walk(root, rootRef.toString(), 0);
      assert.equal(root.lookupMaybe(key('Count'), PDFNumber)?.asNumber(), shown, `${name}: /Count`);
      assert.deepEqual(
        titles,
        (doc.contents ?? []).map((e) => [e.title, e.depth]),
        name
      );
    }
  });

  test('a link with no probe, or an anchor probed twice, is a fault, naming it', async () => {
    const printer = started;
    assert.ok(printer);
    const alpha = bookPdf(built, 'Alpha pathway');
    // the front part alone: its contents list links to sections printed in other parts
    const front = await PDFDocument.load(await printer.part(layoutBookFront(alpha, options).html));
    assert.throws(
      () => rewriteLinks(front),
      /a link to s-R-HSA-90000200 has no probe.*a link to s-R-HSA-90000211 has no probe/
    );
    // and nothing was changed: the placeholders and probes are still there
    const kept = await reading(await front.save(), linksOf);
    assert.ok(kept.some((l) => l.url?.startsWith(PROBE)));
    assert.ok(kept.every((l) => !l.dest));
    // a section printed twice and joined: its anchor probed twice
    const place = alpha.places.find((p) => p.full && p.section.event.stId === 'R-HSA-90000211');
    assert.ok(place);
    const part = await printer.part(layoutBookPart(alpha, [place], options).html);
    const { pdf: twice } = await joinParts([part, part]);
    assert.throws(() => rewriteLinks(twice), /s-R-HSA-90000211 is probed twice/);
  });

  test('an outline entry whose target the PDF does not hold is a fault, naming it', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage();
    const targets = new Map([['here', { page: page.ref, index: 0, y: 700 }]]);
    assert.throws(() => {
      writeOutline(
        pdf,
        [
          { title: 'Here', target: 'here', depth: 0 },
          { title: 'Nowhere', target: 'nowhere', depth: 1 },
        ],
        targets
      );
    }, /Nowhere \(nowhere\)/);
    assert.equal(pdf.catalog.get(PDFName.of('Outlines')), undefined);
  });
});
