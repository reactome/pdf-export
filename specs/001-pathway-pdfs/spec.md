# Feature Specification: Reactome's pathway PDFs from the graph

**Feature Branch**: `001-plan-2`

**Created**: 2026-10-29

**Status**: Draft

**Input**: User description: "Reactome's pathway PDFs from the graph, replacing reactome/event-pdf (plan: #3). Two outputs from one implementation: the release's book, as one PDF instead of today's folder of per-pathway PDFs, with a table of contents, bookmarks and links between pathways; and the website's PDF of one pathway or reaction, on request. Content as event-pdf writes today, proven against it by meaning. Data from the graph only, with the release's own files where needed. Figures in the new website's pathway-browser look. Every dependency under a non-restrictive licence, checked in CI. Runs as the release's step, with a check of the book that can fail on wrong content. Public repository: no people's names in fixtures."

## Background: what `event-pdf` writes today

`reactome/event-pdf` makes both of Reactome's pathway PDFs, with the same parts in
each:

- **The release's book**, `TheReactomeBook`:
  - one PDF for each of human's top-level pathways, in full depth;
  - written to a folder that is archived for download.
- **The website's PDF** of one pathway or reaction:
  - made on request, for an event of any species;
  - at depth 0 (the event alone) or 1 (it and its direct children), 1 by default;
  - optionally overlaid with an analysis result, named by its token.

Each PDF holds, in this order:

1. **A cover:**
   - Reactome's logo and the event's name;
   - for a pathway, its diagram;
   - the names of the people on the authored, edited, reviewed and revised records of
     the events in it, sorted and each once;
   - a fixed statement of Reactome's institutions;
   - Reactome's licence statement (CC BY 4.0) and the date;
   - for a pathway at depth 1 or less, a note that it is an excerpt, pointing at the
     book.
2. **An introduction:** about Reactome, Reactome's own references, the release, and the
   counts of pathways and reactions.
3. **With an analysis,** a section on the analysis's properties.
4. **A section for each event,** in document order. An event held by several pathways is
   written once in a PDF. Each section holds, in this order:
   1. its name, linked to its page on the website;
   2. its location (the path of pathways above it, linked);
   3. its stable identifier;
   4. for a reaction, its type;
   5. its compartments;
   6. its diseases;
   7. what it was inferred from, with the species;
   8. its figure;
   9. its summations;
   10. for a reaction, the events before and after it that the PDF holds;
   11. its first five literature references;
   12. its edit history;
   13. with an analysis, the entities and then the interactors found.
5. **A contents list,** after the sections: the introduction, the analysis's properties
   (with an analysis), each event (every place it appears pointing at its one section),
   and last the contents list itself. It is left out for a reaction alone or at depth 0.

Its figures:

- **For a pathway:** its own diagram. A pathway with no diagram of its own is shown in
  its nearest ancestor's diagram, with its own events selected. Where the release's EHLD
  summary names the pathway, its illustrated diagram (EHLD) is shown instead.
- **For a reaction:** its reaction diagram.
- **With an analysis:** the figures are overlaid with the analysis.

All are drawn by the Java exporters, in the old pathway browser's look, with an embedded
proprietary font. It reads:

- the graph;
- the release's diagram files, EHLD files and EHLD summary;
- for an overlay, the analysis result file the token names, from the folder the analysis
  service writes them to.

PDFs have no bookmarks (outline) today.

The release then checks the folder: that it exists, that every file named in the
previous release's list is there, and that no file shrank by more than a tolerance.

Four things are to change:

- **One book:** the release's book becomes a single PDF.
- **The new look:** figures are drawn as the new website's pathway browser draws them.
- **Loose licences:** `event-pdf` is AGPL-3.0, depends on GPL-3.0 code, and embeds a
  proprietary font.
- **A check of content:** the release's check reads names and sizes, not content.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - The release's book is one PDF from the graph (Priority: P1)

A reader downloads Reactome's book for a release and gets one PDF:

- a cover and an introduction;
- a contents list;
- each of human's top-level pathways, in full depth;
- nested bookmarks;
- the links of FR-003.

It is made from the release's graph during the release.

**Why this priority**: the book is a release deliverable, and replacing it retires
`event-pdf` from the release.

**Independent Test**: make the book from a private copy of a release's graph. Then
check that:

- it opens as one PDF;
- its contents list and bookmarks name every top-level pathway and every event beneath
  them;
- each event's section agrees with `event-pdf`'s by FR-012.

**Acceptance Scenarios**:

1. **Given** a release's graph and files, **When** the book is made, **Then** one PDF
   is written, holding every human top-level pathway, in the order of FR-002, and every
   event beneath them.
