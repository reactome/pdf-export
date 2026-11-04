# Feature Specification: Reactome's pathway PDFs from the graph

**Feature Branch**: `001-plan-5`

**Created**: 2026-10-29

**Status**: Draft

**Input**: User description: "Reactome's pathway PDFs from the graph, replacing reactome/event-pdf (plan: #3). Two outputs from one implementation: the release's book, as one PDF instead of today's folder of per-pathway PDFs, with a table of contents, bookmarks and links between pathways; and the website's PDF of one pathway or reaction, on request. Content as event-pdf writes today, proven against it by meaning. Data from the graph only, with the release's own files where needed. Figures in the new website's pathway-browser look. Every dependency under a non-restrictive licence, checked in CI. Runs as the release's step, with a check of the book that can fail on wrong content. Public repository: no people's names in fixtures."

**Changed** (user's decision, 3 Nov 2026): the book stays a folder of PDFs, one per
top-level pathway, as today's, not the single PDF the description asks for (Background).

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
   - Reactome's licence statement (CC BY 4.0 today; the new PDFs state it as the website's
     licence page does) and the date;
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

Three things are to change, and one stays:

- **The book stays a folder of PDFs,** one per top-level pathway, archived as today's
  (user's decision, 3 Nov 2026, in place of the single PDF first specified: the book is
  large and grows with every release; separate files are printed in parallel, each
  joined alone, and stay a size readers can open).
- **The new look:** figures are drawn as the new website's pathway browser draws them.
- **Loose licences:** `event-pdf` is AGPL-3.0, depends on GPL-3.0 code, and embeds a
  proprietary font.
- **A check of content:** the release's check reads names and sizes, not content.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - The release's book from the graph (Priority: P1)

A reader downloads Reactome's book for a release and gets, as today, one PDF for each of
human's top-level pathways, in full depth. Each has:

- a cover and an introduction;
- a contents list;
- nested bookmarks;
- the links of FR-003.

It is made from the release's graph during the release.

**Why this priority**: the book is a release deliverable, and replacing it retires
`event-pdf` from the release.

**Independent Test**: make the book from a private copy of a release's graph. Then
check that:

- there is one PDF for each top-level pathway, and no other;
- each one's contents list and bookmarks name every event beneath its pathway;
- each event's section agrees with `event-pdf`'s by FR-012.

**Acceptance Scenarios**:

1. **Given** a release's graph and files, **When** the book is made, **Then** one PDF
   is written for each human top-level pathway, holding every event beneath it.
2. **Given** one of the book's PDFs, **When** a reader opens its bookmarks, **Then** they
   nest as the events nest. Each place an event appears has an entry, pointing at its
   one full section in that PDF.
3. **Given** an event held by several pathways, **When** the book is made, **Then** in
   each PDF that holds it, its full section is at its first place in document order, and
   each later place in that PDF shows a short entry (name and stable identifier) linked
   to it. An event under two top-level pathways is written in full in both PDFs, as
   today.
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
   result is gone though its date is still within the analysis service's 7 days, **When** a PDF
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
(as the website's licence page states it: CC0 for data, CC BY 4.0 for illustrations and
art), as the cover says.

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
- the release's graph and files as inputs, with the figures drawn into a folder by a step
  before it (SC-010);
- the book written to the release's output.

A check then fails the step if the book's content is wrong.

**Why this priority**: the book reaches readers only through the release. Today's check
reads file names and sizes: a book of the right size and the wrong content passes it.

**Independent Test**: run the step's command against a private copy of the graph. Then
damage the output in each way FR-011 names, and see the check fail on each.

**Acceptance Scenarios**:

1. **Given** the release's graph and files, **When** the step runs, **Then** it writes
   the book and the check passes.
2. **Given** a book with one of FR-011's faults, **When** the check runs, **Then** it
   fails and names the fault.
3. **Given** a release file the step needs is missing, **When** the step runs, **Then**
   it fails and names the file, and writes no book.
4. **Given** a text or a figure's label holding a character no font draws and FR-017's
   list does not hold, **When** the step runs, **Then** it fails, naming the character
   and the event, before the part holding it is printed, and writes no book.

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
3. **Given** the cover, **When** it is written, **Then** it holds the parts the
   Background lists (for a pathway, its diagram), laid out in the website's style with
   Reactome's logo.
