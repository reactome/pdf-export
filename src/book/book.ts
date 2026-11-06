// The book printed and written (spec 001 T029, contracts/cli.md `book`, research R4): each
// of the book's PDFs, as the preflight built it, with FR-017's substitutions made in what it
// prints, printed in parts (T025), and each joined PDF then, in its join's slot and in this
// order, given its contents' numbers (T028's `reprintFront`, which reads the probes), its
// links (T026's `rewriteLinks`, which removes them), its outline (`writeOutline`) and its
// stamps (T027's `stampPages`), and saved with object streams off into the folder the
// command moves into place at the end. A PDF refused at any of these is never saved: those
// steps change it in place and do not undo a part done, so the run fails whole.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { pageStyles, type LayoutOptions, type Report } from '../layout/document.ts';
import type { BookCharacters } from '../layout/characters.ts';
import { figureKey } from '../layout/figure.ts';
import type { Document, Figure, Place } from '../model/types.ts';
import { fileName } from '../preflight/names.ts';
import { bookPathways } from '../preflight/preflight.ts';
import { reprintFront } from '../print/contents.ts';
import { rewriteLinks } from '../print/links.ts';
import { writeOutline } from '../print/outline.ts';
import { joinParts, printBook, type PartPrinter, type PartsSettings } from '../print/parts.ts';
import { stampPages } from '../print/stamp.ts';
import { BookFaults, FolderFigures } from './figures.ts';

export { BookFaults } from './figures.ts';

/**
 * pdf-lib's object streams, off unless memory binds (research R4, T011): on synthetic files
 * a save took five to eight times as long with them on, for files 6% smaller, and memory
 * peaked lower, perhaps only because slow saves overlapped less. The real book's join is
 * measured with both in T031, which settles this, as it settles `--joins`' default of 1.
 */
export const OBJECT_STREAMS = false;

/**
 * A book's PDF as it is printed: FR-017's substitutions made in every text the layout
 * prints, and counted in `characters` once for each place it is printed, so the counts are
 * the finished book's: a name printed in a heading and a contents entry counts twice, and
 * once only where one string of the model is printed once and read again unprinted (the
 * outline's titles, a figure's label for readers, which an untagged part does not carry).
 * The cover's title is printed on the cover and counted there; the running headers stamped
 * from it are not counted (T027). What the model holds and the layout does not print (a
 * short entry's location, an event's species, a reference's address) is left as it is.
 * A character no font draws is a fault in `characters`, as the preflight found it.
 */
export function printedDocument(doc: Document, characters: BookCharacters): Document {
  const root = bookPathways([doc])[0]?.stId ?? '';
  const text = (value: string, subject: string): string => characters.text(value, subject);
  return {
    ...doc,
    cover: {
      ...doc.cover,
      title: text(doc.cover.title, root),
      // a name the graph does not give stays null, printed empty
      names: doc.cover.names.map((name) => (name === null ? null : text(name, root))),
    },
    contents: doc.contents?.map((entry) => ({ ...entry, title: text(entry.title, root) })) ?? null,
    places: doc.places.map((place): Place => {
      if (!place.full) {
        const { event } = place;
        return { ...place, event: { ...event, name: text(event.name, event.stId) } };
      }
      const { section } = place;
      const { event } = section;
      const s = event.stId;
      return {
        full: true,
        section: {
          ...section,
          event: {
            ...event,
            name: text(event.name, s),
            category: event.category === null ? null : text(event.category, s),
            compartments: characters.strings(event.compartments, s),
            before: characters.strings(event.before, s),
            after: characters.strings(event.after, s),
          },
          path: characters.strings(section.path, s),
          diseases: characters.strings(section.diseases, s),
          inferredFrom: characters.strings(section.inferredFrom, s),
          summations: section.summations.map((summation) => characters.markup(summation, s)),
          // a reference's address is a link's, not printed
          references: section.references.map((r) => ({
            ...characters.strings({ ...r, url: null }, s),
            url: r.url,
          })),
          edits: characters.strings(section.edits, s),
        },
      };
    }),
  };
}

/** One PDF written: its top-level pathway, its file, its pages and bytes. */
export interface PdfWritten {
  stId: string;
  file: string;
  pages: number;
  bytes: number;
}

