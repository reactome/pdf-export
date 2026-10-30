// The batched queries of research R2 (spec 001 T013): the tree by level, each part across
// a level's events, literature, edits, the release and the top-level pathways. Every list
// is in its relationship's `order`, the curators' order; rows come back as plain objects
// keyed by the event's database id.
import type { Graph } from './connection.ts';

export type EventKind = 'pathway' | 'reaction';

export interface EventRef {
  dbId: number;
  stId: string;
  name: string;
}

export interface Child extends EventRef {
  kind: EventKind;
  schemaClass: string;
}

export interface Named {
  dbId: number;
  name: string;
}

export interface EventFacts extends EventRef {
  kind: EventKind;
  schemaClass: string;
  speciesName: string;
  /** A reaction's type, as the graph's `category` gives it. */
  category: string | null;
  hasDiagram: boolean;
  hasEHLD: boolean;
  isInferred: boolean;
  isInDisease: boolean;
  /** The first species by `order`. */
  species: Named | null;
  compartments: Named[];
  diseases: Named[];
  /** What the event was inferred from, each with its species; unordered in the graph. */
  inferredFrom: (EventRef & { speciesName: string })[];
  summations: string[];
  /** The events before this one (its `precedingEvent`s), by `order`. */
  before: EventRef[];
  /** The events after this one: those whose `precedingEvent` it is, by database id. */
  after: EventRef[];
}

export type PublicationKind = 'article' | 'book' | 'web page';

export interface Reference {
  dbId: number;
  kind: PublicationKind;
  title: string;
  /** A book's chapter, where the reference is to one. */
  chapterTitle: string | null;
  journal: string | null;
  volume: number | null;
  pages: string | null;
  year: number | null;
  pubMedId: number | null;
  isbn: string | null;
  url: string | null;
  publisher: string | null;
  /** The first six authors' names, by `order`. */
  authors: string[];
  /** Whether there are more than six. */
  moreAuthors: boolean;
}

export type EditKind = 'authored' | 'edited' | 'reviewed' | 'revised';

export interface Person {
  dbId: number;
  name: string;
  surname: string | null;
}

export interface Edit {
  dbId: number;
  kind: EditKind;
  /** As the graph writes it, `YYYY-MM-DD hh:mm:ss`, or null. */
  dateTime: string | null;
  /** By `order`. */
  authors: Person[];
}

/** The release, from `DBInfo.releaseNumber`. */
export async function release(graph: Graph): Promise<number> {
  const [row] = await graph.read<{ release: number | null }>(
    'MATCH (d:DBInfo) RETURN d.releaseNumber AS release LIMIT 1'
  );
  if (row?.release == null) throw new Error('The graph has no DBInfo.releaseNumber');
  return row.release;
}

/** A species' top-level pathways, by database id: the book orders them by name (FR-002). */
export async function topLevelPathways(graph: Graph, species: string): Promise<EventRef[]> {
  return graph.read<EventRef>(
    `MATCH (p:TopLevelPathway {speciesName: $species})
     RETURN p.dbId AS dbId, p.stId AS stId, p.displayName AS name ORDER BY p.dbId`,
    { species }
  );
}

/** What an identifier names: an event, something that is not one, or nothing. */
export type Identified = { event: Child } | { notAnEvent: true } | null;

/**
 * One object by stable id (with or without its version) or database id: an event, or
 * something that is not one (the service's 400), or nothing (its 404). One lookup on each
 * index, never a disjunction, which can scan every object.
 */
export async function eventByIdentifier(graph: Graph, identifier: string): Promise<Identified> {
  const byDbId = /^\d+$/.test(identifier);
  const query = `MATCH (e:DatabaseObject {${byDbId ? 'dbId: $dbId' : 'stId: $stId'}})
     RETURN e.dbId AS dbId, e.stId AS stId, e.displayName AS name, e.schemaClass AS schemaClass,
            CASE WHEN e:Pathway THEN 'pathway' ELSE 'reaction' END AS kind,
            (e:Pathway OR e:ReactionLikeEvent) AS isEvent
     LIMIT 1`;
  const [row] = await graph.read<Child & { isEvent: boolean }>(query, {
    dbId: byDbId ? Number(identifier) : null,
    stId: identifier.replace(/^(R-[A-Z]{3}-\d+)\.\d+$/, '$1'),
  });
  if (!row) return null;
  if (!row.isEvent) return { notAnEvent: true };
  const { isEvent: _isEvent, ...event } = row;
  return { event };
}

