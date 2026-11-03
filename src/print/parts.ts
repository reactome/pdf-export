// The book's parts (spec 001 T025, research R4): each of the book's PDFs is printed in
// parts and joined, as one print of a large PDF does not fit in memory. The front part
// (cover, introduction, contents) is a part of its own, which T028 prints again; the
// sections are split into parts at section boundaries, each ending at the first boundary
// at which its estimated pages reach a threshold. Parts are printed untagged a few at a
// time across the PDFs, and each PDF's parts are joined with pdf-lib in the slot of
// whichever of its parts finishes printing last: a join holds a slot as a print does, and
// waits for no other PDF's printing, only for one of the fewer joins' slots, as a join
// holds its whole PDF in memory. The largest PDFs are printed first, so their joins do not
// all come together at the end.
// Links, the outline and page stamping are done on the joined PDF (T026, T027).
import { PDFDocument } from '@cantoo/pdf-lib';

import {
  layoutBookFront,
  layoutBookPart,
  type LayoutOptions,
  type Report,
} from '../layout/document.ts';
import { figureKey, measure, place as placeFigure, PORTRAIT } from '../layout/figure.ts';
import type { Document, Figure, Place } from '../model/types.ts';

export interface PartsSettings {
  /** The pages, estimated (Flow), at which a part ends at the next section boundary. */
  threshold: number;
  /** Parts printed and PDFs joined at once, across the PDFs (`--parallel`). */
  parallel: number;
  /**
   * PDFs joined at once, each join still holding one of `parallel`'s slots: a join holds
   * its whole PDF, and four of 6,203 pages at once did not fit in 4 GB (T011). Default 1:
   * two, by inference, need 4.1–4.9 GiB, until T029 measures that two fit.
   */
  joins: number;
}

/** About 200 pages a part (research R4); `--parallel`'s default (contracts/cli.md); one join. */
export const PARTS: PartsSettings = { threshold: 200, parallel: 4, joins: 1 };

/** What prints a part: the Printer (src/print/print.ts). */
export interface PartPrinter {
  part(html: string): Promise<Uint8Array>;
}

export interface Part {
  /** The part's places, in document order; none for the front part, which comes first. */
  places: readonly Place[];
  /** Its pages as printed. */
  pages: number;
}

/** A book's PDF, joined: its parts' pages in order, for links, outline and stamps. */
export interface Joined {
  doc: Document;
  pdf: PDFDocument;
  parts: Part[];
  /** What laying out its parts reported. */
  report: Report;
}

export interface BookRun {
  printer: PartPrinter;
  layout: LayoutOptions;
  settings: PartsSettings;
  /**
   * What is done with each joined PDF, in the slot of its join, so the PDF in memory is
   * counted there; a rejection stops the run as a failed print does.
   */
  joined: (joined: Joined) => Promise<void>;
  /** How parts are joined; the tests count it. */
  join?: typeof joinParts;
}

/** A figure as it prints: on a landscape page of its own, or its height in the portrait text. */
export interface FigureSize {
  landscape: boolean;
  /** Points, in portrait. */
  height: number;
}

/** Each figure's size as figure.ts places it, or null where its SVG is not given. */
export type Sizes = (figure: Figure) => FigureSize | null;

/** Sizes from the layout's figures, each SVG measured once however many sections draw it. */
export function figureSizes(figures: ReadonlyMap<string, string>): Sizes {
  const sizes = new Map<string, FigureSize | null>();
  return (figure) => {
    const key = figureKey(figure);
    let size = sizes.get(key);
    if (size === undefined) {
      const svg = figures.get(key);
      if (svg === undefined) {
        size = null;
      } else {
        let measured;
        try {
          measured = measure(svg);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`The figure ${key}: ${message}`, { cause: error });
        }
        const { landscape, scale } = placeFigure(measured);
        size = { landscape, height: measured.height * scale };
      }
      sizes.set(key, size);
    }
    return size;
  };
}

/** A line of body text: 10.5 pt type on 15 pt lines (the theme's body-medium). */
const LINE = 15;
/** Characters on a line of body text, 481.9 pt wide (inference, not measured). */
const CHARACTERS = 90;
/** A figure's margins in portrait (pages.css). */
const FIGURE_MARGINS = 20;

