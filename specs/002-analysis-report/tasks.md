---
description: 'Tasks for spec 002: the analysis report PDF'
---

# Tasks: The analysis report PDF

**Input**: `specs/002-analysis-report/`: plan.md, spec.md, research.md (R1–R8),
data-model.md, contracts/ (service.md, analysis-api.md, render.md), quickstart.md; and
spec 001's code, which this spec reuses (plan, Order of work, step 2: its analysis stub
T010, client T020 and T021 and service T022 are merged).

**Tests**: required. The constitution (V) asks for every check and fix to be seen failing
before it is relied on, so each task names its tests and what is made to fail.

**Each task** is one pull request with its own adversarial review, unless it says it is
paired with another. The PR ticks its task here, with its number, in the same PR.

**The repository is public:** no host names, server paths, credentials, internal release
process or people's names in code, fixtures, logs, test output or pull requests
(constitution VII, FR-213). A report names the authors and curators of each pathway's
edit history and literature: comparisons print counts and hashes, never names, and
today's reports are kept outside the repository.

**Never production:** tokens are made only by submitting made-up identifiers to a private
analysis service (the website's own development host's, through its analysis gateway or
directly on loopback), small lists, spaced; never to Reactome's production services or
to ReactomeGSA (constitution VI, spec Assumptions).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task).
- **[Story]**: the user story the task serves (US1–US4, spec.md).
- **[WA]**: the work is in `reactome/WebsiteAngular`, under one of its specs; the task
  here links its pull request.

## Path conventions

As plan.md's structure: the report's code in `src/report/`, its analysis calls in
`src/analysis/`, its route in `src/serve.ts`; tests in `test/report/` and the stubs in
`test/stubs/`.

---

## Phase 1: Setup — today's report, measured

**Purpose:** what the new report is compared with (plan, Order of work, step 1), recorded
before anything is built, so no comparison is fitted to the new code.

- [x] T001 [P] Today's answers, recorded for the replay (User Story 2, research R5), from
      the private analysis service on loopback, with tokens of made-up identifiers.
  - **The deployed build:** the analysis service's commit, from the deployment's own pins,
    and, from that commit's source, whether its report controller streams the PDF (main)
    or buffers it (the unmerged branch): spec Background. Record it in research R5.
  - **The replay set:** for each case, the status, the headers that matter
    (`Content-Type`, `Content-Disposition`) and the body (JSON whole; a PDF by its size
    and page count only): a known token at the defaults; `number` at 0, 1, 50, 51, -1 and
    not a number; `resource` held, not held, in another case, and not one; `importableOnly`
    true, false and not a flag; each colour profile; the species as a name in two cases
    with `_`, a taxonomy id, a database id, and one the graph does not know with an
    unknown token; an unknown token; one gone (410); a malformed one (research R8's open
    point); and a file name other than `report`. Kept as a file outside the repository
    (the PDFs hold names); research R5 records the statuses, file names and JSON bodies,
    which hold none.
  - **The failure while the PDF is made** (planted as a fault in a private copy): only if a
    private build of the deployed commit is at hand (WebsiteAngular spec 010 T036 builds
    one). Otherwise research R5 records the answer read from the deployed build's source,
    and the replay says it was not run.
  - **Done (#192):** research R5 records the deployed build (`9b147e1`, whose report
    controller is `main`'s: it streams the PDF, so a failure while it is made ends the
    answer early) and the replay set's 33 cases on the development host's own service:
    the statuses, headers and JSON bodies, and each PDF's size and page count. A number
    or flag that is not one is the framework's default 400 body (a timestamp and the
    path), not the service's form; a malformed token its catch-all 500 (research R8).
    The failure while the PDF is made was not replayed: no private build exists yet.

