// The book's outline (spec 001 T026, FR-003, FR-006, research R4). Chromium writes nested
// bookmarks only for a tagged print, and a joined PDF loses them, so each of the book's
// PDFs gets an outline written here, from its contents list: an entry for each of the
// list's, in its order, nested by its depth, landing where the entry's link lands (each
// target's probe, src/print/links.ts). An event's later place is a short entry, a leaf
// pointing at its one full section in the PDF (FR-004). pdf-lib has no outline API, so the
// dictionaries are written directly. The top level is open, the rest closed.
import {
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  type PDFDocument,
  type PDFRef,
} from '@cantoo/pdf-lib';

import type { ContentsEntry } from '../model/types.ts';
import { destination, type Target } from './links.ts';

interface Item {
  ref: PDFRef;
  dict: PDFDict;
  children: Item[];
}

/**
 * The PDF's outline written from its contents list, at each entry's target. Throws, before
 * writing anything, naming every entry whose target the PDF does not hold.
 */
export function writeOutline(
  pdf: PDFDocument,
  entries: readonly ContentsEntry[],
  targets: ReadonlyMap<string, Target>
): void {
  const missing = entries.filter((entry) => !targets.has(entry.target));
  if (missing.length > 0) {
    const named = missing.map((entry) => `${entry.title} (${entry.target})`).join('; ');
    throw new Error(`The outline's entries with no target in the PDF: ${named}`);
  }
  const { context } = pdf;
  const root: Item = { ref: context.nextRef(), dict: context.obj({}), children: [] };
  // each entry is a child of the nearest entry before it that is shallower
  const stack: { depth: number; item: Item }[] = [{ depth: -1, item: root }];
  for (const entry of entries) {
    const target = targets.get(entry.target);
    if (!target) continue; // refused above
    while ((stack.at(-1)?.depth ?? -1) >= entry.depth) stack.pop();
    const parent = stack.at(-1)?.item ?? root;
    const item: Item = {
      ref: context.nextRef(),
      dict: context.obj({ Title: PDFHexString.fromText(entry.title), Parent: parent.ref }),
      children: [],
    };
    item.dict.set(PDFName.of('Dest'), destination(pdf, target));
    parent.children.push(item);
    stack.push({ depth: entry.depth, item });
  }
  /** The top level is open, so its children show; deeper entries are closed. */
  const open = (level: number): boolean => level <= 1;
  /** Links an item's children; returns how many entries beneath it show when it is open. */
  const link = (item: Item, level: number): number => {
    const { children } = item;
    let shown = 0;
    children.forEach((child, i) => {
      const before = children[i - 1];
      const after = children[i + 1];
      if (before) child.dict.set(PDFName.of('Prev'), before.ref);
      if (after) child.dict.set(PDFName.of('Next'), after.ref);
      const beneath = link(child, level + 1);
      shown += 1 + (open(level + 1) ? beneath : 0);
    });
    const first = children[0];
    const last = children.at(-1);
    if (first && last) {
      item.dict.set(PDFName.of('First'), first.ref);
      item.dict.set(PDFName.of('Last'), last.ref);
      // an open entry counts what shows beneath it; a closed one, negated, what would
      item.dict.set(PDFName.of('Count'), PDFNumber.of(open(level) ? shown : -shown));
    }
    context.assign(item.ref, item.dict);
    return shown;
  };
  link(root, 0);
  root.dict.set(PDFName.of('Type'), PDFName.of('Outlines'));
  pdf.catalog.set(PDFName.of('Outlines'), root.ref);
  pdf.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
}
