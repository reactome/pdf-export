# Implementation Plan: Reactome's pathway PDFs from the graph

**Branch**: `001-plan-2` | **Date**: 2026-10-29 | **Spec**: [spec.md](spec.md)

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

| Dependency                                                                                                   | Licence                        | Role                                                          |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------ | ------------------------------------------------------------- |
| `neo4j-driver`                                                                                               | Apache-2.0                     | reading the graph                                             |
| `playwright-core` with Chromium                                                                              | Apache-2.0, BSD                | layout and printing                                           |
| `@cantoo/pdf-lib`, or pdf-lib 1.17                                                                           | MIT                            | joining parts, links, outline                                 |
| `pdfjs-dist`                                                                                                 | Apache-2.0                     | the checks                                                    |
| `sass`, `@angular/material`, `@angular/cdk`, and `ngx-reactome-style`, the website's theme package           | MIT, and CC0 by its repository | compiling the theme, at build time                            |
| `@fontsource` Roboto, Roboto Mono, and the Noto Sans family (Noto Sans, Noto Sans Symbols 2, Noto Sans Math) | OFL-1.1                        | fonts                                                         |
| `fontkit`                                                                                                    | MIT                            | the characters each font covers, checked before printing (R5) |
| `express`                                                                                                    | MIT                            | the website's service                                         |

**Storage**: none of its own. It reads:

- the graph (Bolt);
- the release's files from a folder (`--files`, contracts/cli.md): the EHLD summary,
  which it reads itself to choose each pathway's figure, and the diagram and EHLD files,
  which its preflight lists before anything is printed (Story 5, scenario 3). The render
  service draws from the same files;
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

- **SC-003:** the book in no more time than `event-pdf` takes: 1 h 18 min on this host
  for release 98 (R7).
- **SC-005:** a single-event PDF at depth 1 in no more time than `event-pdf`'s, warm:
  0.5–1.7 s for a reaction, 1.3–9.5 s for most pathways, 46 s for Signal Transduction
  (R7).
- **Figures dominate:** 19,313 for the human book (R7). From the render service's times,
  measured on beta's shared service, they alone would take about 1.3–1.5 hours with four
  reused pages (inference), over SC-003's whole budget. R7 sets a budget per stage, with
  45 minutes for the figures, and the first task measures the service's throughput
  against it, with named fallbacks if it falls short.

**Constraints**:

- **Memory:**
  - The book's printing peaks under 2.5 GB at four parts at once (R4: 2.1 GB measured
    with synthetic parts; real figures are heavier, so it is re-measured).
  - The join holds the whole book in memory: 120 MB in the synthetic test, and perhaps
    near 1 GB for the real book (inference). It is re-measured in the first tasks (R4).
  - A single-event PDF stays under 1 GB.
- **No network** but the graph, the render service and the analysis service. Fonts are
  local (R5). The website's address (`--site`) is written into links, never fetched.
- **No names** in fixtures, logs or comparison output (FR-013).

**Scale/Scope**: the human book holds every top-level pathway in full depth (R7):

- 29 top-level pathways, 2,889 pathways and 16,424 reactions;
- 23,541 pages and 1.42 GB as `event-pdf` writes it today; its largest top-level
  pathway is 3,760 pages.

## Constitution Check

_GATE: checked before research and again after design._

| Principle                          | How the plan meets it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Status                                                     |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| I. One implementation              | One package; the book's command line and the website's service share every module but their entry points (R9).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Pass                                                       |
| II. Loose licences only            | The check's boundary: the package's dependencies and every asset it ships into the PDFs (fonts, the compiled theme) are checked by CI (R11), and all are allowed; graph-core is not used (R2). Chromium, and the base image's system packages, are run, not linked, and their notices are kept in the image; `npm query` does not see them. The theme package's missing licence field is the one documented exception (CC0 by its repository). **A limitation:** the website's built code, which carries FoamTree under a commercial licence, is never shipped, but the book's figures need the website's render service running, and it loads FoamTree. Until WebsiteAngular's render bundle without FoamTree exists (R10), anyone reusing this exporter needs that service. | Pass for what is shipped; the run-time limitation recorded |
| III. The graph, nothing relational | The graph, the release's files, and the analysis service's API, which reads its own result files (R6).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Pass                                                       |
| IV. The pathway browser's look     | Figures are the website's render service's SVGs (R3). Two kinds it cannot draw yet are recorded differences until WebsiteAngular adds them (R10).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Pass, with R10's gaps tracked                              |
| V. Verify the instrument           | Each check (FR-011, FR-012, SC-009, the licence check) is shown failing on a planted fault before it is relied on. Every fix comes with a test seen failing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Pass                                                       |
| VI. No production                  | A private copy of the release's graph. The published book is fetched once, only for comparison. The render and analysis services are the deployment's own, on the same graph (a private stack for runs), never production's.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Pass                                                       |
| VII. No names                      | The fixture graph uses placeholders. The comparison prints counts and hashes (R8).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Pass                                                       |

**After design:** unchanged. The render service is a new dependency of the release's
step, which constitution I–VII allow, with II's limitation above. The release's owners
agree it (spec, Assumptions; R3).

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

1. **Measure** (done in research, R7): `event-pdf`'s human book and a sample of single
   events, the figures by kind, the EHLD gap, and the overlays on reactions. What is
   left is measured first, each against R7's budgets:
   - the render service's throughput at the book's scale, with its go/no-go threshold
     (R7);
   - what the analysis service answers for an expired and a malformed token, on a
     private instance (R6);
   - the join's memory, and stamping page numbers after it (R4).
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
