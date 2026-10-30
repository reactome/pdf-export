# Feature Specification: The analysis report PDF

**Feature Branch**: `spec002/analysis-report`

**Created**: 2026-10-30

**Status**: Draft

**Input**: User description: "The website's pathway analysis report PDF, replacing
reactome/analysis-report. Made on request, in the website's new look, with the same
content as today's report, by the same implementation as spec 001."

## Background: what today's report holds

The website offers a "PDF Result" download of an analysis result, made on request by
the analysis service at `/AnalysisService/report/{token}/{species}/{filename}.pdf`. It is
written by `reactome/analysis-report`, a library under the AGPL-3.0 built on iText 7,
inside the analysis service. It draws its figures with the same Java exporters as
`event-pdf`, in the old pathway browser's look.

### What it is asked, and how it answers

- **The species** is looked up first, as a name (any case, `_` read as a space), a
  taxonomy id or a Reactome database id; the website's own button sends a taxonomy id, a
  database id or "Homo sapiens". One the graph does not know is answered 404, before the
  token is read. A species the analysis has no result for gives a report with no
  pathways.
- **The token:** one the service does not know is answered 404; one whose result a new
  release deleted, 410.
- **The number of pathways** to report: 25 by default, clamped to 1–50.
- **The resource** to sort and filter by (`TOTAL` by default): one the result does not
  hold is silently replaced by the result's default (the only resource besides `TOTAL`
  when it holds just one, otherwise `TOTAL`).
- **Importable only:** when set, with the `TOTAL` resource, only the pathways found
  through importable identifiers are kept, and the table's statistics count importable
  identifiers only.
- **Three colour profiles** (diagram, analysis and overview).
- **The file name** in the address is ignored: the download is always named `report.pdf`.
- **At most two** reports are made at once; more wait, without limit.
- **Its errors** (the 404s, the 410, and a 500 for a service that cannot answer before
  the PDF is begun) are JSON in the analysis service's form (`code`, `reason`,
  `messages`); the analysis gateway's own refusals before it use the same form. A figure
  whose exporter reports a failure is left out (logged), and the report is still
  answered 200.
- **A failure while the PDF is being made** is answered differently by the two builds of
  the controller. On the analysis service's main branch the PDF is streamed as it is
  made, so the answer ends early, usually as a 200 (its exact form, a short PDF or a
  cut-off file, is the replay's to record). An unmerged branch buffers the PDF: a
  failure of the PDF library, or the report library's own exception (raised when its
  bundled style fails to load), is then answered 500 with the web framework's default
  body, and any other failure 500 in the service's JSON form. Which build the deployments run
  is settled by the deployed analysis service's version or commit, which the plan
  records; the replay's private copy is built from that.
- **The figures' overlays:** each pathway's diagram is overlaid for the report's
  resource; the genome-wide overview shows the pathways the report's filter kept,
  coloured for the result's default resource (as above). Neither is ever for importable
  identifiers only.
- **The pathways reported** are the result's pathways for the species, with something
  found, in the analysis service's default sort for the resource: by the entities'
  p-value counted over all identifiers, lowest first, even when the table shows the
  importable-only p-values; disease pathways included.

### What it holds, in order

