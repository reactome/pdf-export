# Research: the analysis report PDF

Each item says what was decided, why, and what else was weighed. Facts come from reading
the code (the analysis service, analysis-core, `analysis-report`, and WebsiteAngular's
render service and analysis gateway), not from running them; what must be measured is
said so, and is the plan's first work. No AGPL text is copied here, only endpoint paths
and identifiers.

## R1. The analysis service's public API: four or five calls

**Decision.** A report reads the analysis through these calls to the analysis service's
public API (contracts/analysis-api.md), in this order, whatever its number of pathways:

1. **`GET /token/{token}/resources`**: the result's resources, unfiltered. The report's
   resource is decided from it first: one the result does not hold (compared as today,
   case and all) becomes the result's default
   (the only resource besides `TOTAL` when it holds just one, otherwise `TOTAL`). Sent unchecked, an unknown resource would not fail:
   the service answers 200 with empty statistics.
2. **`GET /token/{token}?resource={R}&importableOnly={B}&includeDisease=true`**, with no
   page and no species, so every pathway comes back. It gives:
   - the summary: type, ReactomeGSA method, species, projection, interactors, sample
     name and file name;
   - the resources with their counts after the filters;
   - the count of identifiers not found, and the expression columns' names;
   - every pathway with something found, in every species, after the resource and
     importable-only filters, in the service's default sort (entities' p-value,
     ascending): with its name, species, entities found, total, ratio, p-value and FDR.

   The reported pathways are the first N whose species is the report's: the same
   order as today's (both run the same comparator, a stable sort, over a freshly read
   result). `includeDisease=true` is given explicitly, because without it the stored
   analysis's own setting applies. The API's default p-value bound (1) and today's
   (none) select the same pathways. No species is passed: today's "pathways hit" and
   "identifiers found" count every species.

3. **`GET /token/{token}?resource=TOTAL&importableOnly=false&includeDisease=true`**, only
   when R is not `TOTAL` or B is true: the reactions' columns as today's report shows
   them (the combined counters, unfiltered), joined by pathway. The code decides this,
   not a sample: filtered reactions read per-resource or importable-only counters, which
   differ whenever more than one resource or a non-importable identifier touches a
   reaction. With `TOTAL` and all identifiers, call 2's reactions are today's.
4. **`POST /token/{token}/found/all?resource=TOTAL`**, `Content-Type: text/plain`, its
   body call 2's pathway ids one per line (any other content type is refused with 415).
   It gives each pathway's found entities (what each maps to, per resource, and the
   expression values) and found interactors (with the resource they interact through).
   Skipped when call 2 has no pathway: the service cannot take an empty body.
5. **`GET /token/{token}/notFound`**, unpaged: every identifier not found, with its
   expression values; sorted and with repeats removed here, as today's report does.

**From call 4, as today's report builds them:**

- **A reported pathway's detail:** its found entities split by `mapsTo[].resource`, and
  its interactors by `interactsWith.resource`.
- **The resources' tables** are one per resource the report is for, as today's: every
  resource the result holds when the report's is `TOTAL`, otherwise the report's own.
  Today's report never fills KEGG COMPOUND's or NCBI Protein's: it compares their
  display names, upper-cased, with the mappings' resources (`COMPOUND`,
  `NCBI_PROTEIN`), which never match, so those tables are empty and left out, in each
  pathway's detail and in the identifiers found, whatever the report's resource, for
  found entities and interactors alike. The new report fills them, interactors too; this fixes an obvious bug and is a listed difference (spec,
  Expected differences).
- **The identifiers found** are not a union. For each resource, the pathways are read in
  call 2's order and an identifier is taken from the first pathway holding it, with
  that pathway's mappings and values; later pathways add nothing for it. (Today's report
  keys a sorted set by identifier, pathway by pathway, and the first wins.) The heading's
  "mapping to N Reactome entities" is the union of the mapped accessions.
  - When today's overview colours pathways by expression values (an expression or GSVA
    result, or GSA statistics where a pathway of the overview's species has values at or
    under the p-value threshold), today's order is call 2's
    only up to ties: drawing the overview filters the shared result again, re-sorting it
    by the result's default resource's comparator, before the identifiers are gathered (the diagrams'
    stable sort by the report's own comparator then restores call 2's order except
    among ties, and where no diagram is drawn the list keeps the default resource's
    order). Otherwise (over-representation, species comparison, GSA regulation) the
    overview does not re-sort, and the order is call 2's. Only which pathway's values an identifier shows can differ, an edge case
    the FR-208 comparison names when it meets it.
- **The count of identifiers found** (the properties' and the heading's) is the number
  of distinct identifiers in call 4's found entities, in every resource, not only the
  report's: today's counts every resource of the pathways the filters kept.

**What the API does not give:**

- **The result's server** (the footer's link today): the report's links go to the
  deployment's site, a setting (`--site`), as spec 001's do.