/** Each parent's children, by `order`: one query for a level of the tree. */
export async function children(
  graph: Graph,
  parents: readonly number[]
): Promise<Map<number, Child[]>> {
  const rows = await graph.read<Child & { parent: number }>(
    `UNWIND $parents AS parent
     MATCH (p:DatabaseObject {dbId: parent})-[r:hasEvent]->(c:Event)
     WHERE p:Pathway
     RETURN parent, c.dbId AS dbId, c.stId AS stId, c.displayName AS name,
            c.schemaClass AS schemaClass,
            CASE WHEN c:Pathway THEN 'pathway' ELSE 'reaction' END AS kind
     ORDER BY parent, r.order`,
    { parents: unique(parents) }
  );
  return group(
    rows,
    (row) => row.parent,
    ({ parent: _parent, ...child }) => child
  );
}

/** Each event's facts and short lists, across a level's events. */
export async function eventFacts(
  graph: Graph,
  ids: readonly number[]
): Promise<Map<number, EventFacts>> {
  const rows = await graph.read<EventFacts>(
    `UNWIND $ids AS id
     MATCH (e:DatabaseObject {dbId: id})
     WHERE e:Event
     RETURN e.dbId AS dbId, e.stId AS stId, e.displayName AS name, e.schemaClass AS schemaClass,
       CASE WHEN e:Pathway THEN 'pathway' ELSE 'reaction' END AS kind,
       e.speciesName AS speciesName, e.category AS category,
       coalesce(e.hasDiagram, false) AS hasDiagram, coalesce(e.hasEHLD, false) AS hasEHLD,
       coalesce(e.isInferred, false) AS isInferred, coalesce(e.isInDisease, false) AS isInDisease,
       [(e)-[r:species]->(s) | {order: r.order, dbId: s.dbId, name: s.displayName}] AS species,
       [(e)-[r:compartment]->(c) | {order: r.order, dbId: c.dbId, name: c.displayName}] AS compartments,
       [(e)-[r:disease]->(d) | {order: r.order, dbId: d.dbId, name: d.displayName}] AS diseases,
       [(s:Event)-[:inferredTo]->(e) | {dbId: s.dbId, stId: s.stId, name: s.displayName, speciesName: s.speciesName}] AS inferredFrom,
       [(e)-[r:summation]->(m) | {order: r.order, text: m.text}] AS summations,
       [(e)-[r:precedingEvent]->(b:Event) | {order: r.order, dbId: b.dbId, stId: b.stId, name: b.displayName}] AS before,
       [(f:Event)-[:precedingEvent]->(e) | {dbId: f.dbId, stId: f.stId, name: f.displayName}] AS after`,
    { ids: unique(ids) }
  );
  return new Map((rows as unknown as RawFacts[]).map((row) => [row.dbId, factsFromRow(row)]));
}

/**
 * An event's facts from its row: each list put in its relationship's `order`. Neo4j gives
 * a pattern comprehension no order (it may come back in order, or not), so the sort is
 * here, and tested here, apart from whatever order a database returns.
 */
export function factsFromRow(row: RawFacts): EventFacts {
  return {
    dbId: row.dbId,
    stId: row.stId,
    name: row.name,
    kind: row.kind,
    schemaClass: row.schemaClass,
    speciesName: row.speciesName,
    category: row.category ?? null,
    hasDiagram: row.hasDiagram,
    hasEHLD: row.hasEHLD,
    isInferred: row.isInferred,
    isInDisease: row.isInDisease,
    species: byOrder(row.species).map(({ dbId, name }) => ({ dbId, name }))[0] ?? null,
    compartments: byOrder(row.compartments).map(({ dbId, name }) => ({ dbId, name })),
    diseases: byOrder(row.diseases).map(({ dbId, name }) => ({ dbId, name })),
    inferredFrom: row.inferredFrom,
    summations: byOrder(row.summations).map(({ text }) => text),
    before: byOrder(row.before).map(({ dbId, stId, name }) => ({ dbId, stId, name })),
    after: [...row.after].sort((a, b) => a.dbId - b.dbId),
  };
}

export interface Ordered {
  order: number | null;
}

export interface RawFacts extends Omit<
  EventFacts,
  'species' | 'compartments' | 'diseases' | 'summations' | 'before'
