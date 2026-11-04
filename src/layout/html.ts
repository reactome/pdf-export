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
 * A token longer than this, with no space in it, is given places to break, in equal pieces
 * of at most BREAK_EVERY characters: the pages break words only where they may
 * (`overflow-wrap: break-word`, pages.css), so that a table's short columns keep their
 * words whole, and a token longer than the text column (a run of letters, a long address)
 * would otherwise overflow it, and Chromium then prints its whole part scaled down.
 */
export const LONG_TOKEN = 40;
export const BREAK_EVERY = 20;

/**
 * The spaces a token ends at: those Chromium breaks a line at. A no-break space, U+202F or
 * U+FEFF joins its neighbours, so a token runs through it; a space it could break at but
 * that is not listed (an en space, say) only adds a `<wbr>` where a break already was.
 * A carriage return and line feed are one grapheme.
 */
const BREAKABLE_SPACE = /^[ \t\n\r]+$/;

/**
 * A unit of text: a character as a reader sees it, a character reference, or a tag, which
 * is no character, and which ends the token it is in unless it is inline (`joins`).
 */
interface Unit {
  readonly text: string;
  readonly tag?: 'joins' | 'ends';
}

/**
 * Units with `<wbr>` between the pieces of a token longer than LONG_TOKEN, each piece of
 * at most BREAK_EVERY units and none more than one shorter than another: a break
 * opportunity, which adds no character to the printed text.
 */
function breakTokens(units: readonly Unit[], escape: (unit: string) => string): string {
  let out = '';
  let token: Unit[] = [];
  const flush = () => {
    const length = token.filter((unit) => unit.tag === undefined).length;
    const pieces = length > LONG_TOKEN ? Math.ceil(length / BREAK_EVERY) : 1;
    // the k-th piece ends at ceil(k * length / pieces) units, so the pieces differ by one at most
    let next = 1;
    let counted = 0;
    for (const unit of token) {
      if (unit.tag !== undefined) {
        out += unit.text;
        continue;
      }
      if (next < pieces && counted === Math.ceil((next * length) / pieces)) {
        out += '<wbr>';
        next++;
      }
      out += escape(unit.text);
      counted++;
    }
    token = [];
  };
  for (const unit of units) {
    if (unit.tag === 'joins') {
      token.push(unit);
    } else if (unit.tag === 'ends') {
      flush();
      out += unit.text;
    } else if (BREAKABLE_SPACE.test(unit.text)) {
      flush();
      out += escape(unit.text);
    } else {
      token.push(unit);
    }
  }
  flush();
  return out;
}

/** Characters as a reader sees them: a break never parts a mark from its letter. */
const GRAPHEMES = new Intl.Segmenter('en', { granularity: 'grapheme' });
const graphemes = (value: string): Unit[] =>
  Array.from(GRAPHEMES.segment(value), (part) => ({ text: part.segment }));

/** Text for an element's content, escaped, a long token given places to break. */
export function text(value: string): string {
  return breakTokens(graphemes(value), plainText);
}

/**
 * The inline tags of a summation (the sanitiser's, rules.ts): a word may run through them,
 * as `Na<sub>2</sub>` or a word half in italics, and is counted whole. Any other tag, a
 * paragraph's or a cell's, ends the word.
 */
const INLINE_TAGS = new Set(['a', 'b', 'em', 'i', 'span', 'strong', 'sub', 'sup', 'u']);

/** A tag (its attributes' quoted values may hold `>`), or a comment; a `<` before neither is text. */
const TAG = /(<!--[\s\S]*?(?:-->|$)|<\/?([a-z][a-z0-9]*)(?:[^>"']|"[^"]*"|'[^']*')*>?)/giu;
const REFERENCE = /(&(?:#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]*);)/giu;

/**
 * A summation's sanitised markup, a long token in its text given places to break as `text`
 * gives plain text: each character reference one unit, a tag never broken into and never
 * counted, and a word counted whole through inline tags.
 */
export function markupBreaks(markup: string): string {
  const units: Unit[] = [];
  const parts = markup.split(TAG);
  // split gives text, then each tag with its name (or undefined), then text again
  for (let i = 0; i < parts.length; i += 3) {
    const between = parts[i] ?? '';
    between.split(REFERENCE).forEach((part, j) => {
      if (j % 2 === 1) units.push({ text: part });
      else units.push(...graphemes(part));
    });
    const tag = parts[i + 1];
    if (tag === undefined) continue;
    const name = parts[i + 2]?.toLowerCase();
    const joins = tag.startsWith('<!--') || (name !== undefined && INLINE_TAGS.has(name));
    units.push({ text: tag, tag: joins ? 'joins' : 'ends' });
  }
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
