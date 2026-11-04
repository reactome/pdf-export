// FR-011's check, `check-book` (spec 001 T030, contracts/cli.md, SC-007): the fixture's book,
// printed once by `book`, passes; and a copy of it with one fault planted, by editing its
// folder or a copy of one of its PDFs (never the shared fixture), fails with that fault's
// line and no other. The faults are planted in `beta pathway.pdf`, at Reaction eight
// (R-HSA-90000132, at one place there, so its one contents entry and one outline entry are
// its own), and at beta sub with diagram (R-HSA-90000130) for a diagram's figure.
import assert from 'node:assert/strict';
import {
  copyFileSync,
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';

import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFString,
} from '@cantoo/pdf-lib';

import { bookCommand } from '../../src/book/command.ts';
import { CHECKS, checkBook, checkBookCommand } from '../../src/check/book.ts';
import { graphSettings, openGraph, type Graph } from '../../src/graph/connection.ts';
import { releaseInfo } from '../../src/graph/queries.ts';
import { PLACEHOLDER } from '../../src/layout/html.ts';
import { buildBook } from '../../src/model/build.ts';
import type { Document } from '../../src/model/types.ts';
import { readSummary } from '../../src/preflight/files.ts';
import { expectedFigures, manifestLine, MANIFEST } from '../../src/preflight/folder.ts';

const skip = process.env['NEO4J_URI'] ? false : 'no fixture graph: set NEO4J_URI';
const FILES = fileURLToPath(new URL('../../ci/fixture/files/', import.meta.url));
const FIGURES = fileURLToPath(new URL('../../ci/fixture/figures/', import.meta.url));
const BETA = 'beta pathway.pdf';
const EIGHT = 'R-HSA-90000132';
const SUB = 'R-HSA-90000130';

/** A PDF in a folder changed and saved again, as the book saves it (no object streams). */
async function editPdf(path: string, edit: (pdf: PDFDocument) => void): Promise<void> {
  const pdf = await PDFDocument.load(readFileSync(path));
  edit(pdf);
  writeFileSync(path, await pdf.save({ useObjectStreams: false }));
}

interface Entry {
  ref: PDFRef;
  dict: PDFDict;
  parent: PDFDict;
  title: string;
}

/** Every outline entry, at any depth, in order. */
function outlineEntries(pdf: PDFDocument): Entry[] {
  const entries: Entry[] = [];
  const walk = (parent: PDFDict) => {
    let ref = parent.get(PDFName.of('First'));
    while (ref instanceof PDFRef) {
      const dict = pdf.context.lookup(ref, PDFDict);
      const titled = dict.lookup(PDFName.of('Title'));
      if (!(titled instanceof PDFHexString || titled instanceof PDFString))
        throw new Error('untitled');
      const title = titled.decodeText();
      entries.push({ ref, dict, parent, title });
      walk(dict);
      ref = dict.get(PDFName.of('Next'));
    }
  };
  walk(pdf.catalog.lookup(PDFName.of('Outlines'), PDFDict));
  return entries;
}

/** The one outline entry with a title. */
function entryOf(pdf: PDFDocument, title: string): Entry {
  const found = outlineEntries(pdf).filter((entry) => entry.title === title);
  assert.equal(found.length, 1, `outline entries titled ${title}`);
  const [entry] = found;
  if (!entry) throw new Error('unreachable');
  return entry;
}

/** Where an outline entry lands: its page's index and ref, and its height. */
function landingOf(pdf: PDFDocument, title: string): { index: number; page: PDFRef; y: number } {
  const dest = entryOf(pdf, title).dict.lookup(PDFName.of('Dest'), PDFArray);
  const page = dest.get(0);
  if (!(page instanceof PDFRef)) throw new Error('a destination with no page');
  const index = pdf.getPages().findIndex((p) => p.ref === page);
  return { index, page, y: dest.lookup(3, PDFNumber).asNumber() };
}