/** What writing the book gives the run report. */
export interface Written {
  /** In the book's order (FR-002). */
  pdfs: PdfWritten[];
  /** The layout's report over every part, by stable identifier, each once. */
  layout: Report;
  /** FR-017's substitutions made in the finished book, by code point. */
  replaced: Map<number, number>;
  /** Milliseconds, summed over the slots: so above the wall time where they overlap. */
  ms: { figures: number; print: number; contents: number; join: number; parts: number };
}

export interface WriteSettings {
  /** The folder `figures` wrote. */
  figures: string;
  site: string;
  /** Where the PDFs are written: the folder the command moves into place. */
  folder: string;
  parts: PartsSettings;
  printer: PartPrinter;
  date: Date;
}

/**
 * The book's PDFs, printed and written into `settings.folder`, from its documents as the
 * preflight built them; `characters` counts the substitutions in what is printed. Throws a
 * `BookFaults` for a character no font draws in the texts (which the preflight has
 * checked), and printBook's AggregateError for anything that stops the run, among them a
 * `BookFaults` for a figure's labels; what was written is then the caller's to remove.
 */
export async function writeBook(
  docs: readonly Document[],
  characters: BookCharacters,
  settings: WriteSettings
): Promise<Written> {
  const files = new Map<Document, PdfWritten>();
  const printed = docs.map((doc) => {
    const done = printedDocument(doc, characters);
    const [pathway] = bookPathways([doc]);
    if (!pathway) throw new Error('A PDF of the book holds no pathway');
    files.set(done, { stId: pathway.stId, file: fileName(pathway.name), pages: 0, bytes: 0 });
    return done;
  });
  if (characters.faults.length > 0) throw new BookFaults(characters.faults);
  const figures = new FolderFigures(settings.figures, printed);
  const layout: LayoutOptions = {
    site: settings.site,
    date: settings.date,
    figures,
    styles: pageStyles(),
  };
  const replaced = new Map(characters.replaced);
  const ms = { figures: 0, print: 0, contents: 0, join: 0, parts: 0 };
  const reports: Report[] = [];
  const timed = async <T>(stage: keyof typeof ms, work: () => Promise<T>): Promise<T> => {
    const started = performance.now();
    try {
      return await work();
    } finally {
      ms[stage] += performance.now() - started;
    }
  };
  // the parts' prints timed; the front part's second print is the contents' stage
  const printer: PartPrinter = {
    part: (html) => timed('print', () => settings.printer.part(html)),
  };
  const started = performance.now();
  await printBook(printed, {
    printer,
    layout,
    settings: settings.parts,
    join: (parts) => timed('join', () => joinParts(parts)),
    // each figure a part draws checked before the part is laid out, and its substitutions
    // counted for each drawing, the cover's among them; the front part's second print
    // (T028) is not laid out here, so nothing in it is counted twice
    laying: (doc, places) => {
      const drawn: (Figure | null)[] =
        places === null
          ? [doc.cover.figure]
          : places.map((place) => (place.full ? place.section.figure : null));
      const checks = drawn.flatMap((figure) => (figure ? [figures.check(figureKey(figure))] : []));
      const faults = [...new Set(checks.flatMap((check) => check.faults))];
      if (faults.length > 0) throw new BookFaults(faults);
      for (const check of checks) {
        for (const [point, count] of check.replaced) {
          replaced.set(point, (replaced.get(point) ?? 0) + count);
        }
      }
    },
    joined: async (joined) => {
      const { doc, pdf } = joined;
      const written = files.get(doc);
      if (!written) throw new Error('A joined PDF that is not one of the book');
      await timed('contents', () => reprintFront(joined, settings.printer, layout));
      const bytes = await timed('join', async () => {
        const targets = rewriteLinks(pdf);
        writeOutline(pdf, doc.contents ?? [], targets);
        await stampPages(joined, targets);
        return pdf.save({ useObjectStreams: OBJECT_STREAMS });
      });
      writeFileSync(join(settings.folder, written.file), bytes);
      written.pages = pdf.getPageCount();
      written.bytes = bytes.length;
      reports.push(joined.report);
    },
  });
  ms.parts = performance.now() - started;
  ms.figures = figures.ms;
  const each = (list: (r: Report) => string[]): string[] =>
    [...new Set(reports.flatMap(list))].sort();
  return {
    pdfs: printed.flatMap((doc) => {
      const written = files.get(doc);
      return written ? [written] : [];
    }),
    layout: {
      belowFloor: each((r) => r.belowFloor),
      missing: each((r) => r.missing),
      unmeasured: each((r) => r.unmeasured),
    },
    replaced,
    ms,
  };
}
