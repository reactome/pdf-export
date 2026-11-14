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
submissions (report requests it passes on, R6).

**To measure** (Order of work, step 1): call 4's size and time for a large expression
dataset. It repeats every identifier for each pathway holding it, top-level pathways
included, so a result with tens of thousands of identifiers may return 10⁵ entries or
more (an inference).

**Measured (T002, 7 Nov 2026),** on the website's development host's own analysis
service, on loopback, one call at a time:

| Result                                                   | Pathways (call 2) | Call 2 | Call 4 | Call 4's size | Entity entries | Distinct identifiers |
| -------------------------------------------------------- | ----------------- | ------ | ------ | ------------- | -------------- | -------------------- |
| Expression, 205 identifiers, two columns                 | 1,367             | 0.1 s  | 0.2 s  | 0.7 MB        | 5,738          | 200                  |
| Expression, 2,600 identifiers (2,580 found), two columns | 2,144             | 0.5 s  | 1.4 s  | 6.1 MB        | 65,584         | 2,580                |

So call 4 grows with the identifiers found times the pathways holding each, about 25
entries an identifier here. By that rate (an inference, not measured), 25,000 found
identifiers give about 650,000 entries, 60 MB and some 15 s: well inside SC-203's
minutes, and a size the service's memory holds while a report is made. Call 4 is kept;
no alternative is needed. Its answer is parsed once and dropped once the model is built.

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
  rule, not through spec 001's `assemble`, whose sections hold spec 001's merged rows. (This
  said the graph keeps one `modified` per object, so there is at most one Modified row.
  **Corrected 14 Nov 2026 by T019's run (R9):** in release 98, 20 of the 50 pathways
  compared have two `modified` edits. Today's report prints no Modified row for those, and
  pdf-export prints one for each; the user kept pdf-export's, a listed difference.)
- **The edit history** follows today's report's rule, not spec 001's: one row for each
  date and action (created, modified, authored, edited, reviewed, revised), sorted by
  date, each with that row's names (up to five, then "et al."), and an edit with no
  author kept as a row with no names. Spec 001's `editRows` merges neighbouring edits and
  drops authorless ones, as `event-pdf` did, so the report has a rule of its own beside
  it (`src/report/`).
  - **Within a date**, today's rows come in a fixed order, a hash map's over six fixed
    keys: Modified, Revised, Edited, Reviewed, Authored, Created. The new report keeps
    that order, so FR-208 compares the rows themselves. (Corrected by T019: the map is
    filled by `computeIfAbsent`, which puts a new key at the head of its bucket, and
    Created, Authored and Reviewed share one; this said Created, Authored, Reviewed, the
    order `put` gives. Today's reports print Authored above Created on one day.)
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
Order of work, step 0), with a test there that fails when the page is ready before its overlay;
the report's checks also look for each figure's overlay (quickstart §3). Once settled, the overview is as today's, and a pathway's figure
differs where the report's resource is not the result's default.
**Settled (13 Nov 2026, T017).** The race above is closed in WebsiteAngular. Its render page has
waited for the overlay since reactome/WebsiteAngular#771 (2 Nov, after this was written): ready only
once the analysis has settled on the result's default resource and the view shows it (a
diagram coloured for that token and resource, an illustration coloured with the current
result, the overview showing the tree for that token and resource; the reaction layout is
never coloured), and a token that cannot be read ends in the page's error. Its cache key
was bumped with it, and every figure cached since was drawn with the wait.
reactome/WebsiteAngular#958 added the same tests for a page held between figures (its spec
018), each seen failing on a mutant.

Adding `resource` is a WebsiteAngular task; until it ships, that is a listed difference
(spec, FR-204).

**The overview's pathways.** Today's overview is drawn from the result after the
report's resource and importable-only filters, overlaid for the result's default
resource (the only resource besides `TOTAL` when it holds just one, otherwise `TOTAL`), so
either filter narrows which pathways it shows; the render service draws the whole token,
for the same default resource. With the website's defaults (`TOTAL`, all identifiers) the two
are the same; otherwise it is a listed difference (spec, Expected differences).