1. **A cover:** Reactome's logo, the title "Pathway Analysis Report", the analysis's
   name (the sample's name, else the file's, else the species compared with, else the
   type, else the token; the PDF's title is "Pathway Analysis Report - " and that name), the release, the date the report was made, the link to the result in the
   pathway browser, and how long results are kept.
2. **A contents list,** linking each part below.
3. **An introduction:** about Reactome, with Reactome's own references.
4. **The analysis's properties:** its type, explained, with a link to the user guide;
   the identifiers found and the total (found plus not found), and the number of
   pathways hit: both over the pathways the resource and importable-only filters kept,
   the identifiers found across all of those pathways' resources, not narrowed to
   importable ones; whether it was projected to
   human (with a link to how inferred events are made) and whether interactors were
   included (each said only when it was); the species and resource the report is for; and the token, with how long it is
   kept.
5. **The genome-wide overview:** the species overview (Reacfoam), overlaid with the
   analysis, with a caption.
6. **The most significant pathways:** a table of the reported pathways, each with its
   entities found and total, entities ratio, p-value and false discovery rate, and its
   reactions found, total and ratio. The entities' columns are for the species and
   resource; the reactions' are the pathway's own.
7. **Each of those pathways in detail:** its name, with its stable identifier linked to
   its page on the website; its figure (its own diagram, or the diagram that holds it
   with its events selected, or its illustration), overlaid with the analysis; its
   compartments, diseases (the generic "disease" left out) and what it was inferred
   from; its descriptions; its first five references; its edit history, one row for each
   date and action (created, modified, authored, edited, reviewed, revised) with that
   row's names, up to five and then "et al."; the entities it found, for
   each resource; and, with interactors, the interactors it found.
8. **The identifiers found,** across the whole result after the resource and
   importable-only filters: what each submitted identifier
   mapped to, with its values for an expression analysis, and interactors apart.
9. **The identifiers not found,** complete, without repeats, sorted. Left out when there
   are none (though today's contents list still links it).

A footer names the server (a link, the result's own server, or Reactome's by default) and
the page, from the third page on, numbered from 2. There are no bookmarks.

The website's analysis gateway (WebsiteAngular) queues these requests before the
analysis service, one at a time by default, with a bounded queue, and answers
"unavailable" with a time to retry beyond it.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - A report of an analysis, in the website's new look (Priority: P1)

A website user has run an analysis and downloads its report. They get one PDF with the
parts of the Background, in order, in the new look, with figures as the new pathway
browser draws them, overlaid with their analysis.

**Why this priority**: the website offers this download today. Retiring
`analysis-report` (Principle II: its licence) leaves it with nothing to serve unless this
replaces it.

**Independent Test**: on a private analysis service and a private copy of the graph, for
analyses of each type the service offers (over-representation, expression, species
comparison) and one with interactors, all on made-up identifiers, ask for the report at
the default number of pathways and at the maximum, and compare each with today's report
for the same token by FR-208.

**Acceptance Scenarios**:

1. **Given** a known token and a species, **When** the report is asked for, **Then** it
   holds the Background's parts in order, the number of pathways asked for (25 by
   default, 1–50), in the Background's order.
2. **Given** an expression analysis, **When** its report is asked for, **Then** the
   identifiers found carry their values, as today's.
3. **Given** an analysis with interactors, **When** its report is asked for, **Then**
   each pathway's detail lists the interactors it found, and the identifiers found list
   them apart, as today's.
4. **Given** a reported pathway with no diagram of its own, **When** its detail is
   written, **Then** its figure is the diagram that holds it, with its events selected,
   overlaid; one whose figure is an illustration is overlaid as the website overlays it,
   or recorded as a difference where the website cannot yet.
5. **Given** a submitted identifier that holds a character no font draws, **When** the
   report is asked for, **Then** the report is made, the character printed as the
   replacement mark and logged (spec 001 FR-017).
6. **Given** a result with no identifiers not found, **When** its report is asked for,
   **Then** that part is left out of the report and of its contents list.

---

### User Story 2 - The download keeps working (Priority: P1)

Links the website and other people's programs already use go on working: the same
address and parameters give a report, and the same requests get the same answers.

**Why this priority**: the analysis service documents this endpoint for programmatic
use; people's scripts call it and save what it sends.

**Independent Test**: replay a recorded set of requests to today's service on a private
copy (each parameter, each answer: 200, 404 for a species and for a token, 410, a
resource the result lacks, a number out of range, a number or flag that is not one, the
species as a name, a taxonomy id and a database id, and a failure while the PDF is made,
which no request can cause and so is planted as a fault in the private copy, built from
the deployed build) against the new service, and compare
the statuses, the file names and the reports.

**Acceptance Scenarios**:

1. **Given** today's address with any of today's parameters, **When** it is asked,
   **Then** it answers a report named `report.pdf`, whatever the file name in the
   address; the colour profiles are accepted and ignored (the new look sets the
   colours).
2. **Given** a species the graph does not know, **When** a report is asked for, **Then**
   404, whatever the token; **given** an unknown token, 404; **given** a token whose
   result a release deleted, 410.
3. **Given** a number of pathways out of range, **Then** it is clamped to 1–50; **given**
   a resource the result lacks, **Then** the result's default is used, as today.
4. **Given** more requests at once than the service makes, **When** they arrive, **Then**
   they wait in a bounded queue, and beyond it, or past their time budget, are answered
   "unavailable" with a time to retry, never left hanging.

---

### User Story 3 - Only non-restrictive licences (Priority: P1)

The report adds nothing to what pdf-export ships that spec 001's licence check would
refuse, and reuses spec 001's theme, fonts, layout and printing.

**Why this priority**: the reason for replacing `analysis-report` (Principle II).

**Independent Test**: spec 001's licence check passes with this feature's dependencies
installed, and fails when a restrictive one is planted.

**Acceptance Scenarios**:

1. **Given** this feature's dependencies, **When** CI's licence check runs, **Then** it
   passes; **given** a planted GPL-family dependency, **Then** it fails.

---

### User Story 4 - What users submitted stays theirs (Priority: P2)

A report holds the identifiers a user submitted. The service keeps nothing of them
beyond the request, and logs only FR-211's fields: none of them a submitted identifier.

**Why this priority**: identifiers are not personal data, but they are the user's
research data.

**Independent Test**: make reports for a token, then search the service's logs and its
working files for the submitted identifiers.

**Acceptance Scenarios**:

1. **Given** a report made and sent, **When** the service's logs and working files are
   searched, **Then** no submitted identifier is found; the log holds only FR-211's
   fields.

---

### Edge Cases

- **A species with no result** for the token: the report is made with its properties
  and the identifiers not found, and the most significant pathways' table is empty, as
  today's.
- **Fewer pathways with something found than asked for:** the report holds those there
  are.
- **A figure that cannot be drawn** (the render service refuses or times out): the
  report is made without it and the absence is logged, as for spec 001's single-event
  PDF.
- **Up to 51 figures** (the overview and 50 pathways) are asked of the render service
  at its own concurrency, not all at once: a burst past its queue would be refused, and
  those figures lost.
- **The analysis service, the graph or the render service cannot answer at all:** the
  request is answered "unavailable" with a time to retry; no partial report is sent.
- **Very many identifiers** (tens of thousands found, or not found): the lists are
  complete, the report is still made within SC-203, and the tables break across pages
  with their headers repeated.
- **A species comparison:** the report shows what today's shows for it.
- **A token from ReactomeGSA** (gene set analysis): the report shows what today's shows
  for it, its type explained with ReactomeGSA's guide.
- **A request abandoned by the client:** the work stops, and nothing is kept.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-201**: The system MUST answer today's report address and parameters with a PDF
  holding the Background's parts in order, handling each parameter as the Background
  says (species looked up first, the number clamped, a missing resource replaced by the
  result's default, importable-only as a filter, the file name ignored and the download
  named `report.pdf`); the colour profiles are accepted and ignored.
- **FR-202**: The system MUST read the analysis only through the analysis service's
  public interface, including the order of the pathways reported (its default sort, by
  the entities' p-value, lowest first); the analysis's sums stay in the analysis
  service. From the graph it reads only what that interface does not give: the
  release, species' names, and each reported pathway's compartments, diseases, inferred
  from, descriptions, references, edit history and the diagram that holds it.
- **FR-203**: The report MUST answer errors in the analysis service's JSON form
  (`code`, `reason`, `messages`), the form the analysis gateway in front of it also uses,
  so the address keeps one error format: 404 for a species the graph does not know
  (before the token is read), 404 for an unknown token, 410 for one a release deleted
  (by the analysis service's answers), a number or flag that is not one as today's (the
  replay records which), 500 when making the PDF fails, and 503 when the
  analysis service, the graph or the render service cannot answer or the service is at
  its limit (today's answers 500 to the first when it fails before the PDF is begun, and
  has no limit: a listed difference).
- **FR-204**: Figures MUST be drawn as the website's pathway browser draws them, overlaid
  with the analysis by its token: each reported pathway's figure, chosen as spec 001's
  Background ("Its figures") and its Figure entity choose (its own diagram, or the
  diagram that holds it with its events selected, or its illustration), for the
  report's resource; and the genome-wide overview, for the result's default resource, as
  today's (spec 001 FR-008). The render service takes no resource yet and overlays every
  figure for the result's default resource: adding one is a WebsiteAngular task, and
  until it ships a pathway's figure for a report whose resource is not the default is
  a listed difference.
- **FR-205**: The report MUST follow spec 001's look and layout: FR-015's theme and
  typefaces, and FR-016's rules (no boxes, the same margins on every page, no figure
  split across pages or below the legibility floor, a page number on every page but the
  cover, and a running header naming the report, or on its front parts that part).
- **FR-206**: The report MUST have a contents list before its parts and bookmarks: the
  parts, and under the pathways' details each pathway. It links each pathway's row in
  the most-significant table to its detail, and each pathway's stable identifier to its
  page on the website, as today's.
- **FR-207**: Characters no embedded typeface draws MUST follow spec 001 FR-017 for PDFs
  made on request: the fixed list substituted, any other printed as the replacement mark
  and logged, the request never failing on it.
- **FR-208**: The report MUST be compared with today's for the same token by meaning:
  - the cover's title, analysis name, release and link to the result;
  - the properties' values;
  - the pathways reported, in order, with their statistics;
  - each pathway's detail: its figure present, its compartments, diseases, inferred
    from, descriptions, references, its edit history's rows (their names as a set), its entities
    found per resource and its interactors;
  - the identifiers found, with their values, and the interactors;
  - the identifiers not found.
    Differences are allowed only where Assumptions lists them or a recorded reason gives
    them. A comparison never prints people's names (spec 001 FR-012).
- **FR-209**: The text that is not the analysis's data (introduction, captions, the
  explanations of each part) MUST be the website's current wording, or written anew;
  nothing is copied from `analysis-report`.
- **FR-210**: The service MUST make at most a set number of reports at once (two by
  default, as today), queue a bounded number more, and answer "unavailable" with a time
  to retry beyond that; a report that takes longer than its time budget is abandoned
  and answered "unavailable". On the website's path the analysis gateway's queue comes
  first; the service's own limit protects it from callers that do not pass the gateway.
  The PDF is sent only once it is complete, and the edge closes a request after 100 s,
  so the budget is what is left of those 100 s after the longest wait in the gateway's
  queue and the service's own.
- **FR-211**: The service MUST log, for each report, the token, the species, the number
  of pathways, its time, its size and any character FR-207 replaced, and no submitted
  identifier and nothing about the client. It keeps no file of a report after sending
  it.
- **FR-212**: Every dependency MUST pass spec 001's licence check (FR-009, SC-006).
- **FR-213**: Fixtures and samples MUST use made-up identifiers and placeholder names
  for the authors and curators a report names (constitution Principle VII; spec 001
  FR-013).

### Key Entities

- **Report request:** the species, token, number of pathways (1–50), resource,
  importable-only choice and file name; the profiles, ignored.
- **Analysis summary:** from the analysis service: its type, sample and file names,
  species, projection, interactors, the counts of identifiers submitted and found, the pathways hit, and its
  server.
- **Reported pathway:** a pathway's stable identifier, name and statistics from the
  analysis service, its entities and interactors found; from the graph, the parts of its
  detail and its figure's source.
- **Identifier lists:** found (with what each maps to and, for expression, its values;
  interactors apart) and not found.
- **Report:** the PDF, its parts in the Background's order, and its log line.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-201**: For a sample of tokens covering each analysis type, with and without
  interactors, at 25 and 50 pathways, the new report agrees with today's by FR-208, with
  only listed or recorded differences.
- **SC-202**: Every request in the replayed set of User Story 2 gets the same status and
  file name as today's, but where Assumptions lists a difference.
- **SC-203**: A report of 25 pathways is made in no more time than today's for the same
  token on the same private services, and one of 50 within a budget the plan sets from
  that measurement and FR-210's limit (what is left of the edge's 100 s after the
  queues); the time is measured with the render service's cache empty.
