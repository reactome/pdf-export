# Research: the analysis report PDF

Each item says what was decided, why, and what else was weighed. Facts come from reading
the code (the analysis service, analysis-core, `analysis-report`, and WebsiteAngular's
render service and analysis gateway), not from running them; what must be measured is
said so, and is the plan's first work. No AGPL text is copied here, only endpoint paths
and identifiers.

## R1. The analysis service's public API: three calls

**Decision.** A report reads the analysis through three calls to the analysis service's
public API (contracts/analysis-api.md), whatever the number of pathways:

1. **`GET /token/{token}?resource={R}&importableOnly={B}&includeDisease=true`**, with no
   page, so every pathway comes back. It gives:
   - the summary: type, species, projection, interactors, sample name and file name;
   - the resources, with their counts after the filters;
   - the count of identifiers not found, and the expression columns' names;
   - every pathway with something found, in every species, after the resource and
     importable-only filters, in the service's default sort (entities' p-value,
     ascending): with its name, species, entities found, total, ratio, p-value and FDR,
     and reactions found, total and ratio.

   The reported pathways are the first N of these whose species is the report's.
   `includeDisease=true` is given explicitly, because without it the stored analysis's
   own setting applies; the default p-value threshold (none) is today's.

2. **`POST /token/{token}/found/all?resource=TOTAL`**, its body every pathway id from
   call 1. It gives each pathway's found entities (what each maps to, per resource, and
   the expression values) and found interactors. That covers both the reported
   pathways' details and the "identifiers found" across the whole filtered result,
   which today's report gathers over the same pathways. Each detail's per-resource
   tables are split from `mapsTo[].resource`, as today's report filters them.
3. **`GET /token/{token}/notFound`**, unpaged: every identifier not found, with its
   expression values; sorted and with repeats removed here, as today's report does.

**What the API does not give, and what is done instead:**

- **The result's server** (the footer's link today) is not in the API's summary. The
  report's links go to the deployment's site, a setting (`--site`), as spec 001's do.
- **The count of identifiers found** is not a field: it is the size of the union of call
  2's found identifiers, as today's report computes it.
- **The reactions' columns:** today's report shows a pathway's reactions unfiltered (the
  `TOTAL` resource, all identifiers); call 1's are filtered by the resource and
  importable-only. When the report asks for another resource or importable-only, a
  fourth call, `GET /token/{token}?resource=TOTAL&importableOnly=false&includeDisease=true`,
  gives the unfiltered reactions to join by pathway. Whether the two ever differ is
  measured on the private copy (Order of work); if they never do, the fourth call is
  dropped.
- **The species** is resolved from the graph (a name in any case with `_` as a space, a
  taxonomy id, or a database id, as graph-core resolves it today), and passed to the
  API by its taxonomy id.

**Rationale.** Three calls are the fewest that give everything, and none of the
analysis's sums moves out of the analysis service (FR-202). The calls are made from
pdf-export to the analysis service directly, not through the gateway, which queues only
`/AnalysisService/report/…` and submissions.

**Alternatives considered.**

- One `GET /token/{token}/found/all/{pathway}` per pathway: 1 + 2N calls; rejected for
  the same data in more round trips.
- `/download/{token}/entities/found/{resource}/{filename}.csv`: no expression values and
  no interactors, and the whole stored result rather than the filtered one; rejected.
- `/download/{token}/result.json`: the whole result in one file, but its shape for this
  purpose was not read; not needed, as call 2 suffices.

## R2. What comes from the graph

**Decision.** Each reported pathway's detail is spec 001's section, read with spec 001's
queries (its `src/graph/queries.ts`), which already give, in the curators' order:
compartments, diseases (the generic "disease" left out), inferred-from, summations,
the first five references with their authors, and the diagram that holds a pathway with
no diagram of its own. Two additions:

- **The edit history's rows** gain today's report's "created" and "modified" rows beside
  authored, edited, reviewed and revised, grouped one row per date and action with up
  to five names and then "et al." (spec 002's Background); spec 001's `editRows` is
  extended by a parameter rather than copied.
- **The release** and the species' names, read once per report.

**Rationale.** One reading of an event for both PDFs (constitution I), and the lists'
order is already the curators' (spec 002's listed differences rely on it).

## R3. Figures from the render service

**Decision.** Every figure comes from WebsiteAngular's render service (contracts/render.md
of spec 001, with additions in this spec's contracts/render.md):

- a pathway's own diagram: `/render/{stId}.svg?token={token}`;
- the diagram that holds a pathway: `/render/{diagramStId}.svg?highlight={ids}&token={token}`;
- an illustration (EHLD): `/render/{stId}.svg?token={token}`;
- the genome-wide overview (Reacfoam): `/render/genome-wide.svg?species={taxId}&token={token}`.

**Pacing.** The service renders two at a time and queues eight more, refusing the next
at once with 503 and `Retry-After: 5`. A report asks for its up to 51 figures at the
service's own concurrency (a setting, 2 by default), never all at once, and retries a
503 once after its pause, as spec 001's client does. Identical requests coalesce in the
service, and a figure is cached under its token, so a second report of the same token
is fast; a new token is always cold.

**The resource.** The render service takes no `resource` (a request with one is refused
with 400), so a diagram is overlaid for all resources together. Adding it is a
WebsiteAngular task (the page already has a resource filter state, unset on the render
path); until it ships, the overlay is a listed difference (spec, FR-204).

## R4. The time budget: likely over, to be measured first

**What bounds it.** The gateway's report lane runs one report at a time, queues up to 40,
and answers "unavailable" to a request that has waited 60 s. The edge closes a request
after 100 s, and the PDF is sent only once it is complete (FR-210). So a report has
about 40 s after the longest wait.

**What a cold report costs, by inference.** The render service's README measures a cold
render at 4.2–6.9 s (an expression-token diagram 6.7 s, an illustration 3.5 s). 51
figures two at a time is about 26 rounds of 5–7 s, about 2–3 minutes, before layout and
printing. That is well over 40 s. A 25-pathway report, the website's default, is about
half that, still over.

**Decision.** Measure first, on a private stack (Order of work, step 1): a cold report of
25 and of 50 pathways, stage by stage. If it is over, bring the user the choices, with
the numbers:

- a shorter wait on the gateway's report lane, so more of the 100 s is left;
- more render concurrency for report figures (the host's memory sets the limit);
- a lower SC-203 target, or a smaller default number of pathways;
- the report made in the background and fetched when ready (a different contract:
  a 202 with where to fetch it, and the website's button changed to poll).

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

## R8. Fixtures and tests

**Decision.** A stub analysis service, extending spec 001's (T010), answers the three
calls for made-up tokens on the fixture graph, with made-up identifiers (FR-213): an
over-representation result, an expression result with two columns, one with
interactors, one with nothing found for a species, and one past retention (410). The
render stub answers the overview. The fixture graph's placeholder people serve the
edit history.
