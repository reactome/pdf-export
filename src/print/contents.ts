// The contents list's page numbers (spec 001 T019, T028, research R4): the first print
// carries a placeholder in a box of fixed width for each entry; where each target landed is
// read back, and the numbers go into the same boxes, so nothing else moves and the second
// print's pages are the first's.
//
// A single event's PDF (T019) is printed whole: Chromium writes a named destination for
// each anchor a link points at, and every entry links to its target, so each target's page
// is its destination's.
//
// A book's PDF (T028) is printed in parts and joined, its links placeholders: each target's
// page is read from its probe in the joined PDF, as T026's links are, the front part alone
// is printed again with the numbers, and its pages are swapped for the first print's in the
// joined PDF, before its links are rewritten and its pages stamped, so the new front pages
// are linked and stamped as the rest are. The front part must print the same pages, its
// own headings on the same pages, or every later page and number would move: a reprint
// that does not is refused. The reprint's layout report is not kept: the first print's is
// the PDF's, so nothing in the front part is counted twice.
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRef,
  PDFStream,
  type PDFContext,
  type PDFObject,
} from '@cantoo/pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

import { layoutBookFront, type LayoutOptions } from '../layout/document.ts';
import { probeTargets, type Target } from './links.ts';
import type { Joined, PartPrinter } from './parts.ts';

/** An entry's placeholder, as the layout writes it (src/layout/front.ts). */
const PLACEHOLDER = /<span class="page" data-target="([^"]*)">[^<]*<\/span>/g;

