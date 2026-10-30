// Printing (spec 001 T019, research R4), on the fixture's model laid out by T018: the fonts
// embedded and no other, the outline nested, internal links landing on their targets, and
// every contents number its target's page.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { PDFDict, PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { chromium } from 'playwright-core';

import { FAMILIES } from '../../src/layout/fonts.ts';
import {
  layoutBookPart,
  layoutSingle,
  pageStyles,
  type LayoutOptions,
} from '../../src/layout/document.ts';
import { PLACEHOLDER, PROBE } from '../../src/layout/html.ts';
import { PAGE } from '../../src/layout/figure.ts';
import { contentsTargets } from '../../src/print/contents.ts';
import { Printer } from '../../src/print/print.ts';
import { buildFixture, fixtureFigures, skipWithoutGraph, type Built } from '../layout/fixture.ts';

/** A page's text, each piece with where it starts. */
async function textOf(page: { getTextContent(): Promise<{ items: unknown[] }> }) {
  return (await page.getTextContent()).items.flatMap((item) => {
    if (typeof item !== 'object' || item === null || !('str' in item) || !('transform' in item))
      return [];
    const { str, transform } = item as { str: string; transform: unknown[] };
    return [{ str, x: Number(transform[4]), y: Number(transform[5]), size: Number(transform[3]) }];
  });
}

/** A page's link annotations: their named destinations. */
async function linksOf(page: { getAnnotations(): Promise<unknown[]> }): Promise<string[]> {
  return (await page.getAnnotations()).flatMap((a) => {
    const { subtype, dest } = a as { subtype?: unknown; dest?: unknown };
    return subtype === 'Link' && typeof dest === 'string' ? [dest] : [];
  });
}

/** The PostScript names our families embed as: Roboto-Regular, RobotoMono-Regular … */
const OURS = FAMILIES.map((f) => f.family.replace(/ /g, ''));

/**
 * Each font the PDF uses that is not one of ours or is not embedded, by its name with the
 * subset tag taken off: every font dictionary is looked at, not only those with a
 * descriptor, so a standard font (Helvetica, with no descriptor) or a Type 3 font is found.
 */
async function fontProblems(pdf: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(pdf);
  const problems: string[] = [];
  let fonts = 0;
  const name = (value: { toString(): string } | undefined) =>
    (value?.toString() ?? '').replace(/^\/([A-Z]{6}\+)?/, '');
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict)) continue;
    if (object.get(PDFName.of('Type'))?.toString() !== '/Font') continue;
    fonts += 1;
    const base = name(object.get(PDFName.of('BaseFont')));
    const subtype = object.get(PDFName.of('Subtype'))?.toString();
    if (!OURS.includes(base.split('-')[0] ?? '')) problems.push(`not ours: ${base}`);
    if (subtype === '/Type3') problems.push(`Type 3: ${base}`);
    // a composite font's glyphs are its descendant's, a font dictionary of its own
    if (subtype === '/Type0') continue;
    const descriptor = object.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict);
    if (!['FontFile', 'FontFile2', 'FontFile3'].some((k) => descriptor?.has(PDFName.of(k)))) {
      problems.push(`not embedded: ${base}`);
    }
  }
  if (fonts === 0) problems.push('no fonts');
  return problems;
}

/** The contents list's numbers as printed, in order: digits at the right of the text. */
async function printedNumbers(pdf: Uint8Array): Promise<number[]> {
  const task = getDocument({ data: pdf.slice() });
  try {
    const doc = await task.promise;
    const numbers: number[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const items = await textOf(await doc.getPage(i));
      // a contents page is one whose header says so
      if (!items.some((item) => item.str === 'Contents' && item.y > PAGE.height - PAGE.margin)) {
        continue;
      }
      // in the body, at the right: an entry's number, not the page's own
      for (const item of items) {
        if (/^\d+$/.test(item.str) && item.y > PAGE.margin && item.x > PAGE.width / 2) {
          numbers.push(Number(item.str));
        }
      }
    }
    return numbers;
  } finally {
    await task.destroy();
  }
}

