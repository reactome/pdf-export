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

- [x] T005 Measure the figures' throughput at the book's scale (research R3, R7). — #95. The run conditions:
  - a private copy of the release's graph, with the release's diagram and EHLD files;
  - the machine the release would use, or this host, with `event-pdf`'s baseline run again if the machine differs;
  - cold, with an empty `RENDER_CACHE` directory, or a fresh `RENDER_CACHE_KEY`, for each run;
  - a sample of at least 2,000 figures in the book's mix: 85% reactions, 6% own diagrams, 1% illustrations, 8% selections.

  Measure three things:
  - **(a) The render service as it is,** at `RENDER_CONCURRENCY` 1, 2, 4 and 8, with `RENDER_QUEUE` raised to match so the run measures renders, not 503s. The service deliberately opens a fresh page per render, because a reused page leaks state such as a stale analysis token.
  - **(b) Page reuse,** through a harness on WebsiteAngular's `render-core` in `ci/measure/`: 1, 2, 4 and 8 reused pages, each reset between figures, with any leak checked by comparing a figure drawn after another with the same figure drawn fresh.
  - **(c) One figure on request,** for the PDFs made on the fly (a single event's, and the analysis report of spec 002, proposed in #51, which draws a genome-wide overview and up to 50 overlaid diagrams per request): the time for one figure with an analysis token, cold, at the service's settings for the website, and how it grows with requests at once.

  Record figures per second, CPU and memory, and the extrapolation to 19,313 figures, in research R7, and (c)'s times beside SC-005's budget. The script's output carries no names.
  - **Go** if (a) fits 19,313 figures in 44 minutes. A go on (b) alone is conditional: page reuse must ship in WebsiteAngular's render service first (T042), and Phase 4 then waits for it.
  - **No-go** otherwise: record the numbers, raise research R7's routes with the user, and take T006.

  **Done: a no-go** (research R7): at most 1.52 figures a second, at 8, limited by the host's processors, against 7.3 needed. (a) was run on samples of 100–200 figures, not 2,000, the gap being close to fivefold and the cost per figure rising with concurrency; (b) was not run, T006's route taking the figures out of the book's run, where it would only shorten the figures' step; (c) moves to T007. The script is `ci/measure/throughput.ts`.

- [x] T006 Only if T005 is a no-go: the route the user chooses (research R7). — #95.
  - **Many figures per page load:** an in-page API on the render page, raised in WebsiteAngular (T042, raised at once rather than waiting for Polish), and, once it ships, T014's client changed to send a batch per page.
  - **Or:** SC-003 amended with the release's owners, with T005's numbers.

  Record which here.

  **Taken: neither, a third route, the user's choice (research R7).** The figures are drawn by a step of their own before the book, `pdf-export figures` (T046), into a folder the book reads (contracts/figures.md); SC-003 is the book's time from figures already drawn, and SC-010 the figures' step. Many figures per page load stays in T042, to shorten that step.

- [x] T007 [P] Measure a single-event PDF's stages, cold (SC-005, research R7). With T005's (c): one figure with an analysis token, cold, at the service's website settings, and how it grows with requests at once. The render service runs with an empty cache directory. Use research R7's sample: five reactions, pathways of five sizes, and Signal Transduction. Time each figure, two at once. Record the times against `event-pdf`'s warm times in research R7. If figures alone exceed `event-pdf`'s whole time, raise SC-005 with the user, with the numbers.

  **Done** (research R7): figures alone exceed `event-pdf`'s whole time for every reaction and every pathway in the sample but Signal Transduction; one figure with a token takes 4.6 s, and 18.7 s for the last of eight at once. SC-005 raised with the user, who left the choice to us: a PDF without an analysis, of an event the figures' folder holds, reads its figures from it and must keep `event-pdf`'s times (T023 measures it); one with an analysis, or of another species, draws them on request within 8 s plus 3 s per figure (spec SC-005; T022, T023). The script is `ci/measure/single.ts`.

- [x] T008 [P] Measure the diagrams' widths (FR-016's floor, research R4). From the release's diagram files, take each diagram's width in SVG pixels at the website's 12 px node labels. Count how many fit at 5 pt in portrait (about 1,155 px), in landscape (about 1,750 px), and in neither. Record the counts in research R4. If more than 5% fit neither, raise FR-016's floor with the user. Measure the illustrations' lettering too (their text is outlines, so the layout cannot read it and reports them as unmeasured, T018): the smallest letter height in a sample of release 98's EHLDs, rasterised, and the scale that keeps it at 5 pt; then give `place()` a rule for them.

  **Done** (research R4) — #106. Release 98's 1,170 human diagrams, drawn by the render service from the release's own files: only 80 (7%) can print their 12 px labels at 5 pt on any page, the median at 2.1 pt; today's book, which has no floor, prints a median of about 1.85 pt. Raised with the user, who chose, for the reader on a screen: each figure as large as the page allows, portrait or a landscape page of its own where that is larger (1,060 diagrams and all 221 illustrations landscape), never split, linked to its interactive form on the website (FR-003, amended), and listed in the run report below 1 pt (100 diagrams). FR-016 and the data model amended. The illustrations' lettering, outlines, is read from their `PATHWAY TEXT` paths at the render service's viewport scale (`src/layout/lettering.ts`): every label about a 12 px font, 13.9–14.8 px in the render's frame, one at 7.2 px; the render's SVG and the file agreed. Tests: 11 for the lettering, 6 for the figure's links, the placement tests rewritten for the rule. Each of these mutants made one fail: the tallest line not taken, glyphs off the baseline counted, the viewport ignored or any matrix taken, relative commands read as absolute, subpaths merged, no cap-height ratio, an unreadable label skipped or its count dropped, the lettering ignored or used only without text, never landscape, landscape on a tie, the threshold back at 5 pt, the report at the portrait size, no link, no selection, a reaction to the Browser, the section linking the event's page. The link was printed and read back: one annotation over the figure on its landscape page; without the link's `inline-block`, two. From #105's review: `serve`'s bind names its second caller, the analysis gateway (contracts/cli.md, research R9).
  - **From #106's review (#107):** the lettering reader left a letter's holes in, so on a short label a counter could win the baseline vote (BBB read 62% small; release 98's smallest labels, long names, were unaffected, and R4's numbers stand, recounted); read an exponent as a command; joined a subpath begun after a close without a move to the one before; took a command with the wrong count of numbers; and read a label transformed, or in a transformed group, at full size. Holes are now left out, an exponent (either case) is a number, a subpath after a close starts at the last one's start, each command's count is checked, and a transformed label is unread, the groups followed through the markup in one pass of its tags. An ancestor's illustration standing in for an event now links with the event selected. Stale wording of the 5 pt floor is gone from the code's comments and R4. Each was seen failing first.
  - **From #107's review (#109, replacing #108 after its review):** a dot or an accent met first could begin a line of its own that the letters beneath it missed, and a mark set high won a tied baseline vote; two identical subpaths each hid the other; the scan of tags read comments as markup and only double-quoted attributes, and missed a transform on a link, by style, a nested `<svg>`, and a label kept in `<defs>`. Lines are now the letters whose heights overlap, directly or through others; a tie goes to the lower bottom; only a smaller box within another is a hole; every element is followed, comments and character data left out, attributes in either quotes, and each of those leaves the label unread. The render service's viewport writes its scale by attribute and again by style, to six figures: the two must agree (found when this PR's first version read the real render as unmeasured; the tests' viewport now has both, as the render's does). FR-003 names an ancestor's illustration standing in. R4's numbers, recounted, stand. Each was seen failing first. From #108's review: two of its tests passed with their own fix undone, each rescued by the other (the line test by the tie-break, the tie test by the order the letters were written in); the line test now has two dotted letters, whose dots outvote the f on a line split off, and the tie test writes the mark first, each now failing with its own fix alone undone. Also from it: the scan of comments, and of tags never closed, was quadratic (40,000 comments took 12 s; both now under 250 ms, tested, though a tag left open by an unclosed quote stayed quadratic until #111); a close tag ends the element it names, so a stray one ends nothing; the viewport's class is matched whole; element names are known with a prefix or in capitals.
  - **From #109's review (#111, replacing #110 after its review):** a tag left open by an unclosed quote still made the scan quadratic (4 s); XML allows no `<` in a tag, so none is matched now, and every such tag ends at the next `<` (tested). A close tag that skips open elements (malformed markup, which could end the viewport and read later labels at the wrong scale) now leaves every label after it unread. A label in a title, a description or metadata is unread, as one in `<defs>` is. From #110's review: a tag holding a `<` was no longer matched, so its element went unseen and a label in it was read wrongly (unread on main); a `<` that would begin a tag, met between tags, now leaves every label after it unread, and the notes say which malformed markup is caught and which is not (a quote left open, a stray close tag ending the viewport itself). Release 98's 221 illustrations and the sample render read exactly as on main. Not looked for, as the render service writes none of it: a style element's rules, `display="none"`, an unquoted value, an entity in an id, a name in capitals taken as SVG's. Each fix was seen failing first.
  - **From #111's review, recorded and not fixed** (three low findings, each on markup the render service does not write): a label whose own tag holds a `<` is dropped without being counted unread (it could be counted where the stray `<` is met); the notes on a quote left open are more cautious than the code needs; the cost grows with the square of the nesting depth, as on main.

