# Implementation Plan: The analysis report PDF

**Branch**: `spec002/plan` | **Date**: 2026-10-30 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/002-analysis-report/spec.md`

## Summary

pdf-export makes the website's analysis report on request, in place of
`reactome/analysis-report`, by the same code as spec 001's single-event PDF.

- **The analysis:** four calls to the analysis service's public API, five when the report
  filters, give everything the report shows, whatever its number of pathways (research
  R1); the analysis's sums stay in the analysis service.
- **The pathways' details:** spec 001's sections, read from the graph by spec 001's
  queries, with the edit history grouped as today's report groups it (R2).
- **Figures:** the render service's SVGs, overlaid by the token, the genome-wide overview
  among them, asked for at the service's own concurrency (R3).
- **Layout and printing:** spec 001's theme, fonts, layout and printer; the report's
  parts are new templates beside spec 001's (R2).
- **The address:** today's, served by pdf-export's service behind WebsiteAngular's
  analysis gateway (R6).
- **The time a cold report takes** is likely over what the edge allows (R4): measured
  first, and brought to the user with the choices.

## Technical Context

**Language/Version**: TypeScript on Node 24, as spec 001.

**Primary Dependencies**: spec 001's (its plan's table); nothing new.

**Storage**: none. It reads the analysis service's API, the graph and the render
service, and keeps nothing after sending (R7).

**Testing**: Node's test runner, with a stub analysis service (spec 001's T010, extended)
and the render stub; the fixture graph (R8).

**Target Platform**: spec 001's container image, beside the website's services.

**Project Type**: a route in spec 001's web service.

**Performance Goals**: SC-203 against today's report on the same private services; the
budget is what the edge's 100 s leaves after the gateway's wait (R4), likely too little
for a cold report; the plan measures it first.

**Constraints**: the analysis service's API only (FR-202); no submitted identifier logged
or kept (FR-211); FR-017 for characters; constitution 1.1.0.

**Scale/Scope**: up to 50 pathways and 51 figures a report; one report at a time behind
the gateway's lane, two in the service by default.

## Constitution Check

_GATE: checked before research and again after design._

| Principle                          | How the plan meets it                                                                                                                                                                                                                                       | Status                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| I. One implementation              | The report reuses spec 001's graph reading, sections, layout, figures and printing; its new code is the report's parts and the analysis client.                                                                                                             | Pass                                                   |
| II. Loose licences only            | No new dependency. The render service's FoamTree remains spec 001's tracked violation, and for the genome-wide overview it has no end: the overview is FoamTree's own drawing.                                                                              | **Needs agreement** before tasks (Complexity Tracking) |
| III. The graph, nothing relational | The graph and the analysis service's public API: Principle III's "So" names the graph and the release's files; the analysis API is a third source, read because FR-202 keeps the analysis's sums in the analysis service, and it is no relational database. | Pass, by FR-202                                        |
| IV. The pathway browser's look     | Every figure is the render service's, overlaid for the result's default resource once the page waits for its overlay (step 0, gating the report). The resource it cannot yet take is a listed difference until WebsiteAngular adds it (R3).                 | Pass, with R3's gaps tracked                           |
| V. Verify the instrument           | The replay and the FR-208 comparison are each shown failing on a planted fault; the time is measured, not inferred.                                                                                                                                         | Pass                                                   |
| VI. No production                  | A private analysis service on a private graph copy, with made-up identifiers; no production requests, no ReactomeGSA runs.                                                                                                                                  | Pass                                                   |
| VII. No names                      | Fixtures use placeholder people and made-up identifiers (FR-213); comparisons print counts and hashes.                                                                                                                                                      | Pass                                                   |

**After design:** unchanged; Principle II's gate stays open until that agreement.

## Project Structure

### Documentation (this feature)

```text
specs/002-analysis-report/
├── spec.md
├── plan.md              # this file
├── research.md          # R1–R8
├── data-model.md        # the report's entities
├── quickstart.md        # runs that prove it
├── contracts/
│   ├── service.md       # GET /AnalysisService/report/…
│   ├── analysis-api.md  # the analysis service calls pdf-export makes
│   └── render.md        # what the report adds to spec 001's render requests
├── checklists/
│   └── requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── analysis/      # spec 001's client, extended: the report's calls (R1)
├── report/        # the report model (data-model.md) and its parts' layout
└── serve.ts       # spec 001's service, with the report's route (contracts/service.md)
test/
├── report/
└── stubs/         # the analysis stub, extended (R8)
```

**Structure Decision**: the report is a module beside spec 001's, sharing everything
else (constitution I).

## Order of work

0. **The render page waits for its overlay** (WebsiteAngular, in its own specs; R3):
   for the result's default resource, with a test that fails when the page is ready
   before its overlay, and the render cache's key bumped so figures cached without it
   are not served. It gates the report (FR-204), and comes before step 1's figure
   timings, so they include the wait.
1. **Measure first** (each recorded in research):
   - the deployed analysis service's version, so the replay's private copy is built
     from it (R5);
   - today's report on that private copy, for a sample of tokens at 25 and 50 pathways:
     its time and size (SC-203's baseline);
   - a cold report, stage by stage, on a private stack: the analysis calls (R1's call 4
     for a large expression dataset), the figures (spec 001's T005, part c), layout and
     printing (twice, for the contents);
   - **then the time budget's decision with the user** (R4), before the service is
     built to one answer;
   - **and the overview's FoamTree agreement** (Complexity Tracking), recorded in spec
     Assumptions, before tasks are written.
2. **Spec 001's foundations first:** this spec builds on modules spec 001's tasks have
   not built yet: the analysis stub (its T010), the analysis client (T020, T021) and the
   service (T022), besides the layout and printing already merged. Its own work starts
   once those are, or builds them first under spec 001's task numbers.
3. **Foundations:** the analysis stub extended, made-up fixture tokens.
4. **The model:** the report's entities from R1's calls and the graph, the identifiers
   found gathered as today's report gathers them.
5. **Layout:** the report's parts, in spec 001's theme; the genome-wide overview.
6. **The service:** the route, its parameters, its errors in the analysis service's
   form, its limits, and stopping the work when the client abandons the request (R7).
7. **The checks:** the replay (User Story 2), the comparison by FR-208 with each
   figure's overlay checked (quickstart §3), SC-203's timing,
   SC-205's search of logs and files; each shown failing.
8. **The website's part** (WebsiteAngular's specs): the gateway's report lane sent to
   pdf-export, and the render service's `resource` (the overlay wait is step 0).

## Complexity Tracking

| Violation                                                                    | Why Needed                                                             | Simpler Alternative Rejected Because                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The genome-wide overview needs the render service, which loads FoamTree (II) | Today's report shows it, and only the website draws it in the new look | Unlike spec 001's figures, the overview is FoamTree's own drawing, so a render bundle without FoamTree cannot draw it: the violation lasts as long as the report shows today's overview. Dropping the overview would break FR-201's parts. Principle II says such a dependency is not added, and spec 001's violation was agreed because it ends; this one does not, so it needs the user's or the release owners' agreement, recorded in spec Assumptions, or a constitution amendment, before tasks are written |