**Render slots.** A report holding both of the render service's slots for minutes slows
the website's own image downloads meanwhile. So the render requests of all reports
together are capped (contracts/service.md), and SC-203 is measured with one report and
no other render traffic.

## R4. The time budget: over, so the report is made in the background

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

**Measured (spec 001 T007, 2 Nov 2026):** one diagram with an analysis token, cold, at
the render service's website settings: 4.6 s alone; 5.6 s for the slower of two at once;
9.3 s for the last of four; 18.7 s for the last of eight, each pair waiting for the
service's two slots. So a report's figures alone take about a minute for 25 pathways (26
figures) and about two for 50, against the 40 s the edge leaves. More render concurrency
does not change this: the service is limited by the host's processors (spec 001 T005).

**Decision (the user left it to us):** the report is made in the background, behind
today's address (FR-210, contracts/service.md): a request starts or joins it and waits
up to 30 s; then 200 with the PDF, or 202 with `Retry-After` and, for a browser, a page
that asks again; a finished report is kept for an hour.

**Rationale.**

- It keeps the address and its parameters, and the PDF is still sent only once
  complete, so a failure can still be answered with its error (FR-203).
- A browser sees a page, then its PDF; a script that follows `Retry-After` gets the
  PDF. One that saves whatever the address answers, `curl -o report.pdf` even with
  `-f`, saves the 202's JSON: a listed difference (spec).
- A request no longer depends on the edge's limit or the gateway's wait, and nothing
  changes in the analysis service. The time to a ready report still depends on the
  host's processors and on what else the render service draws (R3).

**Alternatives considered.**

- _A shorter wait on the gateway's lane, more render concurrency, a smaller default:_
  none brings 26 figures at about 4.6 s each, two at once, under 40 s.
- _A lower SC-203 target alone:_ does not change the edge's 100 s.
- _Sending the status early and the PDF as it is made:_ a failure part way could no
  longer be answered with its error (FR-203).
- _A new address for the finished report:_ changes what people's scripts call; the same
  address answering 202 then 200 does not.

**Today's report, measured (T002, 7 Nov 2026):** SC-203's baseline, on the website's
development host's own analysis service, on loopback, one report at a time with a pause
between; the host's other traffic was not stopped, so these are one sample each, not a
distribution. The tokens are of made-up or public example identifiers: over-representation
(T001's token: 7 gene symbols and 2 made-up identifiers), expression (205 identifiers,
two columns), with interactors (33 identifiers), species comparison (human against
mouse), and the large expression token above.

| Token                         | 25 pathways              | 50 pathways               |
| ----------------------------- | ------------------------ | ------------------------- |
| Over-representation           | 31 s, 9.5 MB, 53 pages   | 52 s, 20.5 MB, 100 pages  |
| Expression                    | 64 s, 20.8 MB, 80 pages  | 126 s, 38.8 MB, 135 pages |
| With interactors              | 21 s, 10.3 MB, 58 pages  | 32 s, 15.4 MB, 99 pages   |
| Species comparison            | 90 s, 26.5 MB, 210 pages | 187 s, 48.4 MB, 296 pages |
| Expression, 2,600 identifiers | 35 s, 18.2 MB, 161 pages | 79 s, 34.3 MB, 256 pages  |

- **SC-203's targets, from these:** a 25-pathway report within 2 minutes (every one of
  today's here is faster), and a 50-pathway one within 4 minutes; today's species
  comparison at 50 takes 3 minutes.
- **Today's is over the edge's 100 s** for an expression or species-comparison report at
  50 pathways (126 s and 187 s): through the website such a report already fails today,
  which the background job (above) ends.

**What it costs.** The service keeps a finished report in its memory for an hour (FR-211,
amended): the analysis's results, under its token, as the analysis service itself keeps
them, never on disk, checked against the analysis service before it is sent. The
website's button opens the address in a tab rather than downloading it (plan, step 8).

