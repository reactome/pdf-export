// The book's page numbers and running headers, stamped after the join (spec 001 T027,
// FR-016, FR-017), on the fixture's book printed in parts with the threshold lowered so
// each PDF splits, as T025's and T026's tests do: numbers run on across the parts, the
// cover has none, each page's header is its PDF's pathway's or its front part's, placed,
// sized and coloured as a single PDF's margin boxes are, in an embedded subset of Roboto;
// and a pathway's name is stamped after FR-017's substitutions.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  type PDFPage,
} from '@cantoo/pdf-lib';
import * as fontkit from 'fontkit';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

import { layoutSingle, pageStyles, type LayoutOptions } from '../../src/layout/document.ts';
import { PAGE } from '../../src/layout/figure.ts';
import { fontFaces } from '../../src/layout/fonts.ts';
import { themeVariables } from '../../src/layout/theme.ts';
import type { Document } from '../../src/model/types.ts';
import { rewriteLinks } from '../../src/print/links.ts';
import { writeOutline } from '../../src/print/outline.ts';
import { printBook, type Part } from '../../src/print/parts.ts';
import { Printer } from '../../src/print/print.ts';
import { pageStamps, stampLook, stampPages, type FrontTarget } from '../../src/print/stamp.ts';
import { buildFixture, fixtureFigures, skipWithoutGraph, type Built } from '../layout/fixture.ts';

interface Item {
  text: string;
  x: number;
  y: number;
  width: number;
  size: number;
}

interface PageText {
  width: number;
  height: number;
  /** Text above the top margin, below the bottom margin, and between. */
  header: Item[];
  footer: Item[];
  body: Item[];
}

