# Feature Specification: Reactome's pathway PDFs from the graph

**Feature Branch**: `001-pathway-pdfs`

**Created**: 2026-10-29

**Status**: Draft

**Input**: User description: "Reactome's pathway PDFs from the graph, replacing reactome/event-pdf (plan: #3). Two outputs from one implementation: the release's book, as one PDF instead of today's folder of per-pathway PDFs, with a table of contents, bookmarks and links between pathways; and the website's PDF of one pathway or reaction, on request. Content as event-pdf writes today, proven against it by meaning. Data from the graph only, with the release's own files where needed. Figures in the new website's pathway-browser look. Every dependency under a non-restrictive licence, checked in CI. Runs as the release's step, with a check of the book that can fail on wrong content. Public repository: no people's names in fixtures."

## Background

Today `reactome/event-pdf` makes both of Reactome's pathway PDFs:

- **The release's book**, `TheReactomeBook`: one PDF for each of human's top-level
  pathways, each holding every event beneath it, written to a folder that is archived
  for download.
- **The website's PDF** of one pathway or reaction, made on request.

For each event it writes a diagram, the summation, the literature references, the
edit history and other details (type, location, compartments, diseases), and the same
for the events it holds. The book adds a cover and an introduction. It reads the graph,
the release's diagram and EHLD files, and, for an analysis overlay, an analysis result.

Four things are to change:

- **One book:** the release's book becomes a single PDF.
- **The new look:** figures are drawn as the new website's pathway browser draws them.
- **Loose licences:** `event-pdf` is AGPL-3.0 and depends on GPL-3.0 code, so it
  cannot stay.
- **A check that can fail:** the release checks the book by file size alone.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - The release's book is one PDF from the graph (Priority: P1)

A reader downloads Reactome's book for a release and gets one PDF:

- a cover and an introduction;
- a contents list;
- each of human's top-level pathways with every event it holds;
- bookmarks for every pathway and reaction;
- links from an event to the events it names, within the book.

It is made from the release's graph during the release.

**Why this priority**: the book is a release deliverable. Replacing it is what retires
`event-pdf` from the release.

**Independent Test**: produce the book from a private copy of a release's graph and
check:

- that it opens as one PDF;
- that its contents list and bookmarks name every top-level pathway and every event
  beneath them;
- that each event's text matches what `event-pdf` writes for that release, by meaning.

**Acceptance Scenarios**:

1. **Given** a release's graph and its diagram and EHLD files, **When** the book is
   made, **Then** one PDF is written, holding every human top-level pathway and every
   event beneath it.
2. **Given** the book, **When** a reader opens its bookmarks, **Then** each pathway and
   reaction has one, nested as the events nest.
3. **Given** an event in the book that names another event in the book, **When** the
   reader follows the link, **Then** they reach that event's page.
4. **Given** the book and `event-pdf`'s output for the same release, **When** they are
   compared by meaning, **Then** every event's text agrees, apart from differences that
   are recorded with their reason.
5. **Given** an event that holds an event already shown elsewhere in the book, **When**
   the book is made, **Then** the event's full section appears once, and the other
   places link to it.

---

### User Story 2 - The website's PDF of one pathway or reaction (Priority: P1)

A website user asks for the PDF of the pathway or reaction they are looking at. They
get one PDF with that event and what it holds, to a depth they choose, with the same
content and look as the book's section for it.

**Why this priority**: the website offers this download today. Retiring `event-pdf`
leaves it with nothing to serve unless this replaces it.

**Independent Test**: ask for the PDF of a pathway and of a reaction by stable
identifier, against a private copy of the graph. Check that each is the book's section
for that event, at the depth asked for.

**Acceptance Scenarios**:

1. **Given** a pathway's stable identifier, **When** its PDF is asked for, **Then** one
   PDF is returned with the pathway and the events it holds, to the depth asked for.
2. **Given** a reaction's stable identifier, **When** its PDF is asked for, **Then** one
   PDF is returned with the reaction alone.
