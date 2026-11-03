// The model built from the graph (spec 001 T015, T048, data-model.md): the book's PDFs, one
// per top-level pathway, and a single event's PDF. The tree is read a level at a time, once
// for every document; each document's places are made depth-first, in the curators' order;
// an event is written in full at its first place in a document and as a short entry at its
// later places there, its subtree under its first place only (FR-004).
import type { Graph } from '../graph/connection.ts';
import {
  children as readChildren,
  diagramChoices,
  edits as readEdits,
  eventFacts,
  literature,
  release as readRelease,
  topLevelPathways,
  type Child,
  type DiagramChoice,
  type Edit,
  type EventFacts,
  type EventRef,
  type Reference,
} from '../graph/queries.ts';
import {
  byCodeUnits,
  coverNames,
  diseases,
  editRows,
  inferredFrom,
  sanitiseSummation,
} from './rules.ts';
import type { ContentsEntry, Document, Figure, Place, Section } from './types.ts';

export const anchorOf = (stId: string): string => `s-${stId}`;

/**
 * An event's figure (data-model.md): a reaction's own drawing; a pathway's diagram, or its
 * illustration where the EHLD summary names it; otherwise its nearest ancestor's diagram
 * with its reactions selected, the ancestor nearest a top-level pathway winning, or that
 * ancestor's illustration unselected (the render service cannot select on one, research
 * R10).
 */
export function chooseFigure(
  event: Pick<EventFacts, 'stId' | 'kind' | 'hasDiagram'>,
  choice: DiagramChoice | undefined,
  illustrated: ReadonlySet<string>
): Figure | null {
  if (event.kind === 'reaction') return { kind: 'reaction', stId: event.stId };
  if (event.hasDiagram) {
    return illustrated.has(event.stId)
      ? { kind: 'ehld', stId: event.stId }
      : { kind: 'diagram', stId: event.stId };
  }
  const nearest = nearestAncestor(choice?.ancestors ?? []);
  if (!nearest) return null;
  if (illustrated.has(nearest.stId)) {
    return { kind: 'ehld', stId: nearest.stId, unselectedFor: event.stId };
  }
  return { kind: 'ancestor', stId: nearest.stId, highlight: choice?.reactions ?? [] };
}

/**
 * The ancestor that draws a pathway with no diagram, as graph-core does today: the one
 * nearest a top-level pathway below it, a top-level pathway itself last (graph-core gives
 * it no level, and Neo4j sorts that last), then by database id.
 */
export function nearestAncestor<T extends { dbId: number; depthFromTop: number }>(
  ancestors: readonly T[]
): T | undefined {
  const rank = (a: T): number => (a.depthFromTop === 0 ? Infinity : a.depthFromTop);
  return [...ancestors].sort((a, b) => rank(a) - rank(b) || a.dbId - b.dbId)[0];
}

/** A place as the walk finds it, before its event's facts are read. */
interface Walked {
  child: Child;
  path: Child[];
  depth: number;
  full: boolean;
}

/** Each pathway's children, read once, a level at a time, down to a depth. */
async function readTree(
  graph: Graph,
  roots: readonly Child[],
  maxDepth: number
): Promise<Map<number, Child[]>> {
  const kids = new Map<number, Child[]>();
  let level = roots.filter((r) => r.kind === 'pathway');
  for (let depth = 0; depth < maxDepth && level.length > 0; depth++) {
    const wanted = level.filter((p) => !kids.has(p.dbId)).map((p) => p.dbId);
    const read = await readChildren(graph, wanted);
    for (const id of wanted) kids.set(id, read.get(id) ?? []);
    const next = new Map<number, Child>();
    for (const p of level)
      for (const c of kids.get(p.dbId) ?? []) if (c.kind === 'pathway') next.set(c.dbId, c);
    // each pathway once, and none already read: a level is read once, whatever the paths to it
    level = [...next.values()].filter((p) => !kids.has(p.dbId));
  }
  return kids;
}

/** One document's places in document order: an event in full at its first place in it. */
function walk(root: Child, kids: ReadonlyMap<number, Child[]>, maxDepth: number): Walked[] {
  const places: Walked[] = [];
  const seen = new Set<number>();
  const visit = (child: Child, path: Child[], depth: number): void => {
    const full = !seen.has(child.dbId);
    places.push({ child, path, depth, full });
    if (!full) return;
    seen.add(child.dbId);
    if (child.kind !== 'pathway' || depth >= maxDepth) return;
    for (const next of kids.get(child.dbId) ?? []) visit(next, [...path, child], depth + 1);
  };
  visit(root, [], 0);
  return places;
}

const ref = ({ dbId, stId, name }: EventRef): EventRef => ({ dbId, stId, name });

/** What the graph holds for the events of every document, read once for them all. */
interface Read {
  facts: Map<number, EventFacts>;
  refs: Map<number, Reference[]>;
  edits: Map<number, Edit[]>;
  choices: Map<number, DiagramChoice>;
  version: number;
}

async function readEvents(graph: Graph, ids: readonly number[]): Promise<Read> {
  // in chunks, so the book's thousands of events are never one query (research R2)
  const [facts, refs, edits] = await Promise.all([
    inChunks(ids, (chunk) => eventFacts(graph, chunk)),
    inChunks(ids, (chunk) => literature(graph, chunk)),
    inChunks(ids, (chunk) => readEdits(graph, chunk)),
  ]);
  const version = await readRelease(graph);
  const needChoice = [...facts.values()]
    .filter((f) => f.kind === 'pathway' && !f.hasDiagram)
    .map((f) => f.dbId);
  const choices = await diagramChoices(graph, needChoice);
  return { facts, refs, edits, choices, version };
}