4. **Given** a new version of the website's theme, **When** this repository updates to
   it, **Then** the PDFs follow it with no colour value changed in this repository.

---

### Edge Cases

- **An event with no summation, literature or edit history:** its section leaves that
  part out, as today, and the run does not fail.
- **An event held by many pathways:** in each of the book's PDFs, written once with
  linked entries at its later places (Story 1, scenario 3). In a single-event PDF, as
  today: once.
- **Very large pathways** (hundreds of events, the largest of today's book's files 3,760
  pages): the book still completes within SC-003, and each file opens and searches in
  the readers of SC-004.
- **Text with HTML, special characters or very long names:** written legibly, with no
  markup shown as text.
- **A character no embedded typeface draws** (FR-017): in the book, one of a fixed list
  is replaced by what the typefaces draw, and any other fails the step, before the part
  holding it is printed, with no book written. In a PDF made on request it never fails: it prints as the replacement mark
  (U+FFFD) and is logged.
- **A release file missing:** a diagram the graph needs but the files lack, or an EHLD
  the summary names for a pathway the graph holds, but the files lack. (An entry for an
  event the graph does not hold is ignored: plan, research R7.) The step fails and names
  it (Story 5, scenario 3).
- **An analysis token unknown, malformed, or gone:** a malformed token is answered as
  unknown, as is one the analysis service answers 404 (no result, and dated 8 whole days
  ago or more, or not at all); one it answers 410 (no result, though dated within its 7
  whole days or in the future) is answered as gone. Whether a token has expired is the analysis service's to say, as
  it answers a result still stored whatever its date (Story 2, scenario 4; research R6).
- **A release file missing for a single-event PDF:** the PDF is made without that figure,
  as today, and the absence is logged; only the book's step fails on it.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST produce the release's book as one PDF for each of human's
  top-level pathways, in full depth, named as today's (the pathway's name and `.pdf`),
  in one folder.
- **FR-002**: Each of the book's PDFs MUST have:
  - the Background's cover, for its top-level pathway (with its diagram, the names
    across the events in that PDF, and no excerpt note);
  - an introduction;
  - a contents list before the sections;
  - nested bookmarks.

  The PDFs are made, checked and reported in order of their top-level pathways' names,
  ignoring case; "the first event in document order" across the book means in that
  order.

- **FR-003**: Each PDF MUST link:
  - each contents entry and bookmark to its section;
  - each pathway in an event's location to its section where the PDF holds it (otherwise
    plain text, as today);
  - what an event was inferred from to its section where the PDF holds it, and otherwise
    to its page on the website;
  - for a reaction, the events before and after it (only those the PDF holds) to their
    sections;
  - each event's name to its page on the website;
  - each figure to its interactive form on the website (user's decision, 3 Nov 2026): a
    pathway's diagram or illustration in the Pathway Browser, the event selected where an
    ancestor's diagram or illustration draws it, and a reaction's figure to its page, which opens it there.
- **FR-004**: An event held by more than one pathway MUST be written in full once in a
  PDF, at its first place in document order. In the book's PDFs, its later places MUST
  show a short entry (name and stable identifier) linked to that section.
- **FR-005**: For each event, the system MUST write the parts the Background lists,
  in that order.
- **FR-006**: The system MUST produce the PDF of one event of any species by stable
  identifier:
  - at depth 0 or 1, 1 by default;
  - with the cover and introduction of the Background; nested bookmarks; and, where the
    Background has a contents list, that list before the sections, as in the book's;
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
  ISC, OFL for fonts, or similar). CI MUST fail on any other, including none. A
  dependency here is what the repository installs or ships; the render service's
  FoamTree, which it reaches only by calling that service at run time, is
  constitution Principle II's run-time exception.
  - Reactome's content (its data and EHLD illustrations), the literature's metadata and
    Reactome's logo are not shipped assets. They stay under their own terms; the cover
    states Reactome's licence.
  - Nothing is copied from `event-pdf`'s code or resources. Reactome's statements (its
    licence and institutions), the introduction's text and Reactome's own references,
    and the analysis section's explanations are taken from the website's current wording,
    supplied by the release's owners, or written anew.
- **FR-010**: The book's step MUST run as a container image with the release's graph and
  files as inputs, as today's step does, and write the book's folder of PDFs, which the
  release archives as it does today's, its PDFs made several at a time. Its figures are drawn before it, by a step of the same image with the render service and its content
  service beside it, into a folder the book's step also takes as an input (SC-010).
