// What `compare` may print (spec 001 T035, FR-012, FR-013): the one place a value read from a
// PDF reaches its report. Text read from a PDF is printed only where it has one of a few
// strict shapes, none of which can hold a person's name:
//
// - a count (digits);
// - yes or no;
// - a release number;
// - one of a fixed list: the analysis's types and resources, a part's or a kind's name;
// - a stable identifier, `R-` then three capitals, a hyphen and digits;
// - an analysis token of the form the analysis service issues (src/analysis/token.ts);
// - a species from the fixed list of Reactome's species below.
//
// Everything else is printed as a hash and a length (or a count and a hash, for a list of
// names). The hashes printed are salted once a run, so a report's hashes say which values
// are equal within it, and cannot be checked against a guessed name without the run's salt,
// which is never printed: a name is a short guess, and an unsalted hash of one would be read
// back by guessing.
import { createHash, randomBytes } from 'node:crypto';

import { canonicalToken } from '../analysis/token.ts';
import { NEVER_DRAWN } from '../layout/characters.ts';

const UNPRINTED = new RegExp(`${NEVER_DRAWN.source}+`, 'gu');

/** Text as compared: compatibility forms folded, white space and joiners left out. */
export const fold = (text: string): string => text.normalize('NFKC').replace(UNPRINTED, '');

/** A short hash of a text, as the reduced form holds what it does not keep as text. */
export const hash = (text: string): string =>
  createHash('sha256').update(text).digest('hex').slice(0, 16);

/** A value held only as its hash and its length. */
export interface Withheld {
  hash: string;
  length: number;
}

/** People's names, or a list that holds them: how many, and one hash of them all. */
export interface Hashed {
  count: number;
  hash: string;
}

export const withhold = (text: string): Withheld => ({ hash: hash(text), length: text.length });

/** Reactome's species: human and the species its pathways are inferred to. */
export const SPECIES = [
  'Homo sapiens',
  'Bos taurus',
  'Caenorhabditis elegans',
  'Canis familiaris',
  'Danio rerio',
  'Dictyostelium discoideum',
  'Drosophila melanogaster',
  'Gallus gallus',
  'Mus musculus',
  'Mycobacterium tuberculosis',
  'Plasmodium falciparum',
  'Rattus norvegicus',
  'Saccharomyces cerevisiae',
  'Schizosaccharomyces pombe',
  'Sus scrofa',
  'Xenopus tropicalis',
] as const;

/** The analysis service's types and resources. */
export const ANALYSIS_TYPES = ['OVERREPRESENTATION', 'EXPRESSION', 'SPECIES_COMPARISON', 'GSA'];
export const RESOURCES = [
  'TOTAL',
  'UNIPROT',
  'ENSEMBL',
  'CHEBI',
  'IUPHAR',
  'MIRBASE',
  'NCBI_PROTEIN',
  'EMBL',
  'COMPOUND',
  'PUBCHEM_COMPOUND',
];

export type Shape =
  'count' | 'yesno' | 'release' | 'stId' | 'token' | 'species' | { oneOf: readonly string[] };

export const STABLE_ID = /^R-[A-Z]{3}-\d+$/;

/** One of a list, compared folded and case aside, as the list writes it. */
function oneOf(value: string, list: readonly string[]): string | null {
  const read = fold(value).toLowerCase();
  return list.find((item) => fold(item).toLowerCase() === read) ?? null;
}

/**
 * A value as it may be printed in this shape, or null where it does not have it. Strings are
 * read folded; booleans are yes or no.
 */
export function shaped(value: unknown, shape: Shape): string | number | null {
  if (typeof value === 'boolean') return shape === 'yesno' ? (value ? 'yes' : 'no') : null;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) return null;
    if (shape === 'count') return value;
    if (shape === 'release') return value > 0 && value < 10_000 ? value : null;
    return null;
  }
  if (typeof value !== 'string') return null;
  const read = fold(value);
  if (typeof shape === 'object') return oneOf(read, shape.oneOf);
  switch (shape) {
    case 'count':
      return /^\d{1,12}$/.test(read) ? Number(read) : null;
    case 'release':
      return /^\d{1,4}$/.test(read) && Number(read) > 0 ? Number(read) : null;
    case 'yesno':
      return /^(?:yes|true)$/i.test(read) ? 'yes' : /^(?:no|false)$/i.test(read) ? 'no' : null;
    case 'stId':
      return STABLE_ID.test(read) ? read : null;
    case 'species':
      return oneOf(read, SPECIES);
    case 'token':
      try {
        canonicalToken(read);
        return read;
      } catch {
        return null;
      }
  }
}

/** A value read from a PDF as the reduced form holds it: as printed, or withheld. */
export type Checked = { value: string | number } | Withheld;

/** A value kept as it is where it has its shape, or else withheld. */
export function checked(value: string, shape: Shape): Checked {
  const kept = shaped(value, shape);
  return kept === null ? withhold(fold(value)) : { value: kept };
}

