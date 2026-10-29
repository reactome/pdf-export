---
description: "Tasks for spec 001: Reactome's pathway PDFs from the graph"
---

# Tasks: Reactome's pathway PDFs from the graph

**Input**: `specs/001-pathway-pdfs/`: plan.md, spec.md, research.md (R1–R11),
data-model.md, contracts/ (cli.md, service.md, render.md), quickstart.md.

**Tests**: required. The constitution (V) asks for every check and fix to be seen failing
before it is relied on, so each task names its tests and what is made to fail.

**Each task** is one pull request with its own adversarial review. The PR ticks its task
here, with its number, in the same PR.

**The repository is public:** no host names, credentials, internal release process or
people's names in code, fixtures, logs, test output or pull requests (constitution VII,
FR-013). Runs against Reactome's data use a private copy of the release's graph, never a
shared or production one (constitution VI).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task).
- **[Story]**: the user story the task serves (US1–US6, spec.md).

## Path conventions

As plan.md's structure: `src/{graph,model,figures,analysis,layout,print,check,compare}/`,
`src/cli.ts`, `src/serve.ts`, `theme/`, `ci/`, `test/` and `Dockerfile` at the
repository root.

---

## Phase 1: Setup

**Purpose:** the package, its gates and the fixture everything else is tested on.

- [ ] T001 The package: `package.json` (Node 24, `"type": "module"`, `"license": "Apache-2.0"`), `tsconfig.json` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), ESLint with typescript-eslint's strict rules in `eslint.config.js`, Prettier 3.9.10 as the repository has it, and `npm test` as `node --test` over `test/**/*.test.ts` through a TypeScript loader (`tsx`). A placeholder `src/cli.ts` printing usage. CI in `.github/workflows/ci.yml`: install, type check, lint, format and test, beside the existing `format` job. Show each gate failing once (a type error, a lint error, a misformatted file, a failing test), and say so in the PR.
- [ ] T002 The licence check, `ci/licences.ts` (research R11). It reads `npm query '*'` and allows MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0, ISC, 0BSD, OFL-1.1, CC0-1.0 and Zlib, including SPDX expressions such as `(MIT AND Zlib)`. It lists every offender, not only the first. It carries one documented exception: the website's theme package, which is CC0 by its repository and declares no licence. It also checks that each shipped font's licence file is present. Unit tests in `test/ci/licences.test.ts`. Show it failing on a planted GPL-3.0 package and on a planted package with no licence (SC-006), and run it in CI.
- [ ] T003 The fixture graph, `ci/fixture/fixture.cypher`: a small release, with `DBInfo` at 98 and every `Person` and every free text a placeholder (constitution VII). It holds:
  - two top-level pathways, one with a subpathway that has no diagram of its own, so it is drawn in its ancestor's diagram with a selection;
  - one with an illustration;
  - reactions of three kinds;
  - an event shared by two pathways;
  - an inferred event and its source;
  - literature of each kind (article, book, web page);
  - edits of each kind;
  - a disease, and one named exactly "disease";
  - a non-human pathway.

  Write `ci/fixture/README.md` saying how it was made and that it holds no real names. A Neo4j 4.4 service loads it in CI. Test in `test/graph/fixture.test.ts` that it loads and holds each case above, by count.

- [ ] T004 [P] The stubs, in `test/stubs/`:
  - a render service answering recorded SVGs for each fixture figure, in `ci/fixture/figures/`, including two whose ids collide (`clip-1`), and refusing on request with 404, 503 or a timeout;
  - an analysis service answering recorded JSON for one token, plus 404 (unknown), 410 (gone) and a malformed token as T008 measures them.

  Both are small HTTP servers on loopback, started by the tests.

---

## Phase 2: Foundational

**Purpose:** first the measurements the plan left open, each against research R7's budgets, which decide whether the design stands. Then the parts both outputs share.

**Go or no-go:** T005 decides whether the book can meet SC-003 as designed. If it cannot, stop and take research R7's routes (many figures per page load in WebsiteAngular, or SC-003 amended with the release's owners) before any of Phase 4.

