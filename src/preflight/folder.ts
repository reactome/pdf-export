// The figures' folder (spec 001 T024, contracts/figures.md): what `figures` (T046) writes and
// what `book` checks before anything is printed. The manifest, `figures.jsonl`, is a line of
// JSON per record: the fingerprint first, then a line per figure, then `complete`, whose
// fingerprint fields equal the first line's. The line formats are here, for T046 to write.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ReleaseInfo } from '../graph/queries.ts';
import type { Document, Figure } from '../model/types.ts';

export const MANIFEST = 'figures.jsonl';

/** What a folder was drawn from (contracts/figures.md). */
export interface Fingerprint {
  /** The graph's `DBInfo.releaseNumber`. */
  release: number;
  /** The graph's `DBInfo.checksum`, as its decimal digits. */
  checksum: string;
  /** The EHLD summary's hash, `summaryHash` (src/preflight/files.ts). */
  summary: string;
  /** The release the content service answered. */
  content: number;
  /** The render service's `build`. */
  build: string;
}

/** What one event's figure draws: its file is `{stId}.svg`. */
export interface FigureRecord {
  /** The event whose section shows it. */
  stId: string;
  kind: Figure['kind'];
  /** The stable identifier drawn. */
  source: string;
  /** The ids selected, sorted; none but for `ancestor`. */
  highlight: string[];
}

export type ManifestLine =
  | ({ type: 'fingerprint' } & Fingerprint)
  | ({ type: 'figure' } & FigureRecord)
  | ({ type: 'complete' } & Fingerprint);

/** A manifest line as `figures` appends it, its newline included. */
export function manifestLine(line: ManifestLine): string {
  return `${JSON.stringify(line)}\n`;
}

/** An event's figure as the folder records it. */
export function figureRecord(stId: string, figure: Figure): FigureRecord {
  return {
    stId,
    kind: figure.kind,
    source: figure.stId,
    highlight: figure.kind === 'ancestor' ? [...figure.highlight].sort() : [],
  };
}

/**
 * The figures the Figure rules choose for the book: one per event with a figure, by the
 * event's stable identifier, in document order. An event in two of the book's PDFs has the
 * same figure in each, as its figure depends on the event alone.
 */
export function expectedFigures(docs: readonly Document[]): Map<string, FigureRecord> {
  const expected = new Map<string, FigureRecord>();
  for (const doc of docs) {
    for (const place of doc.places) {
      if (!place.full || !place.section.figure) continue;
      const { stId } = place.section.event;
      if (!expected.has(stId)) expected.set(stId, figureRecord(stId, place.section.figure));
    }
  }
  return expected;
}

const FINGERPRINT_FIELDS = ['release', 'checksum', 'summary', 'content', 'build'] as const;
const KINDS: readonly string[] = ['diagram', 'ancestor', 'ehld', 'reaction'];

const isFingerprint = (o: Record<string, unknown>): boolean =>
  Number.isInteger(o['release']) &&
  typeof o['checksum'] === 'string' &&
  typeof o['summary'] === 'string' &&
  Number.isInteger(o['content']) &&
  typeof o['build'] === 'string';

const isFigure = (o: Record<string, unknown>): boolean =>
  typeof o['stId'] === 'string' &&
  typeof o['kind'] === 'string' &&
  KINDS.includes(o['kind']) &&
  typeof o['source'] === 'string' &&
  Array.isArray(o['highlight']) &&
  o['highlight'].every((id) => typeof id === 'string');

/**
 * The manifest's lines, or null when it is not whole (`incomplete-folder`): a line that is
 * not a JSON object of its type, a last line torn (no newline), no fingerprint first, a
 * fingerprint or `complete` anywhere else, no `complete` last, a `complete` whose fingerprint
 * differs from the first line's, or two lines for one stable identifier.
 */
export function readManifest(
  text: string
): { fingerprint: Fingerprint; figures: Map<string, FigureRecord> } | null {
  if (!text.endsWith('\n')) return null;
  const lines: Record<string, unknown>[] = [];
  for (const raw of text.slice(0, -1).split('\n')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    lines.push(parsed as Record<string, unknown>);
  }
  const first = lines[0];
  const last = lines.at(-1);
  if (lines.length < 2 || !first || !last) return null;
  if (first['type'] !== 'fingerprint' || !isFingerprint(first)) return null;
  if (last['type'] !== 'complete' || !isFingerprint(last)) return null;
  if (FINGERPRINT_FIELDS.some((field) => first[field] !== last[field])) return null;
  const figures = new Map<string, FigureRecord>();
  for (const line of lines.slice(1, -1)) {
    if (line['type'] !== 'figure' || !isFigure(line)) return null;
    const record = line as unknown as FigureRecord;
    if (figures.has(record.stId)) return null;
    figures.set(record.stId, {
      stId: record.stId,
      kind: record.kind,
      source: record.source,
      highlight: record.highlight,
    });
  }
  const fingerprint = Object.fromEntries(
    FINGERPRINT_FIELDS.map((field) => [field, first[field]])
  ) as unknown as Fingerprint;
  return { fingerprint, figures };
}

const sameFigure = (a: FigureRecord, b: FigureRecord): boolean =>
  a.kind === b.kind &&
  a.source === b.source &&
  a.highlight.length === b.highlight.length &&
  a.highlight.every((id, i) => id === b.highlight[i]);

/**
 * The folder's faults against the book's graph and EHLD summary (contracts/figures.md,
 * "What `book` checks"), each a fault line. A folder that is not whole, or not this
 * release's or summary's, is refused as a whole: its figures are not checked one by one.
 */
export function checkFolder(
  folder: string,
  {
    release,
    summary,
    expected,
  }: { release: ReleaseInfo; summary: string; expected: ReadonlyMap<string, FigureRecord> }
): string[] {
  const faults: string[] = [];
  if (release.checksum === null) faults.push('no-checksum');
  const path = join(folder, MANIFEST);
  const manifest = existsSync(path) ? readManifest(readFileSync(path, 'utf8')) : null;
  if (!manifest) return [...faults, 'incomplete-folder'];
  const { fingerprint, figures } = manifest;
  if (
    release.checksum !== null &&
    (fingerprint.release !== release.release || fingerprint.checksum !== release.checksum)
  ) {
    faults.push(
      `stale-folder ${String(fingerprint.release)}/${fingerprint.checksum} ${String(release.release)}/${release.checksum}`
    );
  }
  if (fingerprint.summary !== summary) faults.push('stale-summary');
  if (faults.length > 0) return faults;
  for (const [stId, wanted] of expected) {
    const line = figures.get(stId);
    if (!line || !sameFigure(line, wanted)) faults.push(`stale-figure ${stId}`);
    if (!existsSync(join(folder, `${stId}.svg`))) faults.push(`missing-file ${stId}.svg`);
  }
  for (const stId of figures.keys()) {
    if (!expected.has(stId)) faults.push(`stale-figure ${stId}`);
  }
  return faults;
}