- **The species** is resolved from the graph (a name in any case with `_` as a space, a
  taxonomy id, or a database id, as graph-core resolves it today), and used to pick call
  2's pathways by their species.

**Rationale.** The fewest calls that give everything, in the order their answers depend
on, and none of the analysis's sums moves out of the analysis service (FR-202). The
calls go to the analysis service directly, not through the gateway, which queues only
`/AnalysisService/report/…` and submissions.

**To measure** (Order of work, step 1): call 4's size and time for a large expression
dataset. It repeats every identifier for each pathway holding it, top-level pathways
included, so a result with tens of thousands of identifiers may return 10⁵ entries or
more (an inference).

**Alternatives considered.**

- One `GET /token/{token}/found/all/{pathway}` per pathway: 1 + 2N calls; rejected for
  the same data in more round trips.
- `/download/{token}/entities/found/{resource}/{filename}.csv`: no expression values and
  no interactors, and the whole stored result rather than the filtered one; rejected.
- `/download/{token}/result.json`: its shape for this purpose was not read; not needed.

## R2. What comes from the graph

**Decision.** Each reported pathway's detail is spec 001's section (its figure's choice,
compartments, diseases, inferred-from, summations and references, built as spec 001
builds them, with the edit history apart, below), read with spec 001's queries (its `src/graph/queries.ts`), which already give, in the curators' order:
compartments, diseases (the generic "disease" left out), inferred-from, summations,
the first five references with their authors, and the diagram that holds a pathway with
no diagram of its own. Three additions:

- **The edits read:** spec 001's `edits` query matches only `authored`, `edited`,
  `reviewed` and `revised`, and its `EditKind` has no others. The report also needs
  `created` and `modified`, so the query takes those two as well. Spec 001's `editRows`
  filters only on a date and an author, not on kind, and the cover's names
  (`coverNames`) take every edit's authors. So spec 001's build filters the edits to its
  four kinds where it reads them, before both (`src/model/build.ts`), with a test that
  fails without that filter, on the rows and on the cover's names; spec 001's PDFs are
  otherwise unchanged. The report reads the extended query's edits itself, for its own
  rule, not through spec 001's `assemble`, whose sections hold spec 001's merged rows. (The graph keeps one `modified` per object,
  the latest, so there is at most one Modified row, as today.)
- **The edit history** follows today's report's rule, not spec 001's: one row for each
  date and action (created, modified, authored, edited, reviewed, revised), sorted by
  date, each with that row's names (up to five, then "et al."), and an edit with no
  author kept as a row with no names. Spec 001's `editRows` merges neighbouring edits and
  drops authorless ones, as `event-pdf` did, so the report has a rule of its own beside
  it (`src/report/`).
  - **Within a date**, today's rows come in a fixed order, a hash map's over six fixed
    keys: Modified, Revised, Edited, Created, Authored, Reviewed. The new report keeps
    that order, so FR-208 compares the rows themselves.
  - **A row's names** come from a hash set today, in no order a reader can rely on, and
    today's shows the first five of it. The new report lists them in the edits' authors'
    order, without repeats. FR-208 compares a row's names as a set when it has five or
    fewer; with more, which five are shown is a listed difference, and only the "et al."
    is compared.
  - **An edit with no date** makes today's report fail; the new report leaves it out,
    a listed difference.
- **The release** and the species' names, read once per report.

**Rationale.** One reading of an event for both PDFs (constitution I), and the lists'
order is already the curators' (spec 002's listed differences rely on it).

## R3. Figures from the render service

**Decision.** Every figure comes from WebsiteAngular's render service (contracts/render.md
of spec 001, with additions in this spec's contracts/render.md):

- a pathway's own diagram: `/render/{stId}.svg?token={token}`;
- the diagram that holds a pathway: `/render/{diagramStId}.svg?highlight={ids}&token={token}`;
  where that diagram is an illustration, the illustration is drawn with nothing
  selected, as spec 001's research R10 records;
- an illustration (EHLD): `/render/{stId}.svg?token={token}`;
- the genome-wide overview (Reacfoam): `/render/genome-wide.svg?species={taxId}&token={token}`.

**Pacing.** The service renders two at a time and queues eight more, refusing the next
at once with 503 and `Retry-After: 5`. A report asks for its up to 51 figures at the
service's own concurrency (a setting, 2 by default), never all at once, and retries a
503 once after its pause, as spec 001's client does. Identical requests coalesce in the
service, and a figure is cached under its token, so a second report of the same token
is fast; a new token is always cold.