- **SC-204**: Every colour and typeface in the report's own text and layout is one spec
  001 SC-009 allows, as its check shows.
- **SC-205**: No submitted identifier is found in the service's logs or working files
  after a sample of reports (User Story 4).
- **SC-206**: CI's licence check passes, and fails on a planted restrictive dependency.
- **SC-207**: The report opens, and its bookmarks and links work, in the three readers of
  spec 001 SC-004.

## Assumptions

- **Content, not redesign:** the report holds today's content in the new look (the
  user's choice, 30 Oct 2026); improvements are recorded for a later spec, not made
  here.
- **One implementation:** the report is made by pdf-export, beside spec 001's
  single-event PDF, reusing its theme, fonts, layout, printing and figures; a reported
  pathway's detail is close to spec 001's section, and shares its parts. The
  constitution's Principle I is amended with this spec (version 1.1.0) to cover the
  website's PDFs generally, the analysis report among them.
- **Spec 001's FR-017** (characters no font draws) is merged before this spec.
- **The analysis service stays:** its analysis stays in Java and is not ported; only the
  report moves. Its report endpoint is retired once the website routes to pdf-export.
- **The website's part:** WebsiteAngular routes `/AnalysisService/report/` to pdf-export
  through its analysis gateway, in a task in its own specs, and offers the same "PDF Result"
  button.