2. **Given** the book, **When** a reader opens its bookmarks, **Then** they nest as the
   events nest. Each place an event appears has an entry, pointing at its one full
   section.
3. **Given** an event held by several pathways, **When** the book is made, **Then** its
   full section is at its first place in document order. Each later place shows a short
   entry (name and stable identifier) linked to it.
4. **Given** the book and `event-pdf`'s output for the same graph, **When** they are
   compared by FR-012, **Then** they agree, apart from the differences under
   Assumptions and any others recorded with their reason.

---

### User Story 2 - The website's PDF of one pathway or reaction (Priority: P1)

A website user asks for the PDF of the pathway or reaction they are looking at. They
can ask with an analysis overlay. They get one PDF with the same parts and content as
today, in the new look.

**Why this priority**: the website offers this download today, with and without an
analysis. Retiring `event-pdf` leaves it with nothing to serve unless this replaces it.

**Independent Test**: on a private copy of the graph, ask for the PDF of:

- a pathway at depth 0 and at depth 1;
- a reaction;
- a non-human event;
- a pathway with an analysis token.

Compare each with `event-pdf`'s by FR-012.

**Acceptance Scenarios**:

1. **Given** a pathway's stable identifier and a depth of 0 or 1, **When** its PDF is
   asked for, **Then** it holds the parts of the Background to that depth, with the
   contents list and bookmarks placed as FR-006 says.
2. **Given** a reaction's stable identifier, **When** its PDF is asked for, **Then** it
   holds a cover (with no diagram and no excerpt note), an introduction and the
   reaction's section.
3. **Given** an analysis token, **When** a PDF is asked for with it, **Then** it holds
   the analysis's properties, the entities and interactors found per event, and figures
   overlaid with the analysis.
4. **Given** an identifier that names no event, an unknown token, or a token whose
   result is gone though its date is still within the retention period, **When** a PDF
   is asked for, **Then** the answer says which of the three, by the analysis service's
   token rules, and no PDF is made. Today's endpoint answers an empty response for
   either token case; telling them apart is new.

---

### User Story 3 - Figures in the new website's look (Priority: P2)

A reader of either PDF sees every figure as the website's pathway browser shows it,
with the same choices of figure as today (Background), and with an analysis, their
overlays. Nothing is in the old look.

**Why this priority**: the old look makes the PDFs read like a different Reactome from
the website. It matters to readers, but the content can be proven before it looks new.

**Independent Test**: for a sample of events, compare each PDF figure with the website's
own drawing of the same event by SC-008.

**Acceptance Scenarios**:

1. **Given** a pathway with a diagram, **When** its section is written, **Then** its
   figure is the website's drawing of that diagram.
2. **Given** a pathway with no diagram of its own, **When** its section is written,
   **Then** its figure is the website's drawing of its nearest ancestor's diagram, with
   its events selected.
3. **Given** a pathway the EHLD summary names, **When** its section is written,
   **Then** the illustration is shown as the website shows it.
4. **Given** a reaction, **When** its section is written, **Then** its figure is drawn
   as the website draws the reaction.

---

### User Story 4 - Only non-restrictive licences for what the exporter ships (Priority: P1)

Anyone can reuse this exporter, in services under any licence. Nothing it depends on,
and nothing it puts into a PDF of its own (fonts, icons, boilerplate), is under a
restrictive licence. Reactome's content in the PDFs stays under Reactome's own licence
(CC BY 4.0), as the cover says.

**Why this priority**: the restrictive licences of `event-pdf`, its dependencies and its
font are a reason it is being replaced. A replacement that brings one back fails its
purpose.

**Independent Test**: CI lists the licence of every dependency and of every font, icon
and boilerplate file the repository ships, and fails on any not in the allowed list. A
deliberately added restrictive one is seen to fail it.

**Acceptance Scenarios**:

1. **Given** the dependencies and the shipped assets, **When** CI checks their licences,
   **Then** every one is under an allowed licence.
2. **Given** a dependency or shipped asset under the GPL family, under a commercial or
   proprietary licence, or with none, **When** it is added, **Then** CI fails and names
   it.

---

### User Story 5 - The release's step, with a check that can fail (Priority: P2)

The release team runs the book's step as they run today's:

- a container image;
- the release's graph and files as inputs;
- the book written to the release's output.

A check then fails the step if the book's content is wrong.

**Why this priority**: the book reaches readers only through the release. Today's check
reads file names and sizes: a book of the right size and the wrong content passes it.
And at the switch, the list it checks names files the new step does not write.