> {
  species: (Ordered & Named)[];
  compartments: (Ordered & Named)[];
  diseases: (Ordered & Named)[];
  summations: (Ordered & { text: string })[];
  before: (Ordered & EventRef)[];
}

/**
 * A list comprehension's items in their relationship's `order`. Neo4j gives no order to
 * a pattern comprehension, so the order is the relationship's, sorted here.
 */
function byOrder<T extends Ordered>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/** Each event's first five references by `order`, each with its first six authors. */
export async function literature(
  graph: Graph,
  ids: readonly number[]
): Promise<Map<number, Reference[]>> {
  const rows = await graph.read<Reference & { event: number; labels: string[] }>(
    `UNWIND $ids AS id
     MATCH (e:DatabaseObject {dbId: id})-[r:literatureReference]->(p:Publication)
     WHERE e:Event
     WITH id, p, r.order AS ord ORDER BY id, ord
     WITH id, collect(p)[..5] AS firsts
     UNWIND range(0, size(firsts) - 1) AS i
     WITH id, i, firsts[i] AS p
     OPTIONAL MATCH (a:Person)-[ra:author]->(p)
     WITH id, i, p, a ORDER BY id, i, ra.order
     WITH id, i, p, collect(a.displayName) AS authors
     RETURN id AS event, p.dbId AS dbId, labels(p) AS labels, p.title AS title,
            p.chapterTitle AS chapterTitle,
            p.journal AS journal, p.volume AS volume, p.pages AS pages, p.year AS year,
            p.pubMedIdentifier AS pubMedId, p.ISBN AS isbn,
            p.uniformResourceLocator AS url,
            head([(p)-[:publisher]->(f) | f.displayName]) AS publisher,
            authors[..6] AS authors, size(authors) > 6 AS moreAuthors
     ORDER BY event, i`,
    { ids: unique(ids) }
  );
  return group(
    rows,
    (row) => row.event,
    ({ event: _event, labels, ...ref }) => ({
      ...ref,
      kind: labels.includes('Book') ? 'book' : labels.includes('URL') ? 'web page' : 'article',
      chapterTitle: ref.chapterTitle ?? null,
      journal: ref.journal ?? null,
      volume: ref.volume ?? null,
      pages: ref.pages ?? null,
      year: ref.year ?? null,
      pubMedId: ref.pubMedId ?? null,
      isbn: ref.isbn ?? null,
      url: ref.url ?? null,
      publisher: ref.publisher ?? null,
    })
  );
}

/**
 * Each event's edits, each with its authors by `order`. The edit history's rules are the
 * model's, its rows' authors by database id among them (research R2), so it re-sorts them.
 */
export async function edits(graph: Graph, ids: readonly number[]): Promise<Map<number, Edit[]>> {
  const rows = await graph.read<Edit & { event: number }>(
    `UNWIND $ids AS id
     MATCH (e:DatabaseObject {dbId: id})<-[k:authored|edited|reviewed|revised]-(i:InstanceEdit)
     WHERE e:Event
     OPTIONAL MATCH (a:Person)-[ra:author]->(i)
     WITH id, k, i, a ORDER BY id, i.dbId, ra.order
     WITH id, type(k) AS kind, i,
          [x IN collect(a) WHERE x IS NOT NULL | {dbId: x.dbId, name: x.displayName, surname: x.surname}] AS authors
     RETURN id AS event, i.dbId AS dbId, kind, i.dateTime AS dateTime, authors
     ORDER BY event, dbId`,
    { ids: unique(ids) }
  );
  return group(
    rows,
    (row) => row.event,
    ({ event: _event, ...edit }) => ({
      ...edit,
      dateTime: edit.dateTime ?? null,
      authors: edit.authors.map((a) => ({ ...a, surname: a.surname ?? null })),
    })
  );
}

/**
 * Each id once: an event with two parents at one level is in a level's list twice, and
 * read twice it would give every row twice (the first five references among them).
 */
function unique(ids: readonly number[]): number[] {
  return [...new Set(ids)];
}

function group<R, K, V>(rows: readonly R[], key: (row: R) => K, value: (row: R) => V): Map<K, V[]> {
  const grouped = new Map<K, V[]>();
  for (const row of rows) {
    const k = key(row);
    const list = grouped.get(k) ?? [];
    list.push(value(row));
    grouped.set(k, list);
  }
  return grouped;
}
