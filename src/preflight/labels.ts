// The labels of a release's diagram file (spec 001 T024, FR-017): the text a diagram drawn
// from `diagram/{stId}.json` can print, read before anything is drawn: the `displayName`s of
// its nodes, compartments, notes, shadows and links (measured for T024 on release 98), and
// the `label` of each node's attachments, which the website's diagram draws as a
// modification's lettering; `{stId}.graph.json` holds no label.
import { readFileSync } from 'node:fs';

/** The lists of a diagram file whose items carry a label. */
const LABELLED = ['nodes', 'compartments', 'notes', 'shadows', 'links'] as const;

/** Each label in a diagram file's JSON, in the file's order. */
export function diagramLabels(json: unknown): string[] {
  if (json === null || typeof json !== 'object') return [];
  const labels: string[] = [];
  for (const list of LABELLED) {
    const items: unknown = (json as Record<string, unknown>)[list];
    if (!Array.isArray(items)) continue;
    for (const item of items as unknown[]) {
      if (item === null || typeof item !== 'object') continue;
      const name: unknown = (item as Record<string, unknown>)['displayName'];
      if (typeof name === 'string') labels.push(name);
      const attachments: unknown = (item as Record<string, unknown>)['nodeAttachments'];
      if (!Array.isArray(attachments)) continue;
      for (const attachment of attachments as unknown[]) {
        if (attachment === null || typeof attachment !== 'object') continue;
        const label: unknown = (attachment as Record<string, unknown>)['label'];
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
