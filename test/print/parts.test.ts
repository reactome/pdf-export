// The book's parts (spec 001 T025, research R4), on the fixture's book with the threshold
// lowered so a pathway's PDF splits: the pages estimated are the pages printed, parts end
// at section boundaries, each holds one PDF's pages, each PDF's join holds its parts' pages
// in order, no more than `parallel` prints and joins run at once, and a failure anywhere
// stops the run and is thrown.
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
import { PORTRAIT, figureKey } from '../../src/layout/figure.ts';
import { PROBE } from '../../src/layout/html.ts';
import type { Document } from '../../src/model/types.ts';
import { Printer } from '../../src/print/print.ts';
import {
  Flow,
  estimatePages,
  figureSizes,
  joinParts,
  printBook,
  splitParts,
  type Joined,
} from '../../src/print/parts.ts';
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

/** The pages at which the fixture's parts end: about three of Alpha's sections. */
const THRESHOLD = 1;

describe('parts', { skip: skipWithoutGraph }, () => {
  let built: Built;
  let started: Printer | undefined;
  // the fixture's figures as a map, which a test copies and changes
  let options: LayoutOptions & { figures: ReadonlyMap<string, string> };
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
      settings: { threshold: THRESHOLD, parallel: 2, joins: 2 },
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
    assert.deepEqual([...joined.keys()].sort(), ['Alpha pathway', 'Gamma pathway', 'beta pathway']);
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

  test('the pages estimated are the pages printed: each section alone, and each PDF', async () => {
    // a section alone prints its estimate rounded up (Gamma's two landscape figures, three
    // pages and two, among them); a PDF's sections together, within a page
    const sizes = figureSizes(options.figures);
    const printer = started;
    assert.ok(printer);
    const pagesPrinted = async (doc: Document, places: Document['places']) =>
      (await joinParts([await printer.part(layoutBookPart(doc, places, options).html)])).pages[0];
    for (const doc of built.book) {
      for (const place of doc.places) {
        if (!place.full) continue;
        const estimate = estimatePages(place, sizes);
        const printed = await pagesPrinted(doc, [place]);
        assert.equal(
          Math.ceil(estimate),
          printed,
          `${place.section.event.stId}: ${String(estimate)}`
        );
      }
      const flow = new Flow(sizes);
      for (const place of doc.places) flow.add(place);
      const printed = (await pagesPrinted(doc, doc.places)) ?? 0;
      assert.ok(
        Math.abs(flow.pages - printed) < 1,
        `${doc.cover.title}: ${String(flow.pages)}, ${String(printed)}`
      );
    }
  });

  test('a figure as tall as the text area prints no page more, and is estimated', async () => {
    // a section with text after its figure (Reaction one: a summation, references), its
    // figure drawn as tall as the text area allows: landscape, 1,300 by 900, and portrait,
    // 600 by 1,400; each page holds text, the figure's own a label
    const alpha = bookPdf(built, 'Alpha pathway');
    const place = alpha.places.find((p) => p.full && p.section.event.stId === 'R-HSA-90000211');
    assert.ok(place?.full && place.section.figure);
    const key = figureKey(place.section.figure);
    const printer = started;
    assert.ok(printer);
    for (const [width, height, landscape] of [
      [1300, 900, true],
      [600, 1400, false],
    ] as const) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(width)} ${String(height)}"><rect width="${String(width)}" height="${String(height)}" fill="#eee"/><text x="20" y="40" font-size="12">tall figure</text></svg>`;
      const figures = new Map(options.figures).set(key, svg);
      const sizes = figureSizes(figures);
      assert.equal(sizes(place.section.figure)?.landscape, landscape);
      const pages = await pagesOf(
        await printer.part(layoutBookPart(alpha, [place], { ...options, figures }).html)
      );
      const blank = pages.flatMap((page, i) => (page.text.trim() === '' ? [i + 1] : []));
      assert.deepEqual(blank, [], `${String(width)} by ${String(height)}: blank pages`);
      const estimate = estimatePages(place, sizes);
      assert.equal(
        Math.ceil(estimate),
        pages.length,
        `${String(width)} by ${String(height)}: ${String(estimate)}`
      );
    }
  });

  test("a figure's link is as wide as the figure, not the text, and centred", async () => {
    // Reaction one's figure, narrower than the text, in portrait, and drawn again 1,000 by
    // 900 with 8 px labels, which prints on a landscape page narrower than its text: each
    // link's rectangle is its figure's, centred on the page, told from the name's link to
    // the same page by its height
    const alpha = bookPdf(built, 'Alpha pathway');
    const place = alpha.places.find((p) => p.full && p.section.event.stId === 'R-HSA-90000211');
    assert.ok(place?.full && place.section.figure);
    const key = figureKey(place.section.figure);
    const printer = started;
    assert.ok(printer);
    const wide = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 900"><rect width="1000" height="900" fill="#eee"/><text x="20" y="40" font-size="8">wide figure</text></svg>`;
    for (const [figures, landscape] of [
      [options.figures, false],
      [new Map(options.figures).set(key, wide), true],
    ] as const) {
      assert.equal(figureSizes(figures)(place.section.figure)?.landscape, landscape);
      const html = layoutBookPart(alpha, [place], { ...options, figures }).html;
      const figure =
        /<a class="figure-link" href="([^"]*)"><svg\b[^>]*\swidth="([\d.]+)pt" height="([\d.]+)pt"/.exec(
          html
        );
      assert.ok(figure?.[1] && figure[2] && figure[3], 'no figure link');
      const href = figure[1].replace(/&amp;/g, '&');
      const width = Number(figure[2]);
      const height = Number(figure[3]);
      const text = landscape ? PORTRAIT.height : PORTRAIT.width;
      assert.ok(width < text - 50, String(width));
      const task = getDocument({ data: (await printer.part(html)).slice() });
      try {
        const doc = await task.promise;
        const rects: { rect: number[]; pageWidth: number }[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const [left = 0, , right = 0] = page.view;
          for (const a of await page.getAnnotations()) {
            const { url, rect } = a as { url?: unknown; rect?: number[] };
            const [, y1 = 0, , y2 = 0] = rect ?? [];
            if (url === href && Math.abs(y2 - y1 - height) < 2 && rect) {
              rects.push({ rect, pageWidth: right - left });
            }
          }
        }
        assert.equal(rects.length, 1, href);
        const { rect, pageWidth } = rects[0] ?? { rect: [], pageWidth: 0 };
        const [x1 = 0, , x2 = 0] = rect;
        assert.ok(Math.abs(x2 - x1 - width) < 2, `${String(x2 - x1)} for ${String(width)}`);
        // landscape on a landscape page; centred, as the margins are the same each side
        assert.equal(pageWidth > 800, landscape, String(pageWidth));
        const centre = (x1 + x2) / 2;
        assert.ok(
          Math.abs(centre - pageWidth / 2) < 2,
          `centred at ${String(centre)} on a page ${String(pageWidth)} wide`
        );
      } finally {
        await task.destroy();
      }
    }
  });

  test('a portrait figure counts its margins, and a reaction its events before and after', () => {
    const alpha = bookPdf(built, 'Alpha pathway');
    const place = alpha.places.find((p) => p.full && p.section.event.stId === 'R-HSA-90000211');
    assert.ok(place?.full && place.section.event.kind === 'reaction');
    assert.ok(place.section.event.before.length + place.section.event.after.length > 0);
    const none = estimatePages(place, () => null);
    // a portrait figure 100 pt tall, that fits: its height and its 10 pt margins
    const figure = estimatePages(place, () => ({ landscape: false, height: 100 }));
    assert.ok(Math.abs((figure - none) * PORTRAIT.height - 120) < 1e-6, String(figure - none));
    // without events before and after, two lines (15 pt each) fewer
    const alone = {
      ...place,
      section: { ...place.section, event: { ...place.section.event, before: [], after: [] } },
    };
    const fewer = estimatePages(alone, () => null);
    assert.ok(Math.abs((none - fewer) * PORTRAIT.height - 30) < 1e-6, String(none - fewer));
  });

  test('a part ends at the boundary where it reaches the threshold, not after', () => {
    // a section with a landscape figure and nothing after it: exactly two pages
    const gamma = bookPdf(built, 'Gamma pathway');
    const sizes = figureSizes(options.figures);
    const two = gamma.places.find((p) => p.full && p.section.event.stId === 'R-HSA-90000310');
    assert.ok(two);
    assert.equal(estimatePages(two, sizes), 2);
    assert.deepEqual(splitParts([two, two], 2, sizes), [[two], [two]]);
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
      settings: { threshold: THRESHOLD, parallel: 3, joins: 2 },
      join: (parts) => busy('join', () => joinParts(parts)),
      joined: async () => {
        await sleep(5);
      },
    });
    assert.equal(most, 3);
    // the first join (Gamma's, the largest PDF printed first) starts before the later
    // PDFs' prints are all started
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
        settings: { threshold: THRESHOLD, parallel: 2, joins: 2 },
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

  /** A printer of one blank page, after a wait, that fails for a PDF's parts by title. */
  const blankPrinter = async (wait: number, failFor?: string) => {
    const one = await PDFDocument.create();
    one.addPage();
    const blank = await one.save();
    return {
      part: async (html: string) => {
        if (failFor && html.includes(`<title>${failFor}</title>`)) throw new Error(`no ${failFor}`);
        await sleep(wait);
        return blank.slice();
      },
    };
  };

  test('at most `joins` joins at once, however many PDFs are printed together', async () => {
    // every PDF's two parts printed at once, so all three joins are ready together
    let joining = 0;
    let most = 0;
    await printBook(built.book, {
      printer: await blankPrinter(10),
      layout: options,
      settings: { threshold: 1000, parallel: 6, joins: 2 },
      join: async (parts) => {
        joining += 1;
        most = Math.max(most, joining);
        try {
          await sleep(30);
          return await joinParts(parts);
        } finally {
          joining -= 1;
        }
      },
      joined: () => Promise.resolve(),
    });
    assert.equal(most, 2);
  });

  test('the largest PDF, by its estimated pages, is printed first', async () => {
    // Gamma, its two landscape figures making it the largest, before Alpha and beta
    const titles: string[] = [];
    const blank = await blankPrinter(0);
    await printBook(built.book, {
      printer: {
        part: (html) => {
          titles.push(/<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '');
          return blank.part(html);
        },
      },
      layout: options,
      settings: { threshold: THRESHOLD, parallel: 1, joins: 1 },
      joined: () => Promise.resolve(),
    });
    assert.equal(titles[0], 'Gamma pathway');
    assert.deepEqual([...new Set(titles)], ['Gamma pathway', 'Alpha pathway', 'beta pathway']);
  });

  test('a failed join, or what is done with one, starts no join waiting', async () => {
    // all three PDFs printed together, their joins waiting on one join's slot; the first
    // fails, in the join or after it
    for (const where of ['join', 'joined'] as const) {
      const handed: string[] = [];
      let joins = 0;
      await assert.rejects(
        printBook(built.book, {
          printer: await blankPrinter(10),
          layout: options,
          settings: { threshold: 1000, parallel: 6, joins: 1 },
          // each failing after a while, so the other joins are waiting by then
          join: async (parts) => {
            joins += 1;
            await sleep(30);
            if (where === 'join') throw new Error('no join');
            return joinParts(parts);
          },
          joined: async (j) => {
            handed.push(j.doc.cover.title);
            await sleep(30);
            if (where === 'joined') throw new Error('not kept');
          },
        }),
        where === 'join' ? /no join/ : /not kept/
      );
      assert.equal(joins, 1, where);
      assert.equal(handed.length, where === 'join' ? 0 : 1, where);
    }
  });

  test('a figure that cannot be measured is thrown with the rest, naming it', async () => {
    const gamma = bookPdf(built, 'Gamma pathway');
    const figure = gamma.places.find((p) => p.full && p.section.figure);
    assert.ok(figure?.full && figure.section.figure);
    const key = figureKey(figure.section.figure);
    let prints = 0;
    const blank = await blankPrinter(0);
    const error: unknown = await printBook([gamma], {
      printer: {
        part: (html) => {
          prints += 1;
          return blank.part(html);
        },
      },
      layout: { ...options, figures: new Map(options.figures).set(key, '<svg></svg>') },
      settings: { threshold: THRESHOLD, parallel: 2, joins: 1 },
      joined: () => Promise.resolve(),
    }).then(
      () => null,
      (e: unknown) => e
    );
    assert.ok(error instanceof AggregateError, String(error));
    const [first] = error.errors as Error[];
    assert.ok(first?.message.startsWith(`The figure ${key}: `), first?.message);
    assert.equal(prints, 0);
  });

  test('every failure is thrown together, once what was printing has finished', async () => {
    let finished = 0;
    const blank = await blankPrinter(30);
    const alpha = bookPdf(built, 'Alpha pathway');
    const beta = bookPdf(built, 'beta pathway');
    const error: unknown = await printBook([alpha, beta], {
      printer: {
        part: async (html) => {
          // each PDF in two parts, all four printing at once: Alpha's fail at once, beta's
          // go on printing a while
          if (html.includes('<title>Alpha pathway</title>')) throw new Error('no Alpha');
          const pdf = await blank.part(html);
          finished += 1;
          return pdf;
        },
      },
      layout: options,
      settings: { threshold: 1000, parallel: 4, joins: 2 },
      joined: () => Promise.resolve(),
    }).then(
      () => null,
      (e: unknown) => e
    );
    assert.ok(error instanceof AggregateError, String(error));
    assert.deepEqual(
      error.errors.map((e: unknown) => (e instanceof Error ? e.message : e)),
      ['no Alpha', 'no Alpha']
    );
    // the two of beta's started beside them had finished when it was thrown
    assert.equal(finished, 2);
  });

  test("no PDF is joined once another's print has failed", async () => {
    // each PDF in two parts, all four printing at once: Gamma's fail, beta's finish after
    const beta = bookPdf(built, 'beta pathway');
    const gamma = bookPdf(built, 'Gamma pathway');
    let joins = 0;
    await assert.rejects(
      printBook([beta, gamma], {
        printer: await blankPrinter(20, 'Gamma pathway'),
        layout: options,
        settings: { threshold: 1000, parallel: 4, joins: 2 },
        join: (parts) => {
          joins += 1;
          return joinParts(parts);
        },
        joined: () => Promise.resolve(),
      }),
      /no Gamma pathway/
    );
    assert.equal(joins, 0);
  });

  test('a failed join, or a failure in what is done with a joined PDF, is thrown', async () => {
    const gamma = bookPdf(built, 'Gamma pathway');
    const run = async () => ({
      printer: await blankPrinter(0),
      layout: options,
      settings: { threshold: THRESHOLD, parallel: 2, joins: 2 },
      joined: () => Promise.resolve(),
    });
    await assert.rejects(
      printBook([gamma], { ...(await run()), join: () => Promise.reject(new Error('no join')) }),
      /no join/
    );
    await assert.rejects(
      printBook([gamma], { ...(await run()), joined: () => Promise.reject(new Error('not kept')) }),
      /not kept/
    );
  });

  test('a joined PDF carries what laying out its parts reported', async () => {
    // Gamma's last section laid out without its figure: missing, from the last part
    const gamma = bookPdf(built, 'Gamma pathway');
    const last = gamma.places.at(-1);
    assert.ok(last?.full && last.section.figure);
    const figures = new Map(options.figures);
    figures.delete(figureKey(last.section.figure));
    let report: Joined['report'] | undefined;
    await printBook([gamma], {
      printer: await blankPrinter(0),
      layout: { ...options, figures },
      settings: { threshold: THRESHOLD, parallel: 2, joins: 2 },
      joined: (j) => {
        report = j.report;
        return Promise.resolve();
      },
    });
    assert.deepEqual(report?.missing, [last.section.event.stId]);
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
    splitParts(places, 1e-6, () => null).map((part) => part.length),
    [1, 1, 1]
  );
  assert.deepEqual(
    splitParts(places, 1e6, () => null),
    [places]
  );
  assert.deepEqual(
    splitParts([], 1, () => null),
    []
  );
});
