# Feature Specification: The analysis report PDF

**Feature Branch**: `spec002/analysis-report`

**Created**: 2026-10-30

**Status**: Draft

**Input**: User description: "The website's pathway analysis report PDF, replacing
reactome/analysis-report. Made on request, in the website's new look, with the same
content as today's report, by the same implementation as spec 001."

## Background: what today's report holds

The website offers a "Report (PDF)" download of an analysis result, made on request by
the analysis service at `/AnalysisService/report/{token}/{species}/{filename}.pdf`. It is
written by `reactome/analysis-report`, a library under the AGPL-3.0 built on iText 7,
inside the analysis service.

- **What it is asked:** the token, the species, a file name, and optionally the number of
  pathways to report (25 by default, at most 50), the resource to sort by, whether to
  count importable identifiers only, and three colour profiles (diagram, analysis and
  overview). At most two are made at once; more wait.
- **Its answers:** the PDF; 404 for a token it does not know; 410 for a result deleted
  by a new release.
- **What it holds, in order:**
  1. **A cover:** Reactome's logo, the title "Pathway Analysis Report" and the
     analysis's name.
  2. **A contents list,** linking each part below.
  3. **An introduction:** about Reactome, with Reactome's own references.
  4. **The analysis's properties:** its type, token and date, the species, whether it
     was projected to human and included interactors, how many identifiers were
     submitted and found, and links to see the result on the website.
  5. **The genome-wide overview:** the species overview (Reacfoam), overlaid with the
     analysis, with a caption.
  6. **The most significant pathways:** a table of the reported pathways, each with its
     entities found and total, ratio, p-value and false discovery rate, and its
     reactions found and total.
  7. **Each of those pathways in detail:** its name and statistics, its diagram (or
     illustration) overlaid with the analysis, the entities it mapped, and its
     description.
  8. **The identifiers found:** what each submitted identifier mapped to, with its
     values for an expression analysis, and interactors apart.
  9. **The identifiers not found.**

  A footer on each page names the server and the page.

- **Its figures** are drawn by the Java exporters in the old pathway browser's look, as
  in spec 001's Background.

The website's analysis gateway (WebsiteAngular) queues these requests before the
analysis service.

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
comparison) and one with interactors, ask for the report at the default number of
pathways and at the maximum, and compare each with today's report for the same token by
FR-208.

**Acceptance Scenarios**:

1. **Given** a known token and a species, **When** the report is asked for, **Then** it
   holds the Background's parts in order, the number of pathways asked for (25 by
   default, at most 50), sorted as today's report sorts them.
2. **Given** an expression analysis, **When** its report is asked for, **Then** the
   identifiers found carry their values, as today's.
3. **Given** an analysis with interactors, **When** its report is asked for, **Then** the
   interactors found are listed apart from the entities, as today's.
4. **Given** a pathway whose diagram is an illustration, **When** it is among the most
   significant, **Then** its detail holds the illustration, overlaid as the website
   overlays it, or recorded as a difference where the website cannot yet.
5. **Given** a submitted identifier that holds a character no font draws, **When** the
   report is asked for, **Then** the report is made, the character printed as the
   replacement mark and logged (spec 001 FR-017).

---

### User Story 2 - The download keeps working (Priority: P1)

Links the website and other people's programs already use go on working: the same
address and parameters give a report, and the same tokens give the same answers.

**Why this priority**: the analysis service documents this endpoint for programmatic
use; people's scripts call it.

**Independent Test**: replay a recorded set of today's requests (each parameter, each
answer: 200, 404, 410, and a token in each of the forms the service issues) against the
new service, and compare the statuses and the reports.

**Acceptance Scenarios**:

1. **Given** today's address with any of today's parameters, **When** it is asked,
   **Then** it answers a report; the colour profiles are accepted and ignored (the new
   look sets the colours).
2. **Given** an unknown token, **When** a report is asked for, **Then** the answer is
   404, as today. **Given** a token whose result was deleted by a release, **Then** 410.
3. **Given** a species the analysis does not cover, or a number of pathways out of range,
   **When** a report is asked for, **Then** the answer is as today's for the same
   request (the number is clamped to 1–50).
4. **Given** more requests at once than the service makes, **When** they arrive, **Then**
   they wait in a queue of bounded length, and beyond it are answered "unavailable" with
   a time to retry, never left hanging.

---

### User Story 3 - Only non-restrictive licences (Priority: P1)

The report adds nothing to what pdf-export ships that spec 001's licence check would
refuse, and reuses spec 001's theme, fonts, layout and printing.

**Why this priority**: the reason for replacing `analysis-report` (Principle II).

**Independent Test**: spec 001's licence check passes with this feature's dependencies
installed, and fails when a restrictive one is planted.

**Acceptance Scenarios**:

1. **Given** this feature's dependencies, **When** CI's licence check runs, **Then** it
   passes; **Given** a planted GPL-family dependency, **Then** it fails.

---

### User Story 4 - What users submitted stays theirs (Priority: P2)

A report holds the identifiers a user submitted. The service keeps nothing of them
beyond the request, and logs only counts.

**Why this priority**: identifiers are not personal data, but they are the user's
research data.

**Independent Test**: make reports for a token, then search the service's logs and its
working files for the submitted identifiers.

**Acceptance Scenarios**:

1. **Given** a report made and sent, **When** the service's logs and working files are
   searched, **Then** no submitted identifier is found; the log names the token, the
   species, the number of pathways, the time and any character replaced.

---

### Edge Cases

- **A token whose analysis found nothing** for the species: the report is made with its
  properties and the identifiers not found, and says no pathway was found, as today's.