/** Points for a run of text, at least a line. */
const text = (characters: number) => LINE * Math.max(1, Math.ceil(characters / CHARACTERS));

/**
 * Pages filled by places in turn, estimated from the model and the figures' sizes, as a
 * part's pages are known only once it is printed. Text flows down portrait pages; a
 * portrait figure is never split, so one that does not fit begins a page; a landscape
 * figure ends the portrait page it follows, takes a page of its own, and what follows it
 * begins a new page (pages.css's named page `wide`). Text is counted in lines (the name,
 * its facts, the summations with their markup taken out, events before and after, two
 * lines a reference, a line an edit), so a section with a portrait figure or none is
 * within about a page; test/print/parts.test.ts holds it to that on the fixture.
 */
export class Flow {
  readonly #sizes: Sizes;
  /** Pages ended, and points used on the page under way. */
  #ended = 0;
  #used = 0;

  constructor(sizes: Sizes) {
    this.#sizes = sizes;
  }

  /** Pages so far, the page under way as its share used. */
  get pages(): number {
    return this.#ended + this.#used / PORTRAIT.height;
  }

  add(place: Place): void {
    if (!place.full) {
      this.#flow(LINE + 16);
      return;
    }
    const { section } = place;
    const { event } = section;
    // the rule and space above, the name, its facts
    let facts = 1 + (section.path.length > 0 ? 1 : 0);
    if (event.kind === 'reaction' && event.category) facts += 1;
    for (const list of [event.compartments, section.diseases, section.inferredFrom]) {
      if (list.length > 0) facts += 1;
    }
    this.#flow(24 + 2 * LINE + facts * (LINE + 2) + 8);
    const size = section.figure ? this.#sizes(section.figure) : null;
    if (size?.landscape) {
      this.#end();
      this.#ended += 1;
    } else if (size) {
      const height = size.height + FIGURE_MARGINS;
      if (this.#used + height > PORTRAIT.height) this.#end();
      this.#used += height;
    }
    let after = 0;
    for (const summation of section.summations) {
      after += text(summation.replace(/<[^>]*>/g, '').length);
    }
    if (event.kind === 'reaction' && (event.before.length > 0 || event.after.length > 0)) {
      after += 2 * LINE;
    }
    if (section.references.length > 0) after += 2 * LINE + 2 * LINE * section.references.length;
    if (section.edits.length > 0) after += 3 * LINE + LINE * section.edits.length;
    this.#flow(after);
  }

  /** Text flowing on, page after page. */
  #flow(points: number): void {
    this.#used += points;
    while (this.#used > PORTRAIT.height) {
      this.#ended += 1;
      this.#used -= PORTRAIT.height;
    }
  }

  /** The page under way ended: never empty, as a section's name and facts come first. */
  #end(): void {
    this.#ended += 1;
    this.#used = 0;
  }
}

/** A place's pages printed alone, estimated (Flow). */
export function estimatePages(place: Place, sizes: Sizes): number {
  const flow = new Flow(sizes);
  flow.add(place);
  return flow.pages;
}

/**
 * The places split into parts: each ends at the first section boundary at which its
 * estimated pages (Flow) reach the threshold.
 */
export function splitParts(places: readonly Place[], threshold: number, sizes: Sizes): Place[][] {
  const parts: Place[][] = [];
  let part: Place[] = [];
  let flow = new Flow(sizes);
  for (const place of places) {
    part.push(place);
    flow.add(place);
    if (flow.pages >= threshold) {
      parts.push(part);
      part = [];
      flow = new Flow(sizes);
    }
  }
  if (part.length > 0) parts.push(part);
  return parts;
}

/** Parts' PDFs joined in order into one, with each part's page count. */
export async function joinParts(
  parts: readonly Uint8Array[]
): Promise<{ pdf: PDFDocument; pages: number[] }> {
  const pdf = await PDFDocument.create();
  const pages: number[] = [];
  for (const bytes of parts) {
    const part = await PDFDocument.load(bytes);
    const copied = await pdf.copyPages(part, part.getPageIndices());
    for (const page of copied) pdf.addPage(page);
    pages.push(copied.length);
  }
  return { pdf, pages };
}

