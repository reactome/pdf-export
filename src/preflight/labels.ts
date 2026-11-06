// The labels of a release's diagram file (spec 001 T024, FR-017): the text a diagram drawn
// from `diagram/{stId}.json` can print, read before anything is drawn: the `displayName`s of
// its nodes, compartments, notes, shadows and links (measured for T024 on release 98), and
// the `label` of each node's attachments, which the website's diagram draws as a
// modification's lettering; `{stId}.graph.json` holds no label.
import { readFileSync } from 'node:fs';

import { isRecord } from '../unknown.ts';

/** The lists of a diagram file whose items carry a label. */
const LABELLED = ['nodes', 'compartments', 'notes', 'shadows', 'links'] as const;

/** Each label in a diagram file's JSON, in the file's order. */
export function diagramLabels(json: unknown): string[] {
  if (!isRecord(json)) return [];
  const labels: string[] = [];
  for (const list of LABELLED) {
    const items = json[list];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (!isRecord(item)) continue;
      const name = item['displayName'];
      if (typeof name === 'string') labels.push(name);
      const attachments = item['nodeAttachments'];
      if (!Array.isArray(attachments)) continue;
      for (const attachment of attachments) {
        if (!isRecord(attachment)) continue;
        const label = attachment['label'];
        if (typeof label === 'string') labels.push(label);
      }
    }
  }
  return labels;
}

/**
 * A diagram file's labels, or null when it cannot be read or is not JSON: the caller's fault
 * `bad-file <name>`.
 */
export function readDiagramLabels(path: string): string[] | null {
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
  return diagramLabels(json);
}