3. **Given** an identifier that names no event, **When** a PDF is asked for, **Then**
   the answer says so and returns no PDF.
4. **Given** the same event, **When** its PDF and the book's section for it are
   compared, **Then** their content agrees.

---

### User Story 3 - Figures in the new website's look (Priority: P2)

A reader of either PDF sees every figure as the website's pathway browser shows it:
pathway diagrams, illustrated (EHLD) diagrams, reaction figures and the overview.
Nothing is in the old pathway browser's look.

**Why this priority**: the old look makes the book read like a different Reactome from
the website. It matters to readers, but the book can be proven correct before it looks
new.

**Independent Test**: for a sample of pathways, put each PDF figure beside what the
website's pathway browser draws for the same pathway. They match in layout, colours,
shapes and labels.

**Acceptance Scenarios**:

1. **Given** a pathway with a diagram, **When** its section is written, **Then** its
   figure is the website's drawing of that diagram.
2. **Given** a pathway with an illustrated (EHLD) diagram, **When** its section is
   written, **Then** the illustration is shown as the website shows it.
3. **Given** a reaction, **When** its section is written, **Then** its figure is drawn
   as the website draws the reaction.

---

### User Story 4 - Only non-restrictive licences (Priority: P1)

Anyone can reuse this exporter and the PDFs it makes, in services under any licence:
nothing it uses is under a restrictive licence.

**Why this priority**: the restrictive licences of `event-pdf` and its dependencies are
a reason it is being replaced. A replacement that brings one back fails its purpose.

**Independent Test**: CI lists the licence of everything installed and fails on any not
in the allowed list. A deliberately added restrictive dependency is seen to fail it.

**Acceptance Scenarios**:

1. **Given** the installed dependencies, **When** CI checks their licences, **Then**
   every one is under an allowed licence.
2. **Given** a dependency under the GPL family, under a commercial licence, or with no
   licence, **When** it is added, **Then** CI fails and names it.

---

### User Story 5 - The release's step, with a check that can fail (Priority: P2)

The release team runs the book's step as they run today's: a container image, the
release's graph and files mounted, the book written to the release's output. A check
then fails the step if the book is wrong, not just if it is small.

**Why this priority**: the book reaches readers only through the release. Today's check
compares file sizes, so a book of the right size and the wrong content passes it.

**Independent Test**: run the step's command against a private copy of the graph.
Then damage its output in a few ways (a missing pathway, an empty section, a broken
link) and see the check fail on each.

**Acceptance Scenarios**:

1. **Given** the release's graph and files, **When** the step runs, **Then** it writes
   the book and the check passes.
2. **Given** a book missing a top-level pathway, or with an event whose section is
   empty, **When** the check runs, **Then** it fails and names what is wrong.

---

### Edge Cases

- **An event with no diagram, no summation or no literature:** its section says so, or
  leaves that part out, and does not fail.
- **An event held by many pathways:** written once in the book and linked from the others
  (Story 1, scenario 5).
- **Very large pathways** (hundreds of events): the book still completes within the
  release's time, and a reader can still navigate it.
- **The human book's size** (thousands of pages): it is still one PDF, and opens and
  searches in common readers.
- **Text with HTML, special characters or very long names:** written legibly, with no
  markup shown as text.
- **An event of a kind the old exporter did not write:** recorded, not silently dropped.
- **Missing release files** (a diagram or an EHLD the graph names but the files lack):
  the step reports which, and the check fails rather than publishing a book with holes.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST produce the release's book as a single PDF holding each of
  human's top-level pathways and every event beneath them.
- **FR-002**: The book MUST have a cover, an introduction, a contents list, nested
  bookmarks for every pathway and reaction, and internal links from an event to the
  events it names.
- **FR-003**: An event held by more than one pathway MUST appear in full once in the
  book, and be linked from its other places.