/** A leaf of the outline taken out of it, its neighbours and parent linked past it. */
function dropOutline(pdf: PDFDocument, title: string): void {
  const { ref, dict, parent } = entryOf(pdf, title);
  assert.ok(!dict.has(PDFName.of('First')), `${title} is not a leaf`);
  const prev = dict.get(PDFName.of('Prev'));
  const next = dict.get(PDFName.of('Next'));
  const relink = (holder: PDFDict, key: string, to: unknown) => {
    if (to instanceof PDFRef) holder.set(PDFName.of(key), to);
    else holder.delete(PDFName.of(key));
  };
  if (prev instanceof PDFRef) relink(pdf.context.lookup(prev, PDFDict), 'Next', next);
  if (next instanceof PDFRef) relink(pdf.context.lookup(next, PDFDict), 'Prev', prev);
  if (parent.get(PDFName.of('First')) === ref) relink(parent, 'First', next);
  if (parent.get(PDFName.of('Last')) === ref) relink(parent, 'Last', prev);
  if (!parent.has(PDFName.of('First'))) parent.delete(PDFName.of('Count'));
  pdf.context.delete(ref);
}

interface Annotation {
  ref: PDFRef;
  dict: PDFDict;
  uri: string | null;
  dest: PDFArray | undefined;
  top: number;
}

/** A page's link annotations, as listed. */
function annotations(pdf: PDFDocument, index: number): Annotation[] {
  const annots = pdf.getPages()[index]?.node.Annots();
  const found: Annotation[] = [];
  for (let i = 0; i < (annots?.size() ?? 0); i++) {
    const ref = annots?.get(i);
    if (!(ref instanceof PDFRef)) continue;
    const dict = pdf.context.lookup(ref, PDFDict);
    const action = dict.lookupMaybe(PDFName.of('A'), PDFDict);
    const uri = action?.lookupMaybe(PDFName.of('URI'), PDFString, PDFHexString)?.decodeText();
    const rect = dict.lookup(PDFName.of('Rect'), PDFArray);
    const top = Math.max(
      rect.lookup(1, PDFNumber).asNumber(),
      rect.lookup(3, PDFNumber).asNumber()
    );
    found.push({
      ref,
      dict,
      uri: uri ?? null,
      dest: dict.lookupMaybe(PDFName.of('Dest'), PDFArray),
      top,
    });
  }
  return found;
}

/** An annotation taken off its page and out of the file. */
function removeAnnotation(pdf: PDFDocument, index: number, ref: PDFRef): void {
  const page = pdf.getPages()[index];
  const annots = page?.node.Annots();
  if (!page || !annots) throw new Error('a page with no annotations');
  const at = annots.indexOf(ref);
  assert.ok(at !== undefined && at >= 0, 'the annotation is not on its page');
  annots.remove(at);
  pdf.context.delete(ref);
}

/** A font's character codes and what each reads as, from its ToUnicode map. */
function readsAs(font: PDFDict): Map<number, string> {
  const map = new Map<number, string>();
  const stream = font.lookup(PDFName.of('ToUnicode'));
  if (!(stream instanceof PDFRawStream)) return map;
  const cmap = Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
  const utf16 = (hex: string) => Buffer.from(hex, 'hex').swap16().toString('utf16le');
  for (const [, block = ''] of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const [, code = '', to = ''] of block.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      map.set(parseInt(code, 16), utf16(to));
    }
  }
  for (const [, block = ''] of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const ranges = block.matchAll(
      /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[([^\]]*)\])/g
    );
    for (const [, lo = '', hi = '', base, list] of ranges) {
      const from = parseInt(lo, 16);
      const to = parseInt(hi, 16);
      const listed = list === undefined ? [] : [...list.matchAll(/<([0-9A-Fa-f]+)>/g)];
      for (let code = from; code <= to; code++) {
        if (base !== undefined)
          map.set(code, String.fromCodePoint(parseInt(base, 16) + code - from));
        else map.set(code, utf16(listed[code - from]?.[1] ?? ''));
      }
    }
  }
  return map;
}

/**
 * Every run of text on a page that reads `text` taken out of its content: each `BT ... ET`
 * block (Chromium writes one a run, its glyphs as two-byte hex codes) read through its
 * fonts' ToUnicode maps. Returns how many were taken out.
 */