/** A fixed number of slots, each held by one print or one join, given in turn. */
class Slots {
  #free: number;
  readonly #waiting: (() => void)[] = [];

  constructor(count: number) {
    this.#free = count;
  }

  async run(task: () => Promise<void>): Promise<void> {
    if (this.#free > 0) this.#free -= 1;
    else await new Promise<void>((resolve) => this.#waiting.push(resolve));
    try {
      await task();
    } finally {
      const next = this.#waiting.shift();
      if (next) next();
      else this.#free += 1;
    }
  }
}

/**
 * Every PDF of the book printed in parts and joined, each handed to `joined`. The first
 * failure stops the run: what is printing finishes, nothing more is started, and once all
 * have stopped every failure is thrown, together in an AggregateError, as a run is whole
 * (contracts/cli.md).
 */
export async function printBook(docs: readonly Document[], run: BookRun): Promise<void> {
  const { printer, layout, settings, joined } = run;
  const join = run.join ?? joinParts;
  for (const [name, value] of Object.entries(settings)) {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`The parts' ${name} must be a whole number of at least 1`);
    }
  }
  const slots = new Slots(settings.parallel);
  const joinSlots = new Slots(settings.joins);
  const sizes = figureSizes(layout.figures);
  const failures: unknown[] = [];
  const tasks: Promise<void>[] = [];
  // the largest PDFs first, by their estimated pages (the sort is stable), each split; a
  // figure that cannot be measured is a failure like any other, and nothing is printed
  let split: [Document, Place[][]][] = [];
  try {
    const estimated = new Map(
      docs.map((doc) => {
        const flow = new Flow(sizes);
        for (const place of doc.places) flow.add(place);
        return [doc, flow.pages] as const;
      })
    );
    split = [...docs]
      .sort((a, b) => (estimated.get(b) ?? 0) - (estimated.get(a) ?? 0))
      .map((doc) => [doc, splitParts(doc.places, settings.threshold, sizes)]);
  } catch (error) {
    failures.push(error);
  }
  for (const [doc, sections] of split) {
    // the front part first, then the sections' parts, laid out only once a slot is theirs
    const parts: (readonly Place[] | null)[] = [null, ...sections];
    let printed: Uint8Array[] = [];
    const reports: Report[] = [];
    let left = parts.length;
    const print = async (places: readonly Place[] | null, i: number) => {
      if (failures.length > 0) return;
      const laid = places ? layoutBookPart(doc, places, layout) : layoutBookFront(doc, layout);
      printed[i] = await printer.part(laid.html);
      reports[i] = laid.report;
      left -= 1;
      if (left > 0 || failures.length > 0) return;
      // the PDF's parts are all printed, this one last: its join takes this slot and one
      // of the joins', holding both while what is done with the PDF is done, and the parts'
      // bytes are let go
      await joinSlots.run(async () => {
        if (failures.length > 0) return;
        // noted before the join's slot is let go, so no join waiting starts after it
        try {
          const { pdf, pages } = await join(printed);
          printed = [];
          await joined({
            doc,
            pdf,
            parts: parts.map((p, k) => ({ places: p ?? [], pages: pages[k] ?? 0 })),
            report: {
              belowFloor: reports.flatMap((r) => r.belowFloor),
              missing: reports.flatMap((r) => r.missing),
              unmeasured: reports.flatMap((r) => r.unmeasured),
            },
          });
        } catch (error) {
          failures.push(error);
        }
      });
    };
    parts.forEach((places, i) => {
      tasks.push(
        slots.run(async () => {
          // a failure is noted before its slot is let go, so no task waiting starts after it
          try {
            await print(places, i);
          } catch (error) {
            failures.push(error);
          }
        })
      );
    });
  }
  await Promise.all(tasks);
  if (failures.length > 0) {
    const first = failures[0] instanceof Error ? failures[0].message : String(failures[0]);
    throw new AggregateError(
      failures,
      `${String(failures.length)} failed in the book's parts: ${first}`
    );
  }
}
