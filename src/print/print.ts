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

import { contentsTargets, fillContents, landed, movedPages } from './contents.ts';

export class Printer {
  readonly #browser: Browser;
  readonly #folder: string;
  #count = 0;

  readonly #onExit: () => void;

  private constructor(browser: Browser, folder: string, onExit: () => void) {
    this.#browser = browser;
    this.#folder = folder;
    this.#onExit = onExit;
  }

  static async start(): Promise<Printer> {
    const folder = mkdtempSync(join(tmpdir(), 'pdf-export-'));
    // its folder removed as the process exits if it is not closed first (a run stopped by a
    // signal), from before the browser is launched
    const onExit = () => {
      rmSync(folder, { recursive: true, force: true });
    };
    process.once('exit', onExit);
    try {
      return new Printer(await chromium.launch(), folder, onExit);
    } catch (error) {
      process.off('exit', onExit);
      onExit();
      throw error;
    }
  }

  /** Whether its browser is still there: one that crashed or was killed is not. */
  get connected(): boolean {
    return this.#browser.isConnected();
  }

  /** Called once its browser goes, however it went (a crash, a kill, `close`). */
  onDisconnected(listener: () => void): void {
    this.#browser.once('disconnected', listener);
  }

  /**
   * A page of HTML, printed once from a file: tagged with an outline, or not. When `signal`
   * ends, the page is closed, which stops its print at once; one that has ended prints nothing.
   */
  async print(html: string, tagged: boolean, signal?: AbortSignal): Promise<Uint8Array> {
    signal?.throwIfAborted();
    const file = join(this.#folder, `${String(++this.#count)}.html`);
    const page = await this.#browser.newPage();
    const stop = () => {
      void page.close().catch(() => undefined);
    };
    signal?.addEventListener('abort', stop, { once: true });
    try {
      signal?.throwIfAborted();
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
    } catch (error) {
      // a print stopped by its signal fails with the signal's reason, not the page's
      signal?.throwIfAborted();
      throw error;
    } finally {
      signal?.removeEventListener('abort', stop);
      await page.close().catch(() => undefined);
      rmSync(file, { force: true });
    }
  }

  /**
   * A single event's PDF. With a contents list, the first print gives each entry's page,
   * and the second prints them; the two must have the same pages. Each print stops when
   * `signal` ends, and the second is not begun after it.
   */
  async single(html: string, signal?: AbortSignal): Promise<Uint8Array> {
    const first = await this.print(html, true, signal);
    const targets = contentsTargets(html);
    if (targets.length === 0) return first;
    const { pages, pageCount } = await landed(first, targets);
    // the second print is not begun once the signal has ended
    signal?.throwIfAborted();
    const second = await this.print(fillContents(html, pages), true, signal);
    const problem = movedPages({ pages, pageCount }, await landed(second, targets), targets);
    if (problem) throw new Error(`The contents' numbers moved the pages: ${problem}`);
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
      process.off('exit', this.#onExit);
    }
  }
}
