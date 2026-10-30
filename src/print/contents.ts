// The contents list's page numbers (spec 001 T019, research R4): the first print carries a
// placeholder in a box of fixed width for each entry; where each target landed is read back
// from that print, and the numbers go into the same boxes, so nothing else moves and the
// second print's pages are the first's. Chromium writes a named destination for each
// anchor a link points at, and every entry links to its target, so each target's page is
// its destination's.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

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
