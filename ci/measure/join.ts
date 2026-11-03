// T011 (research R4, R7): the join and stamping at the largest PDF's size.
//
// The book is one PDF per top-level pathway, printed in parts of about 200 pages and joined
// (research R4); the largest today is 3,760 pages. This prints synthetic sections in the
// real book's figure mix (85% reactions, 6% diagrams, 1% illustrations, 8% selections, from
// T005's recorded SVGs) through the layout and the printer, in parts, then joins each PDF's
// parts with @cantoo/pdf-lib, rewrites its links through the placeholders and probes, writes
// a nested outline, stamps page numbers and headers in embedded Roboto, and saves it. Each
// stage's time and the memory of the run's cgroup (Node, its worker and Chromium together)
// are recorded. Several PDFs can be made at once: their parts share `--parallel` print
// slots, and a PDF's join takes a slot of its own, in a worker thread, as the book's would.
//
//   systemd-run --user --scope -p MemoryMax=4G -p MemorySwapMax=0 --quiet \
//     node ci/measure/join.ts --figures <folder of T005's SVGs> --out <scratch folder> \
//     [--pdfs 1] [--pages 3760 | --sections n] [--part-pages 200] [--parallel 4] [--seed 98]
//     [--together] [--no-object-streams] [--verify]
//
// The run refuses to start outside a memory cap. `TMPDIR` should be inside `--out`: the
// printer writes its pages there. The output is numbers only; the sections are made up.
import { mkdirSync, readFileSync, rmSync, statfsSync, writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFNumber,
  PDFRef,
  PDFString,
  rgb,
  type PDFObject,
} from '@cantoo/pdf-lib';
import * as fontkit from 'fontkit';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

import { layoutBookPart, pageStyles, type LayoutOptions } from '../../src/layout/document.ts';
import { figureKey } from '../../src/layout/figure.ts';
import { PLACEHOLDER, PROBE } from '../../src/layout/html.ts';
import { themeVariables } from '../../src/layout/theme.ts';
import { anchorOf } from '../../src/model/build.ts';
import type { Document, Figure, Place, Section } from '../../src/model/types.ts';
import { Printer } from '../../src/print/print.ts';

/** R7's budgets for the whole book (23,541 pages at release 98), in seconds. */
const BOOK_PAGES = 23_541;
const BUDGET = { print: 13 * 60, join: 6 * 60 };

/** What a join worker is given, and what it answers. */
interface JoinJob {
  pdf: number;
  parts: string[];
  out: string;
  title: string;
  outline: { anchor: string; title: string; depth: number }[];
  verify: boolean;
  objectStreams: boolean;
}
type JoinMessage =
  { stage: string; at: number; done: boolean } | { result: Record<string, number | string> };

const seconds = (ms: number) => Number((ms / 1000).toFixed(2));

// ---------------------------------------------------------------- the join, in a worker

/** A link annotation's address, if it has one. */
function uriOf(annot: PDFDict): string | null {
  const action = annot.lookupMaybe(PDFName.of('A'), PDFDict);
  const uri = action?.lookupMaybe(PDFName.of('URI'), PDFString, PDFHexString);
  return uri ? uri.decodeText() : null;
}

/** An annotation's top edge, from its rectangle. */
function topOf(annot: PDFDict): number {
  const rect = annot.lookup(PDFName.of('Rect'), PDFArray);
  const y = (i: number) => rect.lookup(i, PDFNumber).asNumber();
  return Math.max(y(1), y(3));
}

/** A destination at a height on a page: `[page /XYZ null y null]`. */
function destination(doc: PDFDocument, page: PDFRef, y: number): PDFArray {
  const dest = PDFArray.withContext(doc.context);
  dest.push(page);
  dest.push(PDFName.of('XYZ'));
  dest.push(PDFNull);
  dest.push(PDFNumber.of(Math.round(y * 100) / 100));
  dest.push(PDFNull);
  return dest;
}

