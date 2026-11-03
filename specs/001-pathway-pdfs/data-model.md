# Data model: from the graph to the page

The model is what `src/graph` builds from the graph and `src/layout` writes as HTML. It
holds no layout. Each entity says where its values come from (research R2) and the rules
that apply to it.

## Release

- `version`: from `(:DBInfo).releaseNumber` (`version` reads null on release 98).
- `checksum`: from `(:DBInfo).checksum`, present on release 98; the figures' folder's
  fingerprint (contracts/figures.md). Missing, it is a fault, never a match.
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
- `svg`: the drawing, every id prefixed with the section's anchor, and its labels' text
  after FR-017: the list substituted, and in a PDF made on request any other character
  no font draws replaced by U+FFFD (in the book, such a character is a fault).
- `scale`: its size on the page, from which its labels' size follows (12 px for node labels in the SVG; the smallest sets it).
  As large as the page allows: the portrait text, or a landscape page of its own where that
  prints it larger. Below 1 pt even so, it is listed in the run report (research R4).
- `link`: its interactive form on the website (FR-003).
- `overlay`: the analysis token, when there is one.

**Choosing a pathway's figure** (research R2, as graph-core does today):

1. Its own diagram, if it has one.
2. Otherwise its nearest ancestor with a diagram on each path up (none between), with the
   reactions reached without crossing another diagram selected. Among several, as
   graph-core does today: the one nearest a top-level pathway below it wins, a top-level
   pathway itself last (graph-core gives it no level, and Neo4j sorts that last), then the
   smaller database id.
3. The EHLD in place of the chosen diagram where the summary names it.

Where the chosen diagram is an EHLD and events would be selected, the render service
cannot draw it yet (research R10). The figure is the EHLD unselected, and the
difference is recorded.

**A figure that cannot be drawn:** for the book, the figures' step fails, and the book's
preflight would fail on its missing file (contracts/figures.md). In a
single-event PDF, the section is written without it and the absence is logged (Edge
Cases).

## Cover

- `title`:
  - the event's name: the top-level pathway's in each of the book's PDFs (FR-002), the
    event's in a single-event PDF.
- `figure`: a pathway's diagram.
- `names`: the authors of the edits of every event the PDF holds, each name once (as
  `event-pdf` removes duplicates, by name), sorted by code units, case and all.
- `excerpt`: true for a single pathway at depth 1 or less. Its note points at the book.
- `statements`: Reactome's institutions and licence, and the date.

## Contents

- `entries`: the introduction, the analysis properties (with an analysis), each place an
  event appears pointing at its one full Section, and last the contents list itself.
- `pages`: each entry's page, filled by the second pass (research R4), in the book's
  PDFs and in a single-event PDF alike.
- Left out for a reaction alone or at depth 0, as today. Bookmarks are written in every
  PDF (FR-006).

## Book

The release's folder of PDFs, one `BookPdf` per human top-level pathway (FR-001), named
as today's (the pathway's name and `.pdf`). A name a file system cannot hold (holding
`/` or NUL), or two names equal ignoring case, is a preflight fault `bad-file-name
<stId>`; none of today's does.

In the code (`src/model/types.ts`), a book's PDF and a single event's PDF are one
`Document` with `kind: 'book' | 'single'`; its `places` hold the pathway's tree in
document order, and `contents` is a list of `ContentsEntry`. (Until T048, the code's
`'book'` document holds every top-level pathway as chapters of one PDF.)

## BookPdf

- `release`, `cover` (its top-level pathway's), `introduction`, `contents`.
- `root`: the top-level pathway, in full depth. A file past about 200 pages is printed
  in parts (research R4).
- `outline`: nested as the pathway's tree. An event's later places in this PDF point at
  its full Section (FR-004); an event is in full in every PDF that holds it.

## SingleEventPdf

- `root`: the Event.
- `depth`: 0 or 1, 1 by default.
- `analysis`: optional.
- Otherwise as BookPdf, but printed whole and tagged, with no parts or join (research R4).

## Analysis

From the analysis service's API (research R6).

- `token`, `type`, `species`, `resource` (`TOTAL`), `projection`, `interactors`.
- **Requested with FR-006's defaults:** all resources together, no expression column, all
  identifiers rather than only importable ones.
- `identifiersFound`, `identifiersTotal`, `pathwaysHit`. Found is the count of distinct
  submitted identifiers in the found identifiers' CSV (header skipped), as
  `/token/{token}` carries none; the total adds its `identifiersNotFound`; the pathways
  hit are its `pathwaysFound`, asked for with `includeDisease=true` (research R6).
- `found(pathwayStId)`: the entities and interactors found. A reaction uses its first
  parent pathway's, filtered to the reaction's own identifiers.
- **Errors:** the token's form is checked here before the service is asked (research
  R6): a malformed token is unknown; the service's 404 is unknown, its 410 gone, and
  whether a token has expired is the service's to say. The identifier is checked first.

## Run report

What the book's step and the service log. The figures' step writes its own: figures by
kind, each kind's times, the release, those it could not draw, by stable identifier and
cause (`unanswered`, `failed`, `refused`, `invalid` or `label`, contracts/figures.md), and, if it stopped at once, why.

- `release`, the time taken, and the page count and size of each PDF and in all.
- Figures by kind, and those missing or stale in the figures' folder, by stable identifier.
- Figures whose labels print below 1 pt, by stable identifier (research R4).
- Release files missing, by name, from the preflight.
- Characters FR-017's list replaced, by code point and count; characters off the list, by
  code point and stable identifier (a fault in the book, U+FFFD in a PDF made on request).
- Each stage's time, against research R7's budget.
- Each FR-011 check, and its result.
- No names (FR-013).