- [ ] T005 Measure the render service's throughput at the book's scale (research R3, R7). The run:
  - on a private copy of the release's graph, with the release's diagram and EHLD files;
  - on the machine the release would use, or on this host, with `event-pdf`'s baseline run again if the machine differs;
  - WebsiteAngular's render service with its concurrency raised, its cache off and its pages reused;
  - a sample of at least 2,000 figures in the book's mix (85% reactions, 7% own diagrams, 1% illustrations, 8% selections).

  Record figures per second against 1, 2, 4 and 8 pages at once, CPU and memory, and the extrapolation to 19,313 figures, in research R7. **Go** if 19,313 figures fit in 44 minutes. **No-go** otherwise: record the numbers and raise R7's routes with the user. No code in `src/`; the script lives outside the repository or in `ci/measure/`, with no names in its output.

- [ ] T006 [P] Measure a single-event PDF's stages cold (SC-005, research R7): render service cache off, for the sample of research R7 (five reactions, pathways of five sizes, Signal Transduction): each figure's time, two at once. Record against `event-pdf`'s warm times in research R7. If figures alone exceed `event-pdf`'s whole time, raise SC-005 with the user, with the numbers.
- [ ] T007 [P] Measure the diagrams' widths (FR-016's floor, research R4): from the release's diagram files, each diagram's width in SVG pixels at the website's 16 px labels. Count how many fit at 5 pt in portrait (about 1,540 px) and landscape (about 2,330 px), and how many fit neither. Record in research R4. If more than 5% fit neither, raise FR-016's floor with the user.
- [ ] T008 [P] Measure the analysis service's answers (research R6), on a private instance with a submitted fixture analysis, never production. Record the status and body in research R6 for each case: a good token, an unknown one, a malformed one, one gone within retention, and one older than retention. Also record its retention period and whether its summary carries the count of identifiers found. Record each case as a recorded answer for T004's stub.
- [ ] T009 [P] Measure the join and stamping at the book's size (research R4): print synthetic parts adding up to 23,541 pages with figures at the real book's mix (T005's SVGs), join them with `@cantoo/pdf-lib` (or pdf-lib 1.17 if the fork fails the tests), rewrite links via placeholder URIs and probes recording page and y, write a nested outline, and stamp page numbers and headers in embedded Roboto. Record time and peak memory per stage against research R7's 13 + 6 minutes. Keep the script in `ci/measure/`.
- [ ] T010 The graph reader, `src/graph/`: the Neo4j driver (`neo4j-driver`), the batched queries of research R2 (the tree by level; each part across a level's events; literature, first five by `order`, with six authors and whether there are more; edits with their authors; the release; the top-level pathways), and rows mapped to plain objects. Every list is sorted by its relationship's `order`. Tests in `test/graph/` against the fixture graph. Show a test failing on a list read without `ORDER BY`, and on an inferred source read the wrong way.
- [ ] T011 The model, `src/model/` (data-model.md):
  - `Event`, `Section` (full or short, its anchor and path), `Figure` (kind chosen as data-model.md says: own diagram, nearest ancestor with a selection, illustration from the summary, reaction), `Cover`, `Contents`, `Book`, `SingleEventPdf`, `Release`;
  - the parts' rules of research R2 (the "disease" exclusion, the edit grouping and order, an event's subtree written under its first place only).

  Tests in `test/model/` against the fixture, each rule seen failing once.

- [ ] T012 [P] The theme and fonts (research R5). `theme/pdf-theme.scss` uses the website's theme package (`ngx-reactome-style`, at the version the website's lockfile pins, with `@angular/material` and `@angular/cdk` at the website's versions). It is compiled with `sass` at build time to `dist/theme.css`: the light theme's `--mat-sys-*` variables only. Fonts from `@fontsource`, OFL-1.1:
  - Roboto (300–600) and Roboto Mono;
  - Noto Sans, Noto Sans Symbols 2 and Noto Sans Math.

  A character none of them covers is a fault `uncovered-character`, found with `fontkit` before printing. Tests in `test/layout/theme.test.ts`: the variables are the theme's (none written in our code), and a planted uncovered character is caught.

- [ ] T013 [P] The figures client, `src/figures/` (contracts/render.md): asks the render service for each kind, retries a 503 once, and treats a refusal as a missing figure. It prefixes every `id`, `url(#…)` and `href="#…"` with the section's anchor. Tests in `test/figures/` against T004's stub: two colliding figures inlined together keep unique ids; seen failing without the prefixing.
- [ ] T014 The layout, `src/layout/`: HTML for each part of data-model.md, in order (FR-005):
  - the cover (the book's per FR-002, a single event's per the Background), the introduction, the analysis properties, each section's parts and the contents list with fixed-width placeholders for page numbers;
  - the theme's CSS and `@font-face` rules for the local fonts;
  - figures inlined, sized to FR-016's floor: 5 pt labels, or a landscape page of its own;
  - links per FR-003, with a website base URL setting;
  - no boxes or borders, only space, type and thin rules (FR-016).

  Tests in `test/layout/` on the fixture's model: each part present and in order, and links as FR-003 says.

- [ ] T015 Printing, `src/print/print.ts`: one Chromium (`playwright-core`), pages loaded with `goto` on a file (not `setContent`, research R4), and A4 `@page`. A single-event PDF is printed tagged, with Chromium's outline. A part is printed untagged with placeholder links. Tests in `test/print/` on fixture HTML: fonts embedded (pdf-lib's `FontFile*`) and no system font present (seen failing with a `setContent` load); outline nested; internal links landing on their pages.

