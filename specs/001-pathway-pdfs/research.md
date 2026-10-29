# Research: Reactome's pathway PDFs from the graph

Measured 29 Oct 2026 unless said otherwise. "Inference" marks what was reasoned, not
measured. Nothing here went to a production service. The reference build of `event-pdf`
and every experiment ran in a private scratch folder, outside the repository.

## R1. The language: TypeScript on Node, throughout

**Decision.** pdf-export is written in TypeScript on Node 24, as one package with two
entry points: the book's command line and the single-event service (R9).

**Rationale.**

- Everything it is built from is TypeScript or Node already:
  - the website's renderer, which draws the figures (R3);
  - Chromium, driven by Playwright, which lays out and prints the PDF (R4);
  - the Neo4j JavaScript driver (Apache-2.0), which reads the graph (R2);
  - the website's own content service, which will call the single-event service.
- graph-core, the only reason for the JVM, has no licence (constitution II).
- TypeScript's strict mode gives the null safety Kotlin would.

**Alternatives considered.** Kotlin for the graph and the sections, with TypeScript for
the figures and the printing: two builds, two dependency trees to check for licences,
and a hand-off between them, for nothing the graph needs.

## R2. What `event-pdf` reads, and the queries that replace it

**Measured from its source** (event-pdf `2c070d5`, the commit WebsiteAngular's
deployment pins; built here against graph-core 2.0.9, which its pom names).

- **The graph's shape** (release 98):
  - `(Pathway)-[:hasEvent {order}]->(Event)`;
  - `(Event)-[:compartment {order}]->`, `-[:disease]->`, `-[:summation]->(Summation {text})`;
  - `(source)-[:inferredTo]->(event)` for what an event was inferred from;
  - `(event)-[:precedingEvent]->(before)`, read backwards for the events after;
  - `(event)-[:literatureReference {order}]->(Publication)`: `LiteratureReference`
    (title, journal, volume, pages, year, pubMedIdentifier), `URL`
    (uniformResourceLocator), `Book` (chapterTitle, `-[:publisher]->` an affiliation);
  - `(Person)-[:author {order}]->(Publication | InstanceEdit)`;
  - `(InstanceEdit {dateTime})-[:authored | edited | reviewed | revised]->(event)`;
  - `(:DBInfo {version})`, and `:TopLevelPathway {speciesName}`.
- **Order today is mostly the database's, not the curators'.** graph-core 2.0.9 loads
  each list below the PDF's root with no `ORDER BY` on the relationship's `order`:
  children (so the sections' order), compartments, literature (so _which_ five are
  shown), summations, diseases and the events before and after. Only the root's own
  `hasEvent` and `compartment` are sorted. `inferredFrom` is a hash set.
- **The top-level pathways** are written in database-id order today. FR-002 asks for
  name order, ignoring case.
- **The cover's names** are written with U+2060 between every character and no-break
  spaces between words, presumably to stop the reader breaking them. A text comparison
  must normalise both.
- **Its parts' rules**, read from its section writers:
  - diseases leave out the one named exactly "disease";
  - an event already written is left out with its whole subtree;
  - references show six authors, then "et al.", and link PubMed;
  - the edit history drops edits with no date or no author, sorts by date then the first
    author's surname, groups edits sharing a date and either a kind or the same authors,
    and orders each row's authors by database id;
  - with an analysis, a reaction's entities and interactors are its first parent
    pathway's, filtered to the reaction's identifiers.
- **The introduction** has fixed text, four of Reactome's papers by year, the release,
  and the counts of distinct pathways and reactions.

