// The book's contents, second pass (spec 001 T028, research R4), on the fixture's book
// printed in parts with the threshold lowered so each PDF splits, as T025's to T027's tests
// do, each joined PDF's front part printed again with the numbers and swapped in before its
// links are rewritten, its outline written and its pages stamped: every entry's number is
// its target's page, across the parts; the front part keeps its length, and a reprint that
// would not is refused; only the front part is printed again; the reprinted front part's
// links land, its pages are stamped, the outline lands with them; and nothing of the first
// print is left in the file.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRef,
  PDFStream,
  type PDFObject,
} from '@cantoo/pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

import { layoutBookFront, pageStyles, type LayoutOptions } from '../../src/layout/document.ts';
import { PAGE } from '../../src/layout/figure.ts';
import { PLACEHOLDER, PROBE } from '../../src/layout/html.ts';
import type { Document } from '../../src/model/types.ts';
import { reprintFront } from '../../src/print/contents.ts';
import { rewriteLinks } from '../../src/print/links.ts';
import { writeOutline } from '../../src/print/outline.ts';
import { joinParts, printBook, type Part, type PartPrinter } from '../../src/print/parts.ts';
import { Printer } from '../../src/print/print.ts';
import { stampPages } from '../../src/print/stamp.ts';
import { buildFixture, fixtureFigures, skipWithoutGraph, type Built } from '../layout/fixture.ts';

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

interface Item {
  str: string;
  x: number;
  y: number;
  size: number;
}

interface PageRead {
  width: number;
  height: number;
  items: Item[];
  links: { rect: number[]; url: string | null; dest: unknown[] | null }[];
}

/** Each page's text items and link annotations. */
function pagesOf(pdf: Uint8Array): Promise<PageRead[]> {
  return reading(pdf, async (doc) => {
    const pages: PageRead[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const [, , width = 0, height = 0] = page.view;
      const items = (await page.getTextContent()).items.flatMap((item) => {
        if (!('str' in item) || item.str.trim() === '') return [];
        const [, , c = 0, d = 0, x = 0, y = 0] = item.transform as number[];
        return [{ str: item.str, x, y, size: Math.hypot(c, d) }];
      });
      const links = (await page.getAnnotations()).flatMap((a) => {
        const { subtype, rect, url, dest } = a as {
          subtype?: unknown;
          rect?: number[];
          url?: unknown;
          dest?: unknown;
        };
        if (subtype !== 'Link' || !rect) return [];
        return [
          {
            rect,
            url: typeof url === 'string' ? url : null,
            dest: Array.isArray(dest) ? (dest as unknown[]) : null,
          },
        ];
      });
      pages.push({ width, height, items, links });
    }
    return pages;
  });
}

/** A page's running header and number, as stamped: the text in its top and bottom margins. */
const header = (page: PageRead) =>
  page.items
    .filter((item) => item.y > page.height - PAGE.margin)
    .map((item) => item.str)
    .join('');
const footer = (page: PageRead) =>
  page.items
    .filter((item) => item.y < PAGE.margin)
    .map((item) => item.str)
    .join('');

/**
 * The contents' numbers as printed, in order: digits at the right of the body of the front
 * part's pages from its contents' heading (18 pt) on, the last front part.
 */
function contentsNumbers(pages: readonly PageRead[], front: number): number[] {
  const first = pages.findIndex((page) =>
    page.items.some((item) => item.str === 'Contents' && item.size > 17)
  );
  assert.ok(first > 0 && first < front, `the contents' heading on page ${String(first + 1)}`);
  return pages
    .slice(first, front)
    .flatMap((page) =>
      page.items.flatMap((item) =>
        /^\d+$/.test(item.str) &&
        item.y > PAGE.margin &&
        item.y < page.height - PAGE.margin &&
        item.x > page.width / 2
          ? [Number(item.str)]
          : []
      )
    );
}

/**
 * The page, counted from 1, where a title is first a heading (above 11 pt: body text and
 * contents entries are 10.5) after the cover, found from the text alone.
 */
function headingPage(pages: readonly PageRead[], title: string): number | null {
  const i = pages.findIndex(
    (page, k) => k > 0 && page.items.some((item) => item.str === title && item.size > 11)
  );
  return i < 0 ? null : i + 1;
}