- **The genome-wide overview** is drawn by WebsiteAngular's render service, which loads
  FoamTree under a commercial licence; pdf-export ships none of it. Unlike spec 001's
  figures, the overview cannot be drawn without FoamTree, so this dependency has no end:
  it needs the user's or the release owners' agreement, recorded here, or an amendment
  to constitution Principle II, before tasks are written (plan, Complexity Tracking).
- **The identifiers found** are gathered across the whole result, as today's; how the
  public interface gives them at that scale, within SC-203, is the plan's to measure.
- **ReactomeGSA results:** in scope as far as today's report covers them; anything more
  (several samples, its own statistics) is a later spec.
- **Measured privately:** against a private analysis service on a private copy of the
  graph, with made-up identifiers; no production requests, and no real ReactomeGSA runs.
- **An open risk for the plan, to settle with the user:** the time FR-210 leaves is
  about 40 s (the edge's 100 s less the gateway's wait of up to 60 s). The render
  service's measured times (about 5–7 s for a diagram with a token, two at a time)
  suggest a cold report of 50 pathways needs about 2 minutes. The plan measures it
  (spec 001's T005 part c) and, if it is over, brings the user the choices: a shorter
  wait on the gateway's report lane, more render concurrency, a lower SC-203 target, or
  a report made in the background and fetched when ready.
- **The website's button** is labelled "PDF Result" today and is hidden for ReactomeGSA
  results; the address serves any token.
- **Expected differences from today's report** (FR-208):
  - the look: layout, colours, typefaces and figures (spec 001's User Stories 3 and 6);
  - bookmarks, which today's has none of;
  - the colour profiles, ignored;
  - rewritten text (FR-209);
  - the footer's server link and its numbering, replaced by the running header and a
    page number counted from the cover;
  - the identifiers not found, when there are none, also left out of the contents list,
    where today's links to a part that is not there;
  - a pathway's figure overlaid for the result's default resource where the report's
    resource is another, until the render service takes a resource (FR-204);
  - in an edit-history row with more than five names, which five are shown (today's
    takes five from a hash set);
  - the genome-wide overview showing the whole result's pathways, where today's shows
    only those the report's resource and importable-only filters kept (the same with
    the website's defaults);
  - KEGG COMPOUND's and NCBI Protein's identifiers and interactors shown, in each
    pathway's detail and in the identifiers found, where today's tables for them are
    always empty and left out (an obvious bug: it compares their display names with the
    mappings' resources);
  - an edit with no date left out of the edit history, where today's report fails;
  - a 503, where today's answers 500, when a service it needs cannot answer before the
    PDF is begun (after that, the Background's build-dependent answers);
  - the order of what a pathway was inferred from (today's in no set order), in the
    curators' order; its compartments, references (and so which five are shown),
    diseases and descriptions are in the curators' order in both, and must match;
  - a failure while making the PDF answered 500 in the analysis service's JSON form,
    before any of the PDF is sent, where today's ends the answer early (main) or, for
    a failure of the PDF library, answers 500 with the framework's default body (the
    unmerged branch) (the Background);
  - a request beyond the queue or past its time budget answered "unavailable", where
    today's waits without limit;
  - today's service also sends each report's timing, with the client's address and
    browser, to a separate reporting service; the new one logs only what FR-211 lists.