**Independent Test**: run the step's command against a private copy of the graph. Then
damage the output in each way FR-011 names, and see the check fail on each.

**Acceptance Scenarios**:

1. **Given** the release's graph and files, **When** the step runs, **Then** it writes
   the book and the check passes.
2. **Given** a book with one of FR-011's faults, **When** the check runs, **Then** it
   fails and names the fault.
3. **Given** a release file the step needs is missing, **When** the step runs, **Then**
   it fails and names the file, and writes no book.

---

### User Story 6 - The PDFs look like the website (Priority: P2)

A reader opening either PDF sees Reactome as the website presents it. It has the
website's colours, typefaces and plain, modern layout, and is clean and easy to read.
Today's book looks dated.

**Why this priority**: the PDFs are part of Reactome's public face. A reader moving
between the website and the book should see one Reactome. It needs no more than the
website's own palette, type and spacing, used well.

**Independent Test**: put a page of the book beside the same event's page on the
website. Check that the colours of the PDF's own text and layout are the website's
theme colours and its typefaces those FR-015 names; figures, illustrations, overlays
and the logo keep their own colours. Then have the judges of SC-009 compare a sample
of pages with today's book.

**Acceptance Scenarios**:

1. **Given** the website's light theme, **When** a PDF is written, **Then** its
   headings, links, thin rules and highlights use the theme's colours (its primary
   colour and the colours paired with it), and its text uses the typefaces FR-015 names.
2. **Given** a section, **When** it is laid out, **Then** its parts are set apart by
   space, type and at most thin rules, never boxes or borders, with the margins,
   running headers, page numbers and figure sizes of FR-016.
3. **Given** the cover, **When** it is written, **Then** it holds the parts FR-002 lists
   (the book) or the Background lists (a single-event PDF; for a pathway, its diagram),
   laid out in the website's style with Reactome's logo.
4. **Given** a new version of the website's theme, **When** this repository updates to
   it, **Then** the PDFs follow it with no colour value changed in this repository.

---

### Edge Cases

- **An event with no summation, literature or edit history:** its section leaves that
  part out, as today, and the run does not fail.
- **An event held by many pathways:** in the book, written once with linked entries
  elsewhere (Story 1, scenario 3). In a single-event PDF, as today: once.
- **Very large pathways** (hundreds of events) and **the human book's size** (thousands
  of pages): the book still completes within SC-003. It is still one file, and it opens
  and searches in the readers of SC-004.
- **Text with HTML, special characters or very long names:** written legibly, with no
  markup shown as text.
- **A release file missing:** a diagram the graph needs but the files lack, or an EHLD
  the summary names but the files lack. The step fails and names it (Story 5,
  scenario 3).
- **An analysis token unknown, malformed, older than the retention period, or gone
  within it:** a malformed token, or one older than the retention period, is answered
  as unknown; one whose result is gone within the period is answered as gone (Story 2,
  scenario 4).
- **A release file missing for a single-event PDF:** the PDF is made without that figure,
  as today, and the absence is logged; only the book's step fails on it.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST produce the release's book as a single PDF holding each of
  human's top-level pathways in full depth.
- **FR-002**: The book MUST have:
  - one cover: Reactome's logo, the title "The Reactome Book" and the release, no
    diagram and no excerpt note, the names across every event in the book (sorted, each
    once), and the institutions, licence and date of the Background's cover;
  - an introduction;
  - a contents list before the sections;
  - nested bookmarks;
  - the top-level pathways in order of their names, ignoring case.
- **FR-003**: Each PDF MUST link:
  - each contents entry and bookmark to its section;
  - each pathway in an event's location to its section where the PDF holds it (otherwise
    plain text, as today);
  - what an event was inferred from to its section where the PDF holds it, and otherwise
    to its page on the website;
  - for a reaction, the events before and after it (only those the PDF holds) to their
    sections;
  - each event's name to its page on the website.
- **FR-004**: An event held by more than one pathway MUST be written in full once in a
  PDF, at its first place in document order. In the book, its later places MUST show a
  short entry (name and stable identifier) linked to that section.
- **FR-005**: For each event, the system MUST write the parts the Background lists,
  in that order.
- **FR-006**: The system MUST produce the PDF of one event of any species by stable
  identifier:
  - at depth 0 or 1, 1 by default;
  - with the cover and introduction of the Background; nested bookmarks; and, where the
    Background has a contents list, that list before the sections, as in the book;
  - given an analysis token, with the analysis overlay of the Background, for the event's
    species.

  The analysis's other options today (resource, expression column, importable only, and
  the diagram and analysis colour profiles) are dropped: the website sends none of them.
  The overlay uses today's defaults for the rest: all resources together, no
  expression column, and all identifiers rather than only importable ones. Its colours
  are the website's default analysis colours, a change from today's, with FR-008.

