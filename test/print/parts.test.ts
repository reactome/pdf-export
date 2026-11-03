// The book's parts (spec 001 T025, research R4), on the fixture's book with the threshold
// lowered so a pathway's PDF splits: parts end at section boundaries, each holds one PDF's
// pages, each PDF's join holds its parts' pages in order, and no more than `parallel`
// prints and joins run at once.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import { PDFDocument } from '@cantoo/pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

import {
  layoutBookFront,
  layoutBookPart,
  pageStyles,
  type LayoutOptions,
} from '../../src/layout/document.ts';
import { PROBE } from '../../src/layout/html.ts';
import type { Document } from '../../src/model/types.ts';
import { Printer } from '../../src/print/print.ts';
import { joinParts, printBook, splitParts, type Joined } from '../../src/print/parts.ts';
import {
  bookPdf,
  buildFixture,
  fixtureFigures,
  skipWithoutGraph,
  type Built,
} from '../layout/fixture.ts';

/** A PDF's pages, each as its text and the probes on it, in order. */
async function pagesOf(pdf: Uint8Array): Promise<{ text: string; probes: string[] }[]> {
  const task = getDocument({ data: pdf.slice() });
  try {
    const doc = await task.promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const text = (await page.getTextContent()).items
        .map((item) => ('str' in item ? item.str : ''))
        .join('');
      const probes = (await page.getAnnotations()).flatMap((a) => {
        const { url } = a as { url?: unknown };
        return typeof url === 'string' && url.startsWith(PROBE) ? [url.slice(PROBE.length)] : [];
      });
      pages.push({ text, probes });
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

/** Pages a part is estimated past which the fixture's PDFs split: about three sections. */
const THRESHOLD = 3;

describe('parts', { skip: skipWithoutGraph }, () => {
  let built: Built;
  let started: Printer | undefined;
  let options: LayoutOptions;
  /** Each part printed, by its HTML. */
  const printed = new Map<string, Uint8Array>();
  /** Each PDF joined, saved, by its title. */
  const joined = new Map<string, { joined: Joined; pdf: Uint8Array }>();
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
      printer: {
        async part(html) {
          const pdf = await printer.part(html);
          assert.ok(!printed.has(html), 'a part printed twice');
          printed.set(html, pdf);
          return pdf;
        },
      },
      layout: options,
      settings: { threshold: THRESHOLD, parallel: 2 },
      joined: async (j) => {
        joined.set(j.doc.cover.title, { joined: j, pdf: await j.pdf.save() });
      },
    });
  });
  after(async () => {
    await started?.close();
  });

  /** A PDF's join, by its title. */
  const joinedOf = (title: string) => {
    const found = joined.get(title);
    if (!found) throw new Error(`${title} was not joined`);
    return found;
  };

  /** A part's pages as printed, found by its HTML as printBook lays it out. */
  const printedPages = (doc: Document, places: Joined['parts'][number]['places']) => {
    const html =
      places.length === 0
        ? layoutBookFront(doc, options).html
        : layoutBookPart(doc, places, options).html;
    const pdf = printed.get(html);
    if (!pdf) throw new Error(`a part of ${doc.cover.title} was not printed`);
    return pagesOf(pdf);
  };

  test('a PDF past the threshold is split, at section boundaries only', async () => {
    assert.deepEqual([...joined.keys()], ['Alpha pathway', 'beta pathway', 'Gamma pathway']);
    // Alpha's ten sections, each with a figure, in several parts besides the front
    assert.ok(joinedOf('Alpha pathway').joined.parts.length >= 4);
    for (const doc of built.book) {
      const { parts } = joinedOf(doc.cover.title).joined;
      assert.deepEqual(parts[0]?.places, [], 'the front part first');
      // every place, once, in order: the parts end only between places
      assert.ok(parts.slice(1).every((part) => part.places.length > 0));
      assert.deepEqual(
        parts.flatMap((part) => part.places),
        doc.places
      );
      // and each section's heading, with its probe, is printed in the part given it
      for (const part of parts.slice(1)) {
        const pages = await printedPages(doc, part.places);
        assert.deepEqual(
          pages.flatMap((page) => page.probes),
          part.places.flatMap((place) => (place.full ? [place.section.anchor] : []))
        );
      }
    }
  });

  test("each joined PDF's page count is the sum of its parts'", async () => {
    for (const { joined: j, pdf } of joined.values()) {
      let sum = 0;
      for (const part of j.parts) {
        const pages = (await printedPages(j.doc, part.places)).length;
        assert.equal(part.pages, pages);
        sum += pages;
      }
      assert.ok(j.parts.length > 1);
      assert.equal((await PDFDocument.load(pdf)).getPageCount(), sum);
    }
  });

  test("no part holds two PDFs' pages: each PDF is its own parts' pages, in order", async () => {
    let parts = 0;
    for (const { joined: j, pdf } of joined.values()) {
      const own: { text: string; probes: string[] }[] = [];
      for (const part of j.parts) {
        own.push(...(await printedPages(j.doc, part.places)));
      }
      assert.deepEqual(await pagesOf(pdf), own);
      parts += j.parts.length;
    }
    // and every part printed is one PDF's
    assert.equal(printed.size, parts);
  });

  test('at most `parallel` prints and joins at once; a join waits for no other PDF', async () => {
    const one = await PDFDocument.create();
    one.addPage();
    const blank = await one.save();
    let active = 0;
    let most = 0;
    const events: string[] = [];
    const busy = async <T>(name: string, work: () => Promise<T>): Promise<T> => {
      active += 1;
      most = Math.max(most, active);
      events.push(name);
      try {
        await sleep(10);
        return await work();
      } finally {
        active -= 1;
      }
    };
    await printBook(built.book, {
      printer: { part: () => busy('print', () => Promise.resolve(blank.slice())) },
      layout: options,
      settings: { threshold: THRESHOLD, parallel: 3 },
      join: (parts) => busy('join', () => joinParts(parts)),
      joined: async () => {
        await sleep(5);
      },
    });
    assert.equal(most, 3);
    // Alpha's join starts before the later PDFs' prints are all started
    assert.ok(events.indexOf('join') < events.lastIndexOf('print'), events.join(' '));
  });

  test('a failed print stops the run: nothing more is started, and it is thrown', async () => {
    const alpha = bookPdf(built, 'Alpha pathway');
    let prints = 0;
    let handed = 0;
    await assert.rejects(
      printBook([alpha, ...built.book], {
        printer: {
          part: async () => {
            prints += 1;
            await sleep(5);
            throw new Error('no print');
          },
        },
        layout: options,
        settings: { threshold: THRESHOLD, parallel: 2 },
        joined: () => {
          handed += 1;
          return Promise.resolve();
        },
      }),
      /no print/
    );
    assert.equal(prints, 2);
    assert.equal(handed, 0);
  });
});

// the split alone, so it runs with or without the fixture graph
test('a threshold below a section gives a part to each; none at all, one part', () => {
  const short = (n: number) => ({
    full: false as const,
    anchor: `a${String(n)}`,
    event: { dbId: n, stId: `R-HSA-${String(n)}`, name: 'x' },
    path: [],
    depth: 1,
  });
  const places = [short(1), short(2), short(3)];
  assert.deepEqual(
    splitParts(places, 1e-6).map((part) => part.length),
    [1, 1, 1]
  );
  assert.deepEqual(splitParts(places, 1e6), [places]);
  assert.deepEqual(splitParts([], 1), []);
});
