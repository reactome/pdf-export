// The book's parts (spec 001 T025, research R4): each of the book's PDFs is printed in
// parts and joined, as one print of a large PDF does not fit in memory. The front part
// (cover, introduction, contents) is a part of its own, which T028 prints again; the
// sections are split into parts at section boundaries, each ending at the first boundary
// past a page threshold. Parts are printed untagged a few at a time across the PDFs, and
// each PDF's parts are joined with pdf-lib once its last part is printed, in that print's
// slot: a join holds a slot as a print does, and waits for no other PDF's printing.
// Links, the outline and page stamping are done on the joined PDF (T026, T027).
import { PDFDocument } from '@cantoo/pdf-lib';

import {
  layoutBookFront,
  layoutBookPart,
  type LayoutOptions,
  type Report,
} from '../layout/document.ts';
import type { Document, Place } from '../model/types.ts';

export interface PartsSettings {
  /** The pages, estimated (`estimatePages`), past which a part ends at the next section. */
  threshold: number;
  /** Parts printed and PDFs joined at once, across the PDFs (`--parallel`). */
  parallel: number;
}

/** About 200 pages a part (research R4); `--parallel`'s default (contracts/cli.md). */
export const PARTS: PartsSettings = { threshold: 200, parallel: 4 };

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

/** Lines of body text in the portrait text area: 10.5 pt type on 15 pt lines, 728.5 pt tall. */
const LINES = 48;
/** Characters on a line of body text, 481.9 pt wide (inference, not measured). */
const CHARACTERS = 90;

/** Lines for a run of text, at least one. */
const lines = (characters: number) => Math.max(1, Math.ceil(characters / CHARACTERS));

/**
 * A place's pages, estimated from the model, as a part's pages are known only once it is
 * printed: its figure a page, as a landscape figure takes a page of its own and a portrait
 * one most of one; its text in lines of the portrait text area (the name, its facts, the
 * summations with their markup taken out, events before and after, two lines a
 * reference, a line an edit). It errs large, so a part errs small.
 */
export function estimatePages(place: Place): number {
  if (!place.full) return 1 / LINES;
  const { section } = place;
  let count = 6;
  for (const summation of section.summations)
    count += lines(summation.replace(/<[^>]*>/g, '').length);
  if (section.event.kind === 'reaction') count += 2;
  if (section.references.length > 0) count += 1 + 2 * section.references.length;
  if (section.edits.length > 0) count += 2 + section.edits.length;
  return (section.figure ? 1 : 0) + count / LINES;
}

/** The places split into parts: each ends at the first section boundary past the threshold. */
export function splitParts(places: readonly Place[], threshold: number): Place[][] {
  const parts: Place[][] = [];
  let part: Place[] = [];
  let pages = 0;
  for (const place of places) {
    part.push(place);
    pages += estimatePages(place);
    if (pages >= threshold) {
      parts.push(part);
      part = [];
      pages = 0;
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
 * failure stops the run: what is printing finishes, nothing more is started, and it is
 * thrown once all have stopped, as a run is whole (contracts/cli.md).
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
  const failures: unknown[] = [];
  const tasks: Promise<void>[] = [];
  for (const doc of docs) {
    // the front part first, then the sections' parts, laid out only once a slot is theirs
    const parts: (readonly Place[] | null)[] = [
      null,
      ...splitParts(doc.places, settings.threshold),
    ];
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
      // the PDF's last part: its join takes this slot, and the parts' bytes are let go
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
  if (failures.length > 0) throw failures[0];
}