- [x] T002 [P] Today's report's time and size (SC-203's baseline) and R1's call 4, measured
      on the same private services, one request at a time with pauses between, never
      in parallel with other load on the host.
  - Today's report for a sample of tokens: over-representation, expression (two columns),
    species comparison, one with interactors; at 25 and 50 pathways; its time, size and
    page count. Each token's identifiers are made up or from public example lists, a
    handful to a few hundred.
  - Call 4 (`POST /token/{token}/found/all`) for the largest expression token of the
    sample and for one of some thousands of identifiers: its size, its time and its number
    of entries (research R1, "To measure").
  - Recorded in research R1 and R4. If call 4 is too large or too slow for SC-203 at
    that scale, research R1 records the alternative chosen before T007 builds on it.
  - **Done (#193):** research R4 records today's report for five tokens at 25 and 50
    pathways (21 s to 187 s; 9 to 48 MB), and R1 call 4 for two expression results (2,580
    distinct identifiers: 65,584 entries, 6.1 MB, 1.4 s). Call 4 is kept. Today's
    expression and species-comparison reports at 50 pathways take longer than the edge's
    100 s. The reports are kept outside the repository for T019. Also recorded here: the
    decisions for T012 (8 Nov 2026), in T012, research R8 and spec Assumptions.

---

## Phase 2: Foundational — what every story reads

**Purpose:** the report's data, from the analysis service and the graph, before any
layout. Blocks every later phase.

- [x] T003 Spec 001's edits, widened (research R2): `src/graph/queries.ts`'s `edits` reads
      `created` and `modified` too, and `EditKind` gains them.
  - The graph holds `created` and `modified` in the same direction as the four kinds spec
    001 reads, from the InstanceEdit to the object (graph-core's `DatabaseObject`, at the
    commit the website's pins name), so the query reads all six in one pattern.
  - Spec 001's build filters the edits to its four kinds where it reads them
    (`src/model/build.ts`), before `editRows` and `coverNames`, so spec 001's PDFs are
    unchanged.
  - The fixture (`ci/fixture/fixture.cypher`) gains a `created` and a `modified` edit on a
    pathway, with placeholder people, one `created` with no author and one edit with no
    date.
  - Tests: the query reads all six kinds on the fixture; spec 001's rows and cover names
    are what they were, seen failing with the filter removed (the created edit's author
    then appears among the cover's names).
  - **Done (#194):** `EDIT_KINDS` holds six kinds and the query reads them;
    `SECTION_EDIT_KINDS` holds spec 001's four, and `sectionEdits` in `build.ts` keeps
    those before the history and the cover. The fixture gains a placeholder person, a
    dated `created` with an author and a `modified` with none on `Alpha pathway`, and an
    undated `created` on `Reaction one`. Seen failing: with the filter removed, the
    cover's names gain the created edit's author and `Alpha pathway`'s history gains a
    row (2 tests); with the query back to four kinds, the reader's two edit tests fail.
    The fixture's new edits alone (the old code) left all 59 graph and model tests
    passing. An edit's row now refuses a kind outside the six (`deleted`).

- [x] T004 [P] The analysis stub, extended (research R8), `test/stubs/analysis.ts`: R1's
      five calls (contracts/analysis-api.md) for made-up tokens on the fixture graph's
      pathways, with made-up identifiers:
  - an over-representation result with two resources; an expression result with two
    columns; one with interactors; one with nothing found for a second species; one
    gone (410, dated within 7 days); and the existing unknown and malformed tokens.
  - As the service answers: call 2 in the default sort (entities' p-value, ascending,
    stable), every species, after the resource and importable-only filters;
    `includeDisease` left out reading the stored setting; call 4 refusing a content type
    other than `text/plain` with 415 and an empty body with the service's answer; call 5
    unpaged, with repeats.
  - Like the existing stub, a parameter pdf-export never sends, or one given twice, is
    a 400, so a client sending one fails a test instead of passing silently.
  - Each call counted on the stub's `requests`, so a test can say how many reports one
    key made (FR-210).
  - The render stub (`test/stubs/render.ts`) answers `/render/genome-wide.svg?species&token`
    with a figure naming its species, and refuses a `resource` with 400 as the service
    does.
  - Tests: each answer as recorded, each refusal seen.
  - **Done (#195):** `REPORT_TOKENS`: over-representation through UniProt and KEGG
    COMPOUND, expression with two columns, interactors through UniProt and NCBI Protein, a
    species comparison with mouse (nothing found for mouse), and KEGG COMPOUND alone
    (importable-only finds no pathway, so call 4 has nothing to post), dated within the 7
    days; spec 001's gone, unknown and malformed tokens beside them. The five calls as the
    service's code answers them; call 4's 415 and empty-body 400 are the framework's, read
    from the source, not measured. A resource the result lacks is the stub's 400 (the
    service answers empty statistics). Each request is recorded with its method, content
    type and body. The render stub answers the overview and refuses `resource`. 15 tests,
    seen failing on 32 planted faults.

- [x] T005 [US1] The report's analysis client, `src/analysis/report.ts` (research R1,
      contracts/analysis-api.md), after T004.
  - **The check:** call 1 with a 5 s timeout; 404 `unknown-token`, 410 `gone-token`, any
    other failure or none `unavailable` (`src/analysis/error.ts`'s reasons).
  - **The calls,** in order: 1 (the report's resource decided from it, compared as today,
    case and all, the result's default otherwise); 2 with `resource`, `importableOnly` and
    `includeDisease=true`, no page and no species; 3 only when the resource is not
    `TOTAL` or `importableOnly` is true; 4 with call 2's pathway ids as `text/plain`, one
    per line, skipped when there are none; 5 unpaged. The token sent is the canonical one
    (`src/analysis/token.ts`), and each call names its `Accept`.
  - Every answer arrives as `unknown` and is checked into its type, refusing what does not
    fit (CLAUDE.md, "Nothing on trust").
  - Tests against T004's stub, each seen failing: `includeDisease` left out (the pathways
    differ); `species` sent (the stub's 400); call 3 made without a filter, and not made
    with one; call 4 made with no pathway; call 4 with another content type (the stub's
    415); a resource the result lacks sent as it was given; a 410 from any call after the
    check is `gone-token`, not none found.
  - **Done (#196):** `checkToken` (the token's form, then call 1 within 5 s), `reportResource`
    and `readReportAnalysis` (calls 2 to 5, call 3 and call 4 only when needed), each answer
    checked into its type; after the check a 404 is `unknown-token` and a 410
    `gone-token` from any call. Seen failing on 15 planted faults, the task's seven among
    them; the 410 test checks which call failed, as a call 4 swallowing its 410 otherwise
    passed when call 5 failed after it.

- [x] T006 [US1] The report model, `src/report/model.ts` (data-model.md), from T005's
      answers, after T005.
  - **The request:** `number` clamped to 1–50 (25 by default), and a number or flag that
    is not one answered as T001 recorded; `importableOnly` acting only with `TOTAL`.
  - **The species,** resolved from the graph as a name in any case with `_` as a space, a
    taxonomy id or a database id (`src/graph/queries.ts`, a new query); unknown is the
    route's 404, before the token.
  - **The summary:** its name (the sample's, else the file's, else the species compared
    with, else the type, else the token), type, ReactomeGSA method, projection,
    interactors; the identifiers found (the distinct identifiers of call 4's entities, in
    every resource) and their total with the not-found count; the pathways hit.
  - **The reported pathways:** the first `number` of call 2's whose species is the
    report's; reactions from call 3 when it was made; found entities split by
    `mapsTo[].resource` and interactors by `interactsWith.resource`, one table per
    resource the report is for (every resource the result holds with `TOTAL`, otherwise
    its own), KEGG COMPOUND and NCBI Protein included (a listed difference).
  - **The identifiers found:** per resource, the pathways read in call 2's order, each
    identifier taken from the first pathway holding it, with that pathway's mappings and
    values (research R1: not a union); interactors apart; the heading's count of Reactome
    entities the union of the mapped accessions. **Not found:** sorted, without repeats.
  - Tests, each seen failing: the clamp's bounds; a resource lacked becoming the default
    (one resource besides `TOTAL`, and two); an identifier in two pathways taking the
    first's values; the count spanning resources; KEGG COMPOUND's table filled; the
    name's fallbacks in order; repeats in not-found removed.
  - **Done (#197):** `reportParameters` (Spring's readings of an `Integer` and a `Boolean`,
    read from its source), `speciesByIdentifier` and `speciesByDbId` (graph-core's lookup,
    read from its compiled class), and `buildReport`. The identifiers found are sorted by
    identifier, as today's sorted set is, each from the first pathway in call 2's order.
    Seen failing on 24 planted faults. An `importableOnly` of spaces alone is false here
    (today's, by its source, fails); a parameter given twice reads its first value, a
    resource given twice its values joined by commas, as the framework converts them (not
    measured). Java's digits and whitespace are read as ASCII digits and JavaScript's `\s`:
    Java also takes other Unicode digits and spaces, which nobody sends.

- [x] T007 [US1] The pathways' details and edit history, `src/report/details.ts` and
      `src/report/edits.ts` (research R2), after T003 and T006.
  - Each reported pathway's spec 001 Section (figure choice, compartments, diseases
    without the generic one, inferred-from, summations, first five references), read with
    spec 001's queries in one batch for all reported pathways, not one read per pathway.
  - **The edit history,** today's rule: a row per date and action over all six kinds,
    sorted by date; within a date, Modified, Revised, Edited, Created, Authored,
    Reviewed; a row's names in the edits' authors' order without repeats, five and then
    "et al."; an authorless edit kept as a row with no names; an undated one left out.
  - Tests on the fixture (placeholder people only), each seen failing: the within-date
    order; six names becoming five and "et al."; the authorless row kept; the undated
    edit left out rather than failing; two edits of one kind on one date one row.
  - **Done (#198):** `readDetails` builds each section with spec 001's `sectionOf` (moved
    out of `assemble`, unchanged) from one read of each query for all the pathways, its
    `edits` empty; `editHistory` writes the report's rows, a row's date the day (an
    inference from R2, for T019 to confirm). The fixture gains, on `beta pathway`, a
    `created` edit with six authors and a `modified` with none on its `authored` edit's
    date; spec 001 reads neither. Seen failing on 13 planted faults.

---

## Phase 3: User Story 1 — a report of an analysis, in the website's new look (P1)

**Goal:** the PDF, from the fixture and the stubs, with every part of the Background in
order, in spec 001's look.

**Independent test:** `pdf-export report` on the fixture graph with the stubs makes a PDF
for each stub token, whose text and outline hold each part in order (User Story 1's
acceptance scenarios).

- [x] T008 [US1] The report's front parts and table, `src/report/layout.ts`, in spec
      001's theme (FR-205), after T006.
  - The cover (logo, title, the analysis's name, release, date, the link to the result
    in the pathway browser on `--site`, how long results are kept); the contents list
    (FR-206); the introduction (spec 001's text, FR-209); the properties (the type
    explained with a link to the user guide, ReactomeGSA's guide for its types; the
    counts; projection and interactors only when set; the species, resource and token,
    with how long it is kept); the overview's place and caption; the most significant
    pathways' table, each row linked to its detail.
  - Text that is not data is the website's current wording or written anew (FR-209):
    nothing from `analysis-report`.
  - Tests on the HTML, each seen failing: the parts in order; projection and interactors
    left out when unset; a row linked to its detail's anchor; the ReactomeGSA guide for a
    GSA type.
  - **Done (#199):** `reportFrontHtml` writes the parts in order with spec 001's markup and
    theme; the contents list leaves out the details, the identifiers found and the not
    found when the report has none; the wording is in `src/report/text.ts`, the title
    kept as today's for FR-208. The result's link is the website's own form,
    `/PathwayBrowser?analysis={token}`. Seen failing on 17 planted faults.

- [x] T009 [US1] The details and identifier lists, `src/report/layout.ts`, after T007 and
      T008.
  - Each pathway's detail: spec 001's `sectionHtml` for its Section, with T007's edit
    history in place of spec 001's, its stable identifier linked to its page on `--site`,
    then its entities found per resource and, with interactors, its interactors.
  - The identifiers found (with the expression columns' values; interactors apart) and
    the identifiers not found, left out of the report and its contents when empty.
  - Tables break across pages with their headers repeated (spec Edge Cases).
  - Characters no font draws follow FR-017 on request (FR-207): spec 001's
    `CharacterLog`, one log for the texts and the figures' labels.
  - Tests, each seen failing: the not-found part and its contents entry absent when
    empty; a planted undrawable character in a submitted identifier printed as U+FFFD
    and logged once, the report still made; the expression columns' values in place.
  - **Done (#200):** `detailHtml` through spec 001's `sectionHtml` (its new
    `analysisReport` input: the report's tail and the linked identifier); `foundHtml`
    and `notFoundHtml`, each left out when empty; `onRequestReport` with one
    `CharacterLog`; `reportBodyHtml` for T011. Resources by the website's names. Seen
    failing on 12 planted faults.

- [x] T010 [US1] The report's figures, `src/report/figures.ts` and
      `src/figures/client.ts`, after T006.
  - A `genome-wide` figure request (contracts/render.md): the species' taxonomy id and
    the token; each pathway's figure as spec 001 chooses it, with the token.
  - Asked at the render service's concurrency (2 by default), with a cap shared by all
    reports being made (contracts/service.md), never all 51 at once; a 503 retried once
    after its pause, as spec 001's client does; a figure that cannot be drawn left out
    and logged, the report still made.
  - Labels through `src/figures/labels.ts` on request (FR-017).
  - Tests against the render stub, each seen failing: never more than the cap at once
    across two reports (the stub counts its concurrency); the overview asked for with the
    report's species, not the analysis's; a refused figure leaving its place empty.
  - **Done (#201):** `drawReportFigures` through `Slots` shared by every report (a caller
    that ends leaves the queue); the figures client's `genome-wide` request; the render
    stub's `peak`. A missing figure is logged without the token. T011 and T012 create the
    slots from a setting. Seen failing on 12 planted faults.

- [ ] T011 [US1] Printing the report and `pdf-export report`, `src/report/report.ts` and
      `src/cli.ts`, after T009 and T010.
  - Spec 001's printer and stamping: bookmarks for the parts and, under the details, each
    pathway (FR-206); the running header naming the report, or on a front part that
    part; page numbers on every page but the cover (FR-205); links checked after the
    print.
  - `pdf-export report` (`--token`, `--species`, `--number`, `--resource`,
    `--importable-only`, `-o <file>`) makes one report from the graph, the analysis service and the render
    service, for the comparison (T019) and for checks by hand; the service (T012) calls
    the same function.
  - Tests on the fixture with the stubs, each seen failing: the outline's entries in
    order; every link's target inside the PDF or on `--site`; a 50-pathway report of
    the stub's largest token printed whole.

---

## Phase 4: User Story 2 — the download keeps working (P1)

**Goal:** today's address and parameters, answered as contracts/service.md says.

**Independent test:** the replay of T001's set against the service on the stubs, every
status and file name as recorded or a listed difference (SC-202).

- [ ] T012 [US2] The route, `src/serve.ts`, after T011 (contracts/service.md).
  - `GET /AnalysisService/report/{token}/{species}/{filename}.pdf`: the species first
    (404), then the token's check (404, 410, 503), then the rest; the parameters as T006
    reads them, the profiles accepted and ignored, the file name ignored.
  - A malformed token (research R8's open point, decided 8 Nov 2026): spec 001's form
    check, answered 404 in the service's form before any call, after the species, where
    today's answers its catch-all 500 (an obvious bug: a client's bad input is not a
    server error); a token holding `%2F` is malformed too, where today's gets the servlet
    container's HTML 400. A listed difference (spec Assumptions).
  - A number or flag that is not one: today's framework 400 exactly (research R5): its
    body's fields in order, the `timestamp` and the `path` written as today's, its
    headers (`Content-Disposition: inline;filename=f.txt`), before the species. Every
    other case of T001's set as today's, but where an obvious bug is fixed and listed.
  - Errors in the analysis service's JSON form, `{"code","reason","messages"}`, with no
    path, host, name or submitted identifier in a message; the PDF as
    `application/pdf`, `Content-Disposition: attachment; filename="report.pdf"`,
    `Cache-Control: private, no-store`.
  - This task answers in one request, with spec 001's limit and deadline; T013 puts it
    in the background.
  - Tests in `test/report/serve.test.ts` against the stubs, each status seen failing; an
    unknown species with an unknown token is the species' 404; a profile changes nothing.

- [ ] T013 [US2] The report in the background, `src/report/jobs.ts` and `src/serve.ts`
      (FR-210, data-model Job), after T012.
  - A request starts the report, or joins the one queued, being made or kept for the same
    key (token, species' database id, clamped `number`, defaulted `resource`,
    `importableOnly`); waits up to 30 s; 200 with the PDF once complete, else 202 with
    `Retry-After: 10` and the JSON, or for `Accept: text/html` a page that asks again.
  - A report ended by an error answers it to every request then waiting and to the next,
    then is forgotten; one nobody asks for is forgotten after an hour.
  - A time budget of 5 minutes from when it starts being made; a request the client
    abandons ends only its own wait.
  - Tests, each seen failing: a stub made slow gives 202 then 200 at the same address; two
    requests for one key make one report (the stubs' counts); the error given to the
    waiting and the next, then a fresh start; the budget ending a report as 503; an
    abandoned request leaving the report to finish.

- [ ] T014 [US2] Limits and keeping, `src/report/jobs.ts` (FR-210, FR-211), after T013.
  - Two made at once and eight waiting by default (each a setting), 503 with
    `Retry-After` beyond; a joining request never counted; at most two of the waiting
    from one client, named by `X-Reactome-Client`, a request without it counted as
    `internal`.
  - A finished report kept in memory for an hour, at most 512 MB in all, the oldest
    dropped first; each request's check of the token dropping a kept report on 404 or
    410; the graph's release read with the species, a change dropping every kept report.
  - `/health` adds the reports being made, waiting and kept.
  - Tests, each seen failing: the ninth waiting refused; a third from one client refused
    while another's is taken; a kept report dropped after the hour (a clock the test
    moves) and on the stub's 410; the total cap dropping the oldest; a release change
    dropping all.

---

## Phase 5: User Stories 4 and 3 — what users submitted stays theirs; licences (P2, P1)

- [ ] T015 [US4] The log line and the working page (FR-211, research R7), `src/serve.ts`,
      `src/print/temporary.ts`, after T013.
  - One log line per report made, not per request: a hash of the token, the species,
    the number, the time per stage, the size, the code points FR-207 replaced; no
    submitted identifier and nothing about the client.
  - The printer's working HTML in a folder private to the service, a setting (the
    image's `tmpfs`), removed in a `finally`; the folder emptied when the service starts.
  - Tests, each seen failing: after reports for the stub's tokens, the log and the folder
    hold none of the stub's identifiers; a folder left with a file (a killed print) is
    emptied at start.

- [ ] T016 [US3] The licences (FR-212, SC-206): no dependency added by this spec;
      `node ci/licences.ts` passes on the installed tree and is seen failing on a planted
      GPL-family package (a scratch install, not committed). Recorded here. May be paired
      with T015.

---

## Phase 6: The website's parts and the live checks

**Purpose:** the report on real data, against today's, and the website routed to it.
The comparisons run on the development host's own services only.

- [ ] T017 [WA] The render page waits for its analysis overlay (plan, Order of work,
      step 0; research R3; FR-204), in WebsiteAngular, under its render service's spec:
      readiness waits for the overlay for the result's default resource, with a test that
      fails when the page is ready before it; the render cache's key bumped, so figures
      cached without it are not served. Gates T019 and T020; link its PR here.

- [ ] T018 [WA] The pdf-export image's pin and settings for the report (WebsiteAngular's
      `deploy/pdf-export` and compose): the report's analysis setting and the working
      folder on a `tmpfs`, the port still bound to loopback. May be paired with T021;
      a separate PR only if T019 needs the image before the route.

- [ ] T019 [US1] The comparison by meaning (FR-208, SC-201), `src/compare/report.ts` and
      `pdf-export compare-report <today's.pdf> <new.pdf>`, after T011 and T017.
  - Reads both PDFs' text (spec 001's `src/compare/read.ts`) and compares FR-208's list:
    the cover's title, name, release and link; the properties; the pathways in order
    with their statistics; each detail's figure present, compartments, diseases,
    inferred-from, descriptions, references, edit-history rows (names as a set, compared
    by hash; with more than five, the "et al." alone), entities per resource and
    interactors; the identifiers found with their values; the not found.
  - The edit history's rows are grouped by day (T007, accepted 13 Nov 2026): the
    comparison checks it against today's report on a pathway with two edits of one kind
    on one day at different times, one row in both or a recorded difference.
  - Prints counts and hashes, never names; seen failing on a planted difference in each
    part.
  - Each figure checked for its analysis overlay (quickstart §3), seen failing on one
    captured without it.
  - **The run:** T002's tokens at 25 and 50 pathways, today's from the private analysis
    service, ours from `pdf-export report` against the same services. Every difference
    is a listed one or recorded with its reason in research (a new item, R9) and spec
    Assumptions.

- [ ] T020 [US2] The replay and the time (SC-202, SC-203, SC-204, SC-205, SC-207), after
      T014, T015 and T017.
  - T001's set replayed against `pdf-export serve` on the development host's services:
    each status and file name as today's or a listed difference. The set gains a
    parameter given twice (T006, read from the framework's source, not measured):
    `number=7&number=abc` (the first value read), `importableOnly=true&importableOnly=maybe`,
    and `resource=UNIPROT&resource=ENSEMBL` (the values joined by commas, so not held: the
    default); and `importableOnly=%20`, a listed difference.
  - SC-203: cold (the render cache empty) and warm, stage by stage, from the first request
    to the PDF, one report alone, against T002's baseline and the 2- and 4-minute
    targets.
  - SC-204: spec 001's colour and font check on a sample report, once spec 001's T032
    exists; until then, recorded as not run.
  - SC-205: after a sample of reports, some still kept, and one killed while printing and
    the service started again, the logs and the working folder searched for the
    submitted identifiers (none).
  - SC-207: the report opened in spec 001's three readers, its bookmarks and links
    followed.
  - Call 4's answers to another content type (415) and to an empty body (400) are the
    framework's bodies in T004's stub, read from the analysis service's source, not
    measured: the replay checks them against the private service.
  - Recorded in research.

- [ ] T021 [WA] The website routed to pdf-export (research R6; plan, Order of work, step
      8), in WebsiteAngular under spec 010 (the analysis gateway, its Story 6), after
      T019 and T020. Last; deployed by the user.
  - The gateway sends `GET /AnalysisService/report/…` to pdf-export, a second upstream,
    without queueing it; keeps `PER_CLIENT`; sets `X-Reactome-Client` to its own
    `clientOf`, overwriting what a client sent; answers 503 in the analysis service's
    JSON form when pdf-export cannot be reached. The analysis service still answers
    everything else.
  - pdf-export's errors byte-identical to the analysis service's for the same request
    (status, `Content-Type`, body; its JSON carries no `url`), compared on the
    development host for T001's error cases.
  - The pin moved to the pdf-export commit holding T020; the "PDF Result" button opens
    the address in a new tab; nginx's route to the gateway unchanged, and `nginx -t` run.
  - WebsiteAngular's `documentation/declared-differences.md`, "Analysis report PDF
    (pdf-export spec 002)": its rows kept consistent with spec Assumptions and T019's
    recorded differences, its status moved from "Spec only".

---

## Phase 7: Polish

- [ ] T022 [P] `README.md` and `CLAUDE.md`: the report, `pdf-export report`,
      `compare-report`, the route and its settings.
- [ ] T023 [WA] Later, not blocking T021: the render service takes `resource` (FR-204);
      then the report passes its resource for the pathways' figures and the default for
      the overview, and the listed difference is removed here and in the register.
- [ ] T024 Remove the scratch baselines once T019 and T020 are recorded: today's reports,
      kept outside the repository, hold names.
- [ ] T025 Check the success criteria, SC-201 to SC-207, and record the result here.

---

## Dependencies and execution order

- **Phase 1:** T001 and T002 in parallel, first: nothing is compared with a baseline
  taken after the code.
- **Phase 2:** T003 and T004 in parallel; T005 after T004; T006 after T005; T007 after T003
  and T006.
- **US1:** T008 after T006; T009 after T007 and T008; T010 after T006; T011 after T009 and
  T010.
- **US2:** T012 after T011; T013 after T012; T014 after T013.
- **US4 and US3:** T015 after T013; T016 at any time.
- **Live:** T017 at any time before T019; T018 when T019 or T021 needs it; T019 after T011
  and T017; T020 after T014, T015 and T017; T021 last of the build.
- **Polish:** T022 at any time; T023 after T021; T024 after T019 and T020; T025 last.

## Parallel opportunities

- T001 and T002.
- T003 beside T004 and T005.
- T008 and T010 once T006 is merged.
- T016 and T017 at any time.

## Implementation strategy

1. **Measure today's report first** (T001, T002): the baseline and the replay set.
2. **The data, then the PDF** (T003–T011): a report made from the command line on the
   fixture and stubs is User Story 1's MVP, checkable without the website.
3. **Then the service** (T012–T015): the address, in the background, with its limits.
4. **Then the live proof** (T017, T019, T020) and only then the website's route (T021),
   which the user deploys.