- **FR-007**: The system MUST read:
  - the graph;
  - the release's diagram files, EHLD files and EHLD summary;
  - for an overlay, the analysis result the token names, through the analysis service
    that holds it (plan, research R6).

  It MUST NOT read a relational database.

- **FR-008**: Every figure MUST be the one the Background describes, drawn as the new
  website's pathway browser draws it, with its analysis overlay when there is one.
- **FR-009**: Every dependency, and every font, icon and boilerplate file the repository
  ships into the PDFs, MUST be under a non-restrictive licence (MIT, BSD, Apache-2.0,
  ISC, OFL for fonts, or similar). CI MUST fail on any other, including none.
  - Reactome's content (its data and EHLD illustrations), the literature's metadata and
    Reactome's logo are not shipped assets. They stay under their own terms; the cover
    states Reactome's licence.
  - Nothing is copied from `event-pdf`'s code or resources. Reactome's statements (its
    licence and institutions), the introduction's text and Reactome's own references,
    and the analysis section's explanations are taken from the website's current wording,
    supplied by the release's owners, or written anew.
- **FR-010**: The book's step MUST run as a container image with the release's graph and
  files as inputs, as today's step does, and write the book as one PDF in place of the
  folder.
- **FR-011**: A check MUST fail the book's step on any of these:
  - a missing top-level pathway;
  - an event missing from the contents list or the bookmarks;
  - a section with no name or no stable identifier;
  - a pathway's or reaction's full section with no figure, where the figure's source
    exists (its own or an ancestor's diagram file, its EHLD, or for a reaction the
    graph);
  - a broken internal link.
- **FR-012**: The output MUST be compared with `event-pdf`'s for the same graph, by
  meaning:
  - a single-event PDF's cover: its title, whether it has a diagram and an excerpt note,
    and the count of distinct names; the book's one cover: the count of distinct names
    across today's files' covers;
  - the introduction: the release and the counts;
  - with an analysis, the analysis's properties: the values it reports (such as its type,
    the identifiers found and in all, the pathways hit, projection, interactors, species,
    resource and token), not its explanatory text;
  - each event's section: its parts, their text and their order;
  - the contents list's entries and their targets;
  - which events have which kind of figure.

  Bytes, layout, running headers, page numbers and the look of figures are not compared.
  Every difference MUST be fixed or recorded with its reason. A comparison MUST NOT
  print people's names.

- **FR-013**: Fixtures, samples and test output in the repository MUST NOT contain
  people's names; authors and curators are replaced by placeholders.
- **FR-014**: The website's single-event PDF MUST be reachable for the website to serve.
  How the website routes it, its parameters' names and the form of its error answers are
  specified in WebsiteAngular. Today's depth parameter's name is malformed, so the
  website in effect always asks for depth 1.
- **FR-015**: The PDFs' own text and layout (headings, body text, links, rules,
  highlights and backgrounds) MUST take their colours from the website's published light
  theme, used as a dependency rather than a hand-kept copy of its values. Figures,
  illustrations, analysis overlays and Reactome's logo keep their own colours (FR-008).
  The text MUST be set in the website's typefaces, Roboto, with Roboto Mono for
  identifiers, and the Noto Sans family (Noto Sans, Noto Sans Symbols 2 and Noto Sans
  Math) only for characters they lack. Each typeface is embedded
  and under a licence FR-009 allows.
- **FR-016**: The PDFs' layout MUST have:
  - parts set apart by space, type and at most thin rules, with no boxes or borders;
  - the same margins on every page;
  - a running header naming the top-level pathway (in the book) or the event (in a
    single-event PDF), or on front pages (introduction, analysis properties,
    contents) that part's name, and a page number on every page but the cover;
  - no figure split across pages, and none shrunk below the size the plan sets for
    legibility;
  - a cover in the website's style (User Story 6, scenario 3).

### Key Entities

- **Event**: a pathway or a reaction, with the parts FR-005 lists and the events it
  holds.
- **Book**: the release's single PDF: cover, introduction, contents, sections, bookmarks
  and links.
- **Single-event PDF**: one event's PDF for the website, at depth 0 or 1, with or
  without an analysis.
- **Section**: one event's pages, or in the book a short entry pointing at them.
- **Figure**: an event's diagram (its own or its ancestor's), illustration or reaction
  drawing, in the website's look, overlaid with an analysis when there is one.