/** Where a destination lands, and whether the title is a heading just below it (T026's test). */
async function landing(doc: PdfJs, dest: unknown[], title: string): Promise<string | null> {
  const [ref, kind, , y] = dest;
  const page = (await doc.getPageIndex(ref as { num: number; gen: number })) + 1;
  if ((kind as { name?: unknown } | undefined)?.name !== 'XYZ' || typeof y !== 'number') {
    return 'not an /XYZ destination with a height';
  }
  if (page === 1) return 'lands on the cover';
  const items = (await (await doc.getPage(page)).getTextContent()).items;
  const heading = items.find((item) => {
    if (!('str' in item) || item.str !== title) return false;
    const size = Number(item.transform[3]);
    const above = y - Number(item.transform[5]);
    return size > 11 && above >= 0.9 * size && above <= 1.6 * size;
  });
  return heading ? null : `no heading "${title}" just below ${String(y)} on page ${String(page)}`;
}

/** The indirect objects of a PDF that nothing reaches from its trailer. */
function unreachable(pdf: PDFDocument): string[] {
  const { context } = pdf;
  const seen = new Set<PDFRef>();
  const { Root, Info } = context.trailerInfo;
  const stack: PDFObject[] = [Root, Info].filter((o) => o !== undefined);
  for (let object = stack.pop(); object !== undefined; object = stack.pop()) {
    if (object instanceof PDFRef) {
      if (seen.has(object)) continue;
      seen.add(object);
      const found = context.lookup(object);
      if (found) stack.push(found);
    } else if (object instanceof PDFDict) stack.push(...object.values());
    else if (object instanceof PDFArray) stack.push(...object.asArray());
    else if (object instanceof PDFStream) stack.push(object.dict);
  }
  return context
    .enumerateIndirectObjects()
    .flatMap(([ref]) => (seen.has(ref) ? [] : [String(ref)]));
}

/** The pages at which the fixture's parts end, as T025's tests: about three sections. */
const THRESHOLD = 1;

interface Made {
  doc: Document;
  parts: Part[];
  /** Saved as joined; with the front part reprinted; and with links, outline and stamps. */
  joined: Uint8Array;
  swapped: Uint8Array;
  done: Uint8Array;
}

