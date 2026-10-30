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
    const folder = mkdtempSync(join(tmpdir(), 'pdf-export-'));
    try {
      return new Printer(await chromium.launch(), folder);
    } catch (error) {
      rmSync(folder, { recursive: true, force: true });
      throw error;
    }
  }

  /** A page of HTML, printed once from a file: tagged with an outline, or not. */
  async print(html: string, tagged: boolean): Promise<Uint8Array> {
    const file = join(this.#folder, `${String(++this.#count)}.html`);
    const page = await this.#browser.newPage();
    try {
      writeFileSync(file, html);
      await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
      // Every face the page declares is loaded, not only those its body uses: text only in
      // a margin box (a running header) is drawn with faces nothing else asked for, and is
      // left out if they are not ready. A face that fails to load (a missing file, or a
      // page whose file:// fonts cannot load) is refused, not left to a system font.
      const failed = await page.evaluate<string[]>(
        `Promise.allSettled([...document.fonts].map((face) => face.load())).then(() =>
          [...document.fonts].filter((face) => face.status !== 'loaded').map((face) => face.family))`
      );
      if (failed.length > 0) {
        throw new Error(`Fonts did not load: ${[...new Set(failed)].join(', ')}`);
      }
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
    try {
      await this.#browser.close();
    } finally {
      rmSync(this.#folder, { recursive: true, force: true });
    }
  }
}
