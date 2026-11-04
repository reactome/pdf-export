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
 * The spaces a token ends at: those Chromium breaks a line at, measured
 * (`ci/measure/breaks.ts`): tab, line feed, carriage return (a carriage return and line
 * feed are one grapheme), space, U+0085 (next line), U+1680, U+2000 to U+2006 (the en and
 * em spaces among them), U+2008 to U+200A (the thin and hair spaces among them), U+200B
 * (zero width), U+2028, U+2029, U+205F and U+3000. The others `\s` holds join their
 * neighbours, and a token runs through them: U+000B, U+000C, U+00A0 (no-break), U+2007
 * (figure), U+202F and U+FEFF. A space left out of this list would join two words into one
 * token, and a long one would break mid-word.
 */
export const BREAKABLE_SPACE =
  /^[\t\n\r \u0085\u1680\u2000-\u2006\u2008-\u200b\u2028\u2029\u205f\u3000]+$/u;

/**
 * The characters other than spaces Chromium breaks a line beside, measured
 * (`ci/measure/breaks.ts`) between letters and digits alike: after a hyphen (`-`, U+2010),
 * U+058A, U+2012 and U+2013 (figure and en dashes), U+2027, U+2E17, U+30FB, `?` and U+00AD
 * (the soft hyphen, which prints a hyphen where it breaks); before
 * U+1806; before and after U+2014 (the em dash). Not beside U+2011, the non-breaking
 * hyphen, which FR-017 prints as `-` (characters.ts) before the layout sees it: Chromium
 * then breaks after it as after any hyphen, so it is counted as one. Nor beside `/`, `|`
 * or U+2212 (minus). Ideographs, between which Chromium breaks too, are not
 * listed: a long run of them is only given `<wbr>`s where a break already was.
 */
const BREAKS_AFTER: ReadonlySet<number> = new Set([
  0x2d, 0x3f, 0xad, 0x58a, 0x2010, 0x2012, 0x2013, 0x2014, 0x2027, 0x2e17, 0x30fb,
]);
const BREAKS_BEFORE: ReadonlySet<number> = new Set([0x1806, 0x2014]);

/**
 * Where a line may break beside a character as a reader sees it: a space ends a token and
 * is not counted in it; a hyphen ends the run it closes; U+1806 starts one. A space with a
 * combining mark is one grapheme, and breaks as the space does (Chromium ends the line
 * after the mark, or for U+0020 before it, which leaves the mark uncounted: one character
 * in a run, at most). A hyphen with a mark is taken to join: Chromium breaks after it
 * before a letter but not before a digit, and a `<wbr>` too many is harmless.
 */
export function breakBeside(unit: string): 'space' | 'after' | 'before' | 'both' | 'none' {
  const first = String.fromCodePoint(unit.codePointAt(0) ?? 0);
  if (BREAKABLE_SPACE.test(first)) return 'space';
  if (first !== unit) return 'none';
  const point = first.codePointAt(0) ?? 0;
  const after = BREAKS_AFTER.has(point);
  const before = BREAKS_BEFORE.has(point);
  return after && before ? 'both' : after ? 'after' : before ? 'before' : 'none';
}

/**
 * A unit of text: a character as a reader sees it, a character reference, or a tag, which
 * is no character, and which ends the token it is in unless it is inline (`joins`).
 */
interface Unit {
  readonly text: string;
  readonly tag?: 'joins' | 'ends';
  /** The character a numeric character reference stands for, where a line may break. */
  readonly stands?: string;
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
    } else {
      const at = breakBeside(unit.stands ?? unit.text);
      if (at === 'space') {
        flush();
        out += escape(unit.text);
        continue;
      }
      // a run ends after a hyphen, which is counted in it
      if (at === 'before' || at === 'both') flush();
      token.push(unit);
      if (at === 'after' || at === 'both') flush();
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

/**
 * A tag (its attributes' quoted values may hold `>`), or a comment; a `<` before neither is
 * text. Enough for the sanitiser's output, which holds no CDATA, doctype, processing
 * instruction or script or style element: raw markup is not read rightly.
 */
const TAG = /(<!--[\s\S]*?(?:-->|$)|<\/?([a-z][a-z0-9]*)(?:[^>"']|"[^"]*"|'[^']*')*>?)/giu;
const REFERENCE = /(&(?:#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]*);)/giu;

/**
 * The character a numeric reference stands for; a named one is left as it is. Defensive:
 * the sanitiser writes every character but `&`, `<`, `>` and `"` as itself, so no
 * summation it has read holds a numeric reference, and only a direct call reaches this.
 */
function referenced(reference: string): string {
  const hex = /^&#x([0-9a-f]+);$/iu.exec(reference)?.[1];
  const decimal = /^&#([0-9]+);$/u.exec(reference)?.[1];
  const code =
    hex !== undefined ? parseInt(hex, 16) : decimal !== undefined ? Number(decimal) : NaN;
  return code <= 0x10ffff ? String.fromCodePoint(code) : reference;
}

/**
 * A summation's markup, sanitised by `sanitiseSummation` (src/model/rules.ts), which the
 * model applies to every summation it builds, a long token in its text given places to
 * break as `text` gives plain text: each character reference one unit, a tag never broken
 * into and never counted, and a word counted whole through inline tags. It relies on the
 * sanitiser: on raw markup (CDATA, a doctype, a script) it may break where it should not.
 */
export function markupBreaks(markup: string): string {
  const units: Unit[] = [];
  const parts = markup.split(TAG);
  // split gives text, then each tag with its name (or undefined), then text again
  for (let i = 0; i < parts.length; i += 3) {
    const between = parts[i] ?? '';
    between.split(REFERENCE).forEach((part, j) => {
      if (j % 2 === 1) units.push({ text: part, stands: referenced(part) });
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