**Decision.** pdf-export reads the graph with the Neo4j JavaScript driver, in batched
Cypher (one query per level of the tree, one per part across a level's events), and
sorts every list by the relationship's `order`. The parts' rules above are kept. Where
today's order is the database's, the new order is the curators', and FR-012's comparison
treats list order as an expected difference (spec amended, Assumptions).

**Alternatives considered.** graph-core: no licence, and the JVM (R1). The content
service's HTTP API: it is the website's, built for pages, and the book would put tens of
thousands of requests on it.

## R3. The figures: the website's render service

**Measured.** WebsiteAngular's renderer has three layers:

- the render page in the built site (`/PathwayBrowser/render/{id}`);
- `render-core`, which drives a page;
- a command line and an HTTP service.

Only the render page draws. It needs the built site, its content service (two of whose
calls are still Java's: the events hierarchy and the reaction layout), and the release's
diagram and EHLD files.

- **What it draws:**
  - a pathway's diagram;
  - a subpathway in its ancestor's diagram (`highlight=`);
  - an EHLD;
  - a reaction (`layout=reaction`);
  - an analysis overlay by token.
- **What it cannot draw yet** (WebsiteAngular changes, R10):
  - an ancestor's diagram with events selected when that ancestor has an EHLD, since
    highlighting an illustration throws and nothing forces the plain diagram (no human
    pathway at release 98 needs one, R7);
  - an overlay on a reaction's own drawing (the reaction component never reads the
    analysis, and `event-pdf` overlays reactions, R7).
- **SVG** stays vector in Chromium's PDF when inlined.
  - Diagrams carry text in Roboto without the font embedded, and node shapes as small
    PNGs.
  - EHLDs are all outlines.
  - Two figures on one page share ids such as `clip-1`. Inlined together, they change
    each other's drawing: 13.6% of one figure's pixels in one measurement. Every id is
    prefixed per figure.
- **Time per figure** (through beta's render service, uncached): diagrams 3.4–5.0 s, a
  subpathway's selection 4.1 s, a reaction 2.6 s, an EHLD 2.2–2.4 s. On a page that is
  reused, a reaction takes 0.65 s and a diagram 2.8–4.0 s.
- **The human book's figures:** 19,313, counted from the graph (R7). That is about 9 h
  through the service as it is, at its concurrency of 2, or 1.5–2 h with four reused
  pages (inference, from these times).
- **A licence trap.** The built site carries FoamTree, under Carrot Search's commercial
  licence, in a chunk every render loads. pdf-export cannot ship the built site in its
  own image (constitution II).

**Decision.** pdf-export asks a render service for each figure, over HTTP, as SVG. It
never ships the website's code.

- **For the website's PDF:** beta's render service, beside the content service that
  calls pdf-export.
- **For the book:** the release step runs WebsiteAngular's render service (with its
  content service) on the release's graph and files, as a neighbour of pdf-export's
  container.
- **The service's limits are settings,** for the book's run, rather than beta's
  defaults: concurrency, queue and timeout. Its cache is turned off for the run.
- **pdf-export prefixes every SVG id** before it inlines the figure.

**Alternatives considered.**

- _pdf-export drives the render page itself:_ it would ship the built site, and with it
  FoamTree. WebsiteAngular could publish a render bundle without FoamTree. That is the
  better long-term shape and needs a WebsiteAngular spec; it is noted under R10.
- _The old Java exporters' figures:_ against constitution IV.

**Open, for the release's owners:** the release step then needs WebsiteAngular's render
and content services on the release's graph. The time measured in R7 decides whether the
book is made beside the website's own release testing, or by its own step.

## R4. Layout and printing: HTML and paged CSS, printed by Chromium in parts

**Measured** with Playwright 1.64 (Chromium 156), pdf-lib 1.17 and pdfjs 6.4, on
synthetic documents, on this host under load.

- **One pass does not scale.** 500 pages printed in 9.7 s at 1.3 GB; 1,990 pages in 61 s
  at 3.9 GB. 4,930 pages passed 6 GB and was stopped. Inference: 9–10 GB.
- **Parts, joined, do.** 4,930 pages in 26 parts of about 190 printed in 88 s, or 53 s
  four at a time, with Chromium's peak at 0.8 GB, or 2.1 GB with four. The join took
  6 s and gave a 120 MB file.
- **Joining breaks internal links** (pdf-lib's `copyPages`). This works instead, and
  resolved 21,375 links of 21,375:
  - every internal link is printed as a placeholder URI;
  - a 1-pixel probe link inside each target gives its page;
  - after the join, each placeholder becomes a real destination and the probes are
    removed.
- **Bookmarks.** Chromium writes nested bookmarks only with `outline` and `tagged`
  together. A joined file loses them, and its tagging. pdf-lib has no outline API, but
  writing the outline's dictionaries directly works: 7,126 nested entries, each landing
  on its page.
- **Paged CSS in Chromium:**
  - works: `@page` size (A4 must be set) and margins; margin boxes with literal text and
    page counters; named pages, one per chapter, for running headers;
    `break-inside: avoid` for figures;
  - does not work: `string-set`, running elements, `target-counter()` and `leader()`.
- **Contents page numbers** come from a second pass. The first pass prints fixed-width
  placeholders; each section's page is read back; the front part is printed again. Page
  counts and anchors were identical between the passes.
- **Page numbers across parts:** `html { counter-reset: page N }` starts a part at N+1.
  "Of M" must be literal text.
- **A single-event PDF of about 30 pages** printed in 0.7 s with bookmarks and tagging,
  on a browser already running.
- **A trap:** `setContent` cannot load fonts from `file://`, and the text silently falls
  back to the system's. Pages are loaded with `goto` on a file.

**Decision.**

- **The book:**
  - one part per top-level pathway, split at section boundaries when one runs past about
    200 pages;
  - printed untagged, a few at a time, then joined;
  - links rewritten, and the outline written by pdf-export, which it needs anyway: in the
    book, an event's later places point at its one section (FR-004), which Chromium's
    headings would not do;
  - the contents list numbered by the second pass.
- **A single-event PDF:** one pass, tagged, with Chromium's own bookmarks.
- **pdf-lib:** the maintained MIT fork `@cantoo/pdf-lib`, if it passes the same tests;
  otherwise pdf-lib 1.17.

**Alternatives considered.**

- _One pass:_ out of memory at the book's size.
- _A paged-media engine with `target-counter`_ (Prince, WeasyPrint): commercial, or AGPL
  and outside Node.
- _Paged.js:_ a polyfill that lays out in the page's script, untested at thousands of
  pages; kept in reserve for the contents list's numbers.

## R5. The website's look: its theme as a dependency, its fonts embedded

**Measured.**

- **The theme compiles without Angular itself.** The website's theme package, with Sass
  and Angular Material's Sass (`@angular/material` and `@angular/cdk`), compiles in
  0.6 s to CSS variables: 160 `--mat-sys-*` values in the light theme, 29 distinct
  colours as hex. For example: primary `#006781`, on-primary `#ffffff`, tertiary
  `#1660a5`, surface `#effbff`, on-surface `#001f25`, surface-container-lowest
  `#ffffff`, outline `#6d797f`.
- **Its install is 25 packages** (76 MB, Angular's packages as peers). All are under
  allowed licences, except the theme package, which declares none; its repository is
  CC0.
- **The fonts:** Roboto, Roboto Mono and Noto Sans from `@fontsource`, each OFL-1.1 with
  its licence file. Chromium embeds subsets of them.
- **Fallback is silent.** A character none of the three has is drawn in whatever the
  system has: on this host, Liberation Serif for an arrow, DejaVu Sans for a check mark.
- **The website's diagrams ask for Roboto at weight 600**, which the site does not load.

**Decision.**

- **Colours:** the build compiles the theme to CSS variables, from the theme package
  pinned in the lockfile, and the stylesheet uses only those variables. No colour value
  is written in pdf-export's own code (FR-015). The page is surface-container-lowest
  (white). The theme's `color-mix()` surfaces are not used, since their colours are not
  in the palette.
- **Fonts:**
  - Roboto (300, 400, 500 and 600, so the diagrams' labels get their own weight) and
    Roboto Mono, from `@fontsource`;
  - Noto Sans, plus Noto Sans Symbols 2 and Noto Sans Math for arrows and signs, all
    OFL-1.1;
  - the container carries no other font, so nothing can fall back to one;
  - the check of FR-011 and SC-009 lists every font in the PDF.

**Alternatives considered.**

- _A copy of the palette's values:_ against FR-015.
- _Fonts from Google's servers at print time:_ the release step would depend on a third
  party, and a failure would fall back silently.

## R6. The analysis overlay: through the analysis service's API

**Measured from the source.**

- **Results are stored as Kryo 5.3.0 files,** named after the token, with class names as
  strings. A TypeScript reader would depend on the analysis library's internal Java
  fields, and would break silently when they changed.
- **The analysis service's API reads the same files by the same rules:**
  - 404 for an unknown token, and 410 for one gone within its retention, judged by the
    date inside the token;
  - `/token/{token}` gives the summary, the resource summary, the not-found count and the
    pathways hit;
  - `/token/{token}/found/entities/{pathway}` and `/found/interactors/{pathway}` give the
    found lists, a 404 meaning none;
  - `/download/{token}/result.json` gives the count of identifiers found.
- **Today's errors:** a malformed token throws an unhandled Base64 error, and the
  content service answers it with an empty response, as it does the other token errors.
- **The render page** reads the same API for its overlays.

**Decision.**

- pdf-export reads the analysis through the analysis service's API, at an address that
  is a setting. It is the same service, reading the same files by the same rules, and
  the render page reads it too, so a PDF's figures and its text agree.
- FR-007's wording ("from where the analysis service writes it") is amended to "through
  the analysis service that holds it".
- In tests, a private instance, or a stub of its answers.

**Alternatives considered.** A Kryo reader in TypeScript: tied to Java's internals.

## R7. How long, and how big: the baseline

**Measured** on 29 Oct 2026, on a private, read-only copy of release 98's graph on this
host. `event-pdf` was built at its pinned commit, with `reaction-exporter` 1.2.9's
snapshot in place of 1.2.8: only a Reactome-hosted repository serves 1.2.8, and the
figures are not what this baseline compares. The release's diagram files, EHLD files and
EHLD summary were fetched one at a time from the release's download directory, for the
human pathways that have a diagram: 2,780 files and 221 illustrations, 373 MB.

- **The human book,** by `event-pdf`'s command line (`-Xmx6g`):

  | Measure              | Value                         |
  | -------------------- | ----------------------------- |
  | Wall time            | 1 h 18 min 41 s (4,721 s)     |
  | Peak resident memory | 4.7 GB                        |
  | Files                | 29, one per top-level pathway |
  | Pages                | 23,541                        |
  | Size                 | 1.42 GB                       |
  | Smallest file        | 44 pages, 1.1 MB              |
  | Largest file         | 3,760 pages, 383 MB           |
  - Two diagrams could not be inserted (an index error in the diagram exporter). The
    rest of the log is iText's licence notice, 33 times.
  - The figures are about half the size: the old exporters write raster images.

- **Single events at depth 1,** as the content service makes them, timed on the second
  of two runs in one JVM (the service's JVM is warm):

  | Event                                          | Pages  | Time         |
  | ---------------------------------------------- | ------ | ------------ |
  | Five reactions, one of each kind               | 3 each | 0.5–1.7 s    |
  | Pathways with 1–34 reactions beneath them      | 5–19   | 1.3–3.8 s    |
  | Pathways with 143–1,150 reactions beneath them | 10–15  | 4.4–9.5 s    |
  | Signal Transduction                            | 30     | 46 s (15 MB) |

  A cold JVM, as the command line starts, took 11–21 s for a reaction.

- **The figures the human book needs,** from the graph:

  | Kind                                                                | Count  |
  | ------------------------------------------------------------------- | ------ |
  | Pathways with a diagram of their own                                | 1,390  |
  | of which illustrations (EHLD)                                       | 220    |
  | Pathways drawn in their nearest ancestor's diagram, events selected | 1,499  |
  | of which that ancestor has an EHLD                                  | 0      |
  | Reactions                                                           | 16,424 |
  | In all                                                              | 19,313 |

  None of release 98's human pathways needs an ancestor's illustration with events
  selected, which the render service cannot draw (R10). That gap does not touch the human
  book at this release; the book's check would find it if it ever does.

- **Overlays on reactions:** `event-pdf` overlays the analysis on a reaction's figure too
  (`Diagrams.insertReaction` passes the result to the diagram exporter). So the render
  service's reaction drawing needs its overlay (R10) before the website's PDF matches
  today's with an analysis.

**What this sets.**

- **SC-003:** the book in no more than 1 h 18 min on this host, against this baseline.
- **SC-005:** each single-event PDF in no more time than these, warm.
- **Figures:** 19,313 for the book. At R3's measured times, through the render service
  as it is, that is about 9 hours at its concurrency of 2. So the release's run needs the
  service's concurrency raised and its pages reused, as R3 decides. With four reused pages
  the estimate is 1.5–2 hours, still over SC-003's budget. The first tasks measure the
  render service's throughput with those settings. If it cannot meet the budget, the
  plan's answer is more render workers, not fewer figures.
- **Parts:** the largest top-level pathway is 3,760 pages today. At about 200 pages a
  part (R4), it is split within its chapter, at section boundaries.

## R8. The checks: by meaning, with tools under loose licences

**Measured.** pdfjs-dist (Apache-2.0) reads what the checks need:

- each piece of text, with the font it is drawn in;
- the structure tree of a tagged PDF;
- the outline;
- every link and its target: the 4,930-page test book's 21,375 links and 7,126
  bookmarks were checked in 84 s;
- fill and stroke colours, from operator lists.

Marked content does not separate figures from layout. Printing the same HTML with the
figures hidden gives the same pages, and only the layout's colours: `#006781`,
`#001f25` and `#ffffff` in the test, each a theme colour. pdf-lib shows which fonts are
embedded.

**Decision.**

- **FR-011's check** (`check-book`) reads the book with pdfjs: every top-level pathway
  present, every event in the contents and the bookmarks, every section named and
  identified, every figure present where its source exists, every link landing on a
  page. Each fault is seen to fail once (SC-007).
- **FR-012's comparison** (`compare`) reduces both PDFs to the parts FR-012 lists.
  - It normalises the cover's hidden characters and white space.
  - It treats list order as a recorded difference.
  - It prints counts and hashes of names, never names (FR-013).
  - It is run in development against `event-pdf`'s output, never in the release.
- **SC-009's check** prints a sample with figures hidden, and compares every colour with
  the compiled theme and every font with FR-015's.

**Alternatives considered.** Poppler's or MuPDF's tools: GPL and AGPL, so not
dependencies, though a person may use them to look.

## R9. Shape: one package, a command line and a service

**Decision.**

- **One TypeScript package, two entry points:**
  - `pdf-export book`, the release's command line: graph, files, render service and
    output path in, `TheReactomeBook.pdf` and a run report out;
  - `pdf-export serve`, an HTTP service for the website: `GET /event/{stId}.pdf` with
    depth and token, answering a PDF or the errors of Story 2's scenario 4.
- **WebsiteAngular's content service calls it** as it calls the Java library service
  for SBML. The website's part (routes, parameters, envelope, caching) is in
  WebsiteAngular's specs (FR-014).
- **One container image,** for both.
- **CI:** type checks, lint, the unit tests, a fixture graph (a Neo4j service seeded
  from a placeholder fixture, with no real names, as BioPAX3Exporter's CI does), the
  render service stubbed with recorded SVGs, the licence check and Prettier.

**Alternatives considered.** A library that WebsiteAngular's content service imports:
it would bring Chromium into that service's image, and the release would need a second
packaging.

## R10. What WebsiteAngular must change (its own specs)

- **The plain diagram on demand.** A render option to draw an ancestor's diagram, not
  its EHLD, with events selected. Release 98's human book needs none (R7), so this
  waits until a release does. Until then such a figure would be the ancestor's EHLD
  without a selection, recorded as a difference.
- **An overlay on a reaction's drawing:** `event-pdf` overlays reactions today (R7), so
  the website's PDF with an analysis needs it.
- **The render service's limits as settings** for a batch run (R3).
- **The single-event route** in the content service, nginx and the dev proxy (FR-014).
- **Later:** a render bundle without FoamTree, which would let pdf-export draw figures
  in its own process.

## R11. Licences, checked in CI

**Measured.**

- `npm query '*'` lists every installed package with its licence and whether it is for
  development only, in 0.6 s.
- `license-checker-rseidelsohn` stops at its first offender, and its own dependencies
  bring in CC-BY-3.0.

**Decision.** A short check of our own, `ci/licences.ts`:

- an allowlist (MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0, ISC, 0BSD, OFL-1.1,
  CC0-1.0, Zlib);
- SPDX expressions, such as pako's `(MIT AND Zlib)`;
- one documented exception: the website's theme package, CC0 by its repository;
- every offender listed, not only the first;
- the fonts' licence files checked too (FR-009).

It is shown failing on a GPL package and on a package with no licence (SC-006).
