# pdf-export Constitution

These principles are not aspirations. Each one is here because breaking it has
already cost Reactome's PDFs something specific, or is about to. The cost is named
so the rule can be argued with rather than merely obeyed.

## Core Principles

### I. One implementation, for the release's book and the website's PDFs

Reactome publishes PDFs in three ways:

- **the release's book**, `TheReactomeBook`: a folder of pathway PDFs, made by
  `reactome/event-pdf`'s command line during the release and published with it;
- **the website's PDF of one pathway or reaction**, made by the same library inside
  the content service, on request;
- **the website's analysis report**, made on request by `reactome/analysis-report`
  inside the analysis service.

The first two come from `event-pdf` today, which is why one fix reaches both; the
third comes from another library with its own look, its own copy of the figures'
drawing and the same restrictive licence, so a fix to one never reached it.

**So:** this repository is the one implementation of all of them, and of any PDF the
website makes later. They share one look, one way of drawing figures and one way of
printing. A change lands once and is seen in each, and none keeps a copy of its own.

### II. Loose licences only

`event-pdf` is AGPL-3.0 (it is built on iText), and depends on fireworks-exporter,
which is GPL-3.0. A service that embeds it must be copyleft too: the website's plan
for its Java library service licensed that whole service AGPL-3.0 because of
event-pdf and analysis-report, both AGPL-3.0, and fireworks-exporter
(reactome/WebsiteAngular spec 010, research R2).

**So:** this repository and everything it depends on are under loose open-source
licences (MIT, BSD, Apache-2.0 or the like). A dependency under the GPL family
(GPL, LGPL, AGPL), with a commercial licence, or with no licence at all is not
added, and CI is to check the licences of what is installed. graph-core, through
which `event-pdf` reads the graph, has no licence at all today: spec 001 decides how
to read the graph with that in mind.

### III. The graph, and nothing relational

Reactome is moving every export off the relational release database and onto the
Neo4j graph. `event-pdf` already reads the graph, through graph-core, with the
diagram files, the EHLD files and their summary the release makes.

**So:** this repository reads the graph and the release's own published files
(diagrams, EHLDs) and no relational database.

### IV. The pathway browser's look

The PDFs' figures are drawn by the Java exporters, in the old pathway browser's
look: diagram-exporter for pathway diagrams, reaction-exporter for reactions and
fireworks-exporter for the overview. The website's pathway browser has a new look, and a reader moving from the
site to the book sees two Reactomes.

**So:** a diagram in a PDF is drawn as the website's pathway browser draws it.
How (the website's own renderer, headless) is the first spec's to decide.

### V. Verify the instrument, and prove a test fails

A check that cannot fail is not a check. The release's verifier for the book today
compares file sizes with the previous release's, within a tolerance: a PDF of the
right size and the wrong content passes it.

**So:** name what a check actually reads, and see it fail once before relying on it.
A fix comes with a test that fails without it, and that has been seen to fail; where
that is impractical, the pull request says so rather than implying coverage.

### VI. Production services are not test fixtures

Reactome's production services (the website, its APIs and its databases) are not
used for development, comparison or verification: a burst of requests can load the
live site.

**So:** runs use a private copy of the release's graph. The release's own published
files, fetched one at a time only when a comparison needs them, are the only
reference taken from Reactome's servers, and they are kept out of the repository.

### VII. People's names stay out of the repository

This repository is public. A pathway's PDF carries the names of the authors of its
literature and of the curators in its edit history. A fixture, a test log or a
sample PDF copied from real output would publish them.

**So:** fixtures and samples replace those values with placeholders, and
comparisons never print them.

## Quality Gates

Every change passes these; the first spec's first tasks make each one real
(Principle V):

- **The unit tests run and pass**, each fix with a test seen failing first.
- **Formatting and lint** as CI runs them.
- **The licence check** over what is installed (Principle II).
- **For a change to what is written:** the output for a fixture graph is compared
  with what it was, by meaning (the text and structure of each PDF, not its bytes),
  and the difference is in the pull request.

## Development Workflow

- **Specs first.** Feature-sized work goes through Spec Kit before any code:
  `/speckit-specify` → `/speckit-plan` → `/speckit-tasks`. The specs live in
  `specs/`, and the pull request that completes a task ticks it in `tasks.md` with
  its number.
- **Each change by pull request,** with CI green and an adversarial review before it
  merges.
- **Work that also touches the website** (`reactome/WebsiteAngular`) keeps its
  website part in that repository's specs.

## Governance

This constitution outranks other practice in this repository. It is changed by pull
request, with the reason for the change; a principle is removed only with the cost
it was guarding against shown to be gone.

**Version**: 1.1.0 | **Ratified**: 2026-10-29 | **Last Amended**: 2026-10-30
