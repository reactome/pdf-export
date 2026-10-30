// Printing (spec 001 T019, research R4): one Chromium prints every page the layout writes.
// Each page is written to a file and loaded with goto, never setContent: a page set from a
// string cannot load the fonts from file:// and falls back to the system's without a word.
// A single event's PDF is printed tagged, with Chromium's outline, and with a contents list
// it is printed twice, the second time with the numbers the first gave. A part of the book
// is printed untagged, its links placeholders for the join (T026).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { chromium, type Browser } from 'playwright-core';

import { contentsTargets, fillContents, landed } from './contents.ts';

export class Printer {
  readonly #browser: Browser;
  readonly #folder: string;
  #count = 0;

  private constructor(browser: Browser, folder: string) {
    this.#browser = browser;
    this.#folder = folder;
  }

  static async start(): Promise<Printer> {
    const browser = await chromium.launch();
    return new Printer(browser, mkdtempSync(join(tmpdir(), 'pdf-export-')));
  }

  /** A page of HTML, printed once from a file: tagged with an outline, or not. */
  async print(html: string, tagged: boolean): Promise<Uint8Array> {
    const file = join(this.#folder, `${String(++this.#count)}.html`);
    writeFileSync(file, html);
    const page = await this.#browser.newPage();
    try {
      await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
      // every face is font-display: block, so printing waits for each one used
      await page.evaluate('document.fonts.ready.then(() => true)');
      // a plain Uint8Array: pdf.js refuses a Buffer
      return new Uint8Array(
        await page.pdf({ preferCSSPageSize: true, printBackground: true, tagged, outline: tagged })
      );
    } finally {
      await page.close();
      rmSync(file, { force: true });
    }
  }

  /**
   * A single event's PDF. With a contents list, the first print gives each entry's page,
   * and the second prints them; the two must have the same pages.
   */
  async single(html: string): Promise<Uint8Array> {
    const first = await this.print(html, true);
    const targets = contentsTargets(html);
    if (targets.length === 0) return first;
    const { pages, pageCount } = await landed(first, targets);
    const second = await this.print(fillContents(html, pages), true);
    const check = await landed(second, targets);
    const moved = targets.filter((t) => check.pages.get(t) !== pages.get(t));
    if (check.pageCount !== pageCount || moved.length > 0) {
      throw new Error(
        `The contents' numbers moved the pages: ${String(pageCount)} pages, then ${String(check.pageCount)}; moved: ${moved.join(', ')}`
      );
    }
    return second;
  }

  /** A part of the book: untagged, with placeholder links and probes. */
  async part(html: string): Promise<Uint8Array> {
    return this.print(html, false);
  }

  async close(): Promise<void> {
    await this.#browser.close();
    rmSync(this.#folder, { recursive: true, force: true });
  }
}
