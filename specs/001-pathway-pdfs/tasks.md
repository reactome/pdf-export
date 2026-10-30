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

- [x] T001 The package and its gates. — #20. TypeScript 6.0, ESLint 10 with typescript-eslint 8.72's strict type-checked rules (node:test's calls allowed as floating promises), Prettier 3.9.10 and Node 24.22's `node --test`, with no loader. Each gate was seen failing on a planted fault: a type error (typecheck exit 2), an unused variable (lint exit 1), a misformatted file (format exit 1) and a failing test (test exit 1).
  - `package.json`: Node 24, `"type": "module"`, `"license": "Apache-2.0"`.
  - `tsconfig.json`: strict, with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `erasableSyntaxOnly` and `noEmit`.
  - ESLint with typescript-eslint's strict rules, in `eslint.config.js`.
  - Prettier 3.9.10, as the repository has it.
  - `npm test` as `node --test` over `test/**/*.test.ts`, run by Node 24's own type stripping, with no loader dependency.
  - A placeholder `src/cli.ts` that prints its usage.
  - CI in `.github/workflows/ci.yml`: install, type check, lint, format and test, beside the existing `format` job.

  Show each gate failing once (a type error, a lint error, a misformatted file, a failing test), and say so in the PR.

- [x] T002 [P] The licence check, `ci/licences.ts` (research R11). — #22, replacing #21 after its review. BlueOak-1.0.0 joins the allowlist: permissive, like MIT, and minimatch, which ESLint brings, uses it. Development packages are checked too. 99 packages pass today. Seen failing with two planted packages installed, one GPL-3.0 and one with no licence: both listed, exit 1. Eight unit tests: SPDX AND, OR and WITH, an unreadable expression, the old licence forms, every offender listed, the exception by exact name and only while the package declares none, an unused exception reported, and a font without its licence file found by its `location` (npm masks parts of `path` it takes for secrets, which made a font with its licence look as if it had none). From #20's review, in the same PR: `CLAUDE.md`'s checks section; lint refuses a relative `.js` import, export or dynamic import, which type-checks but fails at run time (each seen failing); `src/cli.ts` and `ci/licences.ts` executable.
  - It reads `npm query '*'` and allows MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0, ISC, 0BSD, OFL-1.1, CC0-1.0 and Zlib, including SPDX expressions such as `(MIT AND Zlib)`.
  - It lists every offender, not only the first.
  - It carries one documented exception: the website's theme package, which is CC0 by its repository and declares no licence.
  - It checks that each shipped font's licence file is present.

  Unit tests in `test/ci/licences.test.ts`. Show it failing on a planted GPL-3.0 package and on a planted package with no licence (SC-006), and run it in CI.

- [x] T003 [P] The fixture, `ci/fixture/`: a small release graph, `fixture.cypher`, with `DBInfo` at 98, and the release's files beside it, `files/`. Every `Person` and every free text is a placeholder (constitution VII). `README.md` says how it was made, that it holds no real names, and the case each item is there for. It holds:
  - **Top-level pathways:**
    - three human ones whose names sort differently ignoring case than by database id or by case (FR-002);
    - one non-human top-level pathway, which `--species` must exclude.
  - **Figures:**
    - a subpathway with no diagram of its own, drawn in its ancestor's diagram with a selection;
    - a subpathway beneath a pathway that has an illustration (data-model.md: the illustration unselected, recorded);
    - a subpathway with two parents that have diagrams (the ancestor nearest a top-level pathway wins);
    - a pathway with an illustration of its own;
    - reactions of three kinds.
  - **Sharing and links:**
    - an event shared by two pathways (FR-004);
    - an event inferred from two sources in different species (inferredFrom sorted by species, then name);
    - reactions with `precedingEvent`, one pointing at an event outside a single-event PDF.
  - **Order:** at least one list (children, compartments or literature) whose relationship `order` differs from database-id order, so a read without `ORDER BY` is seen to fail.
  - **Literature:** of each kind (article, book, web page); an event with more than five references; a reference with more than six authors.
  - **Edits:** of each kind; one with no date; one with no author; two sharing a date (the grouping rules).
  - **Text:** a summation whose HTML must be sanitised.
  - **Diseases:** one disease, and one named exactly "disease".
  - **Not an event:** a node that is not an event, for 400 `not-an-event`.
  - **`files/`:**
    - `diagram/` and `.graph.json` for each pathway with a diagram;
    - `ehld/` for each illustration;
    - `ehld/svgsummary.txt`, with one entry for an event the graph does not hold.

  A Neo4j 4.4 service loads the graph in CI. A test in `test/graph/fixture.test.ts` checks that it loads and holds each case above, by count.

  — #24, replacing #23 after its review. 56 nodes and 92 relationships in release 98's labels and relationships (each with `order` and `stoichiometry`), ids from 90000000. `test/graph/fixture.test.ts` checks each case (9 tests), and fails if a person is not a placeholder. CI loads it into a Neo4j 4.4 service. Seen failing: one inference source removed, every `hasEvent` order set to its child's id, and a real-looking person added. From #22's review: the licence check takes the project's root from its own place, so it runs from any folder. From #23's review: a reaction pointing outside its top-level pathways, the "disease" exclusion on one event, the publisher and the release files are tested, and the graph suite fails rather than skips in CI without a graph; `isInDisease` and edit times as release 98 has them; a non-event with a stable id (a complex).

