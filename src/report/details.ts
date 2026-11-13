// The reported pathways' details (spec 002 T007, research R2): each pathway's spec 001
// Section (its figure's choice, compartments, diseases without the generic one,
// inferred-from, summations and first five references), read with spec 001's queries in
// one batch for every reported pathway, and its edit history by the report's own rule.
import type { Graph } from '../graph/connection.ts';
import {
  diagramChoices,
  edits as readEdits,
  eventFacts,
  literature,
  type DiagramChoice,
  type EventRef,
} from '../graph/queries.ts';
import { sectionOf } from '../model/build.ts';
import type { Section } from '../model/types.ts';
import { editHistory, type HistoryRow } from './edits.ts';

export interface PathwayDetail {
  /**
   * Spec 001's section, at depth 0 with no path. Its `edits` are empty: the report's
   * history, below, takes their place.
   */
  section: Section;
  history: HistoryRow[];
}

/**
 * The details of the reported pathways, by database id, each query made once for them
 * all. `illustrated` names the pathways with an illustration (the release's EHLD summary).
 * A pathway the graph does not hold has no detail.
 */
export async function readDetails(
  graph: Graph,
  pathways: readonly Pick<EventRef, 'dbId'>[],
  illustrated: ReadonlySet<string>
): Promise<Map<number, PathwayDetail>> {
  const ids = [...new Set(pathways.map((p) => p.dbId))];
  if (ids.length === 0) return new Map();
  const [facts, refs, edits] = await Promise.all([
    eventFacts(graph, ids),
    literature(graph, ids),
    readEdits(graph, ids),
  ]);
  const needChoice = [...facts.values()]
    .filter((f) => f.kind === 'pathway' && !f.hasDiagram)
    .map((f) => f.dbId);
  const choices =
    needChoice.length === 0
      ? new Map<number, DiagramChoice>()
      : await diagramChoices(graph, needChoice);
  const held = new Set(ids);
  const details = new Map<number, PathwayDetail>();
  for (const id of ids) {
    const event = facts.get(id);
    if (!event) continue;
    details.set(id, {
      section: sectionOf(
        event,
        { refs, edits: new Map(), choices },
        { path: [], depth: 0, held, illustrated }
      ),
      history: editHistory(edits.get(id) ?? []),
    });
  }
  return details;
}