## R5. Errors, and how they are compared

**Decision.** Errors are answered in the analysis service's JSON form (`code`, `reason`,
`messages`), as the gateway's own refusals are, with the statuses of FR-203.

**The comparison with today** is a replay on a private copy of the analysis service
built from the deployed version, recorded here when known (the controller differs
between its main branch and an unmerged one, spec Background). The replay includes a
failure while the PDF is made, which no request can cause: it is planted as a fault in
the private copy (an exporter made to throw), and the new service's answer is compared
with that copy's.

### The deployed build (T001, 7 Nov 2026)

The deployed analysis service is built from `reactome/analysis-service` at `9b147e1`
(branch `feature/batik-upgrade`, the website's pins; its classes match that commit's).
Its report controller is the same file as on `main`: it **streams** the PDF into the
answer as it is made. The buffering controller of the spec's Background is on another
unmerged branch, `add-null-checks-and-throw-errors`, which no deployment runs. So, read
from the deployed source:

- the species is looked up before the token, and the number clamped to 1–50, before
  anything is written;
- a failure of the PDF library, an illegal state or an I/O error while the PDF is
  written is caught and logged, and the answer ends with what was written: its status
  already sent (200) once any of the PDF has left the server's buffer;
- an exporter's own failure is raised again as an unchecked error, which the service's
  catch-all answers 500 in its JSON form only while nothing has been sent; after that
  the answer is cut off.

**The failure while the PDF is made was not replayed:** no private build of the
deployed commit exists yet (WebsiteAngular spec 010 T036 builds one). The answer above
is read from the source; the replay (T020) says it was not run.

### The replay set, as today's service answers it (T001, 7 Nov 2026)

On the website's development host's own analysis service, on loopback, with a token of
seven gene symbols and two made-up identifiers (an over-representation result holding
`TOTAL`, `UNIPROT` and `ENSEMBL`), one request at a time with a pause between. The
reports themselves are kept outside the repository; here, their status, headers and
size only.