function eraseText(pdf: PDFDocument, index: number, text: string): number {
  const page = pdf.getPages()[index];
  if (!page) throw new Error('no such page');
  const fonts = page.node.Resources()?.lookupMaybe(PDFName.of('Font'), PDFDict);
  const maps = new Map<string, Map<number, string>>();
  const mapOf = (name: string) => {
    let map = maps.get(name);
    if (!map) {
      const font = fonts?.lookupMaybe(PDFName.of(name), PDFDict);
      map = font ? readsAs(font) : new Map<number, string>();
      maps.set(name, map);
    }
    return map;
  };
  const contents = page.node.get(PDFName.of('Contents'));
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  let erased = 0;
  for (const ref of refs) {
    if (!(ref instanceof PDFRef)) continue;
    const stream = pdf.context.lookup(ref);
    if (!(stream instanceof PDFRawStream)) continue;
    const before = Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
    let found = 0;
    const after = before.replace(/\bBT\b[\s\S]*?\bET\b/g, (block) => {
      let map = new Map<number, string>();
      let read = '';
      for (const [, font, hex] of block.matchAll(
        /\/([^\s/<>[\]()]+)\s+[-\d.]+\s+Tf|<([0-9A-Fa-f\s]*)>/g
      )) {
        if (font !== undefined) map = mapOf(font);
        else
          for (const code of (hex ?? '').replace(/\s/g, '').match(/.{4}/g) ?? []) {
            read += map.get(parseInt(code, 16)) ?? '';
          }
      }
      if (read !== text) return block;
      found += 1;
      return '';
    });
    if (found === 0) continue;
    erased += found;
    pdf.context.assign(ref, pdf.context.flateStream(Buffer.from(after, 'latin1')));
  }
  return erased;
}

