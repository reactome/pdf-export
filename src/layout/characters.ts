// Characters no embedded typeface draws (spec 001 FR-017, T022). First a fixed list of
// substitutions, each by what the typefaces draw without changing what the text says; then,
// in a PDF made on request, any other character no font draws is printed as U+FFFD and its
// code point logged once for the PDF, with the stable identifier or the token, never the
// text. The texts and the figures' labels (src/figures/labels.ts) share one log. T024 adds
// the book's mode, in which such a character is a fault.
import { codePointName, coveredCodePoints } from './fonts.ts';

/**
 * The substitutions, each with the release text it was found in (release 98, measured for
 * T018 and T024 over the texts the PDFs print, people's names aside).
 */
export const SUBSTITUTIONS: ReadonlyMap<number, string> = new Map([
  // U+2011 non-breaking hyphen, in summations and event names (197 lines) and publications'
  // titles (6): a hyphen, which every face draws and a reader's search finds
  [0x2011, '-'],
  // U+FB01 the ﬁ ligature, in summations (5 lines): its letters
  [0xfb01, 'fi'],
  // U+02D9 spacing dot above, used as a radical's dot ("O2˙−", 1 line): a bullet
  [0x02d9, '\u2022'],
  // U+05F3 geresh, used as a prime in a publication's title ("2׳-O methylation"): a prime
  [0x05f3, '\u2032'],
]);

/** What a character no font draws prints as in a PDF made on request. */
export const REPLACEMENT = '\uFFFD';

/** Characters never drawn, and so never uncovered: white space, controls, joiners. */
const NEVER_DRAWN = /[\s\p{Cc}\p{Default_Ignorable_Code_Point}]/u;

/** Text that holds nothing to substitute or replace, read at once. */
const PLAIN = /^[\x20-\x7e\s]*$/;

/**
 * One PDF's log of the characters no font draws: each code point once, however often and
 * wherever (a text, a figure's label) the PDF holds it.
 */
export class CharacterLog {
  readonly #seen = new Set<number>();
  readonly #subject: string;
  readonly #write: (line: string) => void;

  /**
   * @param subject what the line names: the stable identifier, and the token if there is one
   * @param write where each line goes
   */
  constructor(subject: string, write: (line: string) => void) {
    this.#subject = subject;
    this.#write = write;
  }