describe("the book's contents, second pass", { skip: skipWithoutGraph }, () => {
  let built: Built;
  let started: Printer | undefined;
  let options: LayoutOptions;
  const made = new Map<string, Made>();
  /** Every page of HTML printed, in order. */
  const printed: string[] = [];

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
    const counting: PartPrinter = {
      part: (html) => {
        printed.push(html);
        return printer.part(html);
      },
    };
    await printBook(built.book, {
      printer: counting,
      layout: options,
      settings: { threshold: THRESHOLD, parallel: 2, joins: 1 },
      joined: async (j) => {
        const joined = await j.pdf.save({ useObjectStreams: false });
        await reprintFront(j, counting, options);
        const swapped = await j.pdf.save({ useObjectStreams: false });
        const targets = rewriteLinks(j.pdf);
        writeOutline(j.pdf, j.doc.contents ?? [], targets);
        await stampPages(j, targets);
        const done = await j.pdf.save({ useObjectStreams: false });
        made.set(j.doc.cover.title, { doc: j.doc, parts: j.parts, joined, swapped, done });
      },
    });
  });
  after(async () => {
    await started?.close();
  });

  const madeOf = (title: string) => {
    const found = made.get(title);
    if (!found) throw new Error(`${title} was not made`);
    return found;
  };

  test("every contents entry's number is its target's page, across the parts", async () => {
    assert.deepEqual([...made.keys()].sort(), ['Alpha pathway', 'Gamma pathway', 'beta pathway']);
    for (const [name, { doc, parts, joined, done }] of made) {
      const front = parts[0]?.pages ?? 0;
      const pages = await pagesOf(done);
      const entries = doc.contents ?? [];
      const expected = entries.map((entry) => headingPage(pages, entry.title));
      assert.ok(
        expected.every((page) => page !== null),
        `${name}: ${String(expected)}`
      );
      assert.deepEqual(contentsNumbers(pages, front), expected, name);
      // each number is also the page's stamped number
      for (const page of expected) {
        const at = pages[page - 1];
        assert.ok(at);
        assert.equal(footer(at), String(page), `${name}: page ${String(page)}`);
      }
      // targets in the front part and in at least two parts of sections
      const partOf = (page: number) => {
        let start = 0;
        return parts.findIndex((part) => (start += part.pages) >= page);
      };
      const reached = new Set(expected.map(partOf));
      assert.ok(reached.has(0) && reached.size >= 3, `${name}: parts ${[...reached].join(', ')}`);
      // as joined, before the second pass, every number was the placeholder
      const placeholders = contentsNumbers(await pagesOf(joined), front);
      assert.ok(placeholders.length >= entries.length, name);
      assert.ok(
        placeholders.every((n) => n === 0),
        `${name}: ${String(placeholders)}`
      );
    }
  });

  test('only the front part is printed again, keeping its length', async () => {
    for (const [name, { doc, parts, joined, swapped }] of made) {
      const front = layoutBookFront(doc, options).html;
      // the front part twice, the second time with the numbers; every other part once
      const own = printed.filter((html) => html.includes(`<title>${name}</title>`));
      assert.equal(own.filter((html) => html === front).length, 1, name);
      const again = own.filter((html) => html !== front && html.includes('data-part="contents"'));
      assert.equal(again.length, 1, name);
      assert.equal(own.length, parts.length + 1, name);
      // the same pages, the front part's with its numbers in, the rest as joined
      const [was, now] = [await pagesOf(joined), await pagesOf(swapped)];
      assert.equal(now.length, was.length, name);
      const frontPages = parts[0]?.pages ?? 0;
      const text = (page: PageRead | undefined, digits: boolean) =>
        (page?.items ?? []).map((item) => (digits ? item.str : item.str.replace(/\d+/g, '#')));
      for (const [i, page] of now.entries()) {
        const label = `${name}, page ${String(i + 1)}`;
        if (i < frontPages) assert.deepEqual(text(page, false), text(was[i], false), label);
        else assert.deepEqual(page, was[i], label);
      }
      assert.notDeepEqual(
        now.slice(0, frontPages).map((page) => text(page, true)),
        was.slice(0, frontPages).map((page) => text(page, true)),
        name
      );
    }
  });

  test('a reprint that would move the pages is refused, changing nothing', async () => {
    const alpha = madeOf('Alpha pathway');
    const front = alpha.parts[0]?.pages ?? 0;
    const printer = started;
    assert.ok(printer);
    const refused = async (part: PartPrinter['part'], expected: RegExp) => {
      const pdf = await PDFDocument.load(alpha.joined);
      await assert.rejects(
        reprintFront({ doc: alpha.doc, pdf, parts: alpha.parts }, { part }, options),
        expected
      );
      assert.deepEqual(await pagesOf(await pdf.save()), await pagesOf(alpha.joined));
    };
    // a page more: the introduction pushed onto a page of its own
    await refused(
      (html) =>
        printer.part(html.replace('<h1 id="introduction"', '<div style="height: 250mm"></div>$&')),
      new RegExp(
        `The front part's numbers moved its pages: ${String(front)} pages, then ${String(front + 1)}; moved: introduction, contents`
      )
    );
    // the same pages, the headings on others: the reprint's cover moved to its end
    await refused(
      async (html) => {
        const printed = await PDFDocument.load(await printer.part(html));
        const moved = await PDFDocument.create();
        const [cover, ...rest] = printed.getPageIndices();
        const pages = await moved.copyPages(printed, [...rest, cover ?? 0]);
        for (const page of pages) moved.addPage(page);
        return moved.save();
      },
      new RegExp(`${String(front)} pages, then ${String(front)}; moved: introduction, contents`)
    );
    // after the links are rewritten, the probes are gone
    const linked = await PDFDocument.load(alpha.joined);
    rewriteLinks(linked);
    await assert.rejects(
      reprintFront({ doc: alpha.doc, pdf: linked, parts: alpha.parts }, printer, options),
      /entries with no probe in the joined PDF \(run before rewriteLinks\): introduction, /
    );
    // and parts that are not the PDF's
    await assert.rejects(
      reprintFront(
        { doc: alpha.doc, pdf: await PDFDocument.load(alpha.joined), parts: alpha.parts.slice(1) },
        printer,
        options
      ),
      /first part is not its front part/
    );
    await assert.rejects(
      reprintFront(
        {
          doc: alpha.doc,
          pdf: await PDFDocument.load(alpha.joined),
          parts: alpha.parts.slice(0, -1),
        },
        printer,
        options
      ),
      /The parts hold \d+ pages, the joined PDF \d+/
    );
    // and the PDF joined twice over, every anchor probed twice
    const { pdf: twice } = await joinParts([alpha.joined, alpha.joined]);
    await assert.rejects(
      reprintFront(
        { doc: alpha.doc, pdf: twice, parts: [...alpha.parts, ...alpha.parts] },
        printer,
        options
      ),
      /introduction is probed twice/
    );
  });

  test("the reprinted front part's links land, and the outline lands with them", async () => {
    for (const [name, { doc, parts, swapped, done }] of made) {
      const front = parts[0]?.pages ?? 0;
      const titleOf = new Map((doc.contents ?? []).map((e) => [e.target, e.title]));
      // the reprinted front part's placeholders, by page and rectangle
      const placeholders = (await pagesOf(swapped)).slice(0, front).flatMap((page, i) =>
        page.links.flatMap((link) =>
          link.url?.startsWith(PLACEHOLDER)
            ? [
                {
                  page: i,
                  rect: link.rect,
                  anchor: decodeURIComponent(link.url.slice(PLACEHOLDER.length)),
                },
              ]
            : []
        )
      );
      // a link for every contents entry
      assert.deepEqual(
        [...new Set(placeholders.map((p) => p.anchor))].sort(),
        [...titleOf.keys()].sort(),
        name
      );
      const pages = await pagesOf(done);
      await reading(done, async (pdf) => {
        const dests = new Map<string, unknown[]>();
        for (const placeholder of placeholders) {
          const label = `${name}: page ${String(placeholder.page + 1)}, to ${placeholder.anchor}`;
          const link = pages[placeholder.page]?.links.find((l) =>
            l.rect.every((v, k) => Math.abs(v - (placeholder.rect[k] ?? NaN)) < 0.01)
          );
          assert.ok(link?.dest, `${label}: no destination`);
          assert.equal(
            await landing(pdf, link.dest, titleOf.get(placeholder.anchor) ?? ''),
            null,
            label
          );
          dests.set(placeholder.anchor, link.dest);
        }
        // the outline: the contents list, each entry where its link lands
        interface Entry {
          title: string;
          dest: unknown;
          items: Entry[];
        }
        const flat = (items: Entry[]): Entry[] => items.flatMap((e) => [e, ...flat(e.items)]);
        const outline = flat(await pdf.getOutline());
        const entries = doc.contents ?? [];
        assert.deepEqual(
          outline.map((e) => e.title),
          entries.map((e) => e.title),
          name
        );
        for (const [i, entry] of entries.entries()) {
          assert.deepEqual(outline[i]?.dest, dests.get(entry.target), `${name}: ${entry.title}`);
        }
      });
      // and no placeholder or probe left, in the annotations or the file
      const file = Buffer.from(done);
      for (const address of [PLACEHOLDER, PROBE])
        assert.ok(!file.includes(address), `${name}: ${address}`);
    }
  });

  test('the reprinted front pages are stamped as the rest are', async () => {
    for (const [name, { parts, done }] of made) {
      const front = parts[0]?.pages ?? 0;
      const pages = await pagesOf(done);
      const headers = pages.slice(0, front + 1).map(header);
      assert.equal(headers[0], '', `${name}: the cover`);
      assert.equal(headers[1], 'Introduction', name);
      assert.equal(headers.at(-2), 'Contents', name);
      assert.equal(headers.at(-1), name, name);
      assert.deepEqual(
        pages.slice(0, front + 1).map(footer),
        pages.slice(0, front + 1).map((_, i) => (i === 0 ? '' : String(i + 1))),
        name
      );
    }
  });

  test('what the first print shares with a later page is kept', async () => {
    // a joined PDF's parts share no objects, each copied apart; one shared here by hand,
    // the introduction page's content stream held by the first page of sections too
    const alpha = madeOf('Alpha pathway');
    const front = alpha.parts[0]?.pages ?? 0;
    const printer = started;
    assert.ok(printer);
    const pdf = await PDFDocument.load(alpha.joined);
    const [, introduction] = pdf.getPages();
    const later = pdf.getPage(front);
    assert.ok(introduction);
    const refs = (value: PDFObject | undefined) =>
      value instanceof PDFRef ? [value] : value instanceof PDFArray ? value.asArray() : [];
    const shared = introduction.node.get(PDFName.of('Contents'));
    const own = refs(introduction.node.get(PDFName.of('Annots')));
    assert.ok(refs(shared).length > 0 && own.length > 0);
    later.node.set(PDFName.of('Shared'), shared ?? PDFName.of('None'));
    await reprintFront({ doc: alpha.doc, pdf, parts: alpha.parts }, printer, options);
    for (const ref of refs(shared)) {
      assert.ok(pdf.context.lookup(ref) !== undefined, `${String(ref)} deleted`);
    }
    // while the introduction's own annotations went with it
    for (const ref of own) {
      // assert.ok, not equal: an object found is not to be printed, which never ends
      assert.ok(pdf.context.lookup(ref) === undefined, `${String(ref)} kept`);
    }
    assert.deepEqual(unreachable(pdf), []);
  });

  test("nothing of the first print's front part is left in the file", async () => {
    for (const [name, { joined, swapped, done }] of made) {
      for (const [stage, bytes] of [
        ['joined', joined],
        ['swapped', swapped],
        ['done', done],
      ] as const) {
        assert.deepEqual(unreachable(await PDFDocument.load(bytes)), [], `${name}, ${stage}`);
      }
    }
  });
});