**The resource.** The render service takes no `resource` (a request with one is refused
with 400). Its page sets the resource as the pathway browser does: the result's default
(the only resource besides `TOTAL` when it holds just one, otherwise `TOTAL`), by the
browser's analysis service, once the page has settled. That is read from the code, not
measured, and settling is not assured: the page's readiness check waits for what is
drawn, not for the analysis result, and where the default is a specific resource it
needs a second fetch of the result after the first gives its resources. So a figure may be captured with `TOTAL`'s overlay,
or none, and then cached under its token, so later reports of that token get it too.
A race is not ruled out by a clean sample, so the fix is unconditional: the render
page's readiness waits for the analysis overlay, for the result's default resource, and
the render cache's key is bumped so figures cached without it are not served. It is a
WebsiteAngular task that gates the report, done before the figures are timed (plan,
Order of work), with a test there that fails when the page is ready before its overlay;
the report's checks also look for each figure's overlay (quickstart §3). Once settled, the overview is as today's, and a pathway's figure
differs where the report's resource is not the result's default.
Adding `resource` is a WebsiteAngular task; until it ships, that is a listed difference
(spec, FR-204).

**The overview's pathways.** Today's overview is drawn from the result after the
report's resource and importable-only filters, overlaid for the result's default
resource (the only resource besides `TOTAL` when it holds just one, otherwise `TOTAL`), so
either filter narrows which pathways it shows; the render service draws the whole token,
for the same default resource. With the website's defaults (`TOTAL`, all identifiers) the two
are the same; otherwise it is a listed difference (spec, Expected differences).

**Render slots.** A report holding both of the render service's slots for minutes slows
the website's own image downloads meanwhile; R4's choices weigh this.

## R4. The time budget: likely over, to be measured first

**What bounds it.** The gateway's report lane runs one report at a time, queues up to 40,
and answers "unavailable" to a request that has waited 60 s. The edge closes a request
after 100 s, and the PDF is sent only once it is complete (FR-210). So a report has
about 40 s after the longest wait in the gateway, less any wait in pdf-export's own
queue.

**What a cold report costs, by inference.** The render service's README measures a cold
render at 4.2–6.9 s (an expression-token diagram 6.7 s, an illustration 3.5 s). 51
figures two at a time is about 26 rounds of 5–7 s, about 2–3 minutes, before the
analysis calls (R1's call 4 may be large), layout and printing (spec 001's printer prints
twice when there is a contents list, and a report always has one). That is well over
40 s. A 25-pathway report, the website's default, is about half that, still over.

**Decision.** Measure first, on a private stack (Order of work, step 1): a cold report of
25 and of 50 pathways, stage by stage (the analysis calls, the figures, layout,
printing), for a small and a large expression dataset. If it is over, bring the user
the choices, with the numbers:

- a shorter wait on the gateway's report lane, so more of the 100 s is left;
- more render concurrency for report figures (the host's memory sets the limit);
- a lower SC-203 target, or a smaller default number of pathways;
- the report made in the background and fetched when ready (a different contract:
  a 202 with where to fetch it, and the website's button changed to poll);
- sending the answer's status early and the PDF as it is made, as today's main build
  does: the edge then waits only for the first byte (by its documented behaviour, not
  tested here), but a failure part way could no longer be answered 500, which FR-203
  asks for.

**Rationale.** The numbers decide between these, and some (the background job) change
what the website and people's scripts see.

## R5. Errors, and how they are compared

**Decision.** Errors are answered in the analysis service's JSON form (`code`, `reason`,
`messages`), as the gateway's own refusals are, with the statuses of FR-203.

**The comparison with today** is a replay on a private copy of the analysis service
built from the deployed version, recorded here when known (the controller differs
between its main branch and an unmerged one, spec Background). The replay includes a
failure while the PDF is made, which no request can cause: it is planted as a fault in
the private copy (an exporter made to throw), and the new service's answer is compared
with that copy's.

## R6. The address and its routing

**Decision.** pdf-export's service (spec 001's `serve`) adds the route
`GET /AnalysisService/report/{token}/{species}/{filename}.pdf` with today's parameters
(contracts/service.md). WebsiteAngular's analysis gateway keeps queueing the report lane
and sends it to pdf-export instead of the analysis service; nginx's route to the gateway
is unchanged. Both are a WebsiteAngular task, in its own specs (spec Assumptions).

**Alternatives considered.** A new address on the website: rejected, as people's scripts
call today's (User Story 2).

## R7. What is logged, and what is kept

**Decision.** One log line per report: the token, the species, the number of pathways,
the time per stage, the size, and the code points FR-207 replaced (once each). No
submitted identifier, and nothing about the client. The PDF is built in memory and
streamed once complete; no file of it is written. Spec 001's printer writes its HTML to
a temporary file and removes it; for a report, that HTML holds submitted identifiers, so
the folder is private to the service's user, and the file is removed in a `finally`,
which a test shows (SC-205).

**A request the client abandons** (the connection closes before the answer): the
report's work is cancelled at its next stage (the remaining analysis calls and figure
requests are aborted, printing is not started), its temporary files removed, and the
request logged as abandoned.

## R8. Fixtures and tests

**Decision.** A stub analysis service, extending spec 001's (T010), answers R1's
calls for made-up tokens on the fixture graph, with made-up identifiers (FR-213): an
over-representation result, an expression result with two columns, one with
interactors, one with nothing found for a species, and one past retention (410). The
render stub answers the overview. The fixture graph's placeholder people serve the
edit history.