  /** A character no font draws: logged the first time this PDF meets it. */
  uncovered(point: number): void {
    if (this.#seen.has(point)) return;
    this.#seen.add(point);
    this.#write(`uncovered-character ${codePointName(point)} ${this.#subject}`);
  }
}

/**
 * A character as a PDF made on request prints it: its substitution, itself where a font
 * draws it, otherwise U+FFFD, logged; `null` when it is printed as it is.
 */
function onRequestChar(char: string, log: CharacterLog, covered: ReadonlySet<number>) {
  const point = char.codePointAt(0) ?? 0;
  const substitute = SUBSTITUTIONS.get(point);
  if (substitute !== undefined) return substitute;
  if (covered.has(point) || NEVER_DRAWN.test(char)) return null;
  log.uncovered(point);
  return REPLACEMENT;
}

/** A plain text as a PDF made on request prints it (FR-017). */
export function onRequestText(
  text: string,
  log: CharacterLog,
  covered: ReadonlySet<number> = coveredCodePoints()
): string {
  if (PLAIN.test(text)) return text;
  let out = '';
  for (const char of text) out += onRequestChar(char, log, covered) ?? char;
  return out;
}

/**
 * Markup's text as a PDF made on request prints it: the text between its tags, and each
 * numeric character reference there, never a tag, an attribute, a comment or a style or
 * script element's content (`mapText` is given each run of text, raw).
 */
export function markupText(markup: string, mapText: (text: string) => string): string {
  let out = '';
  let i = 0;
  const n = markup.length;
  while (i < n) {
    const lt = markup.indexOf('<', i);
    if (lt === -1) {
      out += mapText(markup.slice(i));
      break;
    }
    out += mapText(markup.slice(i, lt));
    if (markup.startsWith('<!--', lt)) {
      const end = markup.indexOf('-->', lt + 4);
      i = end === -1 ? n : end + 3;
      out += markup.slice(lt, i);
      continue;
    }
    if (markup.startsWith('<![CDATA[', lt)) {
      const end = markup.indexOf(']]>', lt + 9);
      const close = end === -1 ? n : end;
      out += `<![CDATA[${mapText(markup.slice(lt + 9, close))}`;
      out += markup.slice(close, end === -1 ? n : end + 3);
      i = end === -1 ? n : end + 3;
      continue;
    }
    // a tag ends at the first `>` outside a quoted value
    let j = lt + 1;
    let quote = '';
    for (; j < n; j++) {
      const c = markup[j];
      if (quote) {
        if (c === quote) quote = '';
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
    }
    const tag = markup.slice(lt, j + 1);
    out += tag;
    i = j + 1;
    // a style or script element's content is not text: copied up to its end tag
    const raw = /^<(style|script)\b/i.exec(tag);
    if (raw?.[1] && !tag.endsWith('/>')) {
      const endTag = new RegExp(`</${raw[1]}\\s*>`, 'ig');
      endTag.lastIndex = i;
      const end = endTag.exec(markup);
      const stop = end ? end.index : n;
      out += markup.slice(i, stop);
      i = stop;
    }
  }
  return out;
}

/** A numeric character reference, decimal or hexadecimal (`&#x` and its hex digits). */
const REFERENCE = /&#(?:[xX]([0-9a-fA-F]{1,6})|([0-9]{1,7}));/g;

/** A run of markup's text as a PDF made on request prints it, its references included. */
export function onRequestMarkupText(
  text: string,
  log: CharacterLog,
  covered: ReadonlySet<number> = coveredCodePoints()
): string {
  const referenced = text.includes('&#')
    ? text.replace(REFERENCE, (whole, hex: string | undefined, dec: string | undefined) => {
        const point = hex === undefined ? Number(dec) : parseInt(hex, 16);
        if (point > 0x10ffff) return whole;
        // a reference to a character printed as it is stays as it was, a `<` among them
        return onRequestChar(String.fromCodePoint(point), log, covered) ?? whole;
      })
    : text;
  return onRequestText(referenced, log, covered);
}

/**
 * Every string in a value (a document, an analysis) as a PDF made on request prints it: a
 * summation's as markup, every other as plain text. Objects, lists and maps are copied.
 */
export function onRequestStrings<T>(value: T, log: CharacterLog): T {
  const covered = coveredCodePoints();
  const visit = (item: unknown, markup: boolean): unknown => {
    if (typeof item === 'string') {
      return markup
        ? markupText(item, (text) => onRequestMarkupText(text, log, covered))
        : onRequestText(item, log, covered);
    }
    if (Array.isArray(item)) return item.map((element: unknown) => visit(element, markup));
    if (item instanceof Map) {
      return new Map([...item].map(([key, element]) => [key, visit(element, false)]));
    }
    if (item !== null && typeof item === 'object') {
      return Object.fromEntries(
        Object.entries(item).map(([key, element]) => [key, visit(element, key === 'summations')])
      );
    }
    return item;
  };
  return visit(value, false) as T;
}

/**
 * FR-017 in the book (spec 001 T024): the substitutions made, each counted by code point for
 * the run report, and any other character no font draws a fault,
 * `uncovered-character <U+XXXX> <stId>`, naming the subject given with its text, never the
 * text. Such a character is left as it is: the book is not written while there is a fault.
 * One instance per purpose: the preflight's own counts are not the run report's.
 */
export class BookCharacters {
  readonly #faults = new Set<string>();
  readonly #replaced = new Map<number, number>();
  readonly #covered: ReadonlySet<number>;

  constructor(covered: ReadonlySet<number> = coveredCodePoints()) {
    this.#covered = covered;
  }

  /** The faults met so far, each once, in the order met. */
  get faults(): string[] {
    return [...this.#faults];
  }

  /** How often each listed character was replaced. */
  get replaced(): ReadonlyMap<number, number> {
    return this.#replaced;
  }

  /** A character as the book prints it; `null` when it is printed as it is. */
  #char(char: string, subject: string): string | null {
    const point = char.codePointAt(0) ?? 0;
    const substitute = SUBSTITUTIONS.get(point);
    if (substitute !== undefined) {
      this.#replaced.set(point, (this.#replaced.get(point) ?? 0) + 1);
      return substitute;
    }
    if (!this.#covered.has(point) && !NEVER_DRAWN.test(char)) {
      this.#faults.add(`uncovered-character ${codePointName(point)} ${subject}`);
    }
    return null;
  }

  /** A plain text as the book prints it. */
  text(text: string, subject: string): string {
    if (PLAIN.test(text)) return text;
    let out = '';
    for (const char of text) out += this.#char(char, subject) ?? char;
    return out;
  }

  /** A run of markup's text as the book prints it, its numeric references included. */
  markupText(text: string, subject: string): string {
    const referenced = text.includes('&#')
      ? text.replace(REFERENCE, (whole, hex: string | undefined, dec: string | undefined) => {
          const point = hex === undefined ? Number(dec) : parseInt(hex, 16);
          if (point > 0x10ffff) return whole;
          return this.#char(String.fromCodePoint(point), subject) ?? whole;
        })
      : text;
    return this.text(referenced, subject);
  }

  /** Markup (a summation, a figure's SVG) as the book prints it: its text alone changed. */
  markup(markup: string, subject: string): string {
    return markupText(markup, (text) => this.markupText(text, subject));
  }

  /**
   * Every string in a value as the book prints it: a summation's as markup, every other as
   * plain text. Objects, lists and maps are copied.
   */
  strings<T>(value: T, subject: string): T {
    const visit = (item: unknown, markup: boolean): unknown => {
      if (typeof item === 'string') {
        return markup ? this.markup(item, subject) : this.text(item, subject);
      }
      if (Array.isArray(item)) return item.map((element: unknown) => visit(element, markup));
      if (item instanceof Map) {
        return new Map([...item].map(([key, element]) => [key, visit(element, false)]));
      }
      if (item !== null && typeof item === 'object') {
        return Object.fromEntries(
          Object.entries(item).map(([key, element]) => [key, visit(element, key === 'summations')])
        );
      }
      return item;
    };
    return visit(value, false) as T;
  }
}