- [x] T004 The render stub, `test/stubs/render.ts`, after T003.
  - **The SVGs** are hand-made in the website's SVG form: text in Roboto, `clip-N` ids, small PNG node shapes. Two of them have colliding ids. They are not rendered from Reactome's data, so they carry no names.
  - **It answers 400 to any query parameter contracts/render.md does not name**, so a wrongly named parameter fails a test instead of passing silently.
  - **It refuses on request** with 404, 503 or a timeout.

  — #27, replacing #25 after its review. Twelve hand-made figures: four diagrams, one illustration and seven reactions, the mouse one included. They follow the website's form as its render cache shows it: node labels at 12 px and a compartment's at 80 px, plain `href` images, and an illustration with its own ids (`clip0_…`, `paint0_linear_…`, a mask, `ANALINFO`, and the pathway's stable id). Alpha's and beta's diagrams share `clip-1` and `grad-1`; nothing else is shared. Answers are as the real service gives them: `image/svg+xml; charset=utf-8`, JSON error bodies, `Retry-After: 5` on a 503, and 400 for another format or a parameter given twice. A selection and an analysis are marked (`data-highlight`, `data-token`). Ten tests. Each of these mutants made one fail: the 400s off, another format accepted, a repeat accepted, the marks dropped, a refusal never ending, no `Retry-After`, the ids no longer shared, and the illustration's ids gone. Closing with no clean-up made the closing test run out its 5 s and the run hang. From the review: the plan's labels were 16 px, and they are 12 px, so research R4, the data model, contracts/render.md and T008 now say so (portrait about 1,155 px, landscape about 1,750 px).

---

## Phase 2: Foundational

**Purpose:** first the measurements the plan left open, each against research R7's
budgets, which decide whether the design stands; then the parts both outputs share.

**Go or no-go:** T005 decides whether the book can meet SC-003 as designed. If it cannot,
stop and take T006's route before any of Phase 4. A go that rests on page reuse alone waits
for WebsiteAngular to ship it (T042).

- [ ] T005 Measure the figures' throughput at the book's scale (research R3, R7). The run conditions:
  - a private copy of the release's graph, with the release's diagram and EHLD files;
  - the machine the release would use, or this host, with `event-pdf`'s baseline run again if the machine differs;
  - cold, with an empty `RENDER_CACHE` directory, or a fresh `RENDER_CACHE_KEY`, for each run;
  - a sample of at least 2,000 figures in the book's mix: 85% reactions, 6% own diagrams, 1% illustrations, 8% selections.

  Measure two things:
  - **(a) The render service as it is,** at `RENDER_CONCURRENCY` 1, 2, 4 and 8, with `RENDER_QUEUE` raised to match so the run measures renders, not 503s. The service deliberately opens a fresh page per render, because a reused page leaks state such as a stale analysis token.
  - **(b) Page reuse,** through a harness on WebsiteAngular's `render-core` in `ci/measure/`: 1, 2, 4 and 8 reused pages, each reset between figures, with any leak checked by comparing a figure drawn after another with the same figure drawn fresh.

  Record figures per second, CPU and memory, and the extrapolation to 19,313 figures, in research R7. The script's output carries no names.
  - **Go** if (a) fits 19,313 figures in 44 minutes. A go on (b) alone is conditional: page reuse must ship in WebsiteAngular's render service first (T042), and Phase 4 then waits for it.
  - **No-go** otherwise: record the numbers, raise research R7's routes with the user, and take T006.

