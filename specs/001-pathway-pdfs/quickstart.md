# Quickstart: proving it

The runs that show spec 001 works, in the order the work builds them. Commands use the
contracts in `contracts/`. Every graph is a private copy, never a shared or production
one. A run's output stays outside the repository when it holds people's names.

## 0. A private graph and the release's files

- **The graph:** a container started from the release's graph image, read-only, on a
  spare loopback port, removed after the runs. Check the disk has room for its store
  first.
- **The files:** the release's diagram files (`<stId>.json` and `<stId>.graph.json`) for
  the pathways with a diagram, its EHLD files and the EHLD summary. Fetched one at a
  time from the release's download directory, kept outside the repository.

## 1. The baseline (research R7)

`event-pdf` at its pinned commit, against the private graph.

- **The human book:**
  `java -Xmx6g -jar event-pdf-exec.jar --host bolt://127.0.0.1:<port> --user <u> --password <p> --dbname graph.db --diagram <files>/diagram --ehld <files>/ehld --summary <files>/ehld/svgsummary.txt --output <out>/TheReactomeBook`.
  Record the wall time, peak memory, and the page count and size of each file and in all.
- **Single events,** as the content service makes them: the harness, with the
  identifier, depth 1 and an optional token. Record the time and pages for a sample of
  pathways of several sizes and of reactions.
- **From the graph:**
  - the counts of figures by kind;
  - the subpathways whose figure would be an EHLD with events selected;
  - whether `event-pdf` overlays reactions.

Expected: numbers for SC-003, SC-005 and research R3 and R4. Measured for release 98 in
research R7.

- **Then, first of the new work** (research R7): the render service's throughput at the
  book's scale against the 44-minute figures budget, go or no-go; the analysis service's
  answers for an expired and a malformed token on a private instance (R6); the join's
  memory and stamping after it (R4).

## 2. CI's own runs

- `npm test`: unit tests, each seen failing first.
- The fixture: the placeholder graph in a Neo4j service, the render stub and the
  analysis stub.
  - `pdf-export book` writes the fixture's book.
  - `pdf-export check-book` passes on it.
  - It fails on each fault of FR-011, planted one at a time (SC-007).
- `ci/licences.ts`: passes, and fails on a planted GPL package and on a planted package
  with no licence (SC-006).
- Prettier and lint.

## 3. A single-event PDF (Story 2)

With `pdf-export serve` beside the deployment's own render service and an analysis
service, private ones on the private graph:

- `GET /event/<pathway>.pdf?depth=0` and `?depth=1`;
- `GET /event/<reaction>.pdf`;
- a non-human event;
- a pathway with a token.

Each opens, has the parts of the spec's Background in order and has bookmarks.
`compare` against `event-pdf`'s PDF of the same event shows only recorded differences.

- **SC-005:** each is timed warm, on the second of two requests with the render
  service's cache off (a cached figure is not a measurement), stage by stage against
  research R7's budget, and in all against R7's single-event times for the same
  events.
- **SC-008:** for a sample of figures, the book's or the PDF's figure against the render
  service's SVG printed alone on a page with the same `@font-face` rules, both drawn by
  pdf.js at the same scale (research R8): no more than 1% of pixels differ.

- **The errors:** an unknown identifier, a non-event, a bad depth, an unknown token, a
  malformed token, an expired token and a token gone within the period each give
  contracts/service.md's answer, and a bad identifier with a bad token gives the
  identifier's.

## 4. The book (Story 1)

`pdf-export book` against the private graph and a render service on the same release.

- `check-book` passes.
- **SC-001:** every top-level pathway and every event, in the contents list and the
  bookmarks.
- **SC-003:** the time against step 1's.
- **SC-004:** it opens in Chromium's viewer, Firefox's viewer and a Poppler-based viewer.
  A sample of bookmarks and links is followed in each.
- **SC-002:** `compare` against `event-pdf`'s book shows only recorded differences.

## 5. The look (Story 6)

- **SC-009, the check:** a sample of pages printed with figures hidden and taken through
  the same join and stamping as the book. Every colour on the result's pages must be in
  the compiled theme, and every font one FR-015 names, the stamped page numbers and
  headers included.
- **SC-009, the judgement:** 12 random pages, including a cover, a contents page and a
  pathway section with its figure, set beside today's book for the judges.

## 6. The release's step (Story 5)

- The image runs with the graph, the release's files, the render service and an output
  folder, and writes one PDF.
- A planted fault fails the step.
- **Story 5, scenario 3:** a release file removed from the folder fails the preflight,
  naming the file, before anything is printed, and no book is written.
- **Story 5, scenario 4:** a character off FR-017's list, planted in a text and then in a
  diagram file's label, fails the preflight, naming it, and no book is written.
- The image's fonts are only FR-015's (its build lists them).
