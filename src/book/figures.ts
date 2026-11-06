// The book's figures, read from the folder `figures` drew (spec 001 T029, contracts/figures.md):
// the book asks no render service. Each figure's file is `{stId}.svg`, named for an event
// whose section shows it; one drawing serves every section with the same figure (figureKey).
// A file is read each time the layout asks for it, never held, as the release's figures
// together are far larger than any one part. Its labels are printed as the book prints them
// (FR-017, src/figures/labels.ts); the second half of the character check, over its labels'
// text, is made before each part that draws it is printed (contracts/cli.md), a fault
// there naming the event the file is named for.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { labelsInBook } from '../figures/labels.ts';
import { BookCharacters } from '../layout/characters.ts';
import { figureKey, type FigureSvgs } from '../layout/figure.ts';
import type { Document } from '../model/types.ts';
import { errorCode } from '../unknown.ts';

/** Faults found while the book is printed, each a line as the preflight's are. */
export class BookFaults extends Error {
  override name = 'BookFaults';
  readonly faults: readonly string[];

  constructor(faults: readonly string[]) {
    super(`The book's faults: ${faults.join(', ')}`);
    this.faults = faults;
  }
}

/** What one drawing of a figure gives: its faults, and the substitutions it makes. */
export interface FigureCheck {
  faults: readonly string[];
  replaced: ReadonlyMap<number, number>;
}

export class FolderFigures implements FigureSvgs {
  readonly #folder: string;
  /** Each figure's key, and the event whose file draws it: the first in document order. */
  readonly #files = new Map<string, string>();
  readonly #checked = new Map<string, FigureCheck>();
  #ms = 0;

  constructor(folder: string, docs: readonly Document[]) {
    this.#folder = folder;
    for (const doc of docs) {
      for (const place of doc.places) {
        if (!place.full || !place.section.figure) continue;
        const key = figureKey(place.section.figure);
        if (!this.#files.has(key)) this.#files.set(key, place.section.event.stId);
      }
    }
  }

  /** Milliseconds spent reading the folder's files and making their labels' substitutions. */
  get ms(): number {
    return this.#ms;
  }

  /** A figure's file and the event it is named for; its text null where it is missing. */
  #read(key: string): { stId: string; svg: string | null } | undefined {
    const stId = this.#files.get(key);
    if (stId === undefined) return undefined;
    const started = performance.now();
    try {
      return { stId, svg: readFileSync(join(this.#folder, `${stId}.svg`), 'utf8') };
    } catch (error) {
      // a file gone since the preflight (deleted by hand) is a fault, not an error
      if (errorCode(error) === 'ENOENT') return { stId, svg: null };
      throw error;
    } finally {
      this.#ms += performance.now() - started;
    }
  }

  /**
   * A figure's labels checked, once a figure: a character no font draws a fault
   * `uncovered-character <U+XXXX> <stId>`, a file gone since the preflight
   * `missing-file <stId>.svg`; and the substitutions one drawing of it makes, for the run
   * report to count each time it is drawn.
   */
  check(key: string): FigureCheck {
    let checked = this.#checked.get(key);
    if (!checked) {
      const read = this.#read(key);
      if (!read) throw new Error(`No event of the book has the figure ${key}`);
      if (read.svg === null) {
        checked = { faults: [`missing-file ${read.stId}.svg`], replaced: new Map() };
      } else {
        const started = performance.now();
        const characters = new BookCharacters();
        labelsInBook(read.svg, read.stId, characters);
        this.#ms += performance.now() - started;
        checked = { faults: characters.faults, replaced: characters.replaced };
      }
      this.#checked.set(key, checked);
    }
    return checked;
  }

  /**
   * A figure's SVG as the book prints it, read from its file; none for a key no event of the
   * book has. A file gone since the preflight throws its `missing-file` fault, so a section
   * or a cover is never printed without its figure.
   */
  get(key: string): string | undefined {
    const read = this.#read(key);
    if (!read) return undefined;
    if (read.svg === null) throw new BookFaults([`missing-file ${read.stId}.svg`]);
    const started = performance.now();
    try {
      // the counts are the run's, made by check() for each drawing, so these are let go
      return labelsInBook(read.svg, read.stId, new BookCharacters());
    } finally {
      this.#ms += performance.now() - started;
    }
  }
}