- [ ] T006 Only if T005 is a no-go: the route the user chooses (research R7).
  - **Many figures per page load:** an in-page API on the render page, raised in WebsiteAngular (T042, raised at once rather than waiting for Polish), and, once it ships, T014's client changed to send a batch per page.
  - **Or:** SC-003 amended with the release's owners, with T005's numbers.

  Record which here.

- [ ] T007 [P] Measure a single-event PDF's stages, cold (SC-005, research R7). The render service runs with an empty cache directory. Use research R7's sample: five reactions, pathways of five sizes, and Signal Transduction. Time each figure, two at once. Record the times against `event-pdf`'s warm times in research R7. If figures alone exceed `event-pdf`'s whole time, raise SC-005 with the user, with the numbers.
- [ ] T008 [P] Measure the diagrams' widths (FR-016's floor, research R4). From the release's diagram files, take each diagram's width in SVG pixels at the website's 12 px node labels. Count how many fit at 5 pt in portrait (about 1,155 px), in landscape (about 1,750 px), and in neither. Record the counts in research R4. If more than 5% fit neither, raise FR-016's floor with the user.
- [ ] T009 [P] Measure the analysis service's answers (research R6), on a private instance with a submitted analysis, never production. For each case, record the status and body in research R6:
  - a good token;
  - an unknown one;
  - a malformed one;
  - one gone within retention;
  - one older than retention;
  - `found/interactors` with none.

  Also record its retention period, and whether its summary carries the count of identifiers found (otherwise `/download/{token}/result.json` is needed). Recorded answers are scrubbed of host names, paths and identifiers before they are committed.

- [ ] T010 The analysis stub, `test/stubs/analysis.ts`. It is a small HTTP server on loopback that answers T009's recorded, scrubbed answers:
  - 404 (unknown);
  - 410 (gone within retention);
  - found entities and interactors on a reaction's first parent pathway;
  - a `found/interactors` 404 meaning none;
  - `result.json` if T009 says it is needed;
  - a 503, for the `unavailable` answer.

  It can be written before T009, answering contract-shaped placeholders; T009's recorded answers replace them, and the task is ticked only then.

- [ ] T011 [P] Measure the join and stamping at the book's size (research R4).
  - Print synthetic parts totalling 23,541 pages, with figures in the real book's mix (T005's SVGs, so after T005).
  - Join them with `@cantoo/pdf-lib`, or pdf-lib 1.17 if the fork fails the tests.
  - Rewrite the links through placeholder URIs and probes recording page and y.
  - Write a nested outline, and stamp page numbers and headers in embedded Roboto.

  Record time and peak memory per stage against research R7's 13 + 6 minutes. The script lives in `ci/measure/`. If the join does not fit in memory, take T012.

- [ ] T012 Only if T011's join does not fit in memory: join in groups (research R4). Join the parts a few at a time into intermediate files, then join those, keeping the links' and the outline's targets. Record the memory and time against the budget.
- [x] T013 The graph reader, `src/graph/`: — #28, replacing #26 after its review.
  - the Neo4j driver (`neo4j-driver`), with the database name and the `NEO4J_*` settings;
  - the batched queries of research R2: the tree by level; each part across a level's events; literature, the first five by `order`, with six authors and whether there are more; edits with their authors; the release; the top-level pathways;
  - rows mapped to plain objects;
  - every list sorted by its relationship's `order`.

  Tests in `test/graph/` against the fixture graph. Show a test failing on a list read without `ORDER BY`, and on an inferred source read the wrong way.

  - **What it is:** `connection.ts` reads the settings (`NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD`, `NEO4J_DATABASE`) and opens read sessions, integers as numbers. `queries.ts` has the release (`DBInfo.releaseNumber`); a species' top-level pathways; what an identifier names (an event, something that is not one, or nothing: the service's 200, 400 and 404), by stable id, versioned stable id or database id, each by its own index lookup; a level's children; each event's facts and short lists; the first five references, each with its first six authors, whether there are more, and a book's chapter; and edits with their authors (the model re-sorts a row's authors by database id, research R2).
  - **From #26's review:** every query finds its events through `DatabaseObject`'s `dbId` index with the label in a `WHERE`; `MATCH (p:Pathway {dbId: …})` scanned every pathway, as `EXPLAIN` on the fixture showed (`NodeByLabelScan` against `NodeIndexSeek`). Each id is read once, so an event a level names twice gives its rows once. Pattern comprehensions come back in no set order, so `factsFromRow` sorts each list by its relationship's `order`, tested on scrambled rows without a graph.
  - **The fixture** gains lists whose creation order is neither their order nor its reverse (three summations, three events before and three after), the eight-author reference among the first five, authors created in reverse of their order, and a book chapter: 58 nodes and 98 relationships.
  - **Tests:** `test/graph/reader.test.ts` (9, on the fixture) and `test/graph/facts.test.ts` (2, no graph). Each of these mutants made one fail: literature or children read without `ORDER BY`; inference read the wrong way; more-authors always true; no cap of six; a reference's or an edit's authors unsorted; each of the six lists left unsorted; ids not made unique; a non-event read as nothing.