**Checkpoint:** the measurements are recorded, and the model, layout and printing work on the fixture.

---

## Phase 3: User Story 2 — the website's PDF of one pathway or reaction (P1)

**Goal:** `pdf-export serve` answers `GET /event/{stId}.pdf` as contracts/service.md says.

**Independent test:** quickstart §3 on the fixture and on a private copy: a pathway at
depth 0 and 1, a reaction, a non-human event and a pathway with a token, each with the
Background's parts in order and bookmarks; each error case gives its answer.

- [ ] T016 [US2] The analysis client, `src/analysis/` (research R6): the summary, the found entities and interactors by pathway, and a reaction filtered to its own identifiers from its first parent pathway's results. With FR-006's defaults: all resources together, no expression column, all identifiers. Tests against T004's stub.
- [ ] T017 [US2] Tokens, in `src/analysis/token.ts`. A malformed token (not the analysis service's Base64 form) or one older than the retention period (the `--retention` setting) is `unknown-token`. The service's 404 is `unknown-token` and its 410 is `gone-token`. The identifier is checked first. Tests cover each case of T008's table, each seen failing.
- [ ] T018 [US2] The service, `src/serve.ts` (contracts/service.md): `GET /event/{stId}.pdf?depth&token` and `GET /health`, with the bind address and port as settings (loopback by default) and its concurrency limit. The statuses and reasons are the contract's: 400 `not-an-event` or `bad-depth`; 404 `no-event` or `unknown-token`; 410 `gone-token`; 503 `unavailable`. With a contents list (depth 1 pathway), the second print fills the page numbers (research R4). Bookmarks in every PDF (FR-006). A figure that cannot be drawn leaves the section without it, logged. Tests in `test/serve.test.ts` against the stubs, each status seen failing.
- [ ] T019 [US2] SC-005, measured: the service against a private copy and the render service with its cache off, for research R7's sample, against `event-pdf`'s warm times. Record in research R7. If over, raise SC-005 with the user, with the numbers.

**Checkpoint:** the website's PDF works on its own; WebsiteAngular can route to it (T040).

---

## Phase 4: User Story 1 — the release's book is one PDF (P1)

**Goal:** `pdf-export book` writes `TheReactomeBook.pdf` and checks it (contracts/cli.md).

**Independent test:** quickstart §4: on a private copy, the book is one file with every
top-level pathway and event, in the contents and the bookmarks, and `check-book` passes.

- [ ] T020 [US1] The preflight, in `src/cli.ts` `book --files <dir>` (contracts/cli.md). From the graph's events, and the summary only to say which are illustrations (ignoring entries for events the graph does not hold, research R7), list the files the figures need. Each one missing is a fault `missing-file <name>`, with exit 1 and no book written (Story 5, scenario 3). Tests: a planted missing diagram and a planted missing illustration are caught; a summary entry for an absent event is not.
- [ ] T021 [US1] Parts, in `src/print/parts.ts`: one per top-level pathway, by name ignoring case (FR-002), split at section boundaries past about 200 pages. Printed untagged and a few at a time (`--parallel`), and joined. Tests on the fixture: the joined page count equals the parts' sum, and no section is split between parts.
- [ ] T022 [US1] Links and outline after the join, in `src/print/links.ts` and `src/print/outline.ts`. Each placeholder URI becomes a `/XYZ` destination at its probe's page and y, and the probes are removed. The outline is nested as the chapters' trees, and an event's later places point at its one full section (FR-004); a short entry is not repeated with its subtree. Tests: every link and bookmark lands on its target heading, seen failing with links copied as pdf-lib leaves them.
- [ ] T023 [US1] Page numbers and running headers, `src/print/stamp.ts`: stamped after the join with pdf-lib, in embedded Roboto and the theme's colour. Each page's header is its chapter's name, or its front part's name (FR-016). No number on the cover. Tests: numbers continuous across parts, headers right at a part boundary, seen failing with the parts' own numbering.
- [ ] T024 [US1] The contents' second pass, `src/print/contents.ts`: read where each section landed, and reprint the front part with the numbers in the same width. Tests: every entry's number is its target's page, seen failing with the placeholders left in.
- [ ] T025 [US1] `book` end to end, `src/cli.ts` (contracts/cli.md): `--graph`, `--render`, `--files`, `--species`, `--out`, `--parallel` and `--report`. The file is written beside its name and moved into place. The run report has the release, the time, the pages, the figures by kind and the missing figures, by stable identifier, never a person. Test on the fixture: one PDF, exit 0.
- [ ] T026 [US1] `check-book`, `src/check/book.ts` (FR-011, contracts/cli.md). From the graph, and from the book's outline and text (the book is untagged), it finds each fault:
  - `missing-pathway`, `not-in-contents`, `not-in-outline`;
  - `no-name`, `no-stable-id`;
  - `missing-figure` where the source exists;
  - `broken-link`.

  `book` runs it. Tests: a fixture book with each fault planted one at a time fails with that fault's line (SC-007).

- [ ] T027 [US1] The book on a private copy of release 98's graph: time each stage against research R7's budget, and check memory. Run `check-book`. Record in research R7. Open it in the three readers of SC-004 and follow a sample of bookmarks and links in each.

**Checkpoint:** the book is made, and its check can fail.

---

## Phase 5: User Story 6 — the PDFs look like the website (P2)

**Goal:** FR-015, FR-016 and SC-009.

**Independent test:** quickstart §5.

- [ ] T028 [US6] The colour and font check, `src/check/look.ts` (SC-009, research R8). A sample of pages goes through printing, the join and the stamping, printed again with figures hidden. Every fill and stroke colour must be in the compiled theme, and every font one FR-015 names. Tests: a planted off-theme colour and a planted system font each fail it.
- [ ] T029 [US6] The judgement: 12 random pages of the book from T027, including a cover, a contents page and a pathway section with its figure, set beside today's book's. Prepare a page for the judges (the release's owners and the curators they ask), without names. Record the outcome here.

---

## Phase 6: User Story 3 — figures in the new website's look (P2)

**Goal:** SC-008.

- [ ] T030 [US3] The figure comparison, `src/check/figures.ts` (SC-008). For a sample of events, rasterise the PDF's figure with pdf.js in Chromium, and the render service's SVG printed alone on a page with the same `@font-face` rules, at one scale. At most 1% of pixels may differ. Tests: a figure drawn with a different selection fails it.

---

## Phase 7: User Story 4 — only loose licences (P1)

**Goal:** SC-006. The check itself is T002.

- [ ] T031 [US4] Run the licence check over the container image's installed packages too (T033), and keep Chromium's and the base image's notices in the image (plan, constitution II row). No fonts but FR-015's in the image: `fc-list` shows only those, seen failing with `fonts-liberation` installed.

---

## Phase 8: User Story 5 — the release's step, with a check that can fail (P2)

**Goal:** FR-010, FR-011, SC-003, SC-007.

- [ ] T032 [US5] FR-012's comparison, `src/compare/` (`pdf-export compare <today's folder> <new.pdf>`, contracts/cli.md). Both PDFs are reduced to FR-012's parts:
  - the covers' distinct names, counted, across today's files;
  - the introduction's release and counts;
  - the analysis properties;
  - each section's parts and text;
  - the contents' entries and targets;
  - the figures' kinds.

  Names appear only as counts and hashes. The cover's U+2060 and no-break spaces are normalised, and list order is a recorded difference. `--expected` takes the recorded differences. Tests on fixture PDFs: each part's difference is caught, and no name is printed.

- [ ] T033 [US5] The container image, `Dockerfile`: Node 24 on a slim base, Playwright's Chromium and only FR-015's fonts. It runs as a non-root user and its entry point is `pdf-export`. CI builds it and runs `book` over the fixture against the stubs. Test: a planted missing file fails the run with exit 1 and no book.
- [ ] T034 [US5] The release's step, documented in `README.md`. The image runs with the release's graph and files as inputs and the render service beside it, and writes one PDF. The run is timed against SC-003 on the machine the release uses. A planted fault fails the step. Raise the switch from `event-pdf` with the release's owners (spec, Assumptions).
- [ ] T035 [US5] The comparison with `event-pdf`, run on the private copy: the new book against today's 29 files, and a sample of single-event PDFs against today's. Record each difference by part, kind and count, with its reason, in `specs/001-pathway-pdfs/differences.md`, with no names (SC-002).

---

## Phase 9: Polish

- [ ] T036 [P] `README.md` and `CLAUDE.md`: how to build, test, run `book` and `serve`, the settings, the fixture, and the checks.
- [ ] T037 [P] In WebsiteAngular, an issue (and later a spec there) for its part (research R10, FR-014):
  - the single-event route in the content service, nginx and the dev proxy;
  - the render service's limits as settings for a batch run;
  - an overlay on a reaction's drawing;
  - many figures per page load (if T005 is a no-go);
  - the plain diagram on demand;
  - a render bundle without FoamTree.

  Link it here.

- [ ] T038 [P] Ask the theme package's owners to declare its licence in the package. Link the issue here, and drop T002's exception once it is declared.
- [ ] T039 Remove the scratch baselines once T035 is recorded: `event-pdf`'s book and single-event PDFs, the release's files and the private graph copy. They are kept outside the repository and hold names.
- [ ] T040 Check the success criteria (SC-001 to SC-009) and record the result here.

---

## Dependencies and execution order

- **Phase 1:** T001 first; T002–T004 after it, in parallel.
- **Phase 2:**
  - T005 first: the go or no-go for Phase 4. T006–T009 in parallel with it.
  - T010 → T011 → T014 → T015. T012 and T013 alongside T010–T011.
- **US2 (Phase 3)** needs Phase 2: T016 → T017 → T018 → T019.
- **US1 (Phase 4)** needs Phase 2 and a go from T005: T020, T021 → T022 → T023 → T024 → T025 → T026 → T027.
- **US6:** T028 needs T023; T029 needs T027.
- **US3:** T030 needs T015.
- **US4:** T031 needs T033.
- **US5:** T032 after T027; T033 after T025; T034 after T033; T035 after T032.
- **Polish:** T036 at any time; T037 after T005; T038 at any time; T039 after T035; T040 last.

## Parallel opportunities

- T002, T003 and T004.
- T005 to T009, the measurements.
- T012 and T013 beside the graph reader and the model.
- US2 and US1 once Phase 2 is done; US3 (T030) beside them.

## Implementation strategy

1. **Phase 1 and the measurements first.** T005's answer decides whether the book is built as planned.
2. **US2 first:** the website's PDF is smaller, exercises every part but parts and joining, and replaces `event-pdf` in the content service.
3. **Then US1, the book,** with its check.
4. **Then the look's check, the figures' check and the release's step,** with the comparison against `event-pdf` as the proof.