- **Release files**: the diagram files, EHLD files and EHLD summary the release
  publishes beside the graph.
- **Analysis result**: a submitted analysis, named by its token, read for an overlay.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: For a release, the book holds 100% of human's top-level pathways and every
  event beneath them. Each event is reachable from the contents list and from the
  bookmarks.
- **SC-002**: Compared with `event-pdf`'s output for the same private graph by FR-012,
  the book and a sample of single-event PDFs agree. The only differences are those under
  Assumptions and others recorded with their reason.
- **SC-003**: The book is made in no more time than `event-pdf` takes to make today's
  book from the same private graph on the same machine, measured as the baseline.
- **SC-004**: The book opens, and its bookmarks and links work, in three readers:
  Chromium's built-in viewer, Firefox's built-in viewer, and a Poppler-based desktop
  viewer on Linux.
- **SC-005**: A single-event PDF at depth 1 is made in no more time than `event-pdf`
  takes for the same event on the same private graph, for a sample of pathways and
  reactions.
- **SC-006**: CI's licence check passes, and fails when a restrictive dependency or
  shipped asset is added to test it.
- **SC-007**: The book's check fails on each fault in FR-011, each seen to fail once.
- **SC-008**: For a sample of events, each PDF figure is the drawing the website makes for
  the same event and analysis from the same data. Both are rendered at the same size by
  the same means, and no more than 1% of their pixels differ.
- **SC-009**: Every colour in the PDFs' own text and layout is one of the website's
  light theme's palette colours, its foreground and background colours included, and
  every typeface one FR-015 names, the Noto Sans family only for characters the others
  lack, as a
  check of the PDF's colours and fonts shows; figures, illustrations, overlays and the
  logo are left to SC-008. In a side-by-side judgement of at least 12 pages chosen at
  random, including a cover, a contents page and a pathway section with its figure, a
  majority of the judges (the release's owners and the curators they ask) prefer the new
  look to today's.

## Assumptions

- **The book's scope:** human's top-level pathways, as today. Other species' books are
  out of scope for spec 001.
- **The book's name and place:** `TheReactomeBook.pdf`, published where today's archive
  is, without an archive around it (a PDF compresses its own content). The release's
  owners agree the name. The website's download page and the cover's excerpt note point
  at it.
- **The release's check:** the check of FR-011 replaces the release's file-list check
  for the book. The release's owners agree the switch.
- **The render service beside the book's step:** the figures come from the website's
  render service, with its content service, run on the release's graph and files beside
  the book's step (plan, research R3). The release's owners agree it.
- **Expected differences from `event-pdf`** (FR-012):
  - the bookmarks, in every PDF;
  - the contents list before the sections, not after, in every PDF that has one;
  - the book's one cover, in place of a cover per file;
  - short entries at every later place an event recurs in the book, where today's files
    write nothing there;
  - in one book, links that now reach events in other top-level pathways, where each
    per-pathway file could not;
  - rewritten boilerplate (FR-009);
  - links from location entries are as today, but events now outside a per-pathway file
    are inside the one book;
  - a section with no figure today, where the new one has a figure, or the reverse,
    each recorded;
  - the look: layout, colours and typefaces (User Story 6);
  - the order of lists: today's PDFs list an event's children, compartments, literature
    (and so which five references are shown), summations, diseases and the events
    before and after in the database's order; the new ones in the curators' order
    (plan, research R2);
  - top-level pathways by name, not by database identifier (FR-002).
- **Departures in the endpoint's answers** (FR-014): an unknown or gone analysis token
  is answered as such, where today's endpoint answers an empty response for both; and
  the analysis options FR-006 drops are ignored if sent.
- **The website's theme** is used as a package dependency. Its package declares no
  licence today, though its repository is CC0; the theme's owners are asked to declare
  it in the package, and until then CI's licence check is told it is CC0, with the
  reason.
- **One book's size:** the human book runs to thousands of pages. It is printed in parts
  and joined into one PDF (plan, research R4).
- **The analysis result** is read through the analysis service, which reads the files
  it writes by its own rules; its stored format is Java's own (plan, research R6). Tests
  use a private instance or a stub, never production.
- **The website's part:** routing, the depth choice, the token and the error answers live
  in WebsiteAngular's specs. This spec provides the means.
- **Comparison inputs:** a private copy of the release's graph (release 98), with
  `event-pdf` run against it for the reference output. The release's published book is
  fetched one file at a time, only when a comparison needs it, and kept out of the
  repository. No request goes to a production service.
- **Reactome's Java graph library** has no licence, so it is not a dependency
  (constitution II). The plan chooses how the graph is read.
