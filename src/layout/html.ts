// What the layout's parts share (spec 001 T018): escaping, and the links of FR-003. In the
// book, parts are printed apart and joined, which breaks links between them (research R4),
// so an internal link is printed as a placeholder address and each target carries a 1 px
// probe link; after the join, the placeholders become destinations at the probes and the
// probes are removed (T026). A single-event PDF is printed whole, with ordinary links.

import type { Figure } from '../model/types.ts';

/** Text for an element's content. */
export function text(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Text for an attribute's value, quoted with double quotes. */
export function attribute(value: string): string {
  return text(value).replace(/"/g, '&quot;');
}

/** Text for a CSS string, quoted with double quotes, inside a style element. */
export function cssString(value: string): string {
  const escaped = value.replace(/[\\"<\n\r]/g, (c) => `\\${c.codePointAt(0)?.toString(16) ?? ''} `);
  return `"${escaped}"`;
}

/** The placeholder addresses of the book's internal links and of its probes. */
export const PLACEHOLDER = 'https://anchor.invalid/';
export const PROBE = 'https://probe.invalid/';

export class Links {
  readonly #book: boolean;
  readonly #site: string;
  readonly #held: ReadonlySet<string>;

  /**
   * @param book whether the links are the book's placeholders
   * @param site the website's address, for its pages
   * @param held the anchors this PDF holds: its full sections and its front parts
   */
  constructor(book: boolean, site: string, held: ReadonlySet<string>) {
    this.#book = book;
    this.#site = site.replace(/\/+$/, '');
    this.#held = held;
  }

  /** Whether the PDF holds an anchor. */
  holds(anchor: string): boolean {
    return this.#held.has(anchor);
  }

  /** A link's address to a place in this PDF. */
  internal(anchor: string): string {
    return this.#book ? `${PLACEHOLDER}${anchor}` : `#${anchor}`;
  }

  /** A page of the website: a path, or an event's page by its stable identifier. */
  website(path: string): string {
    return `${this.#site}${path}`;
  }

  event(stId: string): string {
    return this.website(`/content/detail/${encodeURIComponent(stId)}`);
  }

  /**
   * An event's figure in its interactive form on the website, where its labels can be read:
   * a pathway's diagram or illustration in the Pathway Browser, the event selected where it
   * is drawn in an ancestor's; a reaction's page, which opens it in its pathway there. The
   * Browser's address is its older form, which the website still reads (`#/` and `SEL`).
   */
  figure(figure: Figure, stId: string): string {
    if (figure.kind === 'reaction') return this.event(stId);
    const select = figure.kind === 'ancestor' ? `&SEL=${encodeURIComponent(stId)}` : '';
    return this.website(`/PathwayBrowser/#/${encodeURIComponent(figure.stId)}${select}`);
  }

  /** The probe a target carries in the book, none in a single-event PDF. */
  probe(anchor: string): string {
    return this.#book ? `<a class="probe" href="${attribute(`${PROBE}${anchor}`)}"></a>` : '';
  }

  /** A link, its text escaped. */
  static a(href: string, label: string): string {
    return `<a href="${attribute(href)}">${text(label)}</a>`;
  }
}
