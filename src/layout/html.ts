// What the layout's parts share (spec 001 T018): escaping, and the links of FR-003. In the
// book, parts are printed apart and joined, which breaks links between them (research R4),
// so an internal link is printed as a placeholder address and each target carries a 1 px
// probe link; after the join, the placeholders become destinations at the probes and the
// probes are removed (T026). A single-event PDF is printed whole, with ordinary links.

import type { Figure } from '../model/types.ts';

/** Text escaped for markup, as it is. */
export function plainText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * A token longer than this, with no space in it, may break every BREAK_EVERY characters:
 * the pages break words only where they may (`overflow-wrap: break-word`, pages.css), so
 * that a table's short columns keep their words whole, and a token longer than the text
 * column (a run of letters, a long address) would otherwise overflow it, and Chromium then
 * prints its whole part scaled down.
 */
export const LONG_TOKEN = 40;
export const BREAK_EVERY = 20;

/**
 * Units of text (characters as a reader sees them, and a markup run's character references)
 * with `<wbr>` between every BREAK_EVERY of a token longer than LONG_TOKEN: a break
 * opportunity, which adds no character to the printed text.
 */
function breakTokens(units: readonly string[], escape: (unit: string) => string): string {
  let out = '';
  let token: string[] = [];
  const flush = () => {
    for (let i = 0; i < token.length; i++) {
      if (token.length > LONG_TOKEN && i > 0 && i % BREAK_EVERY === 0) out += '<wbr>';
      out += escape(token[i] ?? '');
    }
    token = [];
  };
  for (const unit of units) {
    if (/^\s$/u.test(unit)) {
      flush();
      out += escape(unit);
    } else {
      token.push(unit);
    }
  }
  flush();
  return out;
}

/** Characters as a reader sees them: a break never parts a mark from its letter. */
const GRAPHEMES = new Intl.Segmenter('en', { granularity: 'grapheme' });
const graphemes = (value: string): string[] =>
  Array.from(GRAPHEMES.segment(value), (part) => part.segment);

/** Text for an element's content, escaped, a long token given places to break. */
export function text(value: string): string {
  return breakTokens(graphemes(value), plainText);
}

/**
 * A run of markup's text (raw: its character references as they are) given places to break
 * in a long token, as `text` gives plain text: for `markupText`'s runs of a summation.
 */
export function markupBreaks(run: string): string {
  // each character reference one unit, every other text by its characters
  const units = run
    .split(/(&(?:#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]*);)/giu)
    .flatMap((part, i) => (i % 2 === 1 ? [part] : graphemes(part)));
  return breakTokens(units, (unit) => unit);
}

/** Text for an attribute's value, quoted with double quotes: no breaks, which are markup. */
export function attribute(value: string): string {
  return plainText(value).replace(/"/g, '&quot;');
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
   * is drawn in an ancestor's, or an ancestor's illustration stands in for it; a reaction's page, which opens it in its pathway there. The
   * Browser's address is its older form, which the website still reads (`#/` and `SEL`).
   */
  figure(figure: Figure, stId: string): string {
    if (figure.kind === 'reaction') return this.event(stId);
    // drawn in an ancestor's diagram, or its illustration standing in: the event selected
    const drawnElsewhere =
      figure.kind === 'ancestor' || (figure.kind === 'ehld' && figure.unselectedFor !== undefined);
    const select = drawnElsewhere ? `&SEL=${encodeURIComponent(stId)}` : '';
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