async function join(job: JoinJob, report: (m: JoinMessage) => void): Promise<void> {
  const result: Record<string, number | string> = { pdf: job.pdf };
  async function stage<T>(name: string, run: () => T | Promise<T>): Promise<T> {
    report({ stage: name, at: Date.now(), done: false });
    const t = performance.now();
    const value = await run();
    result[`${name}S`] = seconds(performance.now() - t);
    result[`${name}HeapMb`] = Math.round(process.memoryUsage().heapUsed / 2 ** 20);
    report({ stage: name, at: Date.now(), done: true });
    return value;
  }

  const doc = await stage('join', async () => {
    const out = await PDFDocument.create({ updateMetadata: false });
    for (const file of job.parts) {
      const part = await PDFDocument.load(readFileSync(file), { updateMetadata: false });
      for (const page of await out.copyPages(part, part.getPageIndices())) out.addPage(page);
    }
    return out;
  });
  const pages = doc.getPages();
  result['pages'] = pages.length;

  // Placeholders become destinations at their probes; the probes go.
  const probes = await stage('links', () => {
    const at = new Map<string, { page: PDFRef; y: number }>();
    const placeholders: { annot: PDFDict; anchor: string }[] = [];
    for (const page of pages) {
      const annots = page.node.Annots();
      if (!annots) continue;
      const kept: PDFObject[] = [];
      for (let i = 0; i < annots.size(); i++) {
        const entry = annots.get(i);
        const annot = doc.context.lookup(entry, PDFDict);
        const uri = uriOf(annot);
        if (uri?.startsWith(PROBE)) {
          at.set(decodeURIComponent(uri.slice(PROBE.length)), { page: page.ref, y: topOf(annot) });
          continue;
        }
        if (uri?.startsWith(PLACEHOLDER)) {
          placeholders.push({ annot, anchor: decodeURIComponent(uri.slice(PLACEHOLDER.length)) });
        }
        kept.push(entry);
      }
      if (kept.length !== annots.size()) page.node.set(PDFName.of('Annots'), doc.context.obj(kept));
    }
    let unresolved = 0;
    for (const { annot, anchor } of placeholders) {
      const target = at.get(anchor);
      if (!target) {
        unresolved++;
        continue;
      }
      annot.delete(PDFName.of('A'));
      annot.set(PDFName.of('Dest'), destination(doc, target.page, target.y));
    }
    result['links'] = placeholders.length;
    result['unresolved'] = unresolved;
    result['probes'] = at.size;
    return at;
  });

  // The outline, nested by the sections' depths; the top level open, the rest closed.
  await stage('outline', () => {
    interface Item {
      ref: PDFRef;
      dict: PDFDict;
      children: Item[];
    }
    const root: Item = { ref: doc.context.nextRef(), dict: doc.context.obj({}), children: [] };
    const stack: { depth: number; item: Item }[] = [{ depth: -1, item: root }];
    let missing = 0;
    for (const entry of job.outline) {
      const target = probes.get(entry.anchor);
      if (!target) {
        missing++;
        continue;
      }
      while ((stack.at(-1)?.depth ?? -1) >= entry.depth) stack.pop();
      const parent = stack.at(-1)?.item ?? root;
      const item: Item = {
        ref: doc.context.nextRef(),
        dict: doc.context.obj({
          Title: PDFHexString.fromText(entry.title),
          Parent: parent.ref,
        }),
        children: [],
      };
      item.dict.set(PDFName.of('Dest'), destination(doc, target.page, target.y));
      parent.children.push(item);
      stack.push({ depth: entry.depth, item });
    }
    const link = (item: Item, level: number) => {
      const open = level <= 1;
      const { children } = item;
      children.forEach((child, i) => {
        const before = children[i - 1];
        const after = children[i + 1];
        if (before) child.dict.set(PDFName.of('Prev'), before.ref);
        if (after) child.dict.set(PDFName.of('Next'), after.ref);
        link(child, level + 1);
      });
      const first = children[0];
      const last = children.at(-1);
      if (first && last) {
        item.dict.set(PDFName.of('First'), first.ref);
        item.dict.set(PDFName.of('Last'), last.ref);
        item.dict.set(PDFName.of('Count'), PDFNumber.of(open ? children.length : -children.length));
      }
      doc.context.assign(item.ref, item.dict);
    };
    // the outline's own dictionary counts the top level and the open first level beneath it
    link(root, 0);
    const shown = root.children.reduce((n, top) => n + 1 + top.children.length, 0);
    root.dict.set(PDFName.of('Type'), PDFName.of('Outlines'));
    root.dict.set(PDFName.of('Count'), PDFNumber.of(shown));
    doc.catalog.set(PDFName.of('Outlines'), root.ref);
    doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
    result['outline'] = job.outline.length - missing;
    result['outlineMissing'] = missing;
  });

  // Each page's number and the PDF's pathway, in an embedded subset of Roboto.
  await stage('stamp', async () => {
    doc.registerFontkit(fontkit);
    const file = path.join(
      path.dirname(new URL(import.meta.resolve('@fontsource/roboto/package.json')).pathname),
      'files',
      'roboto-latin-400-normal.woff2'
    );
    const font = await doc.embedFont(readFileSync(file), { subset: true });
    const hex = themeVariables().get('--mat-sys-on-surface-variant') ?? '';
    if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`on-surface-variant is ${hex}`);
    const channel = (i: number) => Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    const color = rgb(channel(1), channel(3), channel(5));
    const size = 9; // body-small, 0.75rem: 12 px
    const total = pages.length.toLocaleString('en');
    pages.forEach((page, i) => {
      const { width, height } = page.getSize();
      const centred = (text: string, y: number) => {
        const x = (width - font.widthOfTextAtSize(text, size)) / 2;
        page.drawText(text, { x, y, size, font, color });
      };
      centred(job.title, height - 34);
      centred(`${(i + 1).toLocaleString('en')} of ${total}`, 28);
    });
  });

  await stage('save', async () => {
    const bytes = await doc.save({ useObjectStreams: job.objectStreams });
    writeFileSync(job.out, bytes);
    result['mb'] = Math.round(bytes.byteLength / 2 ** 20);
  });

  if (job.verify) {
    // Not in the budget: pdf.js reads the saved file back, as a reader would.
    await stage('verify', async () => {
      const task = getDocument({ data: new Uint8Array(readFileSync(job.out)) });
      try {
        const pdf = await task.promise;
        let links = 0;
        let bad = 0;
        let leftover = 0;
        for (let p = 1; p <= pdf.numPages; p++) {
          const page = await pdf.getPage(p);
          for (const a of await page.getAnnotations()) {
            const { subtype, dest, url } = a as { subtype?: string; dest?: unknown; url?: unknown };
            if (subtype !== 'Link') continue;
            if (typeof url === 'string' && (url.startsWith(PLACEHOLDER) || url.startsWith(PROBE)))
              leftover++;
            if (!Array.isArray(dest)) continue;
            links++;
            try {
              await pdf.getPageIndex(dest[0] as { num: number; gen: number });
            } catch {
              bad++;
            }
          }
          page.cleanup();
        }
        // the stamps, read back: each sampled page's number and the pathway's name
        let stamped = 0;
        const sampled = [1, Math.ceil(pdf.numPages / 2), pdf.numPages];
        for (const p of sampled) {
          const strings = (await (await pdf.getPage(p)).getTextContent()).items.map((item) =>
            'str' in item ? item.str : ''
          );
          const number = `${p.toLocaleString('en')} of ${pdf.numPages.toLocaleString('en')}`;
          if (strings.includes(number) && strings.includes(job.title)) stamped++;
        }
        result['verifiedStamps'] = `${String(stamped)} of ${String(sampled.length)}`;
        const outline = await pdf.getOutline();
        const count = (items: { items: unknown[] }[]): number =>
          items.reduce((n, item) => n + 1 + count(item.items as { items: unknown[] }[]), 0);
        result['verifiedPages'] = pdf.numPages;
        result['verifiedLinks'] = links;
        result['verifiedBadDests'] = bad;
        result['verifiedLeftover'] = leftover;
        result['verifiedOutline'] = count(outline);
      } finally {
        await task.destroy();
      }
    });
  }
  report({ result });
}

