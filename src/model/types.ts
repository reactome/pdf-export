// The document model (spec 001 T015, data-model.md): what the graph's rows become, before
// any layout. The book and a single event's PDF are both made of these.
import type { EventFacts, EventRef, Reference } from '../graph/queries.ts';

export interface Release {
  version: number;
  /** The distinct pathways and reactions the PDF holds, for the introduction. */
  pathways: number;
  reactions: number;
}

/** What draws an event's figure (data-model.md's Figure). */
export type Figure =
  | { kind: 'diagram'; stId: string }
  | {
      kind: 'ehld';
      stId: string;
      /** Set when an ancestor's illustration stands in, unselected. */ unselectedFor?: string;
    }
  | { kind: 'ancestor'; stId: string; highlight: string[] }
  | { kind: 'reaction'; stId: string };

/** A row of the edit history: one date, its kinds and its authors (research R2). */
export interface EditRow {
  date: string;
  kinds: string[];
  authors: string[];
}

/**
 * An event's facts as a section holds them: its lists that have rules (summations,
 * diseases, inferred-from) are the section's own, filtered and ordered, not these.
 */
export type SectionEvent = Omit<EventFacts, 'summations' | 'diseases' | 'inferredFrom'>;

/** One event's full section. */
export interface Section {
  anchor: string;
  event: SectionEvent;
  /** The pathways above it in this PDF, outermost first. */
  path: EventRef[];
  figure: Figure | null;
  diseases: string[];
  inferredFrom: (EventRef & { speciesName: string })[];
  summations: string[];
  references: Reference[];
  edits: EditRow[];
  /** Its depth in the document: 0 for a chapter's or the PDF's own event. */
  depth: number;
}

/** A place in the document order: an event's one full section, or a short entry to it. */
export type Place =
  | { full: true; section: Section }
  | { full: false; anchor: string; event: EventRef; path: EventRef[]; depth: number };

export interface Cover {
  title: string;
  /** The book's release, or none for a single event. */
  release: number | null;
  /** A single pathway's diagram. */
  figure: Figure | null;
  /** Whether it notes that the PDF is an excerpt of the book. */
  excerpt: boolean;
  /** The distinct authors of the edits of every event the PDF holds, sorted, each once. */
  names: string[];
}

export interface ContentsEntry {
  title: string;
  /** The anchor it points at: a full section's, or a front part's. */
  target: string;
  depth: number;
}

export interface Document {
  kind: 'book' | 'single';
  release: Release;
  cover: Cover;
  /** Every place in document order; a book's chapters are its top-level pathways. */
  places: Place[];
  /** A single event's PDF at depth 0, or a reaction alone, has none (the Background). */
  contents: ContentsEntry[] | null;
}
