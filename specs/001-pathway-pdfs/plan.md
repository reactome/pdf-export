# Implementation Plan: Reactome's pathway PDFs from the graph

**Branch**: `001-plan` | **Date**: 2026-10-29 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-pathway-pdfs/spec.md`

## Summary

pdf-export writes Reactome's pathway PDFs from the Neo4j graph, in place of `event-pdf`,
in TypeScript on Node (research R1).

- **Reading the graph:** batched Cypher, with every list in the curators' order (R2).
- **Figures:** SVG, from the website's render service, so they are the website's own
  drawings (R3).
- **Layout:** HTML in the website's theme and fonts, compiled from the website's theme
  package (R5).
- **Printing:** Chromium prints the HTML. The book is printed in parts of about 200
  pages, joined, its links rewritten and its bookmarks written by pdf-export (R4). A
  single-event PDF is printed in one tagged pass.
- **The analysis overlay:** read through the analysis service's API (R6).
- **Packaging:** one package with a command line for the release's book and an HTTP
  service for the website's PDF, in one container image (R9).
- **Proof:**
  - a check of the book that can fail (FR-011);
  - a comparison with `event-pdf` by meaning (FR-012);
  - a colour and font check (SC-009);
  - a licence check over what is installed (R11).

## Technical Context

**Language/Version**: TypeScript 5 (strict) on Node 24 LTS.

**Primary Dependencies**, each under a licence FR-009 allows:

| Dependency                                                                        | Licence                        | Role                               |
| --------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------- |
| `neo4j-driver`                                                                    | Apache-2.0                     | reading the graph                  |
| `playwright-core` with Chromium                                                   | Apache-2.0, BSD                | layout and printing                |
| `@cantoo/pdf-lib`, or pdf-lib 1.17                                                | MIT                            | joining parts, links, outline      |
| `pdfjs-dist`                                                                      | Apache-2.0                     | the checks                         |
| `sass`, `@angular/material`, `@angular/cdk` and the website's theme package       | MIT, and CC0 by its repository | compiling the theme, at build time |
| `@fontsource` Roboto, Roboto Mono, Noto Sans, Noto Sans Symbols 2, Noto Sans Math | OFL-1.1                        | fonts                              |
| `express`                                                                         | MIT                            | the website's service              |

**Storage**: none of its own. It reads:

- the graph (Bolt);
- the release's diagram and EHLD files and EHLD summary, through the render service;
- analysis results, through the analysis service.

It writes the PDF.

**Testing**: Node's test runner (`node --test`), on TypeScript. CI also runs:

- a fixture graph, seeded from a placeholder Cypher fixture with no real names;
- a stub render service answering recorded SVGs;
- a stub analysis service answering recorded JSON.

**Target Platform**: a Linux container (Debian, with Playwright's Chromium and only the
fonts above), run by the release and beside the website's services.

**Project Type**: a command line and a web service, from one package.

**Performance Goals**:

- **SC-003:** the book in no more time than `event-pdf` takes, measured first (R7).
- **SC-005:** a single-event PDF at depth 1 in no more time than `event-pdf`'s.
- **Figures dominate:** about 18,700 for the human book (inference, R3), so the render
  service's concurrency is the main lever.

**Constraints**:

- **Memory:**
  - The book's printing peaks under 2.5 GB at four parts at once (R4: 2.1 GB measured
    with synthetic parts; real figures are heavier, so it is re-measured).
  - A single-event PDF stays under 1 GB.
- **No network** but the graph, the render service and the analysis service. Fonts are
  local (R5).
- **No names** in fixtures, logs or comparison output (FR-013).

**Scale/Scope**: the human book holds every top-level pathway in full depth:

- about 2,700 pathways and 16,000 reactions (inference, R3);
- thousands of pages, measured in R7's task.

## Constitution Check

_GATE: checked before research and again after design._

| Principle                          | How the plan meets it                                                                                                                                                                                                                                                                                                     | Status                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| I. One implementation              | One package; the book's command line and the website's service share every module but their entry points (R9).                                                                                                                                                                                                            | Pass                              |
| II. Loose licences only            | Every dependency is allowed. graph-core is not used (R2). The website's built code, which carries FoamTree under a commercial licence, is never shipped: figures come from its service (R3). The theme package's missing licence field is the one documented exception (CC0 by its repository). CI checks licences (R11). | Pass, with the exception recorded |
| III. The graph, nothing relational | The graph, the release's files, and the analysis service's API, which reads its own result files (R6).                                                                                                                                                                                                                    | Pass                              |
| IV. The pathway browser's look     | Figures are the website's render service's SVGs (R3). Two kinds it cannot draw yet are recorded differences until WebsiteAngular adds them (R10).                                                                                                                                                                         | Pass, with R10's gaps tracked     |
| V. Verify the instrument           | Each check (FR-011, FR-012, SC-009, the licence check) is shown failing on a planted fault before it is relied on. Every fix comes with a test seen failing.                                                                                                                                                              | Pass                              |
| VI. No production                  | A private copy of the release's graph. The published book is fetched once, only for comparison. The render and analysis services are beta's or private ones, never production's.                                                                                                                                          | Pass                              |
| VII. No names                      | The fixture graph uses placeholders. The comparison prints counts and hashes (R8).                                                                                                                                                                                                                                        | Pass                              |

**After design:** unchanged. The render service is a new dependency of the release's
step, which constitution I–VII allow. It is raised with the release's owners (R3, open).

## Project Structure

### Documentation (this feature)

```text
specs/001-pathway-pdfs/
├── spec.md
├── plan.md              # this file
├── research.md          # R1–R11
├── data-model.md        # the document model, from the graph to the page
├── quickstart.md        # runs that prove it, and R7's baseline commands
├── contracts/
│   ├── cli.md           # pdf-export book, check-book, compare
│   ├── service.md       # GET /event/{stId}.pdf, for the website
│   └── render.md        # what pdf-export asks of the render service
├── checklists/
│   └── requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── graph/          # the Neo4j driver, the queries (R2), mapping rows to the model
├── model/          # Event, Section, Book, SingleEventPdf (data-model.md)
├── figures/        # the render service's client, id prefixing, figure choice
├── analysis/       # the analysis service's client
├── layout/         # HTML templates for each part, the compiled theme, fonts
├── print/          # Chromium printing, parts, joining, links, outline, contents
├── check/          # check-book (FR-011), the SC-009 colour and font check
├── compare/        # compare (FR-012): both PDFs reduced to their meaning
├── cli.ts          # pdf-export book | check-book | compare
└── serve.ts        # pdf-export serve: the single-event service
theme/
└── pdf-theme.scss  # @use of the website's theme; compiled at build time
ci/
├── licences.ts     # R11
└── fixture/        # placeholder graph (Cypher), recorded SVGs and analysis answers
test/               # unit and integration tests, beside each module's name
Dockerfile
```

**Structure Decision**:

- **One package,** split by module as above. The two entry points share every module.
- **Each module's tests** are in `test/` under its name.
- **The fixture** is CI's, and holds no real names.

## Order of work

1. **Measure** (R7): `event-pdf`'s human book and a sample of single events on a private
   copy of release 98's graph. Also:
   - the counts of figures by kind;
   - the subpathways whose ancestor has an EHLD;
   - whether `event-pdf` overlays reactions.
2. **Foundations:**
   - the package, TypeScript, lint, Prettier and CI;
   - the licence check, shown failing;
   - the fixture graph and its stubs.
3. **The model from the graph** (R2): the tree, the sections' parts, the cover and the
   introduction, with list order by `order`. Unit-tested on the fixture.
4. **Layout** (R5): HTML for each part in the website's theme and fonts; figures
   inlined with their ids prefixed.
5. **The single-event PDF** (Story 2): the service, one tagged pass, the analysis overlay
   (R6), and the errors of scenario 4.
6. **The book** (Story 1): parts, the join, links, the outline, and the contents
   list's second pass (R4).
7. **The checks:**
   - `check-book` (FR-011);
   - `compare` against `event-pdf` (FR-012), run on the private copy, with each difference
     recorded;
   - SC-009's colour and font check.

   Each is shown failing.

8. **The release's step** (Story 5): the container image, and its run beside the render
   service. The time is measured against step 1's baseline.
9. **The website's part:** in WebsiteAngular's specs (FR-014, R10). Its render changes
   (R10) are raised there.

## Complexity Tracking

| Violation                                  | Why Needed                                       | Simpler Alternative Rejected Because                                                                        |
| ------------------------------------------ | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| The theme package declares no licence (II) | FR-015 needs the website's own theme, not a copy | A copy of its values breaks FR-015; the package's repository is CC0, and its owners are asked to declare it |