- [x] T014 [P] The figures client, `src/figures/` (contracts/render.md).
  - It asks the render service for each kind: `/render/{stId}.svg`, `?highlight=a,b`, `?layout=reaction`, and `?token=` decoded once.
  - It retries a 503 once, and treats a refusal as a missing figure.
  - It prefixes every `id`, `url(#…)` and `href="#…"` with the section's anchor.

  Tests in `test/figures/` against T004's stub:
  - the exact request URL for each kind, including the token, seen failing with a wrongly named parameter (the stub's 400);
  - two colliding figures inlined together keep unique ids, seen failing without the prefixing.

  — #29. `client.ts` builds each request's URL. The token is given as the analysis service issued it, and `URLSearchParams` encodes it once. A 503 is tried once more after its `Retry-After` (capped by a setting); a second 503, any other refusal, a timeout or an answer that is not SVG is a missing figure, with its reason. `prefix.ts` prefixes every `id`, `url(#…)` (quoted or not) and local `href`/`xlink:href`, leaving `data:` images and web addresses alone. Seven tests. Each of these mutants made one fail: `analysis=` for `token=`, the token encoded twice, `select=` for `highlight=`, no retry, a retry of every refusal, and ids, `url(#…)` or `href="#…"` left unprefixed. Alpha's and beta's diagrams, and Gamma's illustration inlined twice, keep every id unique with every reference on the page. From #28's review: tests for a versioned stable id of a non-event, and for `edits` given an id twice. Taking `unique()` out of `edits` fails no test: the query groups rows by event before collecting, so a doubled id cannot double them.

- [ ] T015 The model, `src/model/` (data-model.md):
  - the entities: `Event`, `Section` (full or short, with its anchor and path), `Figure`, `Cover`, `Contents`, `Book`, `SingleEventPdf` and `Release`;
  - the figure's kind, chosen as data-model.md says: the event's own diagram; its nearest ancestor's with a selection, the ancestor nearest a top-level pathway winning among several parents; an illustration from the summary (unselected, recorded, where the ancestor's is one); or a reaction;
  - the parts' rules of research R2: the "disease" exclusion; the edit grouping and order, with no-date and no-author edits dropped; an event's subtree written under its first place only; `inferredFrom` sorted by species name, then name;
  - summations' HTML sanitised to the tags the website's pages allow.

  Tests in `test/model/` against the fixture, each rule seen failing once.

- [ ] T016 [P] The text that is not data (FR-009): Reactome's institutions and licence statements, the introduction's text, Reactome's own references, and the analysis section's explanations. Take each from the website's current wording, or from the release's owners, or write it anew. Nothing is copied from `event-pdf`. It goes in `src/layout/text.ts`, with its source named in a comment. Ask the release's owners in the PR for any that cannot be taken from the website.
- [ ] T017 [P] The theme and fonts (research R5).
  - `theme/pdf-theme.scss` uses the website's theme package, `ngx-reactome-style`, at the version the website's lockfile pins, with `@angular/material` and `@angular/cdk` at the website's versions.
  - `sass` compiles it at build time to `dist/theme.css`: the light theme's `--mat-sys-*` variables only.
  - The fonts come from `@fontsource`, all OFL-1.1: Roboto (300–600), Roboto Mono, Noto Sans, Noto Sans Symbols 2 and Noto Sans Math.
  - A character none of them covers is found with `fontkit`, as `uncovered-character <code point>`.

  Tests in `test/layout/theme.test.ts`: the variables are the theme's, with none written in our code, and a planted uncovered character is caught.

