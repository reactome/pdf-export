// The labels of a release's diagram file (spec 001 T024, FR-017): the text a diagram drawn
// from `diagram/{stId}.json` can print, read before anything is drawn. As measured for T024
// on release 98, these are the `displayName`s of its nodes, compartments, notes, shadows and
// links; `{stId}.graph.json` holds no label.
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
    }
  }
  return labels;
}

/** A diagram file's labels; a file that is not JSON is an error naming it. */
export function readDiagramLabels(path: string, name: string): string[] {
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${name} cannot be read as JSON`, { cause: error });
  }
  return diagramLabels(json);
}