describe('printing', { skip: skipWithoutGraph }, () => {
  let built: Built;
  /** Undefined only if starting it failed, so after() does not hide that error. */
  let started: Printer | undefined;
  let printer: Printer;
  let options: LayoutOptions;
  let html: string;
  let pdf: Uint8Array;
  before(async () => {
    built = await buildFixture();
    printer = await Printer.start();
    started = printer;
    options = {
      site: 'https://site.example',
      date: new Date('2026-10-30T12:00:00Z'),
      figures: fixtureFigures(built.pathway, built.reaction),
      styles: pageStyles(),
    };
    html = layoutSingle(built.pathway, options).html;
    pdf = await printer.single(html);
  });
  after(async () => {
    await started?.close();
  });

  test('only our fonts, each embedded', async () => {
    assert.deepEqual(await fontProblems(pdf), []);
    assert.deepEqual(
      await fontProblems(await printer.part(layoutSingle(built.reaction, options).html)),
      []
    );
  });

  test('a face that does not load is refused; from a string, none of them load', async () => {
    const missing = html.replace(
      '</style>',
      "</style><style>@font-face { font-family: 'Gone'; src: url('file:///nowhere/gone.woff2'); } body { font-family: Gone, Roboto; }</style>"
    );
    await assert.rejects(printer.print(missing, true), /Fonts did not load: Gone/);
    // the trap of research R4: a page set from a string cannot load file:// fonts, whatever
    // fonts the host has, and printing it would use the system's
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'load' });
      const failed = await page.evaluate<number>(
        `Promise.allSettled([...document.fonts].map((face) => face.load())).then(() =>
          [...document.fonts].filter((face) => face.status !== 'loaded').length)`
      );
      assert.ok(failed > 0, String(failed));
    } finally {
      await browser.close();
    }
  });

  test('text only in a running header is drawn, with faces nothing else uses', async () => {
    const page = `<!doctype html><html><head><meta charset="utf-8"><style>${options.styles.fonts}</style><style>@page { size: A4; margin: 20mm; @top-center { content: "TNF-\\3b1 \\2192 \\436"; font-family: Roboto, 'Noto Sans', 'Noto Sans Symbols 2', 'Noto Sans Math'; } } body { font-family: Roboto; }</style></head><body><p>x</p></body></html>`;
    const printed = await printer.print(page, true);
    const task = getDocument({ data: printed.slice() });
    try {
      const items = await textOf(await (await task.promise).getPage(1));
      const header = items
        .filter((item) => item.y > PAGE.height - PAGE.margin)
        .map((item) => item.str)
        .join('');
      assert.equal(header.replace(/\s+/g, ''), 'TNF-α→ж');
    } finally {
      await task.destroy();
    }
  });

  test("a part of the book is printed untagged, its links the layout's placeholders", async () => {
    const part = layoutBookPart(built.book, built.book.places, options).html;
    const printed = await printer.part(part);
    const task = getDocument({ data: printed.slice() });
    try {
      const doc = await task.promise;
      assert.equal(await doc.getOutline(), null);
      const urls: string[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        for (const a of await (await doc.getPage(i)).getAnnotations()) {
          const { url } = a as { url?: unknown };
          if (typeof url === 'string') urls.push(url);
        }
      }
      assert.ok(
        urls.some((url) => url.startsWith(PLACEHOLDER)),
        'no placeholder links'
      );
      assert.ok(
        urls.some((url) => url.startsWith(PROBE)),
        'no probes'
      );
      assert.deepEqual(await linksOf(await doc.getPage(1)), []);
    } finally {
      await task.destroy();
    }
  });

  test('a second print whose pages moved is refused', async () => {
    // the placeholder in a box only wide enough for one digit, at a size where a second
    // digit wraps to a line as tall as a page: the target, on page 12, then moves
    const filler = '<div style="break-after: page">x</div>'.repeat(11);
    const page = `<!doctype html><html><head><meta charset="utf-8"><style>${options.styles.fonts}</style><style>@page { size: A4; margin: 20mm; } body { font-family: Roboto; }</style></head><body><a href="#t">t</a><div style="font-size: 360pt; line-height: 1; width: 0.6em; overflow-wrap: anywhere"><span class="page" data-target="t">0</span></div>${filler}<h1 id="t">Target</h1></body></html>`;
    await assert.rejects(printer.single(page), /The contents' numbers moved the pages/);
  });

  test('the outline is nested as the sections are', async () => {
    const task = getDocument({ data: pdf.slice() });
    try {
      interface Entry {
        title: string;
        items: Entry[];
      }
      const outline = (await (await task.promise).getOutline()) as Entry[];
      const titles = (items: Entry[]): unknown[] =>
        items.map((item) =>
          item.items.length > 0 ? [item.title, titles(item.items)] : item.title
        );
      assert.deepEqual(titles(outline), [
        'Introduction',
        'Contents',
        ['beta pathway', ['Shared reaction', 'Inferred reaction', 'beta sub with diagram']],
      ]);
    } finally {
      await task.destroy();
    }
  });

  test('every internal link lands on the page its target heading is on', async () => {
    const task = getDocument({ data: pdf.slice() });
    try {
      const doc = await task.promise;
      // each entry's title is its target's heading
      const titleOf = new Map((built.pathway.contents ?? []).map((e) => [e.target, e.title]));
      let links = 0;
      for (let i = 1; i <= doc.numPages; i++) {
        for (const dest of await linksOf(await doc.getPage(i))) {
          links += 1;
          const destination = await doc.getDestination(dest);
          assert.ok(destination, dest);
          const target =
            (await doc.getPageIndex(destination[0] as { num: number; gen: number })) + 1;
          // the title as a heading there, not as a contents entry, which lists every title
          const headings = (await textOf(await doc.getPage(target)))
            .filter((item) => item.size > 11)
            .map((item) => item.str);
          const title = titleOf.get(dest);
          assert.ok(title && headings.includes(title), `${dest} lands on page ${String(target)}`);
        }
      }
      assert.ok(links >= (built.pathway.contents ?? []).length, String(links));
    } finally {
      await task.destroy();
    }
  });

  test("every contents number is its target's page; with the placeholders left in, none is", async () => {
    // each target's page found from the text alone: the first page, after the contents,
    // whose heading (larger than body text, 10.5 pt) is the entry's title; the
    // introduction and contents headings come before the contents' own entries
    const headingPage = async (printed: Uint8Array, title: string, after: number) => {
      const task = getDocument({ data: printed.slice() });
      try {
        const doc = await task.promise;
        for (let i = after; i <= doc.numPages; i++) {
          const items = await textOf(await doc.getPage(i));
          if (items.some((item) => item.str === title && item.size > 11)) return i;
        }
        return null;
      } finally {
        await task.destroy();
      }
    };
    const entries = built.pathway.contents ?? [];
    assert.equal(contentsTargets(html).length, entries.length);
    const expected: (number | null)[] = [];
    for (const entry of entries) expected.push(await headingPage(pdf, entry.title, 2));
    assert.ok(
      expected.every((page) => page !== null),
      String(expected)
    );
    assert.deepEqual(await printedNumbers(pdf), expected);
    // the first print alone, its placeholders left in
    const first = await printer.print(html, true);
    assert.notDeepEqual(await printedNumbers(first), expected);
  });

  test('a reaction alone has no contents list and is printed once, as it is', async () => {
    const reaction = layoutSingle(built.reaction, options).html;
    assert.deepEqual(contentsTargets(reaction), []);
    const once = await printer.single(reaction);
    const task = getDocument({ data: once.slice() });
    try {
      const doc = await task.promise;
      assert.ok(doc.numPages >= 3);
      assert.ok((await doc.getOutline()).length > 0, 'no outline');
    } finally {
      await task.destroy();
    }
  });
});