/** Each page's text, read back with pdf.js, by where it lies. */
async function pagesOf(pdf: Uint8Array): Promise<PageText[]> {
  const task = getDocument({ data: pdf.slice() });
  try {
    const doc = await task.promise;
    const pages: PageText[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const [, , width = 0, height = 0] = page.view;
      const items = (await page.getTextContent()).items.flatMap((item) => {
        if (!('str' in item) || item.str.trim() === '') return [];
        const [, , c = 0, d = 0, x = 0, y = 0] = item.transform as number[];
        return [{ text: item.str, x, y, width: item.width, size: Math.hypot(c, d) }];
      });
      const m = PAGE.margin;
      pages.push({
        width,
        height,
        header: items.filter((item) => item.y > height - m),
        footer: items.filter((item) => item.y < m),
        body: items.filter((item) => item.y >= m && item.y <= height - m),
      });
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

/** A margin's text as one string, its items in order. */
const joinedText = (items: readonly Item[]) => items.map((item) => item.text).join('');

/** The pages at which the fixture's parts end, as T025's tests: about three sections. */
const THRESHOLD = 1;

/** A front part's heading: its name, at the introduction's heading size (18 pt). */
const FRONT_HEADINGS = ['Introduction', 'Contents'];

interface Stamped {
  doc: Document;
  parts: Part[];
  /** Each front part's heading's page, from its probe. */
  targets: Map<string, FrontTarget>;
  /** Saved with its links and outline, before the stamps, and after. */
  before: Uint8Array;
  after: Uint8Array;
}

describe('page numbers and running headers', { skip: skipWithoutGraph }, () => {
  let built: Built;
  let started: Printer | undefined;
  let options: LayoutOptions;
  const stamped = new Map<string, Stamped>();
  /** A single PDF's pages, its headers and numbers from its margin boxes. */
  let single: PageText[] = [];

  before(async () => {
    built = await buildFixture();
    const printer = await Printer.start();
    started = printer;
    options = {
      site: 'https://site.example',
      date: new Date('2026-10-30T12:00:00Z'),
      figures: fixtureFigures(...built.book, built.pathway),
      styles: pageStyles(),
    };
    await printBook(built.book, {
      printer,
      layout: options,
      settings: { threshold: THRESHOLD, parallel: 2, joins: 1 },
      joined: async (j) => {
        const targets = rewriteLinks(j.pdf);
        writeOutline(j.pdf, j.doc.contents ?? [], targets);
        const before = await j.pdf.save({ useObjectStreams: false });
        await stampPages(j, targets);
        const after = await j.pdf.save({ useObjectStreams: false });
        stamped.set(j.doc.cover.title, { doc: j.doc, parts: j.parts, targets, before, after });
      },
    });
    single = await pagesOf(await printer.single(layoutSingle(built.pathway, options).html));
  });
  after(async () => {
    await started?.close();
  });

  /** Where each part begins, counted from 0. */
  const starts = (parts: readonly Part[]) =>
    parts.map((_, k) => parts.slice(0, k).reduce((n, p) => n + p.pages, 0));

  test('numbers run on across the parts, every page but the cover numbered', async () => {
    assert.deepEqual([...stamped.keys()].sort(), [
      'Alpha pathway',
      'Gamma pathway',
      'beta pathway',
    ]);
    for (const [name, { parts, after }] of stamped) {
      // the front part, and at least two of sections, so a section part begins mid-PDF
      assert.ok(parts.length >= 3, `${name}: ${String(parts.length)} parts`);
      const pages = await pagesOf(after);
      assert.equal(
        pages.length,
        parts.reduce((n, p) => n + p.pages, 0)
      );
      assert.deepEqual(
        pages.map((page) => joinedText(page.footer)),
        pages.map((_, i) => (i === 0 ? '' : String(i + 1))),
        name
      );
    }
  });

  test('no number or header on the cover, which is as printed', async () => {
    for (const [name, { before, after }] of stamped) {
      const [printed, cover] = [(await pagesOf(before))[0], (await pagesOf(after))[0]];
      assert.ok(printed && cover);
      assert.deepEqual([...cover.header, ...cover.footer], [], name);
      assert.deepEqual(cover, printed, name);
    }
  });

  test("each page's header is its front part's or its pathway's, at every part boundary", async () => {
    for (const [name, { parts, before, after }] of stamped) {
      // what each page should carry, from the printed pages: a front part's heading begins
      // its pages, and every page after the front part is the pathway's
      const printed = await pagesOf(before);
      let front = '';
      const expected = printed.map((page, i) => {
        if (i >= (parts[0]?.pages ?? 0)) return name;
        const heading = page.body.find(
          (item) => FRONT_HEADINGS.includes(item.text) && item.size > 17
        );
        if (heading) front = heading.text;
        return front;
      });
      assert.deepEqual(expected.slice(0, 3), ['', 'Introduction', 'Contents'], name);
      const headers = (await pagesOf(after)).map((page) => joinedText(page.header));
      assert.deepEqual(headers, expected, name);
      // each boundary between parts, the pages either side of it
      for (const start of starts(parts).slice(1)) {
        assert.deepEqual(
          headers.slice(start - 1, start + 1),
          expected.slice(start - 1, start + 1),
          `${name}: page ${String(start + 1)}`
        );
      }
    }
  });

  test("placed, sized and centred as a single PDF's margin boxes, portrait and landscape", async () => {
    // the single PDF's header's baseline from the page's top, its number's from the bottom
    const boxes = single.slice(1).map((page) => {
      const [header, number] = [page.header[0], page.footer[0]];
      assert.ok(header && number && page.header.length === 1 && page.footer.length === 1);
      return { top: page.height - header.y, bottom: number.y, size: header.size };
    });
    const [first] = boxes;
    assert.ok(first);
    let landscape = 0;
    for (const [name, { after }] of stamped) {
      for (const [i, page] of (await pagesOf(after)).entries()) {
        if (i === 0) continue;
        if (page.width > page.height) landscape += 1;
        const label = `${name}, page ${String(i + 1)}`;
        for (const [items, fromEdge, expected] of [
          [page.header, (item: Item) => page.height - item.y, first.top],
          [page.footer, (item: Item) => item.y, first.bottom],
        ] as const) {
          assert.ok(items.length > 0, label);
          for (const item of items) {
            assert.ok(Math.abs(fromEdge(item) - expected) < 0.5, `${label}: ${item.text}'s height`);
            assert.equal(item.size.toFixed(2), first.size.toFixed(2), label);
          }
          const left = Math.min(...items.map((item) => item.x));
          const right = Math.max(...items.map((item) => item.x + item.width));
          assert.ok(Math.abs((left + right) / 2 - page.width / 2) < 1, `${label}: off centre`);
        }
      }
    }
    // Gamma's landscape figures' pages, stamped as a portrait page is
    assert.ok(landscape >= 2, String(landscape));
  });

  test("in the theme's colour and size, in an embedded subset of Roboto", async () => {
    const theme = themeVariables();
    const look = stampLook();
    assert.equal(look.size, 9); // body-small, 0.75 rem of 16 px, in points
    const hex = theme.get('--mat-sys-on-surface-variant') ?? '';
    const want = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const roboto = fontFaces().find(
      (face) => face.family === 'Roboto' && face.weight === 400 && face.subset === 'latin'
    );
    assert.ok(roboto);
    const full = fontkit.openSync(roboto.path);
    assert.ok('numGlyphs' in full);
    for (const [name, { before, after }] of stamped) {
      const [was, now] = [await PDFDocument.load(before), await PDFDocument.load(after)];
      for (const [i, page] of now.getPages().entries()) {
        const label = `${name}, page ${String(i + 1)}`;
        const old = was.getPage(i);
        const added = refsOf(fontsOf(page), fontsOf(old));
        const drawn = refsOf(contentsOf(page), contentsOf(old));
        if (i === 0) {
          assert.deepEqual([added, drawn], [[], []], label);
          continue;
        }
        // one font more, the stamps' Roboto, embedded as a subset of a few glyphs
        assert.equal(added.length, 1, label);
        const font = now.context.lookup(added[0], PDFDict);
        const base = font.lookup(PDFName.of('BaseFont'), PDFName).decodeText();
        assert.match(base, /^[A-Z]{6}\+Roboto-Regular$/, label);
        const cid = font.lookup(PDFName.of('DescendantFonts'), PDFArray).lookup(0, PDFDict);
        const file = cid.lookup(PDFName.of('FontDescriptor'), PDFDict).get(PDFName.of('FontFile2'));
        const program = fontkit.create(Buffer.from(streamBytes(now, file)));
        assert.ok('numGlyphs' in program);
        assert.ok(program.numGlyphs < 40 && program.numGlyphs < full.numGlyphs, label);
        // what is drawn, in the theme's colour and size: every fill colour the stamps set
        const operators = drawn
          .map((ref) => new TextDecoder().decode(streamBytes(now, ref)))
          .join('\n');
        const fills = [...operators.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) rg/g)];
        assert.ok(fills.length >= 2, label);
        for (const fill of fills) {
          const got = fill.slice(1, 4).map(Number);
          assert.ok(
            got.every((v, k) => Math.abs(v - (want[k] ?? NaN)) < 0.002),
            `${label}: ${fill[0]}`
          );
        }
        const sizes = [...operators.matchAll(/ ([\d.]+) Tf/g)].map((m) => Number(m[1]));
        assert.ok(sizes.length >= 2 && sizes.every((s) => s === 9), `${label}: ${String(sizes)}`);
      }
    }
  });

  test("a pathway's name is stamped after FR-017's substitutions", async () => {
    const alpha = stamped.get('Alpha pathway');
    assert.ok(alpha);
    // the name planted here, not in the fixture: U+2011, a non-breaking hyphen no font draws
    const planted: Document = {
      ...alpha.doc,
      cover: { ...alpha.doc.cover, title: 'Alpha‑pathway ‑ one' },
    };
    const pdf = await PDFDocument.load(alpha.before);
    await stampPages({ doc: planted, pdf, parts: alpha.parts }, alpha.targets);
    const pages = await pagesOf(await pdf.save({ useObjectStreams: false }));
    const front = alpha.parts[0]?.pages ?? 0;
    const headers = pages.slice(front).map((page) => joinedText(page.header));
    assert.ok(headers.length > 0);
    assert.deepEqual(new Set(headers), new Set(['Alpha-pathway - one']));
  });

  test('a name in several faces is drawn as a margin box draws it, each face a subset', async () => {
    const alpha = stamped.get('Alpha pathway');
    assert.ok(alpha);
    // Greek and Cyrillic from Roboto's own files, the arrow from a Noto font
    const name = 'TNF-\u03b1 \u2192 \u0436';
    const planted: Document = { ...alpha.doc, cover: { ...alpha.doc.cover, title: name } };
    const pdf = await PDFDocument.load(alpha.before);
    const was = await PDFDocument.load(alpha.before);
    await stampPages({ doc: planted, pdf, parts: alpha.parts }, alpha.targets);
    const saved = await pdf.save({ useObjectStreams: false });
    const now = await PDFDocument.load(saved);
    const front = alpha.parts[0]?.pages ?? 0;
    const names = refsOf(fontsOf(now.getPage(front)), fontsOf(was.getPage(front))).map((ref) =>
      now.context.lookup(ref, PDFDict).lookup(PDFName.of('BaseFont'), PDFName).decodeText()
    );
    assert.ok(names.length >= 3, String(names));
    for (const base of names) assert.match(base, /^[A-Z]{6}\+[\w-]+$/);
    assert.ok(
      names.some((base) => base.includes('Noto')),
      String(names)
    );
    const read = (await pagesOf(saved))[front];
    assert.ok(read);
    assert.equal(joinedText(read.header).replace(/\s+/g, ''), name.replace(/\s+/g, ''));
    const left = Math.min(...read.header.map((item) => item.x));
    const right = Math.max(...read.header.map((item) => item.x + item.width));
    assert.ok(Math.abs((left + right) / 2 - read.width / 2) < 1, 'off centre');
  });

  test('a character no font draws, or parts that are not the PDF, are refused', async () => {
    const alpha = stamped.get('Alpha pathway');
    assert.ok(alpha);
    const planted: Document = {
      ...alpha.doc,
      cover: { ...alpha.doc.cover, title: 'Alpha ' },
    };
    const pdf = await PDFDocument.load(alpha.before);
    await assert.rejects(
      stampPages({ doc: planted, pdf, parts: alpha.parts }, alpha.targets),
      /U\+E000, which no font draws/
    );
    const short = alpha.parts.slice(0, -1);
    await assert.rejects(
      stampPages({ doc: alpha.doc, pdf, parts: short }, alpha.targets),
      /The parts hold \d+ pages, the joined PDF \d+/
    );
    // nothing was stamped by either
    assert.deepEqual(
      await pagesOf(await pdf.save({ useObjectStreams: false })),
      await pagesOf(alpha.before)
    );
  });
});

/** A page's font dictionaries' references. */
function fontsOf(page: PDFPage): PDFRef[] {
  const fonts = page.node.Resources()?.lookupMaybe(PDFName.of('Font'), PDFDict);
  return (fonts?.values() ?? []).filter((value) => value instanceof PDFRef);
}

/** A page's content streams' references. */
function contentsOf(page: PDFPage): PDFRef[] {
  const contents = page.node.get(PDFName.of('Contents'));
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  return refs.filter((ref) => ref instanceof PDFRef);
}

/** The references in one list not in another. */
function refsOf(now: readonly PDFRef[], was: readonly PDFRef[]): PDFRef[] {
  const old = new Set(was.map(String));
  return now.filter((ref) => !old.has(String(ref)));
}

/** A stream's bytes, decoded. */
function streamBytes(pdf: PDFDocument, ref: unknown): Uint8Array {
  const stream = ref instanceof PDFRef ? pdf.context.lookup(ref) : ref;
  assert.ok(stream instanceof PDFRawStream, 'not a stream');
  return decodePDFRawStream(stream).decode();
}

describe('pageStamps', () => {
  const targets = new Map([
    ['introduction', { index: 1 }],
    ['contents', { index: 3 }],
  ]);

  test('the cover bare, the front parts named, the rest numbered on across parts', () => {
    assert.deepEqual(pageStamps('P', [5, 2, 2], targets), [
      null,
      { header: 'Introduction', number: '2' },
      { header: 'Introduction', number: '3' },
      { header: 'Contents', number: '4' },
      { header: 'Contents', number: '5' },
      { header: 'P', number: '6' },
      { header: 'P', number: '7' },
      { header: 'P', number: '8' },
      { header: 'P', number: '9' },
    ]);
  });

  test('a front part outside the front part, or no introduction, refused', () => {
    assert.throws(() => pageStamps('P', [3, 2], targets), /Contents on page 4/);
    assert.throws(
      () => pageStamps('P', [3, 2], new Map([['introduction', { index: 0 }]])),
      /page 1/
    );
    assert.throws(() => pageStamps('P', [3, 2], new Map()), /no probe/);
  });

  test("the look is the compiled theme's, refused when it is not a colour or a size", () => {
    assert.deepEqual(
      stampLook(
        ':root { --mat-sys-on-surface-variant: #ff0000; --mat-sys-body-small-size: 16px; }'
      ),
      {
        size: 12,
        colour: { type: 'RGB', red: 1, green: 0, blue: 0 },
      }
    );
    assert.throws(
      () => stampLook(':root { --mat-sys-body-small-size: 1rem; }'),
      /no --mat-sys-on-surface-variant/
    );
    assert.throws(
      () =>
        stampLook(':root { --mat-sys-on-surface-variant: red; --mat-sys-body-small-size: 1rem; }'),
      /not #rrggbb/
    );
  });
});