- [ ] T018 The layout, `src/layout/`: HTML for each part of data-model.md, in order (FR-005).
  - **Parts:**
    - the cover (the book's per FR-002, a single event's per the Background);
    - the introduction (T016's text);
    - the analysis properties;
    - each section's parts;
    - the contents list, with fixed-width placeholders for page numbers.
  - **Style:** the theme's CSS, and `@font-face` rules for the local fonts.
  - **Figures:** inlined, sized to FR-016's floor (5 pt labels, or a landscape page of its own), with `break-inside: avoid`.
  - **Links:** as FR-003 says, with a website base URL setting.
  - **Separation:** space, type and thin rules only; no boxes or borders (FR-016).
  - **Book mode:** internal links as placeholder URIs (`https://anchor.invalid/<id>`), and a 1 px probe link inside each target (research R4).
  - **Single-event mode:** running headers and page numbers in `@page` margin boxes. The header names the event, or the front part's name on front pages, and every page but the cover is numbered (FR-016).

  Tests in `test/layout/` on the fixture's model:
  - each part present and in order;
  - links as FR-003 says;
  - placeholders and probes in book mode only;
  - the same margins on every page;
  - no figure split across pages, checked on a print.

- [ ] T019 Printing, `src/print/print.ts` and `src/print/contents.ts`.
  - One Chromium (`playwright-core`). Pages are loaded with `goto` on a file, not `setContent` (research R4), on A4 `@page`.
  - **A single-event PDF** is printed tagged, with Chromium's outline. With a contents list, the second pass reads where each section landed, with pdf.js, and prints again with the numbers in the same width (research R4).
  - **A part** is printed untagged, with placeholder links.

  Tests in `test/print/` on fixture HTML:
  - fonts embedded (pdf-lib's `FontFile*`), and no system font present, seen failing with a `setContent` load;
  - the outline nested;
  - internal links landing on their pages;
  - every contents number its target's page, seen failing with the placeholders left in.

**Checkpoint:** the measurements are recorded, and the model, layout and printing work on
the fixture.

---

## Phase 3: User Story 2 — the website's PDF of one pathway or reaction (P1)

**Goal:** `pdf-export serve` answers `GET /event/{stId}.pdf` as contracts/service.md
says.

**Independent test:** quickstart §3, on the fixture and on a private copy: a pathway at
depth 0 and at depth 1, a reaction, a non-human event, and a pathway with a token. Each
has the Background's parts in order, and bookmarks. Each error case gives its answer.

- [ ] T020 [US2] The analysis client, `src/analysis/` (research R6).
  - It reads the summary, and the found entities and interactors by pathway. `found/interactors` answering 404 means none.
  - A reaction's results are filtered to its own identifiers, from its first parent pathway's results.
  - It uses FR-006's defaults: all resources together, no expression column, all identifiers.
  - The overlay's species is the event's.

  Tests against T010's stub.

- [ ] T021 [US2] Tokens, `src/analysis/token.ts`.
  - A malformed token (not the analysis service's Base64 form) is `unknown-token`.
  - A token older than the retention period is `unknown-token`. The period is the `--retention` setting, whose default is the period T009 reads (research R6).
  - The service's 404 is `unknown-token`, and its 410 is `gone-token`.

  Tests for each case of T009's table, each seen failing.

- [ ] T022 [US2] The service, `src/serve.ts` (contracts/service.md).
  - **Routes:** `GET /event/{stId}.pdf?depth&token` and `GET /health`.
  - **Settings:** bind address (loopback by default), port, `--graph`, `--render`, `--analysis`, `--files`, `--site`, `--retention` and the concurrency limit, each with its environment variable where contracts/cli.md gives one.
  - **Answers:**
    - 200 with `Content-Disposition` naming the stable identifier;
    - 400 `bad-depth`, then 400 `not-an-event` or 404 `no-event`, then the token's answer (404 `unknown-token`, 410 `gone-token`), in that order;
    - 503 `unavailable` when a service cannot answer or the limit is reached.
  - **Health:** the version, the graph's release, and whether the render and analysis services answer.
  - **Content:** bookmarks in every PDF (FR-006). A figure that cannot be drawn leaves its section without it, logged.

  Tests in `test/serve.test.ts` against the stubs:
  - each status, seen failing;
  - a bad identifier with a bad token gives the identifier's answer;
  - no reason carries a path, a host or a name.

- [ ] T023 [US2] SC-005, measured. Run the service against a private copy, with the render service's cache directory empty, for research R7's sample. Compare against `event-pdf`'s warm times, and record the result in research R7. If it is over, raise SC-005 with the user, with the numbers.

**Checkpoint:** the website's PDF works on its own, and WebsiteAngular can route to it
(T042).

---

## Phase 4: User Story 1 — the release's book is one PDF (P1)

**Goal:** `pdf-export book` writes `TheReactomeBook.pdf` and checks it (contracts/cli.md).

**Independent test:** quickstart §4, on a private copy. The book is one file. Every
top-level pathway and every event is in the contents and the bookmarks. `check-book`
passes.

- [ ] T024 [US1] The preflight, in `src/cli.ts` `book --files <dir>` (contracts/cli.md).
  - **Files:** the files the figures need come from the graph's events. The summary only says which of them are illustrations, and its entries for events the graph does not hold are ignored (research R7). Each missing file is a fault `missing-file <name>`.
  - **Characters:** each character no font covers is a fault `uncovered-character <code point> <stId>` (T017's detector).
  - Either fault means exit 1, with no book written (Story 5, scenario 3).

  Tests:
  - a planted missing diagram, a planted missing illustration and a planted uncovered character are each caught;
  - the fixture summary's entry for an absent event is not a fault.

- [ ] T025 [US1] Parts, `src/print/parts.ts`.
  - One part per top-level pathway, by name ignoring case (FR-002).
  - A part is split at section boundaries past a page threshold: a setting, about 200 pages by default.
  - Parts are printed untagged, a few at a time (`--parallel`), and joined.

  Tests on the fixture, with the threshold lowered so a chapter splits:
  - the joined page count equals the sum of the parts';
  - no section is split between parts;
  - the chapters are in FR-002's order, seen failing with database-id order.

- [ ] T026 [US1] Links and outline after the join, `src/print/links.ts` and `src/print/outline.ts`.
  - Each placeholder URI becomes a `/XYZ` destination at its probe's page and y, and the probes are removed.
  - The outline is nested as the chapters' trees.
  - An event's later places point at its one full section (FR-004). A short entry is not repeated with its subtree.

  Tests: every link and bookmark lands on its target heading, seen failing with links copied as pdf-lib leaves them.

- [ ] T027 [US1] Page numbers and running headers, `src/print/stamp.ts`, stamped after the join with pdf-lib.
  - Text in embedded Roboto, in the theme's colour.
  - Each page's header is its chapter's name, or its front part's name.
  - No number on the cover (FR-016).

  Tests: numbers continuous across parts, and headers right at a part boundary, seen failing with the parts' own numbering.

- [ ] T028 [US1] The book's contents, second pass: T019's `src/print/contents.ts`, extended to read where each section landed in the joined book and reprint only the front part. The reprinted front part is swapped in before T026's links and T027's stamping run, so its links are rewritten and its pages stamped like the rest. Tests: every entry's number is its target's page, across parts; the contents' links land; the front pages carry their headers and numbers.
- [ ] T029 [US1] `book` end to end, `src/cli.ts` (contracts/cli.md).
  - **Flags and their environment variables** (contracts/cli.md): `--graph` (`NEO4J_URI`), `--database` (`NEO4J_DATABASE`), `--render` (`RENDER_SERVICE`), `--site` (`REACTOME_SITE`), `--files`, `--species`, `--out`, `--parallel` and `--report`. Credentials come from `NEO4J_USER` and `NEO4J_PASSWORD`, never the command line.
  - **Writing:** the file is written beside its name and moved into place.
  - **The run report:** the release; each stage's time; pages and size; figures by kind; the figures below the legibility floor; missing figures and missing release files; and each FR-011 check's result. Everything is named by stable identifier, never a person.

  Tests:
  - exit 0 on the fixture with one PDF (provisional until T030 adds the check);
  - exit 1 on a figure that cannot be drawn (the stub's 404 or timeout), with no partial book left;
  - exit 2 on bad arguments, and on a service unreachable at the start.

- [ ] T030 [US1] `check-book`, `src/check/book.ts` (FR-011, contracts/cli.md).
  - **Flags:** `--graph`, `--species` and `--files`.
  - **Output:** one line per fault, `fault <kind> <stId>`.
  - **Method:** it reads the graph, and the book's outline and text, since the book is untagged.
  - **Faults:**
    - `missing-pathway`, `not-in-contents`, `not-in-outline`;
    - `no-name`, `no-stable-id`;
    - `missing-figure`, where the source exists;
    - `broken-link`.

  `book` runs it, and exits 0 only when it passes. Tests: a fixture book with each fault planted one at a time fails with that fault's line (SC-007).

- [ ] T031 [US1] The book on a private copy of release 98's graph.
  - Time each stage against research R7's budget, check memory, and run `check-book`. Record the results in research R7.
  - Open the book in the three readers of SC-004, and follow a sample of bookmarks and links in each.

**Checkpoint:** the book is made, and its check can fail.

---

## Phase 5: User Story 6 — the PDFs look like the website (P2)

**Goal:** FR-015, FR-016 and SC-009.

**Independent test:** quickstart §5.

- [ ] T032 [US6] The colour and font check, `src/check/look.ts` (SC-009, research R8).
  - A sample of pages goes through printing, the join and the stamping, with figures hidden.
  - Every fill and stroke colour must be in the compiled theme.
  - Every font must be one FR-015 names, including the stamped Roboto.

  Tests: a planted off-theme colour and a planted system font each fail it.

- [ ] T033 [US6] The judgement.
  - **The sample:** 12 random pages of T031's book, including a cover, a contents page and a pathway section with its figure, each set beside today's book.
  - **The judges:** the release's owners and the curators they ask, given a page without names to compare on.

  Record the outcome here.

---

## Phase 6: User Story 3 — figures in the new website's look (P2)

**Goal:** SC-008.

- [ ] T034 [US3] The figure comparison, `src/check/figures.ts` (SC-008).
  - Both sides are rasterised at one scale with pdf.js in Chromium: the PDF's figure, and the render service's SVG printed alone on a page with the same `@font-face` rules.
  - At most 1% of their pixels may differ.

  Tests: a figure drawn with a different selection fails it, and so does one with a different overlay (another token). Then run it on a sample of T031's book and of T023's single-event PDFs, and record the result here.

---

## Phase 7: User Stories 5 and 4 — the release's step, and licences in the image (P2, P1)

**Goal:** FR-009 in the image (US4, SC-006), and FR-010, FR-011, FR-012, SC-002, SC-003 and SC-007 (US5).

- [ ] T035 [US5] FR-012's comparison, `src/compare/`: `pdf-export compare <today's folder> <new.pdf>` (contracts/cli.md).
  - Both sides are reduced to FR-012's parts:
    - the covers' distinct names, counted, across today's files;
    - the introduction's release and counts;
    - the analysis properties;
    - each section's parts and text;
    - the contents' entries and targets;
    - the figures' kinds.
  - Names appear only as counts and hashes.
  - The cover's U+2060 and no-break spaces are normalised. List order is a recorded difference.
  - `--expected` takes the recorded differences.

  Tests on fixture PDFs: each part's difference is caught, and no name is printed.

- [ ] T036 [US5] The fixture's output as a baseline (the constitution's quality gate for a change to what is written).
  - `ci/fixture/expected.json` holds the fixture book and a fixture single-event PDF, reduced by T035's `compare`; `compare` gains `--reduced <file>` to take a reduced form as the reference, added to contracts/cli.md in this task (the fixture PDFs are not committed).
  - CI compares each PR's output with it, and fails on any difference that the PR does not also update.

  Show it failing on a changed section.

- [ ] T037 [US5] The container image, `Dockerfile`.
  - Node 24 on a slim base, Playwright's Chromium, and only FR-015's fonts.
  - It runs as a non-root user, and its entry point is `pdf-export`.
  - CI builds it and runs `book` over the fixture against the stubs.

  Test: a planted missing file fails the run with exit 1 and no book.

- [ ] T038 [US4] Licences and fonts in the image (SC-006, constitution II).
  - Run T002's check over the image's installed packages.
  - Keep Chromium's and the base image's licence notices in the image.
  - `fc-list` shows only FR-015's fonts, seen failing with `fonts-liberation` installed.
- [ ] T039 [US5] The release's step, documented in `README.md`.
  - The image runs with the release's graph and files as inputs and the render service beside it, and writes one PDF.
  - Keep it generic: the image, its inputs and its output, with no schedules, hosts or paths.
  - Time the run against SC-003 on the machine the release uses, and show a planted fault failing the step.
  - Raise the switch from `event-pdf` with the release's owners (spec, Assumptions).
- [ ] T040 [US5] The comparison with `event-pdf`, run on the private copy.
  - Compare the new book with today's 29 files, and a sample of single-event PDFs with today's.
  - Record each difference by part, kind and count, with its reason, in `specs/001-pathway-pdfs/differences.md`, with no names (SC-002).
  - Include the reaction overlay that the render service cannot draw yet (research R10), for single-event PDFs of reactions with a token.

---

## Phase 8: Polish

- [ ] T041 [P] `README.md` and `CLAUDE.md`: how to build, test, run `book` and `serve`; the settings; the fixture; and the checks.
- [ ] T042 [P] In WebsiteAngular, an issue, and later a spec there, for its part (research R10, FR-014):
  - the single-event route, in the content service, nginx and the dev proxy;
  - a cache-off setting for the render service;
  - page reuse, or many figures per page load (T005, T006);
  - an overlay on a reaction's drawing;
  - the plain diagram on demand;
  - a render bundle without FoamTree.

  Link it here.

- [ ] T043 [P] Ask the theme package's owners to declare its licence in the package. Link the issue here, and drop T002's exception once it is declared.
- [ ] T044 Remove the scratch baselines once T033, T039 and T040 are recorded: `event-pdf`'s book and single-event PDFs, the release's files and the private graph copy. They are kept outside the repository, and they hold names.
- [ ] T045 Check the success criteria, SC-001 to SC-009, and record the result here.

---

## Dependencies and execution order

- **Phase 1:**
  - T001 first.
  - T002 and T003 in parallel after it.
  - T004 after T003.
- **Phase 2:**
  - **Measurements:**
    - T005 first: the go or no-go for Phase 4. On a no-go, T042 is raised at once and T006 follows it (T006's client change also needs T014).
    - T007, T008 and T009 in parallel with T005; T011 after T005 (it uses T005's SVGs).
    - T010 written alongside, finished after T009; T012 only if T011 needs it.
  - **Shared code:**
    - T013 → T015 → T018 → T019.
    - T014 after T004; T016 and T017 alongside T013 and T015.
    - T018 needs T014, T016 and T017.
- **US2 (Phase 3)** needs Phase 2 and T010: T020 → T021 → T022 → T023.
- **US1 (Phase 4)** needs Phase 2 and a go from T005 (one resting on page reuse alone also waits for T042 to ship it), or T006's route: T024 and T025 → T026 → T027 → T028 → T029 → T030 → T031.
- **US6:** T032 needs T027; T033 needs T031.
- **US3:** T034 needs T019, T023 and T031.
- **US5 and US4:**
  - T035 after T031; T036 after T035.
  - T037 after T029.
  - T038 after T037.
  - T039 after T037.
  - T040 after T035.
- **Polish:** T041 at any time; T042 after T005 (at once on a no-go, or on a go that rests on page reuse); T043 at any time; T044 after T033, T039 and T040; T045 last.

## Parallel opportunities

- T002 and T003.
- The measurements: T005, T007, T008 and T009; T011 after T005.
- T014, T016 and T017, beside the graph reader and the model.
- US2 and US1 once Phase 2 is done.

## Implementation strategy

1. **Phase 1 and the measurements first.** T005's answer decides whether the book is built as planned.
2. **US2 first.** The website's PDF is smaller, exercises every part except the parts and the join, and replaces `event-pdf` in the content service.
3. **Then US1, the book,** with its check.
4. **Then the remaining checks and the release's step:** the look's check, the figures' check, the fixture baseline, the image and the release's step, with the comparison against `event-pdf` as the proof.