/** The parts, fields and kinds a difference may name. */
export const PARTS = [
  'file',
  'cover',
  'introduction',
  'analysis',
  'sections',
  'section',
  'figure',
  'contents',
  'short-entries',
] as const;
export const KINDS = [
  'value',
  'count',
  'text',
  'order',
  'missing',
  'extra',
  'kind',
  'target',
  'missing-target',
  'unreadable',
] as const;

/** Each field whose values may be printed, and the shape they must have. */
const VALUES: Readonly<Record<string, Shape>> = {
  'cover title': { oneOf: ['same', 'differs'] },
  'cover diagram': 'yesno',
  'cover excerpt': 'yesno',
  'introduction release': 'release',
  'introduction pathways': 'count',
  'introduction reactions': 'count',
  'analysis token': 'token',
  'analysis type': { oneOf: ANALYSIS_TYPES },
  'analysis species': 'species',
  'analysis projection': 'yesno',
  'analysis interactors': 'yesno',
  'analysis identifiersFound': 'count',
  'analysis identifiersTotal': 'count',
  'analysis pathways': 'count',
  'analysis resource': { oneOf: RESOURCES },
  'short-entries ': 'count',
};

/** The fields a difference may name: the analysis's properties and a section's parts too. */
const FIELDS = new Set([
  ...Object.keys(VALUES).map((key) => key.split(' ')[1] ?? ''),
  'names',
  'reference',
  'new',
  'name',
  'location',
  'stId',
  'type',
  'compartments',
  'diseases',
  'inferredFrom',
  'summation',
  'before',
  'after',
  'references',
  'edits',
  'entities',
  'interactors',
]);

/** A difference as the comparison makes it, before it is printed. */
export interface Difference {
  /** The file compared, by its name in its folder (never read from a PDF). */
  file: string;
  part: (typeof PARTS)[number];
  field?: string;
  kind: (typeof KINDS)[number];
  count: number;
  /** The sections it is in, by stable identifier. */
  events?: string[];
  reference?: unknown;
  new?: unknown;
  /** Why it is expected, from `--expected`'s file (never read from a PDF). */
  recorded?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object';

/**
 * The report's printer: every value a difference holds passes through here. A value of its
 * field's shape is printed; a Hashed list of names as its count and salted hash; anything
 * else, as a salted hash and a length.
 */
export class Output {
  readonly #salt: string;

  /** A salt of its own each run, unless one is given (for tests). */
  constructor(salt: string = randomBytes(16).toString('hex')) {
    this.#salt = salt;
  }

  #salted(digest: string): string {
    return hash(`${this.#salt}\0${digest}`);
  }

  #withheld(value: unknown): { hash: string; length: number } {
    const text = typeof value === 'string' ? fold(value) : JSON.stringify(value);
    return { hash: this.#salted(hash(text)), length: text.length };
  }

  /** One side's value, as it may be printed. */
  value(key: string, value: unknown): unknown {
    if (value === null || value === undefined) return null;
    if (isRecord(value)) {
      const keys = Object.keys(value).sort().join(',');
      const digest = value['hash'];
      const hex = typeof digest === 'string' && /^[0-9a-f]{16}$/.test(digest);
      const count = value['count'];
      const length = value['length'];
      // already withheld or hashed by the reduction: its digest salted
      if (hex && keys === 'count,hash' && typeof count === 'number') {
        return { count, hash: this.#salted(digest) };
      }
      if (hex && keys === 'hash,length' && typeof length === 'number') {
        return { hash: this.#salted(digest), length };
      }
      if (keys === 'value') return this.value(key, value['value']);
      return this.#withheld(value);
    }
    const shape = VALUES[key];
    const kept = shape === undefined ? null : shaped(value, shape);
    return kept ?? this.#withheld(value);
  }

  /** A difference, every field checked. */
  difference(d: Difference): Record<string, unknown> {
    const key = `${d.part} ${d.field ?? ''}`;
    const named = <T extends string>(value: string | undefined, list: Iterable<T>) =>
      value === undefined
        ? undefined
        : [...list].includes(value as T)
          ? value
          : this.#withheld(value);
    const out: Record<string, unknown> = {
      file: d.file,
      part: named(d.part, PARTS),
      kind: named(d.kind, KINDS),
      count: Number.isSafeInteger(d.count) ? d.count : 0,
    };
    if (d.field !== undefined) out['field'] = named(d.field, FIELDS);
    if (d.events !== undefined) {
      out['events'] = d.events.map((e) => (STABLE_ID.test(e) ? e : this.#withheld(e)));
    }
    if ('reference' in d) out['reference'] = this.value(key, d.reference);
    if ('new' in d) out['new'] = this.value(key, d.new);
    if (d.recorded !== undefined) out['recorded'] = d.recorded;
    return out;
  }
}
