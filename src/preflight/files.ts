// The release's files the figures need (spec 001 T024, research R7): which events need which
// file comes from the graph's events, through the Figure rules; the EHLD summary only says
// which of them are illustrations, so its entry for an event the graph does not hold is
// never looked for. A missing file is a fault `missing-file <name>`, named as in `--files`.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { FigureRecord } from './folder.ts';

/** The EHLD summary, in the release's folder. */
export const SUMMARY = 'ehld/svgsummary.txt';

/** The EHLD summary: the pathways it names, and its hash for the folder's fingerprint. */
export interface Summary {
  illustrated: Set<string>;
  /** `sha256:` and the hex digest of the file's bytes. */
  hash: string;
}

/** The release's EHLD summary, or null where the folder has none. */
export function readSummary(files: string): Summary | null {
  const path = join(files, SUMMARY);
  if (!existsSync(path)) return null;
  const bytes = readFileSync(path);
  return {
    illustrated: new Set(
      bytes
        .toString('utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('R-'))
    ),
    hash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
}

/**
 * The release's files the figures draw from, each once, sorted: a diagram's `{stId}.json`
 * and `{stId}.graph.json` for a figure drawn from a diagram (its own or an ancestor's), an
 * illustration's `{stId}.svg` for one drawn from an illustration. A reaction is drawn from
 * the graph alone.
 */
export function neededFiles(figures: Iterable<FigureRecord>): string[] {
  const names = new Set<string>();
  for (const { kind, source } of figures) {
    if (kind === 'diagram' || kind === 'ancestor') {
      names.add(`diagram/${source}.json`);
      names.add(`diagram/${source}.graph.json`);
    } else if (kind === 'ehld') {
      names.add(`ehld/${source}.svg`);
    }
  }
  return [...names].sort();
}

/** Each needed file missing from the release's folder, as a fault. */
export function checkFiles(files: string, names: readonly string[]): string[] {
  return names.filter((name) => !existsSync(join(files, name))).map((n) => `missing-file ${n}`);
}