- [x] T009 [P] Measure the analysis service's answers (research R6), on a private instance with a submitted analysis, never production. For each case, record the status and body in research R6:
  - a good token;
  - an unknown one;
  - a malformed one;
  - one gone within retention (as measured: no result, dated within the service's 7 days);
  - one older than retention (as measured: no result, dated 8 days ago or more);
  - `found/interactors` with none.

  Also record its retention period, and whether its summary carries the count of identifiers found (otherwise `/download/{token}/result.json` is needed). Recorded answers are scrubbed of host names, paths and identifiers before they are committed.

  - **Done (#119, replacing #112 to #118 after their reviews):** against a non-production instance on release 98, not a private one: nothing in its storage was touched, each case being a token the service reads by its own rules (analysis-core's `Tokenizer` and `TokenUtils`, read alongside), and one small analysis was submitted. The service reads a stored result first; its 7 days (a constant) only tell a missing result's 410 from its 404. How long a result is kept is not set by its token's age (the service's cleanup goes by the results folder's size and the files' last access, and results are also removed outside its code), so a result can outlive its 7 days and is then still answered. So the token's date is no longer judged here (T021) and there is no `--retention` setting. A malformed token is the service's catch-all 500, and a `/` in one is a 400 page or another route, so T021 accepts only the form the service issues. Neither `/token/{token}` nor `result.json` carries the found count; the found identifiers' CSV does, from the same map as today's book's count (over all the stored pathways, where the book's are filtered). `pathwaysFound` follows the analysis's `includeDisease`, so it is asked for with `includeDisease=true`, as today's book counts. Research R6 has the table. From #112's review: the includeDisease filter, the cleanup recorded as the retention, the wrong-padding and `/` cases, and R6's older text, which contradicted the measurement. From #113's review: Base64 of `_` alone passed the form rule and the service fails on it, so the rule now requires the decoded `{14 digits}_{digits}`; today's book counts after its own species and resource filter, not the stored list, recorded with the p-value edge; results are also removed outside the service's cleanup, and a resubmission can bring a token back; spec 002's "410 for one a release deleted" corrected, and whether its report checks the token's form left to its tasks. From #114's review: the counter is now bounded (a 7,000-digit one reached the servlet container's HTML 400); today's book counts over every species, and the p-value edge belongs to the identifiers count, not the pathways', as spec 002 already said; a `found/…` 404 may mean the result went mid-PDF; T010's 500 and non-JSON 400 cases; the instance's ASCII dates recorded. From #115's review: the bound is on the decoded token, so a token nested in `%25` layers still reached the HTML 400 when sent as given; the canonical token is what is sent. The p-value wording agrees with spec 002's (no pathway count differs in practice); the calendar named beside the digits; the CSV's file name a constant. From #116's review: T020 now carries the counts, the canonical token and each call's `Accept` (the CSV endpoint answers the framework's 406 to `application/json` alone); `/token/{token}` is paged to one pathway; spec 002's service contract's 410 row and its open item corrected. From #117's review: T010's stub answers a summary whose pathway count follows `includeDisease`, so T020's test catches a client leaving it out; a `found/entities` 404 and later 410s are stubbed and mapped; a missing `Accept` is answered, as the service answers it; the identifiers-found difference is among FR-012's expected ones. From #118's review: T010's CSV maps one identifier to two rows and T020 tests a row count fails; the stub's count changes with `species`; the CSV is fetched last; the summary's fields stay open to GSA's; why a resubmission reuses a token after the cleanup.

- [x] T010 The analysis stub, `test/stubs/analysis.ts`. It is a small HTTP server on loopback that answers T009's recorded, scrubbed answers:
  - 404 (unknown);
  - 410 (no result, dated within the service's 7 days);
  - found entities and interactors on a reaction's first parent pathway;
  - a 200 `/token/{token}` summary whose `pathwaysFound` follows `includeDisease`: the request's if given, otherwise the stored analysis's own, set to exclude disease pathways so that the two counts differ (as T009 measured, 229 and 191), and a different count again when `species` is sent;
  - a `found/entities` and a `found/interactors` 404, each meaning none;
  - a 410 from `found/…` and from the CSV after the summary's 200, as when the result goes while a PDF is made;
  - the found identifiers' CSV, `/download/{token}/entities/found/TOTAL/{name}.csv`, with one submitted identifier on two rows (mapping to two), and a 404 for it after the summary's 200, answering 406 as the service does to `Accept: application/json` alone (a missing `Accept`, or one listing `text/csv`, is answered) (T009: neither the summary nor `result.json` has the count);
  - a 500 in the service's catch-all form, as it answers a stored result it cannot read;
  - a 400 that is not JSON (the servlet container's own page), as for a request it refuses before the service sees it;
  - a 503, for the `unavailable` answer.

  It can be written before T009, answering contract-shaped placeholders; T009's recorded answers replace them, and the task is ticked only then.

  - **Done (#123):** `test/stubs/analysis.ts` serves `/AnalysisService` on loopback and reads a token by the service's rules (URL-decoded until unchanged, Java's basic Base64, a stored result answered whatever its age, a missing one 410 within 7 days or in the future and 404 otherwise), so its 404s and 410s come from the tokens' dates, as the service's do. `TOKENS` holds a case per row of research R6's table; `forget(token, after)` removes a stored result after so many requests for it (a 410 or a 404 later in a PDF), and `refuse(times)` answers 503. The analysis is of made-up identifiers on the fixture's pathways, plus a disease pathway the graph does not hold and mouse's pathway: 5 pathways hit with disease pathways, 4 without (the analysis's own setting) and 4 for human alone, or 1 for mouse. The answers' shapes were read again from the non-production instance (GETs only): the found entities' and interactors' lists, the CSV and its 406. Like the render stub, it answers 400 to a parameter pdf-export never sends, which the service would ignore. Tests in `test/stubs/analysis.test.ts` (14). Each of these mutants made one fail: `includeDisease` ignored; `species` ignored; the CSV's rows one per submitted identifier; the date judged before the stored result is read; any `Accept` taken; a forgotten result kept; Base64 of `_` read as no date; 8 days taken as alive; no 503; an encoded `/` passed to the service.
  - **Carried from #119's and #122's reviews (lows):** research R6's summary fields no longer list `server` (the service never writes it) and say the service leaves out null ones, not empty ones; T048 notes that the cover's figure must be in the front part's figures, as a missing one is dropped without a word; data-model's "none of today's names" breaks the file-name rule is marked as not yet measured.

- [ ] T011 [P] Measure the join and stamping at the largest PDF's size (research R4; the book is one PDF per top-level pathway since 3 Nov 2026).
  - Print synthetic parts totalling 3,760 pages (today's largest file), with figures in the real book's mix (T005's SVGs, so after T005), and join a few such PDFs at once, as `book` would.
  - Join them with `@cantoo/pdf-lib`, or pdf-lib 1.17 if the fork fails the tests.
  - Rewrite the links through placeholder URIs and probes recording page and y.
  - Write a nested outline, and stamp page numbers and headers in embedded Roboto.

  Record time and peak memory per stage against research R7's 13 + 6 minutes. The script lives in `ci/measure/`.

- [ ] T012 Only if T011's join of one PDF (about 3,760 pages) does not fit in memory: join in groups (research R4). Unlikely since the book became one PDF per top-level pathway (3 Nov 2026). Join the parts a few at a time into intermediate files, then join those, keeping the links' and the outline's targets. Record the memory and time against the budget.
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

  — #30, replacing #29 after its review. `client.ts` builds each request's URL. The token is given as the analysis service issued it, and `URLSearchParams` encodes it once. A 503 is tried once more after a fixed pause (the service asks for 5 s); a second 503, any other refusal, a timeout (the body's read included), an answer cut short or one that is not SVG is a missing figure, with its reason (a connection's error code included). `prefix.ts` prefixes every `id` (double- or single-quoted), `url(#…)` (bare, quoted, or with `&quot;` as a style attribute writes it) and local `href`/`xlink:href`, leaving `data:` images and web addresses alone; the test fails on a `url(` of a form it does not know. Ten tests (and the stub's `stall-body` and `not-svg` refusals). Each of these mutants made one fail: the body's read unguarded (a timeout there threw), the type unchecked, the connection's code left out, `&quot;` or single-quoted ids not handled, `analysis=` for `token=`, the token encoded twice, `select=` for `highlight=`, no retry, a retry of every refusal, and ids, `url(#…)` or `href="#…"` left unprefixed. Alpha's and beta's diagrams, and Gamma's illustration inlined twice, keep every id unique with every reference on the page. From #28's review: tests for a versioned stable id of a non-event, and for `edits` given an id twice. Taking `unique()` out of `edits` fails no test: the query groups rows by event before collecting, so a doubled id cannot double them.

- [x] T015 The model, `src/model/` (data-model.md):
  - the entities: `Event`, `Section` (full or short, with its anchor and path), `Figure`, `Cover`, `Contents`, `Book`, `SingleEventPdf` and `Release`;
  - the figure's kind, chosen as data-model.md says: the event's own diagram; its nearest ancestor's with a selection, the ancestor nearest a top-level pathway winning among several parents; an illustration from the summary (unselected, recorded, where the ancestor's is one); or a reaction;
  - the parts' rules of research R2: the "disease" exclusion; the edit grouping and order, with no-date and no-author edits dropped; an event's subtree written under its first place only; `inferredFrom` sorted by species name, then name;
  - summations' HTML sanitised to the tags the website's pages allow.

  Tests in `test/model/` against the fixture, each rule seen failing once.

  — #32, replacing #31 after its review. `types.ts` holds the entities; `rules.ts` the parts' rules; `build.ts` builds the book (a species' top-level pathways by name ignoring case, every depth) and a single event's PDF (depth 0 or 1). The tree is read a level at a time, each pathway's children once; places are made depth-first in the curators' order; an event is in full at its first place, its subtree under that place only, and a short entry elsewhere. A new reader query, `diagramChoices`, gives a diagram-less pathway's nearest diagram-bearing ancestors (none between) with their depth from a top-level pathway, and the reactions to select (none under another diagram). Summations are sanitised with `sanitize-html` (MIT) to paragraph, line-break, emphasis, sub- and superscript, list and web-link tags; the website's own tag set is not known here, so this is the plan's conservative choice. Twelve tests: five on the rules without a graph, seven on the fixture. Each of these mutants made one fail: the "disease" kept, inferred-from unsorted, undated edits kept, edits never grouped, a row's authors unsorted, summations unsanitised, an ancestor's illustration ignored, the farthest ancestor chosen, a subtree written at every place, chapters ordered by case, the contents' own entry left off, and contents at depth 0. From #30's review: single-quoted local `href`s are prefixed too (seen failing on the old code), and the stub's header lists its refusals. From #31's review, each against event-pdf's source: (1) among ancestors with diagrams, a top-level pathway ranks last, as graph-core's `getDiagramResult` gives it no level (the first version chose it; on release 98 no human pathway meets the case, measured over all 1,499 without a diagram); (2) an edit joins the row of the edit before it, as `Tables.createEditionsTable` compares them, not the row as it has grown, with the authors compared as sets (an obvious fix); (3) a row's kinds in event-pdf's order; (4) sorts by code units, as Java's `compareTo`, not the host's locale; (5) summations keep tables (the website shows them through Angular's default sanitiser, which keeps them; release 98's human summations hold 70) and lose relative and in-page links' addresses; (6) a section holds its own lists, not the raw ones, and the events before and after only those the PDF holds; cover names once by name. The fixture gains a diagram between a top-level pathway's and a pathway with none, a diagram-bearing pathway under one without, and an ancestor at two depths: 63 nodes and 109 relationships. The reader's three big queries go in chunks of 2,000 ids, and a level is read once whatever the paths to it. Each of the eleven new mutants made a test fail: compared with the row, kinds unordered, surnames by locale, names once by id, no tables, relative links kept, a top-level pathway first, ancestors through a diagram, reactions under another diagram, the depth's maximum, and before and after unfiltered. From #32's review, in #33: edits tied on date and first surname are ordered as event-pdf leaves them (it lists edits kind by kind and sorts stably), by kind and then id, so neighbours group as today (seen failing without the tie-break).

- [x] T016 [P] The text that is not data (FR-009): Reactome's institutions and licence statements, the introduction's text, Reactome's own references, and the analysis section's explanations. Take each from the website's current wording, or from the release's owners, or write it anew. Nothing is copied from `event-pdf`. It goes in `src/layout/text.ts`, with its source named in a comment. Ask the release's owners in the PR for any that cannot be taken from the website.

  — #38, replacing #37 after its review. `src/layout/text.ts`, each piece with its source named: the institutions (the website's team page), the licence statement as the website's licence page has it (data CC0, illustrations and art CC BY 4.0, linking `/about/license`; the user chose the website's statement over event-pdf's "CC BY 4.0" for the whole, now recorded in the spec's Background, User Story 4 and expected differences), the introduction's opening (the website's mission statement, its first two sentences), the analysis explanations (the website's analysis guide), and the release and contents lines written anew. Reactome's own papers are in `src/layout/references.json`: the two newest knowledgebase papers' titles, journals, years and DOIs from the website's publications page. The user chose full author lists; the code does not write people's names (the organisation's rule for this work), so each paper's `authors` is left for the release's owners to fill in, as written on that page. Nothing is copied from event-pdf: compared with its sources, no six-word run is shared but the CC BY licence's address and an institution's name (the species-comparison sentence, which both took from the website's guide, is reworded). Four tests.

- [x] T017 [P] The theme and fonts (research R5).
  - `theme/pdf-theme.scss` uses the website's theme package, `ngx-reactome-style`, at the version the website's lockfile pins, with `@angular/material` and `@angular/cdk` at the website's versions.
  - `sass` compiles it at build time to `dist/theme.css`: the light theme's `--mat-sys-*` variables only.
  - The fonts come from `@fontsource`, all OFL-1.1: Roboto (300–600), Roboto Mono, Noto Sans, Noto Sans Symbols 2 and Noto Sans Math.
  - A character none of them covers is found with `fontkit`, as `uncovered-character <code point>`.

  Tests in `test/layout/theme.test.ts`: the variables are the theme's, with none written in our code, and a planted uncovered character is caught.

  — #36, replacing #35 and #34 after their reviews. `theme/pdf-theme.scss` lays the website's theme package (`ngx-reactome-style` at the commit the website's lockfile pins, `606de81b`, with `@angular/material` and `@angular/cdk` 21.2.14 and `sass` 1.97.3, its versions) on a selector of our own (below); `src/layout/theme.ts` compiles it and keeps the light theme's 165 `--mat-sys-*` variables, 29 distinct colours (primary `#006781`), and `npm run build` writes them to `dist/theme.css`. `src/layout/fonts.ts` lists the @fontsource files (57 upright WOFF2 subsets at the pages' weights) and, with `fontkit` (MIT), the 7,501 code points they draw; `uncoveredCharacters` finds what none draws, named as `U+XXXX`. The licence check passes on every installed package (159 here; the count depends on the platform's optional binaries), the theme package's exception now in use. Five tests. Each of these mutants made one fail: a primary colour of our own, a colour written in our code, a coverage check that never finds a gap, and each of the three Noto fonts left out (each draws characters the others do not: braille, a combining caron, a Cyrillic supplement letter).

  - **From #34's review:** the light theme goes to a selector of our own, `.pdf-light`, read as exactly one top-level block, not to `:root` (a future theme release could put `:root` blocks elsewhere); the packages are found by name, wherever the install put them. `fontFaceCss` writes the pages' `@font-face` rules, each file's `unicode-range` taken from its own character map: Chromium chooses a face by its declared range, and @fontsource declares Noto Sans Math's whole file as Latin, so 2,425 code points the check counted as drawn would have printed as missing glyphs. Variation selectors and other default-ignorable characters are not counted as uncovered. The colour guard takes every hex length, colour functions and named colours. Seen failing: ranges like @fontsource's, `\p{Cf}` for the ignorables, the light theme on `:root`, and an `hsl()`, a named and an 8-digit colour planted.
  - **From #35's review:** a file's character map is wider than its subset (Roboto's math and symbols files hold A–Z too), and Chromium tries overlapping faces last-declared first, so plain text came from the symbols file, as the reviewer saw Chromium load it. Within a family and weight each character now goes to one file, Latin first (`fontFaces`), and the faces are computed once. Seen failing with the overlapping ranges, and checked in Chromium: plain text now loads `roboto-latin`, α `roboto-greek`, and ✓ and 𝔄 the Noto files.
  - **For the layout (T018):** characters none of the fonts draws include ‰, ℃ and the ﬁ ligature; measure release 98's summations for them once the layout exists. The theme's `--mat-sys-level*` shadows use colours outside its palette, so the layout uses no elevation (SC-009). The fonts have no italic or Mono-bold faces: emphasis and bold identifiers are synthesised, as the website's are.

- [x] T018 The layout, `src/layout/`: HTML for each part of data-model.md, in order (FR-005).
  - **Parts:**
    - the cover (the book's per FR-002, a single event's per the Background);
    - the introduction (T016's text);
    - the analysis properties;
    - each section's parts;
    - the contents list, with fixed-width placeholders for page numbers.
  - **Style:** the theme's CSS, and `@font-face` rules for the local fonts.
  - **Figures:** inlined, sized to FR-016's floor, which T008 later replaced (5 pt labels, or a landscape page of its own), with `break-inside: avoid`.
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

  — #40, replacing #39 after its review. `src/layout/document.ts` lays out a single event's PDF as one HTML page (`layoutSingle`), and the book as a front part (`layoutBookFront`) and parts of sections (`layoutBookPart`, given its places by T025). `front.ts` writes the cover (the website's logo, its positive imagotype from `content/about/logo.mdx`, which invites its use; the title, the release for the book, a single pathway's diagram fitted to the cover, the excerpt note linking the website's download page, the names, institutions, licence and date), the introduction, the analysis's properties and the contents list, each entry's number a placeholder `0` in a box of fixed width with `data-target`, for T019. `section.ts` writes each section's parts in FR-005's order and the book's short entries (FR-004); `html.ts` the links of FR-003, events' pages at the website's `/content/detail/{stId}`, and in book mode `https://anchor.invalid/<id>` placeholders with a `https://probe.invalid/<id>` probe first inside each target. `figure.ts` sizes figures: as large as the text area allows, never above their own size, in portrait when the smallest label is at least 5 pt there, otherwise on a named landscape page when that prints larger; below 5 pt even so, listed in the layout's report with missing figures. A figure with no label whose size can be read (an illustration, its lettering drawn as outlines) is placed by its size alone and listed as unmeasured. `pages.css` takes every colour and type size from the theme's variables, sets thin rules and no boxes, 20 mm margins on every page; a single PDF's running headers and numbers are `@page` margin boxes, none on the cover. The analysis's types (`AnalysisProperties`, `Found`) are in `src/model/types.ts` for T020 to fill. `playwright-core` 1.64.1 and `pdfjs-dist` 6.4.299 (both Apache-2.0) are dev dependencies for the print tests, and CI installs Chromium's headless shell. 27 tests. Each of these mutants made one fail: the landscape page's margins at 10 mm, no named landscape page, an unsized probe, a numbered cover, a contents page with no header, never landscape, the first label taken for the smallest, no cap at the figure's own size, no fit to the page's height (the figure then split across pages), the book's links as fragments, probes in a single PDF, a location always linked, inferred-from always to the website, the summation before the figure, a missing figure not reported, the analysis after the contents, the excerpt note on the book, the root's font size set to body-medium, text and the header's CSS string left unescaped, no check that the analysis and the contents list agree, points read as pixels, relative sizes read as pixels, and an illustration never reported as unmeasured.
  - **From #39's review:** the root kept the theme's body-medium size, so every rem size printed at 0.875 of the website's (headers 7.9 pt, not 9); the root now keeps 16 px, checked on a print. Illustrations were never checked against the floor (their lettering is outlines, so no label size is read, and they were taken as legible); they are now reported as unmeasured, and T008 measures their lettering. The analysis's part and the contents' entry for it came from two inputs; `layoutSingle` now refuses a document and an analysis that disagree. Label sizes in points are read, relative ones (em, %, rem) are not guessed at; a label scaled by a transform is still read at its own size (the render service's diagrams use none). Escaping is tested; ids are escaped as attributes; the cover's names are separated by semicolons, since each name holds a comma.
  - **From #40's review (#45, replacing #41 to #44 after their reviews):** a label's size is read only as a whole value: a number (with an exponent, as `1e1px`) and an absolute unit in any case (px, pt, pc, in, cm, mm, Q). Every other size is counted unread and makes the figure unmeasured, not legible: relative units (em, %, rem, ex …), keywords (x-small, smaller, inherit), functions (calc, var), zero and an overflowing number. In a `font` shorthand the size is its first number with a unit that is not an angle, before any `/`, so a weight, an oblique angle or a line height is not read as one. Style elements are read; the text drawn, data attributes and custom properties (`--my-font`) are not. The markup is read in one pass that ends a tag at the first `>` outside a quoted value, so a `>` in an attribute's value does not hide the size after it, and a stray `<` in text does not swallow the tag after it, while what came before it is kept as markup, so a malformed tag (no `>` of its own, or an unquoted `<` in a value) still gives its size; comments and character data are left out; a style element's rules end at its own end tag, prefixed or not, and a self-closing one has none; a size marked `!important` is read (in an attribute too, where a browser would ignore it: that errs small). The root's start tag is found without a pattern. Numbers are matched anchored. Inputs that made earlier readers backtrack are each read in under 250 ms, seen failing with the earlier reader each names: digits in the shorthand (2.0 s), a tail of `>` (7.0 s, with the unclosed style elements in the same run) and a stray `<svg` with no root (2.7 s); unclosed style elements alone took 1.4–3.2 s with #42's reader, as #43's and #44's reviews measured, a 5 MB diagram in about 110 ms. The report's lists, the escaped ids and the cover's semicolons are tested. Each change was seen failing with its mutant.
  - **From #45's review (#46):** a stray `<` (in text, or a tag missing its `>`) is now counted unread, so a size read after it, where there was none, does not make the figure's labels known: such a figure is reported as unmeasured. An unquoted `font-size=1`, which an HTML parser takes when the figure is inlined, is read, as is one with spaces around `=`; before, neither was seen. The smallest label is found with a loop: `Math.min` over every size overflowed the stack on a figure of 300,000 labels. Each seen failing with its mutant.
  - **`break-inside: avoid` is not what keeps a figure whole.** Chromium moves an SVG no taller than a page to the next page whole with or without it; removing it fails no test. What keeps a figure whole is that none is sized taller than the page, which the split test catches.
  - **For T024's preflight, measured on release 98** (every summation and event name): three characters no font draws, U+2011 (non-breaking hyphen, on 197 lines), U+FB01 (the ﬁ ligature, 5) and U+02D9 (dot above, 1); ‰ and ℃ do not occur. As T024 stood, each failed the book; the user chose to map them (FR-017, #53), and T024 now lists the substitutions.

- [x] T019 Printing, `src/print/print.ts` and `src/print/contents.ts`.
  - One Chromium (`playwright-core`). Pages are loaded with `goto` on a file, not `setContent` (research R4), on A4 `@page`.
  - **A single-event PDF** is printed tagged, with Chromium's outline. With a contents list, the second pass reads where each section landed, with pdf.js, and prints again with the numbers in the same width (research R4).
  - **A part** is printed untagged, with placeholder links.

  Tests in `test/print/` on fixture HTML:
  - fonts embedded (pdf-lib's `FontFile*`), and no system font present, seen failing with a `setContent` load;
  - the outline nested;
  - internal links landing on their pages;
  - every contents number its target's page, seen failing with the placeholders left in.

  — #48, replacing #47 after its review. `Printer` (`src/print/print.ts`) starts one Chromium (`playwright-core` 1.64.1, now a runtime dependency, as is `pdfjs-dist` 6.4.299), writes each page to a file in a folder of its own and loads it with `goto`, loads every face the page declares and refuses one that does not load, and prints on the page's A4 `@page`. `single` prints tagged with Chromium's outline; with a contents list it reads where each target landed from the first print and prints again with the numbers in their boxes, and refuses a second print whose pages differ from the first's. `part` prints untagged. `src/print/contents.ts` finds each target's page from the named destination Chromium writes for every anchor a link points at (every contents entry links to its target), read with pdf.js, and fills the placeholders. The font check uses `@cantoo/pdf-lib` 2.11.1 (MIT; the plan names this fork, research R4 measured pdf-lib 1.17), a dev dependency for now: every font dictionary in the PDF names one of FR-015's families, none is Type 3, and each carries its file. Its dependencies' ranges are open (`culori >=4`, `tslib >=2`, `node-html-better-parser >=1.5.9`); the lock pins them, and they are to be checked when it becomes a runtime dependency (T026). Ten tests (the tenth, the comparison, from #49): the fixture's pathway at depth 1, its reaction alone and a part of its book, two pages made for the purpose (a header whose characters nothing else uses, and one whose pages move), and the comparison of two prints. Each of these mutants made one fail: `setContent` in place of `goto` (every printing test, through the shared setup's refusal of fonts that do not load; without the refusal, system fonts appear, as research R4 found), no second pass, each page counted one too low, and a single PDF printed untagged (no outline). The contents numbers are checked against each heading's page found in the text, not against what `contents.ts` read.
  - **From #47's review:** the link test passed with every link landing on the contents page, which lists every title; a link must now land on a page where its target's title is a heading. Waiting for `document.fonts.ready` left out text only in a running header (its faces were never asked for, and the header was not printed at all); every declared face is now loaded first, and a face that fails to load is refused, which also catches research R4's `setContent` trap whatever fonts the host has (a name check passed on a host with Roboto installed). A part is checked to print untagged with its placeholders and probes, and the refusal of a second print whose pages moved is shown with a page made to move. A failure to start or close no longer leaks the browser or the folder. New mutants, each caught: only `fonts.ready` awaited (the header test), font failures not refused, a part printed tagged, and moved pages not refused.
  - **From #48's review (#49):** each half of the moved-pages check (another page count, a target on another page) is shown alone, on the comparison itself; a link landing on the cover fails the link test (the cover's title and figure labels are as large as headings). Loading every face costs 130–160 ms a print (57 faces decoded each time): T025 and T026 are to account for it at the book's scale, or load the faces once a browser context.

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
  - It reads the summary, and the found entities and interactors by pathway. A `found/entities` or `found/interactors` 404 means none (research R6).
  - The counts (research R6): the pathways hit are `pathwaysFound` from `/token/{token}?resource=TOTAL&importableOnly=false&includeDisease=true&pageSize=1&page=1`, with no species; the total adds its `identifiersNotFound`; the identifiers found are the distinct submitted identifiers in `/download/{token}/entities/found/TOTAL/{constant}.csv`, its header skipped. The analysis's own `includeDisease`, if shown, comes from an answer asked for without the parameter.
  - The token sent is the canonical one (T021). Each call sends its `Accept` header as research R6 gives it (the CSV `text/csv, application/json`, the rest `application/json`); a test shows the stub's 406 to `application/json` alone. A test fails when `includeDisease=true` is left out, or `species` sent (the stub's pathway count then differs), and one when the CSV's rows are counted rather than its distinct submitted identifiers. The CSV is fetched after every `found/…` call, so a result gone mid-PDF ends it rather than reading as none found. A later 410, or a 404 from the CSV, ends the PDF as `gone-token` or `unknown-token` (research R6), each tested.
  - A reaction's results are filtered to its own identifiers, from its first parent pathway's results.
  - It uses FR-006's defaults: all resources together, no expression column, all identifiers.
  - The overlay's species is the event's.

  Tests against T010's stub.

- [ ] T021 [US2] Tokens, `src/analysis/token.ts`.
  - A malformed token is `unknown-token`: anything but the form the service issues (research R6: URL-decoded until unchanged, then non-empty ASCII letters and digits with at most two `=` of padding, decoding to `{14 digits}_{1 to 19 digits}`). Tests include wrong padding (`QQ=`), Base64 of `_` alone (`Xw==`), a counter of 20 digits, a token nested in many `%25` layers (accepted, and sent canonical), an empty token, a `/` encoded and raw, a `+`, and a decoding error. What is sent is the canonical token (padded Base64, `=` as `%3D`), never the input as given.
  - The token's date is not judged here: the service's 404 is `unknown-token`, its 410 is `gone-token`, and any other failure is `unavailable` (research R6, from T009).

  Tests for each case of T009's table, each seen failing.

- [ ] T022 [US2] The service, `src/serve.ts` (contracts/service.md).
  - **Routes:** `GET /event/{stId}.pdf?depth&token` and `GET /health`.
  - **Figures:** every figure drawn on request, with the token where there is one; a figure that cannot be drawn leaves its section without it, logged. Reading the figures' folder is T047's, after T024.
  - **Settings:** bind address (loopback by default), port, `--graph`, `--figures`, `--render`, `--analysis`, `--files`, `--site` and the concurrency limit, each with its environment variable where contracts/cli.md gives one.
  - **Answers:**
    - 200 with `Content-Disposition` naming the stable identifier;
    - 400 `bad-depth`, then 400 `not-an-event` or 404 `no-event`, then the token's answer (404 `unknown-token`, 410 `gone-token`), in that order;
    - 503 `unavailable` when a service cannot answer or the limit is reached.
  - **Health:** the version, the graph's release, and whether the render and analysis services answer.
  - **Content:** bookmarks in every PDF (FR-006). A figure that cannot be drawn leaves its section without it, logged.
  - **Characters (FR-017):** FR-017's substitutions, then any character no font covers printed as U+FFFD, in the texts and in the figures' labels alike: the labels go through `src/figures/labels.ts` in its on-request mode, which replaces and logs instead of raising the book's fault. Each code point is logged once per PDF, the texts' and the labels' sharing one log, with the stable identifier or token, never the text; never a failed request. T022 creates `src/layout/characters.ts` and `src/figures/labels.ts` with the list and the on-request mode; T024 adds the book's fault mode and the preflight. Tested with:
    - a planted character in a text: U+FFFD in the PDF's text, one log line with the code point and the stable identifier;
    - one in a stub figure's label (a stub setting): the answer 200, the figure present, its label holding U+FFFD, one log line naming the code point and the stable identifier (seen failing with labels not passed through `labels.ts`, and with the book's mode, whose fault would drop the figure);
    - the same code point in a text and in a stub label: one log line, not two (seen failing with a log per source);
    - the same character a thousand times in one text: one log line; distinct characters give a line each.

  Tests in `test/serve.test.ts` against the stubs:
  - each status, seen failing;
  - a bad identifier with a bad token gives the identifier's answer;
  - no reason carries a path, a host or a name.

- [ ] T047 [US2] The figures' folder in the service, after T024 (contracts/service.md, spec SC-005).
  - With `--figures`, the folder is used for a PDF without a token while it passes T024's folder checks against the graph's current release: the full checks at start and whenever the folder's fingerprint or the graph's release and checksum change (those read again at most once a minute); otherwise every figure is drawn on request and `/health` says why (`stale`, `incomplete`, `none`).
  - A figure the folder lacks (another species' event) is drawn on request and logged.

  Tests: a PDF without a token asks the render stub nothing; one with a token asks for each figure with the token; a folder of another release is not used and `/health` reports it; a figure the folder lacks is drawn and logged; the full checks run once at start and again only when the fingerprint or the release changes (the graph stub counts its reads).

- [ ] T023 [US2] SC-005, measured, after T046 and T047. Run the service against a private copy for research R7's sample, with one non-human reaction and one non-human pathway added, and the human sample once more with the folder taken away (SC-005's missing-folder clause), the service's process already running (its first layout paid) and the render service cold (a fresh `RENDER_CACHE_KEY`, its browser warmed on a figure no sampled event draws): without a token, reading a figures' folder drawn by T046, against `event-pdf`'s warm times; with a token, against the 8 s plus 3 s per figure of SC-005, a plain diagram's overlay now, and an illustration's and a reaction's in a later run once their overlays exist (T042, recorded then in research R7). Record both in research R7. If either is over, raise SC-005 with the user, with the numbers.

**Checkpoint:** the website's PDF works on its own, and WebsiteAngular can route to it
(T042).

---

## Phase 4: User Story 1 — the release's book (P1)

**Goal:** `pdf-export book` writes the `TheReactomeBook` folder, one PDF per top-level
pathway named as today's, and checks it (contracts/cli.md).

**Independent test:** quickstart §4, on a private copy. There is one PDF per top-level
pathway and no other. Every event is in its PDF's contents and bookmarks. `check-book`
passes.

- [ ] T048 [US1] The book as one PDF per top-level pathway (user's decision, 3 Nov 2026; FR-001, FR-002, data-model BookPdf), changing what T014 and T018 built for one PDF.
  - `src/model/build.ts`: the graph is read once, as now, and split, with what is computed over a document computed per document: the events it holds (`held`, so a reaction's events before and after in another PDF are dropped), each event's first place, and the cover's names: the book gives one document per top-level pathway, by name ignoring case (FR-002), each in full depth with its own cover (the pathway's name and diagram, the names across its own events, no excerpt note), introduction and contents. An event is in full at its first place in each document and a short entry at its later places there; one under two top-level pathways is in full in both.
  - The layout needs no change: `layoutBookFront` already inlines a cover's figure (`src/layout/front.ts`), and the cover now has one, set by `build.ts`, so the front part falls under T024's label check before it is printed. `build.ts` must also put the cover's figure among the front part's figures: one missing there is left out of the cover without a word, so a test checks the cover holds its diagram.
  - Links (FR-003): to a section only within the same PDF; an event held only by another of the book's PDFs is as any event a PDF does not hold: plain text in a location, its page on the website for what an event was inferred from, and left out of a reaction's events before and after (`build.ts` already drops those). The excerpt note's "The Reactome Book" (`src/layout/text.ts`) names the book, which stays its name.
  - **What changes in the code and tests built for one PDF:** `src/model/types.ts` (`Cover.release`, "a book's chapters"), `src/model/build.ts` (its header and the book's assembly); `test/model/build.test.ts` (chapters across the book; the shared reaction, now in full under both top-level pathways; the subtree beta reaches through "beta sub with diagram", whose "Alpha sub two", "Two-parent sub" and "Disease reaction" are now in full in beta's PDF as well, so the places asserted for them change; the book's cover and counts), `test/layout/layout.test.ts` (Reaction one's events before and after it in other top-level pathways' PDFs, Polymerisation four and Inferred reaction, are now left out; the book's front and its title), and `test/layout/fixture.ts`, `test/layout/print.test.ts` and `test/print/print.test.ts`, which build one `built.book`.

  Tests on the fixture: one document per top-level pathway in name order, seen failing with one document; an event under two top-level pathways is in full in each, seen failing with a short entry in the second; each cover's names are its own document's, seen failing with the book's names; no link targets a section in another document.

- [ ] T024 [US1] The preflight, in `src/cli.ts` `book --files <dir> --figures <dir>` (contracts/cli.md).
  - **Figures:** each figure the Figure rules choose must be in `--figures` (contracts/figures.md); one missing is a fault `missing-file {stId}.svg`, and the folder checks contracts/figures.md lists under "What `book` checks" (`incomplete-folder`, `no-checksum`, `stale-folder`, `stale-summary`, `stale-figure {stId}`); T024 adds a `checksum` to the fixture's `DBInfo` and to `src/graph/queries.ts`'s release reader. The preflight's checks live in `src/preflight/`, for T046 to run too. Tests, with a figures' folder the test writes (T046 comes after): a planted missing figure file, a manifest entry with another source, a figure the rules choose with no line, a line for an event the rules give no figure, a folder of another checksum and one of another release number (`stale-folder`), one of another summary hash (`stale-summary`), a folder with no `complete` line, one with a figure line after `complete`, one with a torn last line, one with a middle line that is not JSON, one with two lines for one figure, and one whose `complete` differs from its first line (each `incomplete-folder`), and a graph with no checksum (`no-checksum`) are each caught before anything is printed.
  - **Files:** the files the figures need come from the graph's events. The summary only says which of them are illustrations, and its entries for events the graph does not hold are ignored (research R7). Each missing file is a fault `missing-file <name>`.
  - **Characters (FR-017):** first FR-017's substitutions, in T022's `src/layout/characters.ts` (with T017's detector), which T024 extends with the book's fault mode, applied to every text the layout writes and to the text of every inlined figure's labels (their text content only, never an element, id or attribute): U+2011 (non-breaking hyphen) by U+002D, which every face draws and a reader's search finds; U+FB01 (the ﬁ ligature) by "fi"; U+02D9 (spacing dot above, in release 98 a radical's dot, "O2˙−") by U+2022; and U+05F3 (geresh, in release 98 a prime, "2׳-O methylation") by U+2032. Measured on release 98, every text the PDFs print but people's names: summations and event names (U+2011 on 197 lines, U+FB01 on 5, U+02D9 on 1), publications' titles, journals and chapters (U+2011 on 6, U+05F3 on 1), and the names of compartments, diseases, species and physical entities (none); and the 115,376 `displayName`s of the nodes, compartments, notes, shadows and links in the release's 1,390 human diagram files (`{stId}.json` only, not `.graph.json`; the 220 illustrated pathways' files among them, a superset of what is drawn) (none). People's names were not measured (the organisation's rule on personal information); the preflight checks them, as everything, when the book is made. Then each character no font covers is a fault `uncovered-character <code point> <stId>` (T017's detector), checked twice (contracts/cli.md): before drawing, over the texts, the names the figures label (every physical entity a reaction's figure draws, inputs, outputs, catalysts and regulators, and their compartments, from the graph) and the labels of the diagram files the Figure rules choose to draw, read in `src/preflight/labels.ts`; and after drawing, before each part is printed, over each SVG's label text, in T022's `src/figures/labels.ts`, extended here with the book's fault mode, which also makes the substitutions there after T014's id prefixing. Only the substitutions made in what is printed are counted for the run report, not the preflight's own.
  - **File names:** a top-level pathway's name holding `/` or NUL, or over 255 bytes with `.pdf`, or two names equal ignoring case, is a fault `bad-file-name <stId>` (data-model Book); tested with a planted name of each kind.
  - Any fault means exit 1, with no book written (Story 5, scenarios 3 and 4).

  Tests:
  - a planted missing diagram, a planted missing illustration and a planted uncovered character are each caught;
  - each of the four substitutions is made, in a text and in a figure's label, and none is a fault;
  - a character off the list in a diagram file's label is a fault naming that diagram's pathway; one in a physical entity's name a fault naming the first event whose figure holds it; and one in a compartment held only by a participant, named in no event's section, likewise (so only the figures' names can find it);
  - T024 adds to the fixture graph a compartment held only by a participant's physical entity, for the compartment test above;
  - one in an illustrated pathway's diagram file (`R-HSA-90000300.json`, Gamma pathway) is no fault, as the Figure rules draw its EHLD;
  - one in a drawn figure's label alone is a fault after drawing, before its part is printed (the stub serves such a label only when a test sets it at construction, so the fixture's own run stays clean);
  - a label in a diagram file the book does not draw is not read: a character off the list planted in `R-MMU-90000900.json` is no fault in the human book;
  - a substitution in an inlined figure leaves its elements, ids and attributes as they were;
  - the fixture summary's entry for an absent event is not a fault.

- [ ] T046 [US1] `pdf-export figures`, `src/figures/step.ts` and `src/cli.ts` (contracts/cli.md, contracts/figures.md, SC-010).
  - Lists the book's figures by the Figure rules (T013's `diagramChoices` with `nearestAncestor` from `src/model/build.ts`, and the EHLD summary from `--files`: the same code the book uses), and draws each through T014's client into `--out`, `{stId}.svg`, written beside its name and moved into place.
  - After T024: runs its release-file and pre-drawing character checks first (`src/preflight/`), and the label check after each figure is drawn.
  - Asks the content service named by `--content` for its release, and refuses another (exit 2); refuses a render service whose health answer does not say `files: local` (exit 2; contracts/render.md).
  - Refuses an `--out` that is not empty (exit 2): no resuming (contracts/figures.md).
  - Changes T014's client: a missing figure carries its cause (`unanswered`, `failed`, `refused`, `invalid`; contracts/figures.md); its timeout is a setting (`--timeout`); and when `figures` asks, a 504 or a timeout (the body's included) is retried once, as a 503 is; `serve` keeps one try (contracts/render.md). Its header comment says so.
  - Writes the manifest, `figures.jsonl`, one writer appending: the fingerprint first (the graph's `DBInfo` release number and checksum, the EHLD summary's hash, the content service's release, the render service's `build`); refuses a graph with no checksum or a `build` of `unknown` (exit 2); then each figure's line once its file is written, synced and moved into place and the `build` and content release, read again, still equal the fingerprint's (otherwise its file is removed and the run stops at once, exit 1); after a figure missing as `unanswered`, the same read within `--timeout`, no answer or a change stopping the run at once; the breaker (`2 × --parallel` `unanswered` figures with no other answer between them, or no answer of any kind for `5 × --timeout`, counted from the start of drawing or the last answer; contracts/figures.md) stopping it too; a figure's own fault (missing after the retry, or failing its label check, its file never moved into place) gets no line while the run draws the rest, then exits 1 naming them all; the report written however the run ends; `complete` once every figure has its line.
  - Extends T004's render stub with 500 and 504 refusals (once, or for every figure) and `GET /health` (`build`, settable by a test, including between a figure's render and the read after it), and adds a content stub answering `GET /data/database/version`, its release settable likewise.
  - Its run report: the release, figures by kind, each kind's times, the missing ones by stable identifier and cause, and why the run stopped, if it did.

  Tests, on the fixture against the stub render service: exit 0 with one file per figure the fixture's book needs, by kind, and a `complete` manifest that passes T024's folder checks, seen failing with a selection keyed by its ancestor; a non-empty `--out` is refused (exit 2); a `build` of `unknown`, and a graph with no checksum, are refused; a `build` changed between a figure's render and the read after it, and a content release changed likewise, each leave that figure with no file and no line, and the run exits 1 with no `complete`; a figure failing its label check is left with no file and no line; one figure the stub refuses with a 404 and one with a 500 (its health unchanged), and one failing its label check: the run draws all the others, then exits 1 naming all three, with no `complete`; a content service not answering the read after a figure stops the run, exit 1; the render stub stopping answering mid-run stops the run at the next failed figure, exit 1, without waiting through the rest, and its report names why; the stub answering `/health` but returning 504 to every render trips the breaker, exit 1, its report naming it; ten figures in a row answering 500 (cause `failed`) do not trip it, the run drawing the rest; nor do 500s answered slowly for longer than `5 × --timeout` in all, each within `--timeout`; a deployment change's stop writes the report too; an unreachable content service is exit 2; a content service answering another release is refused before any drawing; a planted missing release file and a planted uncovered character each fail with exit 1 before any request; a figure that times out once and then answers, and one that answers 504 once and then draws, are drawn (the retry); a refused figure leaves no partial file; exit 2 on the render service unreachable.

- [ ] T025 [US1] Parts, `src/print/parts.ts`.
  - Each of the book's PDFs is printed in parts (T048's documents).
  - A part is split at section boundaries past a page threshold: a setting, about 200 pages by default.
  - Parts are printed untagged, a few at a time across the PDFs, and each PDF's parts joined; a join takes one of `--parallel`'s slots, as a print does, and one PDF's join does not wait for another's printing.

  Tests on the fixture, with the threshold lowered so a pathway's PDF splits:
  - each joined PDF's page count equals the sum of its parts';
  - no section is split between parts, and no part holds two PDFs' pages.

- [ ] T026 [US1] Links and outline after the join, `src/print/links.ts` and `src/print/outline.ts`.
  - Each placeholder URI becomes a `/XYZ` destination at its probe's page and y, and the probes are removed.
  - Each PDF's outline is nested as its pathway's tree.
  - An event's later places in a PDF point at its one full section there (FR-004). A short entry is not repeated with its subtree.

  Tests: every link and bookmark lands on its target heading, seen failing with links copied as pdf-lib leaves them.

- [ ] T027 [US1] Page numbers and running headers, `src/print/stamp.ts`, stamped after each PDF's join with pdf-lib, numbered within that PDF.
  - Text in embedded Roboto, in the theme's colour, after FR-017's substitutions (T022's `src/layout/characters.ts`): a top-level pathway's name is stamped, not laid out, so it would otherwise bypass the list. The stamped headers' substitutions are not counted in the run report: the pathway's name is counted where its section prints it.
  - Each page's header is its PDF's top-level pathway's name, or its front part's name.
  - No number on the cover (FR-016).

  Tests: numbers continuous across parts, and headers right at a part boundary, seen failing with the parts' own numbering; a pathway's name holding U+2011 is stamped with U+002D, seen failing with the name stamped as it is.

- [ ] T028 [US1] The book's contents, second pass: T019's `src/print/contents.ts`, extended to read where each section landed in each joined PDF and reprint only that PDF's front part. The reprinted front part is swapped in before T026's links and T027's stamping run, so its links are rewritten and its pages stamped like the rest. Tests: every entry's number is its target's page, across parts; the contents' links land; the front pages carry their headers and numbers.
- [ ] T029 [US1] `book` end to end, `src/cli.ts` (contracts/cli.md).
  - **Flags and their environment variables** (contracts/cli.md): `--graph` (`NEO4J_URI`), `--database` (`NEO4J_DATABASE`), `--figures`, `--site` (`REACTOME_SITE`), `--files`, `--species`, `--out`, `--parallel` and `--report`. Credentials come from `NEO4J_USER` and `NEO4J_PASSWORD`, never the command line.
  - **Writing:** `--out` must be absent or empty (exit 2); the folder is written beside its name and moved into place; each PDF is named as today's (the pathway's name and `.pdf`).
  - **The run report:** the release; the characters FR-017's list replaced, by code point and count; each stage's time; the page count and size of each PDF and in all; figures by kind; the figures whose labels print below 1 pt (research R4); missing figures and missing release files; and each FR-011 check's result. Everything is named by stable identifier, never a person.

  Tests:
  - exit 0 on the fixture with one PDF per top-level pathway and no other (provisional until T030 adds the check);
  - exit 1 on a figure file missing from `--figures`, with no partial folder left;
  - exit 2 on an `--out` that is not empty;
  - exit 2 on bad arguments, and on the graph unreachable at the start;
  - no request to a render service: the book's run is given none;
  - the run report lists the characters replaced, by code point and count. The test plants them itself, in a copy of the fixture: one listed character in a summation, one in the name of Reaction eight (`R-HSA-90000132`, at one place, with no events before or after it and no children, so its name prints only in its heading and its contents entry), and, in a figures' folder the test writes itself (a valid manifest, `complete`), one in the label of Reaction eight's own reaction figure (drawn once; a pathway's diagram can be drawn again for its subpathways). The counts are of occurrences in the finished book: the summation's 1, the name's 2, the label's 1, each plant a different one of the list's characters. What is not printed text is not counted: the bookmark's title (T026) and the figure's `aria-label`, which an untagged part does not carry. A count of the preflight's substitutions too, or of the front part's first print (T028), fails it; and the fourth listed character, planted in a top-level pathway's name, is counted where that name prints as text (its heading, its contents entry and the locations beneath it) and not for its stamped headers (T027), seen failing with the stamps counted;
  - with T025's threshold lowered and, in a figures' folder the test writes itself with a valid manifest, a character off the list planted in one SVG of a later part (the backstop for a folder changed by hand; `figures` would have refused it): exit 1 after earlier parts are printed, and no folder, PDF, temporary file or part file left.

- [ ] T030 [US1] `check-book`, `src/check/book.ts` (FR-011, contracts/cli.md).
  - **Flags:** `--graph`, `--species` and `--files`.
  - **Output:** one line per fault, in contracts/cli.md's three forms: `fault missing-pathway <stId>`, `fault extra-file "<file name>"`, and `fault <kind> "<file name>" <stId>` for the rest.
  - **Method:** it reads the graph, and the book's outline and text, since the book is untagged.
  - **Faults:**
    - `missing-pathway`, `extra-file`;
    - each naming its PDF: `not-in-contents`, `not-in-outline`, `no-name`, `no-stable-id`, `missing-figure` (where the source exists) and `broken-link`.

  `book` runs it on the folder, and exits 0 only when it passes. Tests: a fixture book with each fault planted one at a time fails with that fault's line (SC-007).

- [ ] T031 [US1] The book on a private copy of release 98's graph.
  - Run `figures` first and time it for SC-010; then time each of `book`'s stages against research R7's budget, check memory, and run `check-book`. Record the results in research R7.
  - Open every one of the book's PDFs in the three readers of SC-004, and follow a sample of bookmarks and links in each, the largest PDF's among them.

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

**Goal:** FR-009 in the image (US4, SC-006), and FR-010, FR-011, FR-012, SC-002, SC-003, SC-007 and SC-010 (US5).

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
  - CI builds it and runs `figures` then `book` over the fixture against the stubs.

  Test: a planted missing file fails the run with exit 1 and no book.

- [ ] T038 [US4] Licences and fonts in the image (SC-006, constitution II).
  - Run T002's check over the image's installed packages.
  - Keep Chromium's and the base image's licence notices in the image.
  - `fc-list` shows only FR-015's fonts, seen failing with `fonts-liberation` installed.
- [ ] T039 [US5] The release's step, documented in `README.md`.
  - Two runs of the image: `figures`, with the render service and its content service beside it, writing the figures' folder; then `book`, with the release's graph, files and that folder as inputs, writing the book's folder of PDFs, which the release archives as it does today's.
  - Keep it generic: the image, its inputs and its output, with no schedules, hosts or paths.
  - Time `book` against SC-003 and `figures` for SC-010 on the machine the release uses, and show a planted fault failing each.
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
  - many figures per page load, to shorten the figures' step (T005, T006);
  - the release's diagram and EHLD files read from a local folder, never the download site: `RENDER_FILES`, #777 in WebsiteAngular; and its health answer naming that folder's release (contracts/figures.md);
  - the render service's health answer naming its page's build and its content service's release and checksum, and a header on each drawing naming both (contracts/figures.md);
  - an overlay on a reaction's drawing;
  - the plain diagram on demand;
  - a render bundle without FoamTree.

  Link it here.

- [ ] T043 [P] Ask the theme package's owners to declare its licence in the package. Link the issue here, and drop T002's exception once it is declared.
- [ ] T044 Remove the scratch baselines once T033, T039 and T040 are recorded: `event-pdf`'s book and single-event PDFs, the release's files and the private graph copy. They are kept outside the repository, and they hold names.
- [ ] T045 Check the success criteria, SC-001 to SC-010, and record the result here.

---

## Dependencies and execution order

- **Phase 1:**
  - T001 first.
  - T002 and T003 in parallel after it.
  - T004 after T003.
- **Phase 2:**
  - **Measurements:**
    - T005 first: the go or no-go for Phase 4. It was a no-go, and T006 took the figures' own step (T046, after T024).
    - T007, T008 and T009 in parallel with T005; T011 after T005 (it uses T005's SVGs).
    - T010 written alongside, finished after T009; T012 only if T011 needs it.
  - **Shared code:**
    - T013 → T015 → T018 → T019.
    - T014 after T004; T016 and T017 alongside T013 and T015.
    - T018 needs T014, T016 and T017.
- **US2 (Phase 3)** needs Phase 2 and T010: T020 → T021 → T022 (every figure drawn on request); T047 after T024; T023 after T046 and T047.
- **US1 (Phase 4)** needs Phase 2 and a go from T005 (one resting on page reuse alone also waits for T042 to ship it), or T006's route: T048 first; T024 and T025 → T026 → T027 → T028 → T029 → T030 → T031, with T046 after T024 and before T031 (T029's tests write their own folder). T024 and T027 also need T022, which creates the character modules they extend and use.
- **US6:** T032 needs T027; T033 needs T031.
- **US3:** T034 needs T019, T023 and T031.
- **US5 and US4:**
  - T035 after T031; T036 after T035.
  - T037 after T029 and T046.
  - T038 after T037.
  - T039 after T037.
  - T040 after T035.
- **Polish:** T041 at any time; T042 after T005 (at once on a no-go, or on a go that rests on page reuse); T043 at any time; T044 after T033, T039 and T040; T045 last.

## Parallel opportunities

- T002 and T003.
- The measurements: T005, T007, T008 and T009; T011 after T005.
- T014, T016 and T017, beside the graph reader and the model.
- Once Phase 2 is done and T005 gives a go (one resting on page reuse alone also waits for T042 to ship it) or T006 a route: T025 beside US2; T024 once T022 is done, then T046 and T047, then T023; the rest of US1 after T024 and T025.

## Implementation strategy

1. **Phase 1 and the measurements first.** T005's answer decides whether the book is built as planned.
2. **US2 first.** The website's PDF is smaller and exercises every part except the parts and the join. It draws every figure on request until the book's figures' folder exists (T024, T046, T047), which R7 shows is several times slower than `event-pdf` for all but the largest events (reactions about 2–10 times, small pathways about 2–16), so the website is routed to it (T042) only once T023 has measured SC-005.
3. **Then US1, the book,** with its check.
4. **Then the remaining checks and the release's step:** the look's check, the figures' check, the fixture baseline, the image and the release's step, with the comparison against `event-pdf` as the proof.