/** An attribute's value as the layout escaped it, unescaped. */
function unescape(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** The targets of a page's contents entries, in order. */
export function contentsTargets(html: string): string[] {
  return [...html.matchAll(PLACEHOLDER)].map((m) => unescape(m[1] ?? ''));
}

export interface Landed {
  /** Each target's page, counted from 1. */
  pages: Map<string, number>;
  pageCount: number;
}

/** Where each target landed in a PDF, from its named destinations. */
export async function landed(pdf: Uint8Array, targets: Iterable<string>): Promise<Landed> {
  // pdf.js may take the buffer over, so it is given a copy
  const task = getDocument({ data: pdf.slice() });
  try {
    const doc = await task.promise;
    const pages = new Map<string, number>();
    for (const target of targets) {
      const destination = await doc.getDestination(target);
      const page: unknown = destination?.[0];
      if (page === undefined || typeof page !== 'object' || page === null) {
        throw new Error(`No destination for the contents entry ${target}`);
      }
      pages.set(target, (await doc.getPageIndex(page as { num: number; gen: number })) + 1);
    }
    return { pages, pageCount: doc.numPages };
  } finally {
    await task.destroy();
  }
}

/** The page with each entry's number in its placeholder's box. */
export function fillContents(html: string, pages: ReadonlyMap<string, number>): string {
  return html.replace(PLACEHOLDER, (whole, escaped: string) => {
    const page = pages.get(unescape(escaped));
    if (page === undefined) throw new Error(`No page for the contents entry ${unescape(escaped)}`);
    return whole.replace(/>[^<]*<\/span>$/, `>${String(page)}</span>`);
  });
}

/**
 * How a second print's pages differ from the first's, or null: another page count, or a
 * target on another page. Either means the numbers printed are not the pages.
 */
export function movedPages(
  first: Landed,
  second: Landed,
  targets: readonly string[]
): string | null {
  const moved = targets.filter((t) => second.pages.get(t) !== first.pages.get(t));
  if (second.pageCount === first.pageCount && moved.length === 0) return null;
  return `${String(first.pageCount)} pages, then ${String(second.pageCount)}; moved: ${moved.join(', ') || 'none'}`;
}

const PARENT = PDFName.of('Parent');

/**
 * Every object reachable by reference from those given; through `/Parent` only when asked,
 * as a page's leads to the whole page tree.
 */
function reachable(context: PDFContext, from: readonly PDFObject[], parents: boolean): Set<PDFRef> {
  const seen = new Set<PDFRef>();
  const stack = [...from];
  for (let object = stack.pop(); object !== undefined; object = stack.pop()) {
    if (object instanceof PDFRef) {
      if (seen.has(object)) continue;
      seen.add(object);
      const found = context.lookup(object);
      if (found !== undefined) stack.push(found);
    } else if (object instanceof PDFDict) {
      for (const [key, value] of object.entries()) {
        if (parents || key !== PARENT) stack.push(value);
      }
    } else if (object instanceof PDFArray) {
      for (const value of object.asArray()) stack.push(value);
    } else if (object instanceof PDFStream) {
      stack.push(object.dict);
    }
  }
  return seen;
}

/** Each probed anchor's page, counted from 1, for those on the first `count` pages. */
function pagesOf(targets: ReadonlyMap<string, Target>, count: number): Map<string, number> {
  const pages = new Map<string, number>();
  for (const [anchor, target] of targets) {
    if (target.index < count) pages.set(anchor, target.index + 1);
  }
  return pages;
}

/**
 * A joined book PDF's contents numbered (T028): each entry's target's page read from its
 * probe, the front part printed again with the numbers, and its pages put in place of the
 * first print's, in place, the first print's objects deleted with them. Runs before
 * `rewriteLinks`, which removes the probes, and so before `stampPages`. Throws, changing
 * nothing, when the first part is not the front part or the parts' pages are not the PDF's,
 * an entry's target has no probe, or the reprint's pages differ from the first print's (its
 * page count, or a front heading on another page), which would move every later page.
 */
export async function reprintFront(
  joined: Pick<Joined, 'doc' | 'pdf' | 'parts'>,
  printer: PartPrinter,
  layout: LayoutOptions
): Promise<void> {
  const { doc, pdf, parts } = joined;
  const front = parts[0];
  if (!front || front.places.length > 0) {
    throw new Error("The joined PDF's first part is not its front part");
  }
  const counted = parts.reduce((n, part) => n + part.pages, 0);
  if (counted !== pdf.getPageCount()) {
    throw new Error(
      `The parts hold ${String(counted)} pages, the joined PDF ${String(pdf.getPageCount())}`
    );
  }
  const html = layoutBookFront(doc, layout).html;
  const targets = contentsTargets(html);
  if (targets.length === 0) return;
  const probes = probeTargets(pdf);
  const unprobed = targets.filter((target) => !probes.has(target));
  if (unprobed.length > 0) {
    throw new Error(
      `The contents' entries with no probe in the joined PDF (run before rewriteLinks): ${unprobed.join(', ')}`
    );
  }
  const reprinted = await PDFDocument.load(
    await printer.part(fillContents(html, pagesOf(probes, counted)))
  );
  // the front part's own headings, where they landed the first time and the second
  const first = { pages: pagesOf(probes, front.pages), pageCount: front.pages };
  const pageCount = reprinted.getPageCount();
  const second = { pages: pagesOf(probeTargets(reprinted), pageCount), pageCount };
  const anchors = [...new Set([...first.pages.keys(), ...second.pages.keys()])];
  const problem = movedPages(first, second, anchors);
  if (problem) throw new Error(`The front part's numbers moved its pages: ${problem}`);
  // the first print's page dictionaries: pdf-lib's removePage deletes a page's own object,
  // not what it refers to (its contents, resources, annotations), which saving would write
  const old = pdf
    .getPages()
    .slice(0, front.pages)
    .map((page) => page.node);
  const copied = await pdf.copyPages(reprinted, reprinted.getPageIndices());
  copied.forEach((page, i) => {
    pdf.removePage(i);
    pdf.insertPage(i, page);
  });
  // what only the first print's pages held is deleted, never what the PDF still uses
  const { context } = pdf;
  const { Root, Info, Encrypt } = context.trailerInfo;
  const roots = [Root, Info, Encrypt].filter((o) => o !== undefined);
  const live = reachable(context, roots, true);
  for (const ref of reachable(context, old, false)) {
    if (!live.has(ref)) context.delete(ref);
  }
}