- **FR-011**: A check MUST fail the book's step on any of these:
  - a top-level pathway with no PDF, or a PDF in the folder that is no top-level
    pathway's;
  - an event missing from its PDF's contents list or bookmarks;
  - a section with no name or no stable identifier;
  - a pathway's or reaction's full section with no figure, where the figure's source
    exists (its own or an ancestor's diagram file, its EHLD, or for a reaction the
    graph);
  - a broken internal link in any of the PDFs.
- **FR-012**: The output MUST be compared with `event-pdf`'s for the same graph, by
  meaning:
  - a single-event PDF's cover: its title, whether it has a diagram and an excerpt note,
    and the count of distinct names; each of the book's PDFs' covers likewise, against
    today's file for the same top-level pathway;
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
  - no figure split across pages, and each printed in the portrait text, as large as the
    text column allows, never on a page turned for it (user's decision, 4 Nov 2026,
    replacing that of 3 Nov, which gave a wide figure a landscape page of its own: that
    doubled the book's pages, and a reader zooms in, or follows the figure's link to the
    website); a figure whose labels print below the size the plan sets for the run report
    is listed there;
  - a cover in the website's style (User Story 6, scenario 3).
- **FR-017**: Characters no embedded typeface draws (user's decision, 30 Oct 2026), in
  the text the layout writes and in the figures' labels alike:
  - **the book:** those on a fixed list are replaced by what the typefaces draw, without
    changing what the text says (a ligature by its letters, a non-breaking hyphen by a
    hyphen, a spacing dot above used as a radical's dot by a bullet, a geresh used as a
    prime by a prime). The list is kept with the code, each entry with the release
    text it was found in. Any character not on it fails the step, naming it and the
    event, so the release's owners see a new one: found in the graph's texts or the
    release's files, before anything is printed; found only in a drawn figure, before
    the part holding it is printed. Either way no book is written;
  - **a PDF made on request** (a single event's, or any other the website asks for on the
    fly, whose text can include what users submit): the same list is applied, and any
    other such character prints as the replacement mark (U+FFFD). Each such code point is
    logged once per PDF, with the stable identifier or the token, never the text it was
    in; the request never fails on it;
  - in a figure, only the labels' text is changed, never its shapes; a few substituted
    glyphs should fall well within SC-008's threshold (an inference: release 98's labels
    hold none of the listed characters, so no comparison has tested it), so the figure is
    compared as any other.

### Key Entities

- **Event**: a pathway or a reaction, with the parts FR-005 lists and the events it
  holds.
- **Book**: the release's folder of PDFs, one per human top-level pathway, each with its
  cover, introduction, contents, sections, bookmarks and links.
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

- **SC-001**: For a release, the book holds a PDF for 100% of human's top-level pathways,
  each with every event beneath it. Each event is reachable from its PDF's contents list
  and bookmarks.
- **SC-002**: Compared with `event-pdf`'s output for the same private graph by FR-012,
  the book and a sample of single-event PDFs agree. The only differences are those under
  Assumptions and others recorded with their reason.
- **SC-003**: From its figures already drawn (SC-010), the book is made in no more time
  than `event-pdf` takes to make today's book from the same private graph on the same
  machine, measured as the baseline.
- **SC-004**: Each of the book's PDFs opens, and its bookmarks and links work, in three
  readers:
  Chromium's built-in viewer, Firefox's built-in viewer, and a Poppler-based desktop
  viewer on Linux.
- **SC-005**: A single-event PDF at depth 1, for a sample of pathways and reactions on
  the same private graph:
  - **without an analysis, for an event whose figures the release's figures' folder
    holds** (the human book's, SC-010), its figures read from it, is made in no more
    time than `event-pdf` takes for the same event;
  - **with an analysis, or for an event of another species,** its figures drawn on
    request, is made within 8 s plus 3 s per figure, cold, at the render service's website settings
    (research R7: drawing on request is slower than `event-pdf` for all but the
    largest events, and cannot be avoided where the figure carries the analysis);
  - **while the folder is missing, stale or incomplete,** a human event's PDF is drawn
    on request and held to the same 8 s plus 3 s per figure.

  "Cold" is T023's: the service's process already running, the render service with a
  fresh cache key and its browser warmed on a figure no sampled event draws.

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
- **SC-010**: Every figure the book needs is drawn, in the new look, by a step of its own
  that runs before the book's, and the book reads them from that step's folder. The
  step's time on the machine the release gives it is measured and agreed with the
  release's owners (research R7: about 3.5 hours on an 8-core host at concurrency 8, as the render service
  is today; measured by T031 at 5 h 47 min, which the user accepted on 4 Nov 2026).

