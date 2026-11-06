// What pdf.js gives back, checked into its types: its lists of annotations and a text
// item's transform are typed `any`, and its outline is typed as a list where a PDF with
// none gives null. Each check refuses what does not fit, as an error the caller's reading
// of the PDF reports.
import { isNumbers, isRecord } from '../unknown.ts';

/** An object's reference in a PDF, as pdf.js gives a destination's page. */
export interface PageRef {
  num: number;
  gen: number;
}

/** Whether a value is a page's reference. */
export function isPageRef(value: unknown): value is PageRef {
  return isRecord(value) && typeof value['num'] === 'number' && typeof value['gen'] === 'number';
}

/** A text item's transform: the numbers of its matrix. */
export function textTransform(value: unknown): number[] {
  if (!isNumbers(value)) throw new Error("a text item's transform is not numbers");
  return value;
}

/** An annotation's rectangle: its corners' numbers, or none where it gives none. */
export function annotationRect(value: unknown): number[] {
  if (value === undefined) return [];
  if (!isNumbers(value)) throw new Error("an annotation's rect is not numbers");
  return value;
}

/** A numeric list, a plain one or a typed array (a path's box), or null for anything else. */
export function numbersOf(value: unknown): number[] | null {
  if (value instanceof Float32Array || value instanceof Float64Array) return Array.from(value);
  return isNumbers(value) ? value : null;
}

/** An outline item: its title, where it goes, and the items beneath it. */
export interface OutlineNode {
  title: string;
  dest: unknown;
  items: OutlineNode[];
}

/** A PDF's outline, as `getOutline()` gives it: none for null, a PDF with no outline. */
export function outlineOf(value: unknown): OutlineNode[] {
  return value === null ? [] : outlineItems(value);
}

function outlineItems(value: unknown): OutlineNode[] {
  if (!Array.isArray(value)) throw new Error('an outline is not a list');
  return value.map((item: unknown) => {
    const title = isRecord(item) ? item['title'] : undefined;
    if (!isRecord(item) || typeof title !== 'string') {
      throw new Error('an outline item has no title');
    }
    return { title, dest: item['dest'], items: outlineItems(item['items']) };
  });
}
