# Data model: from the graph to the page

The model is what `src/graph` builds from the graph and `src/layout` writes as HTML. It
holds no layout. Each entity says where its values come from (research R2) and the rules
that apply to it.

## Release

- `version`: from `(:DBInfo).version`.
- `counts`: the distinct pathways and reactions the PDF holds, for the introduction.
- `files`: the release's folder (`--files`): its EHLD summary, read to choose figures,
  and the diagram and EHLD files the preflight expects (contracts/cli.md).
- `site`: the website's address, for FR-003's links to its pages (a setting, never
  fetched).

## Event

One pathway or reaction-like event.

| Field                  | From                                                             | Rules                                                                                       |
| ---------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `dbId`, `stId`, `name` | the node                                                         | `name` is its display name                                                                  |
| `kind`                 | labels                                                           | `Pathway` or `ReactionLikeEvent`; anything else is not an event (Story 2, scenario 4)       |
| `species`              | `-[:species]->`, first by `order`                                | the overlay's species (FR-006)                                                              |
| `reactionType`         | `category`                                                       | reactions only                                                                              |
| `compartments`         | `-[:compartment]->`                                              | by `order`                                                                                  |
| `diseases`             | `-[:disease]->`                                                  | by `order`; one named exactly "disease" is left out, as today                               |
| `inferredFrom`         | `(source)-[:inferredTo]->`                                       | each with its species; sorted by species name, then name (today's is a hash set)            |
| `summations`           | `-[:summation]->(Summation).text`                                | by `order`; HTML, sanitised to the tags the website's pages allow                           |
| `before`, `after`      | `-[:precedingEvent]->`, and the same relationship read backwards | reactions only; only events the PDF holds are shown                                         |
| `references`           | `-[:literatureReference]->`                                      | the first five by `order`. Each has its authors by `author.order`: six shown, then "et al." |
| `edits`                | `(InstanceEdit)-[:authored, edited, reviewed or revised]->`      | grouped and sorted as today (research R2)                                                   |
| `children`             | `-[:hasEvent]->`                                                 | pathways only, by `order`                                                                   |
| `hasDiagram`           | the node                                                         | chooses the figure (Figure)                                                                 |

## Section

One event's pages in one PDF, or a short entry pointing at them.

- `event`: the Event.
- `path`: the pathways above it in this PDF's traversal, for its location. Each links to
  its section when the PDF holds it (FR-003).
- `full`: true at an event's first place in document order. Elsewhere it is a short
  entry: the name and stable identifier, linked to the full section (FR-004).
- `anchor`: `s-{stId}`, unique in the PDF.
- `figure`: the Figure, or none.
- `found`: with an analysis, the entities and interactors found (Analysis).

**Parts, in order** (FR-005): name, location, stable identifier, type, compartments,
diseases, inferred from, figure, summations, before and after, references, edit history,
then what the analysis found.

**State:** each event has exactly one full Section per PDF. An event's subtree is written
beneath its first place only. At a later place, the outline and the contents list hold
the short entry alone, pointing at the full section, and not its subtree again.

## Figure

- `kind`:
  - `diagram`: its own;
  - `ancestor`: its nearest ancestor's diagram, with its events selected;
  - `ehld`: the illustration, where the EHLD summary names the chosen diagram;
  - `reaction`: a reaction's own drawing.
- `source`: the stable identifier the render service draws, with `highlight` ids for
  `ancestor`.
- `svg`: the drawing, every id prefixed with the section's anchor.
- `scale`: its size on the page, from which its labels' size follows (16 px in the SVG).
  At least 5 pt, or a landscape page of its own; below that only for a diagram too large
  for any page, listed in the run report (research R4).
- `overlay`: the analysis token, when there is one.

**Choosing a pathway's figure** (research R2, as graph-core does today):

1. Its own diagram, if it has one.
2. Otherwise its nearest ancestor with a diagram, with the reactions reached without
   crossing another diagram selected. Among several parents, the ancestor nearest a
   top-level pathway wins.
3. The EHLD in place of the chosen diagram where the summary names it.

Where the chosen diagram is an EHLD and events would be selected, the render service
cannot draw it yet (research R10). The figure is the EHLD unselected, and the
difference is recorded.

**A figure that cannot be drawn:** in the book, the step fails (FR-011). In a
single-event PDF, the section is written without it and the absence is logged (Edge
Cases).

## Cover

- `title`:
  - the book's: "The Reactome Book" and the release (FR-002);
  - a single-event PDF's: the event's name.
- `figure`: a pathway's diagram (single-event only).
- `names`: the distinct authors of the edits of every event the PDF holds, sorted by
  name, each once.
- `excerpt`: true for a single pathway at depth 1 or less. Its note points at the book.
- `statements`: Reactome's institutions and licence, and the date.

## Contents

- `entries`: the introduction, the analysis properties (with an analysis), each place an
  event appears pointing at its one full Section, and last the contents list itself.
- `pages`: each entry's page, filled by the second pass (research R4), in the book and
  in a single-event PDF alike.
- Left out for a reaction alone or at depth 0, as today. Bookmarks are written in every
  PDF (FR-006).

## Book

- `release`, `cover`, `introduction`, `contents`.
- `chapters`: one per top-level pathway, by name ignoring case. Each is printed as one
  part or more (research R4).
- `outline`: nested as the chapters' trees. An event's later places point at its full
  Section (FR-004).

## SingleEventPdf

- `root`: the Event.
- `depth`: 0 or 1, 1 by default.
- `analysis`: optional.
- Otherwise as Book, with one root and no chapters.

## Analysis

From the analysis service's API (research R6).

- `token`, `type`, `species`, `resource` (`TOTAL`), `projection`, `interactors`.
- **Requested with FR-006's defaults:** all resources together, no expression column, all
  identifiers rather than only importable ones.
- `identifiersFound`, `identifiersTotal`, `pathwaysHit`. Found from the summary if it
  carries it, otherwise from the result file (research R6).
- `found(pathwayStId)`: the entities and interactors found. A reaction uses its first
  parent pathway's, filtered to the reaction's own identifiers.
- **Errors:** checked here before the service is asked (research R6): a malformed token
  or one past the retention period is unknown; the service's 404 is unknown, its 410
  gone. The identifier is checked first.

## Run report

What the book's step and the service log.

- `release`, the time taken, the page count and the size.
- Figures by kind, and those missing, by stable identifier.
- Figures below the legibility floor, by stable identifier.
- Release files missing, by name, from the preflight.
- Each stage's time, against research R7's budget.
- Each FR-011 check, and its result.
- No names (FR-013).