if (!isMainThread) {
  const port = parentPort;
  if (!port) throw new Error('a join worker without a parent');
  await join(workerData as JoinJob, (m) => {
    port.postMessage(m);
  });
}

// ---------------------------------------------------------------- the run, in the main thread

/** A small seeded generator (mulberry32), so a run can be made again. */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** T005's recorded SVGs, by the kind of figure each stands for. */
const SVGS = {
  reaction: ['reaction.svg'],
  diagram: ['large-akt.svg', 'large-gtp.svg', 'small.svg'],
  ehld: ['ecm.svg', 'ehld.svg', 'il.svg', 'mapk13.svg'],
  ancestor: ['sub-highlight.svg'],
} as const;

const WORDS = (
  'kinase phosphorylates receptor complex binds ligand membrane cytosol nucleus transport ' +
  'activation signalling cascade protein domain substrate product catalyses hydrolysis ' +
  'translocation dimer subunit release recruitment adaptor scaffold degradation ubiquitin ' +
  'transcription factor promoter expression regulation inhibitor enzyme metabolite cofactor'
).split(' ');

/** A synthetic PDF: its sections in document order, a pathway leading each group of reactions. */
function synthetic(pdf: number, sections: number, seed: number) {
  const next = random(seed + pdf);
  const pickOf = <T>(from: readonly T[]): T => from[Math.floor(next() * from.length)] as T;
  const words = (n: number) => Array.from({ length: n }, () => pickOf(WORDS)).join(' ');
  const sentence = (n: number) => {
    const s = words(n);
    return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
  };
  const places: Place[] = [];
  const outline: JoinJob['outline'] = [];
  const figures = new Map<string, string>();
  const path: { stId: string; name: string; dbId: number }[] = [];
  let reactionsLeft = 0;
  let previous: { stId: string; name: string; dbId: number } | null = null;
  for (let n = 0; n < sections; n++) {
    const stId = `R-SYN-${String(pdf)}-${String(n)}`;
    const name =
      n === 0 ? `Synthetic pathway ${String(pdf + 1)}` : words(3 + Math.floor(next() * 4));
    const ref = { dbId: pdf * 1_000_000 + n, stId, name };
    // 15% pathways, each followed by five or six reactions (85%), as the book's mix
    const pathway = n === 0 || reactionsLeft === 0;
    let depth: number;
    let figure: Figure;
    if (pathway) {
      depth = n === 0 ? 0 : 1 + Math.floor(next() * 3);
      path.length = Math.min(path.length, depth);
      const r = next() * 15;
      figure =
        n === 0 || r < 6
          ? { kind: 'diagram', stId }
          : r < 7
            ? { kind: 'ehld', stId }
            : { kind: 'ancestor', stId, highlight: [stId] };
      reactionsLeft = next() < 2 / 3 ? 6 : 5;
    } else {
      depth = path.length;
      figure = { kind: 'reaction', stId };
      reactionsLeft--;
    }
    const kind = figure.kind === 'reaction' ? 'reaction' : 'pathway';
    const svgName = pickOf(SVGS[figure.kind]);
    figures.set(figureKey(figure), svgName);
    const section: Section = {
      anchor: anchorOf(stId),
      event: {
        ...ref,
        kind,
        schemaClass: kind === 'reaction' ? 'Reaction' : 'Pathway',
        speciesName: 'Homo sapiens',
        category: kind === 'reaction' ? 'transition' : null,
        hasDiagram: figure.kind === 'diagram' || figure.kind === 'ehld',
        hasEHLD: figure.kind === 'ehld',
        isInferred: false,
        isInDisease: false,
        species: { dbId: 48887, name: 'Homo sapiens' },
        compartments: [{ dbId: 1, name: pickOf(['cytosol', 'plasma membrane', 'nucleoplasm']) }],
        before: kind === 'reaction' && previous ? [previous] : [],
        after: [],
      },
      path: [...path],
      figure,
      diseases: [],
      inferredFrom: [],
      // text enough for the book's 1.22 pages a section (23,541 pages, 19,313 events)
      summations: [
        `<p>${Array.from({ length: 2 + Math.floor(next() * 5) }, () => sentence(10 + Math.floor(next() * 9))).join(' ')}</p>`,
      ],
      references: Array.from({ length: Math.floor(next() * 4) }, (_, i) => ({
        dbId: i,
        kind: 'article' as const,
        title: sentence(10),
        chapterTitle: null,
        journal: 'Journal of Synthetic Biology',
        volume: 1 + i,
        pages: '1-10',
        year: 2000 + i,
        pubMedId: null,
        isbn: null,
        url: null,
        publisher: null,
        authors: ['Author A', 'Author B', 'Author C'],
        moreAuthors: next() < 0.3,
      })),
      edits: [
        { date: '2020-01-01', kinds: ['authored'], authors: ['Curator A'] },
        { date: '2021-01-01', kinds: ['reviewed'], authors: ['Reviewer B'] },
      ],
      depth,
    };
    places.push({ full: true, section });
    outline.push({ anchor: section.anchor, title: name, depth });
    // an event's later place, a short entry linked to its section (FR-004), now and then
    if (previous && next() < 0.05) {
      places.push({ full: false, anchor: anchorOf(previous.stId), event: previous, path, depth });
    }
    if (pathway) path.push(ref);
    previous = ref;
  }
  const doc: Document = {
    kind: 'book',
    release: { version: 98, pathways: 0, reactions: 0 },
    cover: {
      title: `Synthetic pathway ${String(pdf + 1)}`,
      release: 98,
      figure: null,
      excerpt: false,
      names: [],
    },
    places,
    contents: null,
  };
  return { doc, outline, figures };
}

