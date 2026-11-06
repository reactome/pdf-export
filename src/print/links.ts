// The book's internal links after the join (spec 001 T026, research R4). Joining parts with
// pdf-lib's `copyPages` breaks links between them, so the layout prints each internal link
// as a placeholder address (`https://anchor.invalid/<anchor>`) and a 1 px probe link
// (`https://probe.invalid/<anchor>`) inside each target (src/layout/html.ts). Here, on the
// joined PDF, each probe gives its target's page and height and is removed, and each
// placeholder becomes a `/XYZ` destination there, so a link lands on its heading, not the
// top of its page. A placeholder with no probe, or an anchor probed twice, is a fault: the
// PDF is refused, never left with a dead link or one that lands at random.
import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFNumber,
  PDFRef,
  PDFString,
  type PDFDocument,
  type PDFObject,
} from '@cantoo/pdf-lib';

import { PLACEHOLDER, PROBE } from '../layout/html.ts';

/** Where an anchor's probe was: its page, and the probe's top edge in points. */
export interface Target {
  page: PDFRef;
  /** The page's index, counted from 0. */
  index: number;
  y: number;
}

/** A link annotation's address, if it has one. */
function uriOf(annot: PDFDict): string | null {
  const action = annot.lookupMaybe(PDFName.of('A'), PDFDict);
  const uri = action?.lookupMaybe(PDFName.of('URI'), PDFString, PDFHexString);
  return uri ? uri.decodeText() : null;
}

/** An annotation's top edge, from its rectangle. */
function topOf(annot: PDFDict): number {
  const rect = annot.lookup(PDFName.of('Rect'), PDFArray);
  const y = (i: number): number => rect.lookup(i, PDFNumber).asNumber();
  return Math.max(y(1), y(3));
}

/** A destination at a height on a page: `[page /XYZ null y null]`, the zoom kept. */
export function destination(pdf: PDFDocument, target: Target): PDFArray {
  const dest = PDFArray.withContext(pdf.context);
  dest.push(target.page);
  dest.push(PDFName.of('XYZ'));
  dest.push(PDFNull);
  dest.push(PDFNumber.of(Math.round(target.y * 100) / 100));
  dest.push(PDFNull);
  return dest;
}

/**
 * Where each anchor's probe is in a PDF, read without changing anything: T028 numbers the
 * contents from them before `rewriteLinks` runs. Throws naming every anchor probed twice.
 */
export function probeTargets(pdf: PDFDocument): Map<string, Target> {
  const targets = new Map<string, Target>();
  const twice = new Set<string>();
  pdf.getPages().forEach((page, index) => {
    const annots = page.node.Annots();
    for (let i = 0; i < (annots?.size() ?? 0); i++) {
      const annot = pdf.context.lookup(annots?.get(i));
      const uri = annot instanceof PDFDict ? uriOf(annot) : null;
      if (!(annot instanceof PDFDict) || !uri?.startsWith(PROBE)) continue;
      const anchor = decodeURIComponent(uri.slice(PROBE.length));
      if (targets.has(anchor)) twice.add(anchor);
      targets.set(anchor, { page: page.ref, index, y: topOf(annot) });
    }
  });
  if (twice.size > 0) {
    throw new Error(
      `The PDF's probes: ${[...twice].map((a) => `${a} is probed twice`).join('; ')}`
    );
  }
  return targets;
}

/**
 * Each placeholder link in a joined PDF made a destination at its anchor's probe, and the
 * probes removed. Returns each anchor's target, for the outline. Throws, changing nothing,
 * naming every anchor at fault: a placeholder with no probe, or an anchor probed twice.
 */
export function rewriteLinks(pdf: PDFDocument): Map<string, Target> {
  const targets = new Map<string, Target>();
  const twice = new Set<string>();
  const placeholders: { annot: PDFDict; anchor: string }[] = [];
  const pages: { node: PDFDict; kept: PDFObject[]; size: number }[] = [];
  /** The probes' objects, deleted with them so no probe is left in the file. */
  const dropped: PDFRef[] = [];
  pdf.getPages().forEach((page, index) => {
    const annots = page.node.Annots();
    if (!annots) return;
    const kept: PDFObject[] = [];
    for (let i = 0; i < annots.size(); i++) {
      const entry = annots.get(i);
      const annot = pdf.context.lookup(entry);
      const uri = annot instanceof PDFDict ? uriOf(annot) : null;
      if (annot instanceof PDFDict && uri?.startsWith(PROBE)) {
        const anchor = decodeURIComponent(uri.slice(PROBE.length));
        if (targets.has(anchor)) twice.add(anchor);
        targets.set(anchor, { page: page.ref, index, y: topOf(annot) });
        const action = annot.get(PDFName.of('A'));
        for (const ref of [entry, action]) if (ref instanceof PDFRef) dropped.push(ref);
        continue;
      }
      if (annot instanceof PDFDict && uri?.startsWith(PLACEHOLDER)) {
        placeholders.push({ annot, anchor: decodeURIComponent(uri.slice(PLACEHOLDER.length)) });
      }
      kept.push(entry);
    }
    pages.push({ node: page.node, kept, size: annots.size() });
  });
  const unprobed = new Set(placeholders.flatMap((p) => (targets.has(p.anchor) ? [] : [p.anchor])));
  const faults = [
    ...[...unprobed].map((anchor) => `a link to ${anchor} has no probe`),
    ...[...twice].map((anchor) => `${anchor} is probed twice`),
  ];
  if (faults.length > 0) throw new Error(`The joined PDF's links: ${faults.join('; ')}`);
  for (const { annot, anchor } of placeholders) {
    const target = targets.get(anchor);
    if (!target) continue; // refused above
    annot.delete(PDFName.of('A'));
    annot.set(PDFName.of('Dest'), destination(pdf, target));
  }
  for (const { node, kept, size } of pages) {
    if (kept.length === size) continue;
    if (kept.length === 0) node.delete(PDFName.of('Annots'));
    else node.set(PDFName.of('Annots'), pdf.context.obj(kept));
  }
  for (const ref of dropped) pdf.context.delete(ref);
  return targets;
}