- **FR-004**: For each event, the system MUST write what `event-pdf` writes today:
  - a figure;
  - the summation;
  - the literature references;
  - the edit history;
  - type, location, compartments and diseases;
  - the events it holds, to the depth asked for.
- **FR-005**: The system MUST produce the PDF of one pathway or reaction by stable
  identifier, to a depth asked for. Its content MUST be the book's section for that
  event.
- **FR-006**: The system MUST read the release's data from the graph, and the release's
  own diagram and EHLD files. It MUST NOT read a relational database.
- **FR-007**: Every figure MUST be drawn as the new website's pathway browser draws it.
- **FR-008**: Every dependency MUST be under a non-restrictive licence (MIT, BSD,
  Apache-2.0, ISC or similar). CI MUST fail on any other, including none.
- **FR-009**: The book's step MUST run as a container image with the release's graph and
  files as inputs, as today's step does.
- **FR-010**: A check MUST fail the book's step on wrong content:
  - a missing top-level pathway;
  - an empty section;
  - a broken internal link;
  - a figure that failed to draw.
- **FR-011**: The output MUST be compared with `event-pdf`'s for the same release, by
  meaning (each event's text and structure, not bytes). Every difference MUST be fixed
  or recorded with its reason.
- **FR-012**: Fixtures, samples and test output in the repository MUST NOT contain
  people's names; authors and curators are replaced by placeholders.
- **FR-013**: The website's single-event PDF MUST be reachable for the website to serve.
  How the website routes and serves it is specified in WebsiteAngular.

### Key Entities

- **Event**: a pathway or a reaction, with its stable identifier, names, summation,
  literature, edit history, compartments, diseases, figure and the events it holds.
- **Book**: the release's single PDF: cover, introduction, contents, sections, bookmarks
  and links.
- **Section**: one event's pages: its figure, text, references and the links to its
  children.
- **Figure**: an event's diagram, illustration or reaction drawing, in the website's look.
- **Release files**: the diagram layouts and EHLD illustrations the release publishes
  beside the graph.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: For a release, the book holds 100% of human's top-level pathways and every
  event beneath them. Each event is reachable from the contents list and from the
  bookmarks.
- **SC-002**: Compared with `event-pdf`'s output for the same release, every event's
  text agrees by meaning, apart from differences recorded with their reason.
- **SC-003**: The book is made within the release's step's time today, or a time the
  release's owners accept.
- **SC-004**: The book opens, and its bookmarks work, in at least three common PDF
  readers.
- **SC-005**: A website user gets a single pathway's or reaction's PDF in about the time
  they do today.
- **SC-006**: CI's licence check passes, and fails when a restrictive dependency is added
  to test it.
- **SC-007**: The book's check fails on each kind of damage in FR-010, each seen to fail
  once.
- **SC-008**: For a sample of pathways, each figure matches the website's drawing of the
  same pathway.

## Assumptions

- **The book's scope:** the book holds human's top-level pathways, as today's book does.
  Other species are out of scope for spec 001; a later spec can add them.
- **The analysis overlay** that `event-pdf` can apply to a single event's PDF stays
  possible for the website's PDF if the website still offers it. It is not part of the
  book.
- **One book's size:** the human book runs to thousands of pages. Whether it is made in
  one pass or in parts joined into one PDF is for the plan to measure and decide; either
  way the reader gets one file.
- **The website's part:** routing and serving the single-event PDF, and offering the
  depth choice, live in WebsiteAngular's specs. This spec provides the means.
- **Comparison inputs:** a private copy of the release's graph (release 98), with
  `event-pdf` run against it for the reference output. The release's published book is
  fetched one file at a time, only when a comparison needs it, and kept out of the
  repository. No request goes to a production service.
- **graph-core** has no licence, so it is not a dependency (constitution II). The graph
  is read in another way, which the plan chooses.
- **The release's owners** agree the step's command, its time and the switch from
  `event-pdf`, as for the other exporters.
