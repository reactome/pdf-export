// The layout, printed (spec 001 T018, FR-016): the same margins on every page, a landscape
// figure's included; no figure split across pages; running headers and numbers in a single
// PDF; and in the book, each probe printed as the link T026 will find. Printed by Chromium
// from a file, as T019 prints (research R4).
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, before, describe, test } from 'node:test';

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { chromium, type Browser } from 'playwright-core';

import {
  layoutBookPart,
  layoutSingle,
  pageStyles,
  type LayoutOptions,
} from '../../src/layout/document.ts';
import { PAGE, figureKey } from '../../src/layout/figure.ts';
import { PROBE } from '../../src/layout/html.ts';
import type { Document } from '../../src/model/types.ts';
import { buildFixture, fixtureFigures, skipWithoutGraph, type Built } from './fixture.ts';

interface Item {
  text: string;
  x: number;
  y: number;
  width: number;
  /** Its type size, in points. */
  size: number;
}
interface Printed {
  pages: { width: number; height: number; items: Item[]; links: string[] }[];
}

/** A figure of a size, with a marked label at its top left and its bottom right. */
function marked(width: number, height: number, mark: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}" viewBox="0 0 ${String(width)} ${String(height)}"><rect width="${String(width)}" height="${String(height)}" fill="#bbe0e3"/><text x="4" y="16" style="font: 12px Roboto">${mark}START</text><text x="${String(width - 4)}" y="${String(height - 6)}" text-anchor="end" style="font: 12px Roboto">${mark}END</text></svg>`;
}

const figureOf = (doc: Document, stId: string) => {
  for (const p of doc.places)
    if (p.full && p.section.event.stId === stId && p.section.figure) return p.section.figure;
  throw new Error(`no figure for ${stId}`);
};