- **Fewer significant pathways than asked for:** the report holds those there are.
- **A figure that cannot be drawn** (the render service refuses or times out): the
  report is made without it and the absence is logged, as for spec 001's single-event
  PDF.
- **Very many identifiers** (tens of thousands submitted, or not found): the lists are
  complete, the report is still made within SC-203, and the tables break across pages
  with their headers repeated.
- **A species comparison:** the report shows what today's shows for it.
- **A token from ReactomeGSA** (gene set analysis): the report shows what today's shows
  for it, with the website's link to see it.
- **A request abandoned by the client:** the work stops, and nothing is kept.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-201**: The system MUST answer today's report address and parameters (User Story 2)
  with a PDF holding the Background's parts in order; the colour profiles are accepted
  and ignored.
- **FR-202**: The system MUST read the analysis only through the analysis service's
  public interface; the analysis's sums stay in the analysis service. It reads the graph
  only for what that interface does not give (such as a pathway's description).
- **FR-203**: The report MUST answer 404 for an unknown token and 410 for one deleted by
  a release, by the analysis service's answers, and say which in the body.
- **FR-204**: Figures MUST be drawn as the website's pathway browser draws them, overlaid
  with the analysis by its token: the genome-wide overview, and each reported pathway's
  diagram or illustration (spec 001 FR-007, FR-008).
- **FR-205**: The report MUST take its look from spec 001: the website's light theme, its
  typefaces, and FR-016's layout rules (no boxes, the same margins on every page, a
  running header naming the report and a page number on every page but the cover, no
  figure split across pages).
- **FR-206**: The report MUST have a contents list before its parts and nested bookmarks,
  and link each pathway's row in the most-significant table to its detail, and each
  pathway's name to its page on the website.
- **FR-207**: Characters no embedded typeface draws MUST follow spec 001 FR-017 for PDFs
  made on request: the fixed list substituted, any other printed as the replacement mark
  and logged, the request never failing on it.
- **FR-208**: The report MUST be compared with today's for the same token by meaning:
  - the cover's title and analysis name;
  - the properties' values;
  - the pathways reported, in order, with their statistics;
  - each pathway's detail: its figure present, its statistics, its entities mapped;
  - the identifiers found, with their values, and the interactors;
  - the identifiers not found.
    Differences are allowed only where Assumptions lists them or a recorded reason gives
    them.
- **FR-209**: The text that is not the analysis's data (introduction, captions, the
  explanations of each part) MUST be the website's current wording, or written anew;
  nothing is copied from `analysis-report`.
- **FR-210**: The service MUST make at most a set number of reports at once (two by
  default, as today), queue a bounded number more, and answer "unavailable" with a time
  to retry beyond that. A report that takes longer than its time budget is abandoned and
  answered "unavailable".
- **FR-211**: The service MUST log, for each report, the token, the species, the number
  of pathways, its time, its size and any character replaced, and no submitted
  identifier. It keeps no file of a report after sending it.
- **FR-212**: Every dependency MUST pass spec 001's licence check (FR-009/FR-010).

### Key Entities

- **Report request:** the token, species, number of pathways (1–50), resource, and
  importable-only choice; the profiles, ignored.
- **Analysis summary:** from the analysis service: its type, date, species, projection,
  interactors, and the counts of identifiers submitted and found.
- **Reported pathway:** a pathway's stable identifier, name, statistics, its entities
  mapped, and its figure; its description from the graph.
- **Identifier lists:** found (with what each maps to and, for expression, its values;
  interactors apart) and not found.
- **Report:** the PDF, its parts in the Background's order, and its log line.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-201**: For a sample of tokens covering each analysis type, with and without
  interactors, at 25 and 50 pathways, the new report agrees with today's by FR-208, with
  only listed or recorded differences.
- **SC-202**: Every request in the replayed set of User Story 2 gets the same status as
  today's.
- **SC-203**: A report of 25 pathways is made in no more time than today's for the same
  token on the same private services, and one of 50 within a budget the plan sets from
  that measurement; the time is measured warm, with the render service's cache empty.
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
  single-event PDF, reusing its theme, fonts, layout, printing and figures. The
  constitution's Principle I is amended with this spec (version 1.1.0) to cover the
  website's PDFs generally, the analysis report among them.
- **The analysis service stays:** its analysis stays in Java and is not ported; only the
  report moves. Its report endpoint is retired once the website routes to pdf-export.
- **The website's part:** WebsiteAngular routes `/AnalysisService/report/` to pdf-export
  through its analysis gateway, in a task in its own specs, and offers the same "Report
  (PDF)" button.
- **The genome-wide overview** is drawn by WebsiteAngular's render service, which loads
  FoamTree under a commercial licence; pdf-export ships none of it (as spec 001's
  Assumptions say of the render service).
- **ReactomeGSA results:** in scope as far as today's report covers them; anything more
  (several samples, its own statistics) is a later spec.
- **Measured privately:** against a private analysis service on a private copy of the
  graph; no production requests, and no real ReactomeGSA runs.
- **Expected differences from today's report** (FR-208):
  - the look: layout, colours, typefaces and figures (spec 001's User Stories 3 and 6);
  - the bookmarks (FR-206), whether or not today's report has them;
  - the colour profiles, ignored;
  - rewritten text (FR-209);
  - the footer's server name, replaced by the running header and page number;
  - the wording of the 404 and 410 answers' bodies (their statuses are as today's);
  - today's service also sends each report's timing, with the client's address and
    browser, to a separate reporting service; the new one logs only what FR-211 lists.