describe('pdf-export check-book', { skip }, () => {
  let root: string | undefined;
  const scratch = (): string => {
    root ??= mkdtempSync(join(tmpdir(), 'pdfx-check-'));
    return mkdtempSync(join(root, 'test-'));
  };
  /** The fixture's book, as `book` wrote it, and the documents it was made from. */
  let book: string;
  let docs: Document[];
  let figures: string;
  let summary: NonNullable<ReturnType<typeof readSummary>>;
  const env = { NEO4J_URI: process.env['NEO4J_URI'] };

  before(async () => {
    const graph = openGraph(graphSettings(process.env));
    const read = readSummary(FILES);
    if (!read) throw new Error('the fixture has no EHLD summary');
    summary = read;
    let print;
    try {
      const release = await releaseInfo(graph);
      docs = await buildBook(graph, { illustrated: summary.illustrated });
      print = {
        release: release.release,
        checksum: release.checksum ?? '',
        summary: summary.hash,
        content: release.release,
        build: 'test-build',
      };
    } finally {
      await graph.close();
    }
    // a figures' folder as `figures` would leave it, as the book's tests write one
    figures = scratch();
    const lines = [manifestLine({ type: 'fingerprint', ...print })];
    for (const record of expectedFigures(docs).values()) {
      const file = `${record.source}${record.kind === 'reaction' ? '.reaction' : ''}.svg`;
      copyFileSync(join(FIGURES, file), join(figures, `${record.stId}.svg`));
      lines.push(manifestLine({ type: 'figure', ...record }));
    }
    lines.push(manifestLine({ type: 'complete', ...print }));
    writeFileSync(join(figures, MANIFEST), lines.join(''));
    book = join(scratch(), 'TheReactomeBook');
    const temporary = scratch();
    const was = process.env['TMPDIR'];
    process.env['TMPDIR'] = temporary;
    const err: string[] = [];
    let code: number;
    try {
      code = await bookCommand(
        ['--files', FILES, '--figures', figures, '--site', 'https://site.example', '--out', book],
        env,
        { out: () => undefined, err: (text) => err.push(text), date: new Date('2026-11-04') }
      );
    } finally {
      if (was === undefined) delete process.env['TMPDIR'];
      else process.env['TMPDIR'] = was;
    }
    assert.equal(code, 0, err.join(''));
    assert.deepEqual(readdirSync(temporary), [], 'left in its temporary folder');
  });
  after(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  /** The faults in a copy of the book, `plant` given its folder first. */
  const planted = async (plant: (folder: string) => void | Promise<void>, files = FILES) => {
    const folder = join(scratch(), 'TheReactomeBook');
    cpSync(book, folder, { recursive: true });
    await plant(folder);
    return (await checkBook(folder, docs, files)).faults;
  };

  /** A plant in `beta pathway.pdf`. */
  const inBeta = (edit: (pdf: PDFDocument) => void) => (folder: string) =>
    editPdf(join(folder, BETA), edit);

  const line = (kind: string, stId: string, file = BETA) =>
    `${kind} ${JSON.stringify(file)} ${stId}`;

  test('the book as `book` wrote it passes every check', async () => {
    assert.deepEqual(readdirSync(book).sort(), ['Alpha pathway.pdf', 'Gamma pathway.pdf', BETA]);
    const checked = await checkBook(book, docs, FILES);
    assert.deepEqual(checked.faults, []);
    assert.deepEqual(
      checked.checks,
      CHECKS.map((check) => ({ check, faults: 0 }))
    );
    // and so it does saved again unchanged, as the plants are
    assert.deepEqual(await planted(inBeta(() => undefined)), []);
  });

  test('a top-level pathway with no PDF: missing-pathway', async () => {
    const faults = await planted((folder) => {
      unlinkSync(join(folder, 'Gamma pathway.pdf'));
    });
    assert.deepEqual(faults, ['missing-pathway R-HSA-90000300']);
  });

  test("a file that is no top-level pathway's: extra-file", async () => {
    const faults = await planted((folder) => {
      copyFileSync(join(folder, BETA), join(folder, 'Delta pathway.pdf'));
    });
    assert.deepEqual(faults, ['extra-file "Delta pathway.pdf"']);
  });

  test("an event's contents entry gone: not-in-contents", async () => {
    const faults = await planted(
      inBeta((pdf) => {
        const target = landingOf(pdf, 'Reaction eight');
        const contents = landingOf(pdf, 'Contents').index;
        const links = annotations(pdf, contents).filter(
          (a) =>
            a.dest?.get(0) === target.page && a.dest.lookup(3, PDFNumber).asNumber() === target.y
        );
        assert.equal(links.length, 1);
        for (const link of links) removeAnnotation(pdf, contents, link.ref);
      })
    );
    assert.deepEqual(faults, [line('not-in-contents', EIGHT)]);
    // its link kept, its text gone
    const unread = await planted(
      inBeta((pdf) => {
        assert.equal(eraseText(pdf, landingOf(pdf, 'Contents').index, 'Reaction eight'), 1);
      })
    );
    assert.deepEqual(unread, [line('not-in-contents', EIGHT)]);
  });

  test("an event's outline entry gone: not-in-outline", async () => {
    const faults = await planted(
      inBeta((pdf) => {
        dropOutline(pdf, 'Reaction eight');
      })
    );
    assert.deepEqual(faults, [line('not-in-outline', EIGHT)]);
    // there, landing on its section, but titled another's name
    const retitled = await planted(
      inBeta((pdf) => {
        entryOf(pdf, 'Reaction eight').dict.set(
          PDFName.of('Title'),
          PDFHexString.fromText('Reaction nine')
        );
      })
    );
    assert.deepEqual(retitled, [line('not-in-outline', EIGHT)]);
    // titled its name, but landing 10 pt below its heading, past what a landing may be off
    const moved = await planted(
      inBeta((pdf) => {
        const dest = entryOf(pdf, 'Reaction eight').dict.lookup(PDFName.of('Dest'), PDFArray);
        dest.set(3, PDFNumber.of(dest.lookup(3, PDFNumber).asNumber() - 10));
      })
    );
    assert.deepEqual(moved, [line('not-in-outline', EIGHT)]);
  });

  test("a section's name not printed: no-name", async () => {
    const faults = await planted(
      inBeta((pdf) => {
        const { index } = landingOf(pdf, 'Reaction eight');
        assert.ok(eraseText(pdf, index, 'Reaction eight') > 0, 'no name erased');
      })
    );
    assert.deepEqual(faults, [line('no-name', EIGHT)]);
  });

  test("a section's stable identifier not printed: no-stable-id", async () => {
    const faults = await planted(
      inBeta((pdf) => {
        const { index } = landingOf(pdf, 'Reaction eight');
        assert.equal(eraseText(pdf, index, EIGHT), 1);
      })
    );
    assert.deepEqual(faults, [line('no-stable-id', EIGHT)]);
  });

  /** The figure's link in a section: the lowest of its page's links to `address`. */
  const dropFigure = (title: string, address: string) =>
    inBeta((pdf) => {
      const { index } = landingOf(pdf, title);
      const links = annotations(pdf, index).filter((a) => a.uri?.endsWith(address));
      const lowest = links.sort((a, b) => a.top - b.top)[0];
      if (!lowest) throw new Error(`no link to ${address}`);
      removeAnnotation(pdf, index, lowest.ref);
    });

  test("a section's figure gone where its source exists: missing-figure", async () => {
    // a reaction's, below its heading's link to the same page, and a pathway's diagram
    assert.deepEqual(await planted(dropFigure('Reaction eight', `/content/detail/${EIGHT}`)), [
      line('missing-figure', EIGHT),
    ]);
    const diagram = dropFigure('beta sub with diagram', `/PathwayBrowser/#/${SUB}`);
    assert.deepEqual(await planted(diagram), [line('missing-figure', SUB)]);
    // with its diagram's file not in the release's folder, its figure is not looked for
    const files = scratch();
    cpSync(FILES, files, { recursive: true });
    unlinkSync(join(files, 'diagram', `${SUB}.json`));
    assert.deepEqual(await planted(diagram, files), []);
  });

  test('a link landing on no page, or not rewritten: broken-link', async () => {
    /** Reaction eight's first internal link: its location's first pathway. */
    const breaking = (edit: (pdf: PDFDocument, link: Annotation) => void) =>
      inBeta((pdf) => {
        const { index, y } = landingOf(pdf, 'Reaction eight');
        const link = annotations(pdf, index).find((a) => a.dest !== undefined && a.top < y);
        if (!link) throw new Error('no internal link in its section');
        edit(pdf, link);
      });
    const nowhere = breaking((pdf, link) => {
      // its page a dictionary that is not a page: the catalog
      const root = pdf.context.trailerInfo.Root;
      if (!(root instanceof PDFRef) || !link.dest) throw new Error('no catalog');
      link.dest.set(0, root);
    });
    assert.deepEqual(await planted(nowhere), [line('broken-link', EIGHT)]);
    const placeholder = breaking((pdf, link) => {
      link.dict.delete(PDFName.of('Dest'));
      link.dict.set(
        PDFName.of('A'),
        pdf.context.obj({ S: 'URI', URI: PDFString.of(`${PLACEHOLDER}s-R-HSA-90000100`) })
      );
    });
    assert.deepEqual(await planted(placeholder), [line('broken-link', EIGHT)]);
    // an address to an event's page that cannot be decoded: broken, not a stop
    const undecodable = breaking((pdf, link) => {
      link.dict.delete(PDFName.of('Dest'));
      const uri = PDFString.of('https://site.example/content/detail/%E0%A4%A');
      link.dict.set(PDFName.of('A'), pdf.context.obj({ S: 'URI', URI: uri }));
    });
    assert.deepEqual(await planted(undecodable), [line('broken-link', EIGHT)]);
  });

  test('a section whose heading lost its link and its contents entry is found by the outline', async () => {
    // its first link to its page is then its figure's: the section is not placed there
    const faults = await planted(
      inBeta((pdf) => {
        const target = landingOf(pdf, 'Reaction eight');
        const heading = annotations(pdf, target.index)
          .filter((a) => a.uri?.endsWith(`/content/detail/${EIGHT}`))
          .sort((a, b) => b.top - a.top)[0];
        if (!heading) throw new Error('no heading link');
        removeAnnotation(pdf, target.index, heading.ref);
        const contents = landingOf(pdf, 'Contents').index;
        for (const link of annotations(pdf, contents)) {
          if (
            link.dest?.get(0) === target.page &&
            link.dest.lookup(3, PDFNumber).asNumber() === target.y
          ) {
            removeAnnotation(pdf, contents, link.ref);
          }
        }
      })
    );
    assert.deepEqual(faults, [line('not-in-contents', EIGHT)]);
  });

  test('two sections of one name, and an earlier link to the second: each found at its own', async () => {
    // Reaction eight printed as `Shared reaction`, the name of another section of beta's
    // (R-HSA-90000220), and a link on the cover to its page, before both
    const renamed = (graph: Graph): Graph => ({
      read: async <T>(query: string, params?: Record<string, unknown>) => {
        const rows = await graph.read<unknown>(query, params);
        return JSON.parse(
          JSON.stringify(rows).split('"Reaction eight"').join('"Shared reaction"')
        ) as T[];
      },
      close: () => graph.close(),
    });
    const graph = renamed(openGraph(graphSettings(process.env)));
    let twice: Document[];
    try {
      twice = await buildBook(graph, { illustrated: summary.illustrated });
    } finally {
      await graph.close();
    }
    const folder = join(scratch(), 'TheReactomeBook');
    const temporary = scratch();
    const was = process.env['TMPDIR'];
    process.env['TMPDIR'] = temporary;
    let code: number;
    try {
      code = await bookCommand(
        ['--files', FILES, '--figures', figures, '--site', 'https://site.example', '--out', folder],
        env,
        {
          out: () => undefined,
          err: () => undefined,
          open: (settings, options) => renamed(openGraph(settings, options)),
        }
      );
    } finally {
      if (was === undefined) delete process.env['TMPDIR'];
      else process.env['TMPDIR'] = was;
    }
    assert.equal(code, 0);
    const before = await checkBook(folder, twice, FILES);
    assert.deepEqual(before.faults, []);
    await editPdf(join(folder, BETA), (pdf) => {
      const [link] = annotations(pdf, 0).filter((a) => a.uri !== null);
      if (!link) throw new Error('no link on the cover');
      const uri = PDFString.of(`https://site.example/content/detail/${EIGHT}`);
      link.dict.set(PDFName.of('A'), pdf.context.obj({ S: 'URI', URI: uri }));
    });
    assert.deepEqual((await checkBook(folder, twice, FILES)).faults, []);
  });

  test('pdf-export check-book: its lines and exit codes', async () => {
    const run = async (args: string[], environment: Record<string, string | undefined> = env) => {
      const out: string[] = [];
      const err: string[] = [];
      const code = await checkBookCommand(args, environment, {
        out: (text) => out.push(text),
        err: (text) => err.push(text),
      });
      return { code, out: out.join(''), err: err.join('') };
    };
    const passed = await run([book, '--files', FILES]);
    assert.deepEqual(passed, { code: 0, out: '', err: '' });
    const folder = join(scratch(), 'TheReactomeBook');
    cpSync(book, folder, { recursive: true });
    await inBeta((pdf) => {
      dropOutline(pdf, 'Reaction eight');
    })(folder);
    unlinkSync(join(folder, 'Gamma pathway.pdf'));
    const failed = await run(['--files', FILES, folder, '--species', 'Homo sapiens']);
    assert.equal(failed.code, 1, failed.err);
    assert.equal(
      failed.out,
      `fault missing-pathway R-HSA-90000300\nfault ${line('not-in-outline', EIGHT)}\n`
    );
    // bad arguments, a folder that is not one, no EHLD summary, no graph
    for (const args of [
      ['--files', FILES],
      [book, book, '--files', FILES],
      [book],
      [book, '--files', FILES, '--render', 'x'],
      [book, '--files', FILES, '--species'],
    ]) {
      assert.equal((await run(args)).code, 2, args.join(' '));
    }
    assert.equal((await run([book, '--files', FILES], {})).code, 2);
    const notFolder = await run([join(book, BETA), '--files', FILES]);
    assert.equal(notFolder.code, 2);
    assert.match(notFolder.err, /Not a folder/);
    const noSummary = await run([book, '--files', scratch()]);
    assert.equal(noSummary.code, 2);
    assert.match(noSummary.err, /svgsummary/);
    const unreachable = await run([book, '--files', FILES, '--graph', 'bolt://']);
    assert.equal(unreachable.code, 2);
    assert.match(unreachable.err, /cannot be read/);
  });
});