describe('the layout, printed', { skip: skipWithoutGraph }, () => {
  let built: Built;
  let browser: Browser;
  let folder: string;
  let options: LayoutOptions;
  let count = 0;

  /** Prints HTML as T019 will, from a file, and reads back each page's text and links. */
  async function print(html: string, tagged: boolean): Promise<Printed> {
    const file = join(folder, `${String(++count)}.html`);
    writeFileSync(file, html);
    const page = await browser.newPage();
    try {
      await page.goto(pathToFileURL(file).href);
      const pdf = await page.pdf({
        preferCSSPageSize: true,
        printBackground: true,
        tagged,
        outline: tagged,
      });
      const task = getDocument({ data: new Uint8Array(pdf) });
      const doc = await task.promise;
      const pages: Printed['pages'] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const p = await doc.getPage(i);
        const [, , width = 0, height = 0] = p.view;
        const content = await p.getTextContent();
        const items = content.items
          .filter((item) => 'str' in item && item.str.trim() !== '')
          .map((item) => {
            const t = item as { str: string; transform: number[]; width: number };
            return {
              text: t.str,
              x: t.transform[4] ?? 0,
              y: t.transform[5] ?? 0,
              width: t.width,
              size: Math.hypot(t.transform[2] ?? 0, t.transform[3] ?? 0),
            };
          });
        const links = (await p.getAnnotations())
          .filter((a: { subtype?: string }) => a.subtype === 'Link')
          .map((a: { url?: string }) => a.url ?? '');
        pages.push({ width, height, items, links });
      }
      await task.destroy();
      return { pages };
    } finally {
      await page.close();
    }
  }

  before(async () => {
    built = await buildFixture();
    browser = await chromium.launch();
    folder = mkdtempSync(join(tmpdir(), 'pdf-export-layout-'));
    const figures = fixtureFigures(built.book, built.pathway);
    // the pathway's own figure taller than what is left of its page after its heading, and
    // a reaction's too wide for legible labels in portrait
    figures.set(figureKey(figureOf(built.pathway, 'R-HSA-90000100')), marked(400, 1200, 'TALL'));
    figures.set(figureKey(figureOf(built.pathway, 'R-HSA-90000220')), marked(1500, 400, 'WIDE'));
    options = {
      site: 'https://site.example',
      date: new Date('2026-10-30T12:00:00Z'),
      figures,
      styles: pageStyles(),
    };
  });
  after(async () => {
    await browser.close();
    rmSync(folder, { recursive: true, force: true });
  });

  test('the same margins on every page; headers and numbers only in them; none on the cover', async () => {
    const { pages } = await print(layoutSingle(built.pathway, options).html, true);
    assert.ok(pages.length >= 6, String(pages.length));
    const m = PAGE.margin;
    const edges: number[] = [];
    pages.forEach((page, i) => {
      const inFrame = (item: Item) =>
        item.x >= m - 1 &&
        item.x + item.width <= page.width - m + 1 &&
        item.y >= m - 1 &&
        item.y <= page.height - m + 1;
      const header = page.items.filter((item) => item.y > page.height - m);
      const footer = page.items.filter((item) => item.y < m);
      const body = page.items.filter((item) => !header.includes(item) && !footer.includes(item));
      for (const item of body)
        assert.ok(
          inFrame(item),
          `page ${String(i + 1)}: "${item.text}" at ${String(item.x)}, ${String(item.y)}`
        );
      if (i === 0) {
        assert.deepEqual([...header, ...footer], [], 'a header or number on the cover');
        return;
      }
      assert.deepEqual(
        footer.map((item) => item.text),
        [String(i + 1)],
        `page ${String(i + 1)}'s number`
      );
      assert.equal(header.length, 1, `page ${String(i + 1)}'s header`);
      // the margin boxes sit where the margins put them: the same height from the page's
      // edge on every page, and centred between the left and right margins
      for (const [box, fromEdge] of [
        [header[0], page.height - (header[0]?.y ?? 0)],
        [footer[0], footer[0]?.y ?? 0],
      ] as const) {
        assert.ok(box, `page ${String(i + 1)}`);
        edges.push(fromEdge);
        assert.ok(
          Math.abs(box.x + box.width / 2 - page.width / 2) < 1,
          `page ${String(i + 1)}: "${box.text}" off centre`
        );
      }
    });
    // every header the same distance from the top, every number from the bottom
    const [top = 0, bottom = 0] = edges;
    edges.forEach((e, k) => {
      assert.ok(
        Math.abs(e - (k % 2 === 0 ? top : bottom)) < 0.5,
        `a margin box moved: ${String(e)}`
      );
    });
    const headers = pages
      .slice(1)
      .map((page) => page.items.find((item) => item.y > page.height - m)?.text);
    assert.deepEqual(headers.slice(0, 2), ['Introduction', 'Contents']);
    assert.ok(
      headers.slice(2).every((h) => h === 'beta pathway'),
      String(headers)
    );
  });

  test("type is the theme's at the website's sizes: rem is 16 px", async () => {
    const { pages } = await print(layoutSingle(built.pathway, options).html, true);
    const m = PAGE.margin;
    const sizes = (find: (item: Item, page: Printed['pages'][number]) => boolean) =>
      new Set(
        pages.flatMap((page) =>
          page.items.filter((item) => find(item, page)).map((item) => item.size.toFixed(2))
        )
      );
    // the running headers, body-small (0.75 rem, 12 px)
    assert.deepEqual(
      sizes((item, page) => item.y > page.height - m),
      new Set(['9.00'])
    );
    // the introduction's heading, on its own page, headline-small (1.5 rem, 24 px); the
    // contents list names it too, in body text, on another page
    assert.deepEqual(
      sizes(
        (item, page) =>
          page === pages[1] && item.y <= page.height - m && item.text === 'Introduction'
      ),
      new Set(['18.00'])
    );
    // body text, body-medium (0.875 rem, 14 px)
    assert.deepEqual(
      sizes((item) => item.text === 'Stable identifier'),
      new Set(['10.50'])
    );
  });

  test('no figure is split across pages; a wide one has a landscape page of its own', async () => {
    const { pages } = await print(layoutSingle(built.pathway, options).html, true);
    // after the cover, which draws the pathway's figure too, whole
    const pageOf = (text: string) =>
      pages.findIndex((page, i) => i > 0 && page.items.some((item) => item.text === text));
    for (const mark of ['TALL', 'WIDE']) {
      const start = pageOf(`${mark}START`);
      assert.ok(start >= 0, `${mark} not printed`);
      assert.equal(pageOf(`${mark}END`), start, `${mark} split across pages`);
    }
    const wide = pages[pageOf('WIDESTART')];
    assert.ok(wide && wide.width > wide.height, 'the wide figure is not on a landscape page');
    // alone on its page, with the page's header and number
    assert.deepEqual(
      wide.items.map((item) => item.text).sort(),
      ['WIDESTART', 'WIDEEND', 'beta pathway', String(pageOf('WIDESTART') + 1)].sort()
    );
    for (const page of pages)
      if (page !== wide) assert.ok(page.height > page.width, 'a portrait page turned');
  });

  test("the book's probes print as links, one for each target; a single PDF has none", async () => {
    const { html } = layoutBookPart(built.book, built.book.places, options);
    const probes = [...html.matchAll(/<a class="probe" href="([^"]+)"><\/a>/g)].map((m) => m[1]);
    assert.ok(probes.length > 10);
    const printed = (await print(html, false)).pages
      .flatMap((page) => page.links)
      .filter((url) => url.startsWith(PROBE));
    assert.deepEqual(printed.sort(), probes.sort());
    const single = await print(layoutSingle(built.pathway, options).html, true);
    assert.ok(!single.pages.some((page) => page.links.some((url) => url.startsWith(PROBE))));
  });
});
