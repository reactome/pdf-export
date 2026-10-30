# Quickstart: proving it

The runs that show spec 002 works. Every service is a private copy; no production
requests, and no ReactomeGSA runs.

## 0. A private stack

- The release's graph, read-only (spec 001's quickstart, step 0).
- An analysis service built from the deployed version (research R5), on that graph,
  with its results folder; tokens made by submitting made-up identifiers.
- A render service on the same graph, its cache empty for timed runs.

## 1. The baseline

- Today's report from the private analysis service for a sample of tokens:
  over-representation, expression, species comparison, one with interactors; at 25 and
  50 pathways. Record each one's time and size.
- The replay set (User Story 2): each parameter and answer, the species in its three
  forms, and a failure while the PDF is made (a fault planted in the private copy).
  Record each status, file name and body.

## 2. CI's own runs

- `npm test`, each test seen failing first.
- The analysis stub and the render stub answer the fixture's tokens; the report is made
  for each, and fails on a planted fault.

## 3. The report against today's

- **The replay:** every request gets today's status and file name, or a listed
  difference (SC-202).
- **The comparison by meaning** (FR-208, SC-201): the cover, the properties, the
  pathways and their statistics in order, each detail's parts, the identifiers found
  and not found. Names never printed: counts and hashes.
- **The time** (SC-203): cold and warm, stage by stage, against the baseline and the
  budget the user chose (research R4).
- **The look** (SC-204): spec 001's colour and font check on a sample report.
- **The readers** (SC-207): the report opens, with its bookmarks and links working, in
  spec 001's three readers.
- **What is kept** (SC-205): after a sample of reports, the service's logs and working
  folder hold none of the submitted identifiers.