/**
 * One document's places and sections, and its cover's names, from what was read: what is
 * computed over a document (the events it holds, the names) is computed over this one.
 */
function assemble(
  walked: readonly Walked[],
  read: Read,
  illustrated: ReadonlySet<string>
): { places: Place[]; sections: Section[]; names: string[] } {
  const ids = walked.filter((p) => p.full).map((p) => p.child.dbId);
  const held = new Set(ids);
  const sections: Section[] = [];
  const places: Place[] = walked.map(({ child, path, depth, full }) => {
    if (!full) {
      return {
        full: false,
        anchor: anchorOf(child.stId),
        event: ref(child),
        path: path.map(ref),
        depth,
      };
    }
    const event = read.facts.get(child.dbId);
    if (!event) throw new Error(`${child.stId} was not read from the graph`);
    const {
      summations: rawSummations,
      diseases: rawDiseases,
      inferredFrom: rawInferred,
      before,
      after,
      ...facts1
    } = event;
    const section: Section = {
      anchor: anchorOf(event.stId),
      // the events before and after, only those the PDF holds (the Background, part 10)
      event: {
        ...facts1,
        before: before.filter((e) => held.has(e.dbId)),
        after: after.filter((e) => held.has(e.dbId)),
      },
      path: path.map(ref),
      figure: chooseFigure(event, read.choices.get(event.dbId), illustrated),
      diseases: diseases(rawDiseases),
      inferredFrom: inferredFrom(rawInferred),
      summations: rawSummations.map(sanitiseSummation),
      references: read.refs.get(event.dbId) ?? [],
      edits: editRows(read.edits.get(event.dbId) ?? []),
      depth,
    };
    sections.push(section);
    return { full: true, section };
  });
  const names = coverNames(ids.map((id) => read.edits.get(id) ?? []));
  return { places, sections, names };
}

function release(version: number, sections: readonly Section[]) {
  return {
    version,
    pathways: sections.filter((s) => s.event.kind === 'pathway').length,
    reactions: sections.filter((s) => s.event.kind === 'reaction').length,
  };
}

/** Every place, then the contents list itself last (the Background, item 5). */
function contents(places: readonly Place[], analysis: boolean): ContentsEntry[] {
  return [
    { title: 'Introduction', target: 'introduction', depth: 0 },
    ...(analysis ? [{ title: 'Analysis properties', target: 'analysis', depth: 0 }] : []),
    ...places.map((p) => ({
      title: p.full ? p.section.event.name : p.event.name,
      target: p.full ? p.section.anchor : p.anchor,
      depth: p.full ? p.section.depth : p.depth,
    })),
    { title: 'Contents', target: 'contents', depth: 0 },
  ];
}

/**
 * The release's book (FR-001, FR-002): one PDF for each of a species' top-level pathways,
 * by name ignoring case, each in full depth. The graph is read once for them all. An event
 * under two top-level pathways is in full in each PDF, and no PDF links into another.
 */
export async function buildBook(
  graph: Graph,
  { species = 'Homo sapiens', illustrated }: { species?: string; illustrated: ReadonlySet<string> }
): Promise<Document[]> {
  const tops = (await topLevelPathways(graph, species))
    .map((p): Child => ({ ...p, kind: 'pathway', schemaClass: 'TopLevelPathway' }))
    .sort((a, b) => byCodeUnits(a.name.toLowerCase(), b.name.toLowerCase()) || a.dbId - b.dbId);
  const kids = await readTree(graph, tops, Infinity);
  const walks = tops.map((top) => walk(top, kids, Infinity));
  const ids = new Set(walks.flatMap((w) => w.filter((p) => p.full).map((p) => p.child.dbId)));
  const read = await readEvents(graph, [...ids]);
  return tops.map((top, i) => {
    const { places, sections, names } = assemble(walks[i] ?? [], read, illustrated);
    return {
      kind: 'book',
      release: release(read.version, sections),
      cover: {
        title: top.name,
        release: read.version,
        // the pathway's own figure, its section's, so among the figures the book draws: a
        // cover's figure missing from those is left out of the cover without a word
        figure: sections[0]?.figure ?? null,
        excerpt: false,
        names,
      },
      places,
      contents: contents(places, false),
    };
  });
}

/** A single event's PDF (FR-006): at depth 0 or 1, with or without an analysis. */
export async function buildSingle(
  graph: Graph,
  root: Child,
  {
    depth,
    illustrated,
    analysis = false,
  }: { depth: 0 | 1; illustrated: ReadonlySet<string>; analysis?: boolean }
): Promise<Document> {
  const walked = walk(root, await readTree(graph, [root], depth), depth);
  const read = await readEvents(
    graph,
    walked.filter((p) => p.full).map((p) => p.child.dbId)
  );
  const { places, sections, names } = assemble(walked, read, illustrated);
  const first = sections[0];
  const isPathway = root.kind === 'pathway';
  return {
    kind: 'single',
    release: release(read.version, sections),
    cover: {
      title: root.name,
      release: null,
      figure: isPathway ? (first?.figure ?? null) : null,
      excerpt: isPathway,
      names,
    },
    places,
    // A reaction alone, or depth 0, has none (the Background, item 5)
    contents: isPathway && depth > 0 ? contents(places, analysis) : null,
  };
}

/** A query over many ids, a chunk at a time, its answers merged. */
async function inChunks<V>(
  ids: readonly number[],
  read: (chunk: number[]) => Promise<Map<number, V>>,
  size = 2000
): Promise<Map<number, V>> {
  const merged = new Map<number, V>();
  for (let i = 0; i < ids.length; i += size) {
    for (const [k, v] of await read(ids.slice(i, i + size))) merged.set(k, v);
  }
  return merged;
}