/** The run's cgroup, whose memory the cap counts: Node, its workers and Chromium. */
function cgroup(): string {
  const line = readFileSync('/proc/self/cgroup', 'utf8').trim().split('\n').at(-1) ?? '';
  return path.join('/sys/fs/cgroup', line.replace(/^0::/, ''));
}

async function main() {
  const { values } = parseArgs({
    options: {
      figures: { type: 'string' },
      out: { type: 'string' },
      pdfs: { type: 'string', default: '1' },
      pages: { type: 'string', default: '3760' },
      // the sections instead of the pages: the events a PDF holds, whatever pages they take
      sections: { type: 'string' },
      'part-pages': { type: 'string', default: '200' },
      parallel: { type: 'string', default: '4' },
      seed: { type: 'string', default: '98' },
      verify: { type: 'boolean', default: false },
      together: { type: 'boolean', default: false },
      // pdf-lib's object streams: a smaller file, a slower save
      'no-object-streams': { type: 'boolean', default: false },
      'min-free-gb': { type: 'string', default: '3' },
    },
  });
  if (!values.figures) throw new Error("--figures is required: T005's SVGs");
  if (!values.out) throw new Error('--out is required: a scratch folder for the PDFs');
  const whole = (name: string, value: string, min = 1) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < min) throw new Error(`--${name} must be >= ${String(min)}`);
    return n;
  };
  const pdfs = whole('pdfs', values.pdfs);
  const target = whole('pages', values.pages);
  const partPages = whole('part-pages', values['part-pages']);
  const parallel = whole('parallel', values.parallel);
  const seed = whole('seed', values.seed, 0);
  const out = values.out;

  const group = cgroup();
  const cap = readFileSync(path.join(group, 'memory.max'), 'utf8').trim();
  if (cap === 'max') throw new Error('no memory cap: run under systemd-run -p MemoryMax=…');
  const free = statfsSync(out);
  const freeGb = (free.bavail * free.bsize) / 2 ** 30;
  if (freeGb < Number(values['min-free-gb']))
    throw new Error(`${freeGb.toFixed(1)} GB free on --out`);

  // Memory, sampled four times a second: the cgroup's anonymous memory (what the cap must
  // hold; its page cache can be reclaimed) and its total, and this process's resident size.
  const samples: { at: number; anon: number; current: number; rss: number }[] = [];
  const sample = () => {
    const stat = readFileSync(path.join(group, 'memory.stat'), 'utf8');
    const anon = Number(/^anon (\d+)/m.exec(stat)?.[1] ?? NaN);
    const current = Number(readFileSync(path.join(group, 'memory.current'), 'utf8'));
    samples.push({ at: Date.now(), anon, current, rss: process.memoryUsage().rss });
  };
  const timer = setInterval(sample, 250);
  const mb = (bytes: number) => Math.round(bytes / 2 ** 20);
  const peakIn = (from: number, to: number) => {
    const within = samples.filter((s) => s.at >= from && s.at <= to);
    return {
      anonMb: mb(Math.max(0, ...within.map((s) => s.anon))),
      cgroupMb: mb(Math.max(0, ...within.map((s) => s.current))),
      nodeRssMb: mb(Math.max(0, ...within.map((s) => s.rss))),
    };
  };

  const svgs = new Map<string, string>();
  for (const name of Object.values(SVGS).flat()) {
    svgs.set(name, readFileSync(path.join(values.figures, name), 'utf8'));
  }
  const styles = pageStyles();
  const options = (figures: Map<string, string>): LayoutOptions => ({
    site: 'https://reactome.org',
    date: new Date('2026-11-03T00:00:00Z'),
    figures: new Map([...figures].map(([key, name]) => [key, svgs.get(name) ?? ''])),
    styles,
  });

  const printer = await Printer.start();
  let started: number;
  const windows: { pdf: number; stage: string; from: number; to: number }[] = [];
  const parts: { pdf: number; pages: number; s: number; layoutS: number }[] = [];
  const joins: Record<string, number | string>[] = [];
  try {
    // Calibration: one part's pages per section sets the sections per part and per PDF.
    const probe = synthetic(0, 80, seed + 1000);
    const calibrated = await printer.part(
      layoutBookPart(probe.doc, probe.doc.places, options(probe.figures)).html
    );
    const perSection = (await PDFDocument.load(calibrated)).getPageCount() / 80;
    const sectionsPerPart = Math.round(partPages / perSection);
    const sections = values.sections
      ? whole('sections', values.sections)
      : Math.round(target / perSection);
    started = Date.now();

    const made = Array.from({ length: pdfs }, (_, k) => {
      const s = synthetic(k, sections, seed);
      const slices: Place[][] = [];
      for (let i = 0; i < s.doc.places.length; i += sectionsPerPart) {
        slices.push(s.doc.places.slice(i, i + sectionsPerPart));
      }
      const folder = path.join(out, `pdf-${String(k)}`);
      mkdirSync(folder, { recursive: true });
      return { ...s, slices, folder, files: [] as string[], left: slices.length };
    });

    // The queue: every part of every PDF, in order; a PDF's join goes first once its parts are.
    type Task = { kind: 'part'; pdf: number; index: number } | { kind: 'join'; pdf: number };
    // PDF by PDF, so one PDF's join overlaps the next one's printing; or, `--together`, the
    // PDFs' parts in turn, so their joins run at once: the worst case for memory
    const queue: Task[] = made.flatMap((m, pdf) =>
      m.slices.map((_, index): Task => ({ kind: 'part', pdf, index }))
    );
    if (values.together)
      queue.sort((a, b) => ('index' in a && 'index' in b ? a.index - b.index : 0));
    const runJoin = (pdf: number) =>
      new Promise<void>((resolve, reject) => {
        const m = made[pdf];
        if (!m) throw new Error(`no PDF ${String(pdf)}`);
        const job: JoinJob = {
          pdf,
          parts: m.files,
          out: path.join(m.folder, 'joined.pdf'),
          title: m.doc.cover.title,
          outline: m.outline,
          verify: values.verify,
          objectStreams: !values['no-object-streams'],
        };
        const worker = new Worker(new URL(import.meta.url), { workerData: job });
        const open = new Map<string, number>();
        worker.on('message', (message: JoinMessage) => {
          if ('result' in message) {
            joins.push(message.result);
            return;
          }
          // a sample at each stage's start and end, so a short stage has one
          sample();
          if (!message.done) open.set(message.stage, message.at);
          else
            windows.push({
              pdf,
              stage: message.stage,
              from: open.get(message.stage) ?? message.at,
              to: Date.now(),
            });
        });
        worker.on('error', reject);
        worker.on('exit', (code) => {
          // the parts are done with; the joined file too, its size recorded
          rmSync(m.folder, { recursive: true, force: true });
          if (code === 0) resolve();
          else reject(new Error(`the join of PDF ${String(pdf)} exited ${String(code)}`));
        });
      });
    const slot = async () => {
      for (let task = queue.shift(); task; task = queue.shift()) {
        const m = made[task.pdf];
        if (!m) continue;
        if (task.kind === 'join') {
          await runJoin(task.pdf);
          continue;
        }
        const from = Date.now();
        const places = m.slices[task.index] ?? [];
        const t = performance.now();
        const { html } = layoutBookPart(m.doc, places, options(m.figures));
        const layoutS = seconds(performance.now() - t);
        const bytes = await printer.part(html);
        const file = path.join(m.folder, `part-${String(task.index).padStart(3, '0')}.pdf`);
        writeFileSync(file, bytes);
        m.files[task.index] = file;
        const pages = (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount();
        parts.push({ pdf: task.pdf, pages, s: seconds(Date.now() - from), layoutS });
        windows.push({ pdf: task.pdf, stage: 'print', from, to: Date.now() });
        if (--m.left === 0) queue.unshift({ kind: 'join', pdf: task.pdf });
      }
    };
    await Promise.all(Array.from({ length: parallel }, slot));
    sample();
    const wallS = seconds(Date.now() - started);

    // Each stage per PDF: its time and the run's memory peaks while it ran.
    const stages = ['print', 'join', 'links', 'outline', 'stamp', 'save', 'verify'];
    const perStage = Object.fromEntries(
      stages.flatMap((stage) => {
        const runs = windows.filter((w) => w.stage === stage);
        if (runs.length === 0) return [];
        const byPdf = made.map((_, pdf) => runs.filter((w) => w.pdf === pdf));
        const span = (ws: typeof runs) =>
          ws.length
            ? seconds(Math.max(...ws.map((w) => w.to)) - Math.min(...ws.map((w) => w.from)))
            : 0;
        const peaks = runs.map((w) => peakIn(w.from, w.to));
        return [
          [
            stage,
            {
              secondsPerPdf: byPdf.map(span),
              peakAnonMb: Math.max(...peaks.map((p) => p.anonMb)),
              peakCgroupMb: Math.max(...peaks.map((p) => p.cgroupMb)),
              peakNodeRssMb: Math.max(...peaks.map((p) => p.nodeRssMb)),
            },
          ],
        ];
      })
    );
    const pages = parts.reduce((n, p) => n + p.pages, 0);
    const printWall = windows.filter((w) => w.stage === 'print');
    const printS = seconds(Math.max(...printWall.map((w) => w.to)) - started);
    const joinS = joins.map((j) =>
      ['join', 'links', 'outline', 'stamp', 'save'].reduce((n, s) => n + Number(j[`${s}S`] ?? 0), 0)
    );
    console.log(
      JSON.stringify(
        {
          machine: { cpus: cpus().length, memoryGb: Math.round(totalmem() / 2 ** 30) },
          cap,
          together: values.together,
          objectStreams: !values['no-object-streams'],
          pdfs,
          parallel,
          seed,
          perSection: Number(perSection.toFixed(3)),
          sectionsPerPart,
          sectionsPerPdf: sections,
          pages,
          partPages: {
            min: Math.min(...parts.map((p) => p.pages)),
            max: Math.max(...parts.map((p) => p.pages)),
          },
          partSeconds: {
            min: Math.min(...parts.map((p) => p.s)),
            max: Math.max(...parts.map((p) => p.s)),
          },
          layoutSeconds: Number(parts.reduce((n, p) => n + p.layoutS, 0).toFixed(1)),
          wallS,
          printWallS: printS,
          printMsPerPage: Math.round((printS * 1000) / pages),
          joins,
          joinStagesSPerPdf: joinS.map((s) => Number(s.toFixed(1))),
          perStage,
          peak: {
            anonMb: mb(Math.max(...samples.map((s) => s.anon))),
            cgroupMb: mb(Math.max(...samples.map((s) => s.current))),
            nodeRssMb: mb(Math.max(...samples.map((s) => s.rss))),
            cgroupPeakMb: mb(Number(readFileSync(path.join(group, 'memory.peak'), 'utf8'))),
          },
          // inference: the book's pages at this run's rates
          bookScaled: {
            printMin: Number((((printS / pages) * BOOK_PAGES) / 60).toFixed(1)),
            printBudgetMin: BUDGET.print / 60,
            joinMin: Number(
              (((joinS.reduce((a, b) => a + b, 0) / pages) * BOOK_PAGES) / 60).toFixed(1)
            ),
            joinBudgetMin: BUDGET.join / 60,
          },
        },
        null,
        2
      )
    );
    // a link or an outline entry left without its target is no measurement of the join
    if (joins.some((j) => j['unresolved'] !== 0 || j['outlineMissing'] !== 0)) {
      process.exitCode = 1;
    }
  } finally {
    clearInterval(timer);
    await printer.close();
  }
}

if (isMainThread) await main();