| Case                                                               | Status | Answer                                                                                                                                                                       |
| ------------------------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The defaults (25 pathways)                                         | 200    | a PDF of 53 pages, 9.0 MB, in 33 s                                                                                                                                           |
| `number=0`, `number=-1`                                            | 200    | as `number=1` (10 pages): clamped                                                                                                                                            |
| `number=50`, `number=51`                                           | 200    | the same PDF, 100 pages, 19.6 MB, in 54–68 s: clamped                                                                                                                        |
| `number=` (empty)                                                  | 200    | as the defaults: an empty value is the default                                                                                                                               |
| `number=abc`, `number=1.5`                                         | 400    | the framework's default body (below)                                                                                                                                         |
| `resource=UNIPROT` (held)                                          | 200    | a PDF for that resource (9 pages)                                                                                                                                            |
| `resource=uniprot`, `resource=CHEBI` (not held), `resource=NOTONE` | 200    | as `TOTAL`: compared case and all, then the default                                                                                                                          |
| `importableOnly=true`, `=false`, `=1`                              | 200    | a PDF; `1` read as true (the framework's boolean)                                                                                                                            |
| `importableOnly=maybe`                                             | 400    | the framework's default body                                                                                                                                                 |
| a colour profile, known or not                                     | 200    | a PDF; an unknown profile is not refused                                                                                                                                     |
| species `Homo_sapiens`, `hOMO_SAPIENS`, `Homo%20sapiens`, `48887`  | 200    | as `9606`                                                                                                                                                                    |
| species `Mus_musculus` (no result for it)                          | 200    | a PDF with no pathways (9 pages)                                                                                                                                             |
| species unknown, the token good or unknown                         | 404    | `{"code":404,"reason":"Not Found","messages":[]}`                                                                                                                            |
| `number=abc` with an unknown species                               | 400    | the framework's default body: parameters first                                                                                                                               |
| token unknown (dated 2020, never issued)                           | 404    | `{"code":404,"reason":"Not Found","messages":[]}`                                                                                                                            |
| token gone (dated today, no result)                                | 410    | `{"code":410,"reason":"Gone","messages":[]}`                                                                                                                                 |
| token malformed (`notatoken`)                                      | 500    | the catch-all: `{"code":500,"reason":"Internal Server Error","messages":["Please get in touch with our help desk (help@reactome.org) for more details about this problem"]}` |
| token malformed with an unknown species                            | 404    | the species' 404: the species first                                                                                                                                          |
| token holding `%2F`                                                | 400    | the servlet container's HTML page                                                                                                                                            |
| a file name other than `report`                                    | 200    | the same PDF                                                                                                                                                                 |

**The bytes that matter for the replay:**

- **A PDF:** `Content-Type: application/pdf;charset=UTF-8`,
  `Content-Disposition: attachment; filename="report.pdf"`, sent in chunks.
- **The service's JSON errors** (404, 410, 500): `Content-Type:
application/json;charset=UTF-8`, no `Content-Disposition`, the body exactly as shown
  followed by one newline. They carry no `url` or path.
- **The framework's 400** (a number or flag that is not one): `Content-Type:
application/json;charset=UTF-8`, `Content-Disposition: inline;filename=f.txt`,
  `Connection: close`, and the body
  `{"timestamp":"…","status":400,"error":"Bad Request","path":"…"}`: the time of the
  request (ISO 8601, milliseconds, `+00:00`) and the request's path without its query,
  as received. These two fields are the only ones that differ between requests.
- Every answer carries `Access-Control-Allow-Origin: *`.

## R6. The address and its routing

**Decision.** pdf-export's service (spec 001's `serve`) adds the route
`GET /AnalysisService/report/{token}/{species}/{filename}.pdf` with today's parameters
(contracts/service.md). WebsiteAngular's analysis gateway sends the report lane to
pdf-export instead of the analysis service, and stops queueing it: today it makes one
report at a time and holds each request until its answer ends, which with pdf-export's
30 s wait would serialise every browser's polling, and three at once would exceed its
60 s queue. pdf-export's own limits (FR-210) protect it instead. The gateway keeps,
for the report path, what it adds to its other lanes besides the queue: its existing
per-client share (`PER_CLIENT`, eight by default, counted across all its lanes; a
client's report requests in flight counted, refused past it, never queued), and the
client named to pdf-export in a header it always overwrites,
`X-Reactome-Client`, set to its own `clientOf` (`X-Forwarded-For` would not do: nginx
appends to what a client sends, so a client could choose its leftmost value).
pdf-export uses it for its own share of the waiting reports, trusting it because only
trusted internal callers can reach pdf-export (FR-210), and counting a request without
it as one client. So the gateway gains a second upstream for this path, pdf-export
beside the analysis service; and when pdf-export cannot be reached it answers 503 in
the analysis service's form, as FR-203 asks, not its 502 for the analysis service.
nginx's route to the gateway is unchanged. Both are a WebsiteAngular task, in its own specs (spec Assumptions).

**Alternatives considered.** A new address on the website: rejected, as people's scripts
call today's (User Story 2).

## R7. What is logged, and what is kept

**Decision.** One log line per report: the token, the species, the number of pathways,
the time per stage, the size, and the code points FR-207 replaced (once each). No
submitted identifier, and nothing about the client; one line per report made, not per
request. The PDF is built in memory, kept there for at most an hour once finished
(FR-211, data-model Job), at most 512 MB of them, and sent once complete; no file of
it is written. Spec 001's printer writes its HTML to a temporary file and removes it;
for a report, that HTML holds submitted identifiers and lives for the whole print,
minutes long. So the folder is private to the service's user and on a memory-backed
filesystem (the container's `tmpfs`), the file is removed in a `finally`, and the
folder is emptied when the service starts, which a run killed while printing shows
(SC-205). The log holds a hash of the token, not the token.

**The hash is keyed (T015, accepted 13 Nov 2026):** HMAC-SHA-256 under a key made when the
service starts. A token is a date and a counter, so a plain hash of it can be reversed by
hashing the day's few thousand guesses; a keyed one cannot without the key, which never
leaves the process. The cost: one token's lines match only within one run of the service,
so T020's search of the logs (SC-205) runs within one service run.

**A request the client abandons** (the connection closes before the answer): only its
wait ends. The report goes on to its end or its time budget, for the next request to
fetch: a reader who closes the waiting page and comes back finds it made.

## R8. Fixtures and tests

**Decision.** A stub analysis service, extending spec 001's (T010), answers R1's
calls for made-up tokens on the fixture graph, with made-up identifiers (FR-213): an
over-representation result, an expression result with two columns, one with
interactors, one with nothing found for a species, and one gone (410: no result, though
dated within the service's 7 days; spec 001 research R6). The render stub answers the
overview. The fixture graph's placeholder people serve the edit history.

**Open, for the tasks:** a malformed token is the analysis service's catch-all 500 (spec
001 research R6), so call 1 reads it as "any other failure" and the report answers 503,
where spec 001 answers 404 `unknown-token` after checking the token's form itself
(R6's rule). Whether the report takes the same check is decided with its first token
task. Spec 001 also sends only the canonical token (R6): sent as given, one nested in
`%25` layers or holding `%2F` reaches the servlet container's HTML 400, and a decoded
`/` reaches another route, whose 404 would pass on as the token's; and it names each
call's `Accept`, as the CSV endpoint answers a 406 to the wrong one.

**Measured (T001):** today's report answers a malformed token 500 with the catch-all's
body, after the species (an unknown species is still its 404), and one holding `%2F`
the servlet container's HTML 400 (R5's table).

**Decided (8 Nov 2026):** the report takes spec 001's form check: a malformed token,
`%2F` included, is 404 in the service's form, after the species and before any call. Today's
500 for a client's bad input is an obvious bug, so this is a listed difference (spec
Assumptions), not a match. A number or flag that is not one keeps today's framework 400
exactly (R5), since callers may parse it.

## R9. The comparison with today's report (T019, 13 Nov 2026)

**The run.** T001's and T002's tokens could not be found again (they were not kept with
their reports), so one fresh token was made as T001 made its own (R5): an
over-representation analysis of seven gene symbols and two made-up identifiers, posted
to the development host's own analysis service on loopback, whose data are release 98.
Today's report came from that service at 25 and 50 pathways, one request at a time (31 s,
11.0 MB; 63 s, 25.9 MB); pdf-export's from `pdf-export report` with the same settings,
against the same analysis service, the render service and a private copy of the release
98 graph. Both are kept outside the repository, and removed after the run. Each pair was
compared by `pdf-export compare-report`.

**What the reader learned from today's files** (#212), each with a test on a report
printed here in today's form, seen failing without it:

- its parts numbered (`4. Most significant pathways`), "Pathways details", and a contents
  list naming them at a size between the body's and the parts' headings;
- its properties as sentences, set at a heading's size;
- its tables' cells each shaded on its own, which the reader had taken for a figure, so
  their text was left out;
- the pathways' table: `10 / 536`, thousands with commas, ratios to three places, powers
  with two-digit exponents, a name's lines centred beside its statistics; a statistic
  agrees where the values the two prints could be rounded from overlap;
- each detail at `1.Name (R-HSA-1)`, over two lines when long; "Cellular compartments:"
  and facts ending in a full stop; words broken at a line's end by a hyphen; "References"
  over an empty list; references hanging, their authors in another form, so each is
  compared from its year in brackets on; the edit history's header repeated on each
  page, and its names `Surname I, …`, so a row's names are compared as their words;
- the identifiers found and not found, several entries a row.
- On pdf-export's side: a row's statistics read by their cells, as a name's last word
  (`Interleukin-4`) can touch the first; the notes under the table end it; a figure's
  stray labels, set under 0.6 of the body's size, left out.

**Read on both sides** at 25 and at 50: the cover's title, name, release and link; all
nine properties; every row of the table; every detail, its figure, name, summation,
references, edit history, entities and, where there are some, compartments and
diseases; the identifiers found by resource and not found. The interactors are read
from pdf-export's headings only: this token has none, and today's form for them is
not known.

**Differences found** (the same at 25 and at 50):

| Part                             | Sections (25 / 50)                    | Reason                                                                                                                                                                                                                                                                                       |
| -------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Edit history, order within a day | 4 / 8 (and in some of the next row's) | **Bug, fixed (#213).** Today's groups a day's edits into a hash map with `computeIfAbsent`, which puts a new key at the head of its bucket; Created, Authored and Reviewed share one, so a day reads Modified, Revised, Edited, Reviewed, Authored, Created. R2 inferred the order of `put`. |
| Edit history, Modified rows      | 11 / 20                               | **Listed (decided 14 Nov 2026).** 20 of the 50 pathways have two `modified` edits in the release 98 graph (R2 said one). Today's prints none for them, and one where there is one; pdf-export prints a row for each, kept by the user's decision. `compare-report` lists it itself (T026).   |
| References                       | 1 / 2                                 | A Greek letter today's typeface lacks, written as U+0000 (an improvement). **For a decision:** a book's and a web page's reference printed in spec 001's form, where today's prints a web page's address and a book's publisher after a comma.                                               |

Every other part agreed at both sizes. The edit history's grouping by day (T007) holds:
on the two pathways with two edits of one kind on one day at different times, both
reports print one row with both names.

**Not run here:** the expression, interactors and species-comparison tokens (T002's
sample), whose reports today's prints in forms not read yet (value columns, interactor
tables); and the check of each figure for its overlay (quickstart §3).

## R10. The replay and the time (T020, 13–14 Nov 2026)

**The run.** On the development host's own services, on loopback: today's analysis service
(release 98), pdf-export's `serve` from this repository's `main` on a private copy of the
release 98 graph, and the website's render service. T001's tokens were not kept, so fresh
ones were made as R5 and R9 describe: over-representation analyses of seven gene symbols
and two made-up identifiers, a different pair of made-up identifiers for each token (1,546
pathways found, 2 identifiers not found). One request at a time throughout. The reports
were kept outside the repository and removed after the run.

### The replay (SC-202)

`node ci/replay.ts` (#215) sends each request to both services and compares the status,
the `Content-Type`, the file name, and the body of anything but a PDF (the framework's 400
by its form, its time apart). pdf-export's 202 is followed to its answer (FR-210, listed).
**39 cases: 36 the same, 3 listed differences, none other.**

- **The same:** the defaults; `number` at 0, 1, -1, 50, 51, empty, `abc` and `1.5` (the
  last two the framework's 400, byte for byte but the time); `resource` held, in another
  case, not held and not one; `importableOnly` true, false, 1 and `maybe` (400); four
  colour profiles, one unknown; the species as `Homo_sapiens`, `hOMO_SAPIENS`,
  `Homo%20sapiens`, `48887` and `Mus_musculus`; an unknown species with a good token, an
  unknown one, and `number=abc` (400: parameters first); an unknown token (404), a gone
  one (410); a malformed token with an unknown species (404: the species first); another
  file name (`report.pdf` still).
- **The parameters given twice**, as T006 read them from the framework's source:
  `number=7&number=abc` 200 (the first value read), `importableOnly=true&importableOnly=maybe`
  200, `resource=UNIPROT&resource=ENSEMBL` 200, in both.
- **Listed:** a malformed token (today's catch-all 500) and one holding `%2F` (today's
  servlet container's HTML 400), each 404 in the service's form here (R8); and
  `importableOnly=%20`, 200 here. **Today's answer to it, measured for the first time:** 500,
  `Content-Type: application/json;charset=UTF-8` with `Content-Disposition: attachment;
filename="report.pdf"` and an empty body, the connection closed: the failure the spec's
  Assumptions read from the source.
- **Not compared by SC-202, noted:** a PDF's `Content-Type` is `application/pdf` here, as
  contracts/service.md has it, and `application/pdf;charset=UTF-8` today. The replay
  reads them as one type.
- **Call 4's refusals** (another content type, an empty body): the analysis service's
  status, type and body (by its form) are T004's stub's.
- **The failure while the PDF is made** is still not replayed: no private build of the
  deployed commit exists (R5).
- **A finding, for WebsiteAngular:** the mouse report's figures (`Mus_musculus`, 25
  pathways) lost 4 of 25 to the render service's 500 (two diagrams, two ancestors'
  diagrams); the report was still 200 with each part without its figure, as the contract
  says, and logged. Not investigated here.

### The time (SC-203)

One report alone, timed by a client from the first request to the PDF, asking again at
once after each 202 (a browser following `Retry-After` adds up to 10 s). **Cold:** a fresh
token, so no render cache entry can hold its figures (the render service keys each on the
token): its counters showed every figure rendered (26 and 51) and no hit, and nothing else
drawn meanwhile. **Warm:** the same request after `serve` was restarted (its kept reports
gone), every figure a cache hit. Stages from the report's log line.

| Report      | Today's | Cold  | Analysis | Graph | Figures | Layout | Print  | Warm |
| ----------- | ------- | ----- | -------- | ----- | ------- | ------ | ------ | ---- |
| 25 pathways | 23 s    | 102 s | 0.2 s    | 0.1 s | 74.1 s  | 1.0 s  | 26.4 s | 28 s |
| 50 pathways | 36 s    | 184 s | 0.1 s    | 0.1 s | 132.4 s | 1.5 s  | 49.9 s | 56 s |

- **Within SC-203:** today's is faster (as T002's 31 s and 52 s), so the targets are 2
  and 4 minutes: 102 s and 184 s meet them, with 18 s and 56 s to spare.
- **Where the time goes:** the figures, about 2.8 s each two at once (R4's estimate), and
  the print, about a second a page with its contents' second pass. Warm, the print is
  nearly all of it.
- One sample each, on a host whose other services were not stopped.

### What is kept (SC-205)

The submitted identifiers of the four tokens, each token as issued, URL-decoded and
Base64-decoded, searched for (case-insensitive) in `serve`'s logs of five runs and in its
working folder, the search first shown to find them in a copy of the list:

- after the replay, with seven reports kept in memory: none;
- a report killed (`SIGKILL`) while it printed left its working page, holding the
  identifiers, in the folder, and no browser behind it; `serve` started again emptied
  the folder (the folder stays private to its user);
- then every log and the folder: **none**.

The log holds each report's token as a keyed hash, which differed between runs for the
same token, as R7 says.

### The look (SC-204)

**Not run:** spec 001's colour and font check is its T032, not yet built.

### The readers (SC-207)

The 25- and 50-pathway reports (51 and 93 pages, 33 and 58 bookmarks two levels deep, 111
and 208 links within the report, and links out to the website, PubMed and DOI):

- **pdf.js** (Firefox's viewer): opened; every bookmark and every link within the report
  resolved to one of its pages.
- **Poppler** 24.02 (its command-line tools, unpacked into a scratch folder, not
  installed or shipped): opened without an error; every bookmark and every link within
  the report on one of its pages; the first page drawn.
- **PDFium** (Chromium's viewer's engine, a WebAssembly build, likewise): opened, every
  page drawn. That build gives no access to bookmarks or links, so they were not
  followed in it.
- **Not done:** opening each in the readers themselves and clicking through, which needs
  a desktop, as spec 001's SC-004 (its T031) does.
