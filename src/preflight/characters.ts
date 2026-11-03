// FR-017 before anything is drawn or printed (spec 001 T024, contracts/cli.md): after the
// list's substitutions, a character no font draws is a fault
// `uncovered-character <U+XXXX> <stId>`, sought in three sources:
// - the texts the layout writes, each section's naming its event, a cover's naming its PDF's
//   top-level pathway, a short entry's naming its event;
// - the names the reactions' figures label (src/graph/queries.ts `figureNames`: their
//   participants and the participants' compartments), naming the first event in document
//   order whose figure holds the name;
// - the labels of the diagram files the Figure rules choose to draw, naming the pathway whose
//   diagram it is. An illustration's own diagram file is not drawn, so not read. A file that
//   cannot be read as JSON is a fault `bad-file <name>`, after the characters' faults.
// The second half of the check, over each drawn figure's labels, is src/figures/labels.ts's.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { Graph } from '../graph/connection.ts';
import { figureNames } from '../graph/queries.ts';
import { BookCharacters } from '../layout/characters.ts';
import type { Document } from '../model/types.ts';
import type { FigureRecord } from './folder.ts';
import { readDiagramLabels } from './labels.ts';

/** How many reactions' names are asked for in one read. */
const CHUNK = 2000;

/** The texts' faults, each PDF in order: its cover, then its places. */
export function textFaults(docs: readonly Document[], characters: BookCharacters): void {
  for (const doc of docs) {
    const [first] = doc.places;
    const root = first ? (first.full ? first.section.event.stId : first.event.stId) : null;
    if (root) characters.strings(doc.cover, root);
    for (const place of doc.places) {
      if (place.full) characters.strings(place.section, place.section.event.stId);
      else characters.strings({ event: place.event, path: place.path }, place.event.stId);
    }
  }
}

/**
 * The names the reactions' figures label, each with the first event in document order whose
 * figure holds it: only a reaction's own figure is drawn from these names.
 */
export function namesInOrder(
  docs: readonly Document[],
  names: ReadonlyMap<number, readonly string[]>
): Map<string, string> {
  const first = new Map<string, string>();
  for (const doc of docs) {
    for (const place of doc.places) {
      if (!place.full || place.section.figure?.kind !== 'reaction') continue;
      const { dbId, stId } = place.section.event;
      for (const name of names.get(dbId) ?? []) if (!first.has(name)) first.set(name, stId);
    }
  }
  return first;
}

/** The reactions drawn from the graph: those whose own figure is their reaction's. */
function drawnReactions(docs: readonly Document[]): number[] {
  const ids = new Set<number>();
  for (const doc of docs) {
    for (const place of doc.places) {
      if (place.full && place.section.figure?.kind === 'reaction') {
        ids.add(place.section.event.dbId);
      }
    }
  }
  return [...ids];
}

/**
 * Every fault FR-017 finds before drawing, each once, in the order found: the texts', the
 * figures' names', then the diagram files', then the files unread (a file missing is the
 * files' check's fault).
 */
export async function checkCharacters(
  graph: Graph,
  docs: readonly Document[],
  { files, expected }: { files: string; expected: Iterable<FigureRecord> }
): Promise<string[]> {
  const characters = new BookCharacters();
  textFaults(docs, characters);

  const reactions = drawnReactions(docs);
  const names = new Map<number, string[]>();
  for (let i = 0; i < reactions.length; i += CHUNK) {
    for (const [id, list] of await figureNames(graph, reactions.slice(i, i + CHUNK))) {
      names.set(id, list);
    }
  }
  for (const [name, stId] of namesInOrder(docs, names)) characters.text(name, stId);

  const unreadable: string[] = [];
  const diagrams = new Set<string>();
  for (const { kind, source } of expected) {
    if (kind === 'diagram' || kind === 'ancestor') diagrams.add(source);
  }
  for (const stId of diagrams) {
    const name = `diagram/${stId}.json`;
    const path = join(files, name);
    if (!existsSync(path)) continue;
    const labels = readDiagramLabels(path);
    if (labels === null) unreadable.push(`bad-file ${name}`);
    for (const label of labels ?? []) characters.text(label, stId);
  }
  return [...characters.faults, ...unreadable];
}