## Assumptions

- **The book's scope:** human's top-level pathways, as today. Other species' books are
  out of scope for spec 001.
- **The book's name and place:** today's: a folder of PDFs named after their top-level
  pathways, archived and published as today's archive is, under today's name. The
  website's download page and the cover's excerpt note point at it as they do today.
- **The figures' folder in service:** the single-event service reads the release's
  figures' folder, the one the book's figures step drew, so a PDF without an analysis
  of a human event draws none on request; other species' figures, and any the folder
  lacks, are drawn on request. The release's step draws the figures before the service
  is pointed at the new release's graph and makes the folder available to it; a folder
  of another release is not used.
- **The figures' step:** drawing the figures before the book adds a step of its own,
  about 3.5 hours on an 8-core host at concurrency 8, as the render service is today (research R7, from 200 figures). Its
  machine and time are open, to be agreed with the release's owners (SC-010).
- **The release's check:** the check of FR-011 joins the release's file-list check,
  which, with the files named as today's, can keep running. Its size tolerance compares
  the new PDFs with `event-pdf`'s at the switch, sizes no one has measured (new look,
  figures and layout), so the release's owners take the first new book's sizes as its
  baseline. They agree the arrangement.
- **The render service beside the figures' step:** the figures come from the website's
  render service, with its content service, run on the release's graph and files beside
  the step that draws the book's figures before the book (SC-010; plan, research R3,
  R7); the book's own step reads them from that step's folder. That service loads FoamTree, under a commercial
  licence: pdf-export ships none of it, but cannot draw figures without the service
  until WebsiteAngular's render bundle without FoamTree exists (research R10). Its
  FoamTree is constitution Principle II's run-time exception (1.2.0). The release's
  owners agree to run the render and content services beside the figures' step.
- **Expected differences from `event-pdf`** (FR-012):
  - the bookmarks, in every PDF;
  - the contents list before the sections, not after, in every PDF that has one;
  - short entries at every later place an event recurs in one of the book's PDFs, where
    today's files write nothing there;
  - rewritten boilerplate (FR-009);
  - a section with no figure today, where the new one has a figure, or the reverse,
    each recorded;
  - the look: layout, colours and typefaces (User Story 6);
  - the licence statement: CC0 for data and CC BY 4.0 for illustrations and art, as the
    website's licence page has it, where `event-pdf`'s cover said CC BY 4.0 for everything
    (decided by the user, spec 001 T016);
  - the order of lists: today's PDFs list an event's children, compartments, literature
    (and so which five references are shown), summations, diseases and the events
    before and after in the database's order; the new ones in the curators' order
    (plan, research R2);
  - with an analysis, the identifiers found where a pathway today's filter leaves out
    (one with no p-value, say) holds an identifier no kept pathway does: counted now,
    not today (research R6).
- **Departures in the endpoint's answers** (FR-014): an unknown or gone analysis token
  is answered as such, where today's endpoint answers an empty response for both; and
  the analysis options FR-006 drops are ignored if sent.
- **The website's theme** is used as a package dependency. Its package declares no
  licence today, though its repository is CC0; the theme's owners are asked to declare
  it in the package, and until then CI's licence check is told it is CC0, with the
  reason.
- **The book's size:** the human book runs to about 23,500 pages, in 29 files, the
  largest 3,760 pages. A file past about 200 pages is printed in parts and joined into
  its one PDF; the files are made several at a time (plan, research R4).
- **The analysis result** is read through the analysis service, which reads the files
  it writes by its own rules; its stored format is Java's own (plan, research R6). Tests
  use a non-production instance or a stub, never production.
- **The website's part:** routing, the depth choice, the token and the error answers live
  in WebsiteAngular's specs. This spec provides the means.
- **Comparison inputs:** a private copy of the release's graph (release 98), with
  `event-pdf` run against it for the reference output. The release's published book is
  fetched one file at a time, only when a comparison needs it, and kept out of the
  repository. No request goes to a production service.
- **Reactome's Java graph library** has no licence, so it is not a dependency
  (constitution II). The plan chooses how the graph is read.
