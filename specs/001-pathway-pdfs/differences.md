# Differences from `event-pdf`, release 98 (T040)

FR-012's comparison of pdf-export's book with `event-pdf`'s, by part and kind, with each
difference's reason where it is known (SC-002). No names: the comparison prints none
(FR-013), and this file quotes none.

## The run

- **`event-pdf`'s book:** release 98's `TheReactomeBook.pdf.tgz` from the download folder,
  29 PDFs.
- **pdf-export's book:** `pdf-export book` on main of 20 Nov 2026 (after #236), from the
  figures WebsiteAngular's spec 018 T010 drew on 20 Nov 2026, against release 98's graph
  and folder: 29 PDFs, 21,503 pages, 692 MB, in 25 min 35 s; no fault (`check-book`'s
  checks passed).
- **The comparison:** `pdf-export compare <event-pdf's folder> <pdf-export's folder>` after
  #239, #241, #243 and #247, which teach it `event-pdf`'s own form (below), and #249 to
  #259, on 22 Nov 2026. It found 375 differences, file by file (three sections more read
  than before #256, each now compared).
- **#249:** a piece of text is inside a figure by its middle, not its first point. A
  pathway's diagram has its name, small, at its top left, starting a few points left of its
  nearest node: read as text, it ran into the facts or summation after the figure (in 56
  sections' summations, 68 stable identifiers and 61 compartments). In `event-pdf`'s files
  the same rule keeps contents entries the old one dropped (Cell Cycle's: 515 read, now 633,
  as many as pdf-export's), so the contents' counts changed too.
- **#250:** text under 3 pt is left out wherever it is. A diagram draws a node's name at
  its zoom, 0.78 pt in places, and one just below the figure's box ran into the section's
  summation or facts: summations 316 to 252, stable identifiers 108 to 19, compartments
  128 to 61, diseases 104 to 5, inferred from 104 to 95. A few sections that differed in
  text now differ in order only, so the orders rose a little.
- **#251:** in pdf-export's files a fact's label without its colon is one only as the
  line's whole first piece (its `<dt>`). A summation wrapped to begin "followed by …" or
  "inferred from …" was read as that fact, and its lines before as the fact above's wrap:
  summations 252 to 175, compartments 61 to 22, stable identifiers 19 to 6; facts extra
  and missing (events after, inferred from, diseases, type, stable identifier, before)
  from 132 to 18.
- **#252:** three more of `event-pdf`'s forms (below): the events inferred from parted by
  commas, a fact's label spread letter by letter, a summation's list with its bullets as
  text. Inferred from, text 95 to 1 (53 now differ in order only, 41 not at all);
  summations 175 to 149; facts extra 29 to 7.
- **#253:** a reaction drawn in one row is a figure. pdf-export draws one of a few nodes
  about 480 by 38 to 50 pt, its nodes images; `event-pdf` 466 by 42 to 57, its nodes painted
  paths. Under 60 pt tall, neither was read as a figure, and its labels ran into the fact
  before it. Now a cluster at least 60 pt wide and 20 pt tall is one if it holds an image or
  three shapes: not `event-pdf`'s contents' column of small icons (29 to 49 pt wide), nor
  one shaded band. Figures missing 20 to 0, extra 2 to 1; stable identifiers 6 to 0, types
  4 to 0, compartments 22 to 2, diseases 3 to 1; the contents' counts unchanged.
- **#256:** a shape is read as clipped. A pathway's diagram whose compartments run past
  its frame is clipped to it, but their whole boxes reached the line above the figure, and
  the section's stable identifier was read as the figure's: three sections not found, and
  their contents entries' targets not read. Sections missing 3 to 0, contents targets not
  read 3 to 0.
- **#257:** a heading's label (the references', the edit history's) is one only alone on
  its line, as both layouts print it. A summation `event-pdf` wrapped so a line begins
  "references to …" was read as the references' heading, its lines and the facts after it
  as references. Facts extra (before, after) 7 to 0, summations 69 to 65.
- **#258:** raised and lowered text is read in its line. pdf-export sets a summation's
  `<sup>` and `<sub>` (an ion's charge, a formula's count) a few points off its line's
  baseline: read as lines of their own, they were read in another place, or lost. A row of
  smaller text within half a line's size of a line's baseline now joins it. Summations 65
  to 44.
- **#259:** text under 7.5 pt within 30 pt of a figure is the figure's. A diagram draws
  some labels at 5 to 7 pt just past its shapes, which ran into the summation below it or
  the fact above; a document's own smallest text is 8 pt (`event-pdf`'s edit history).
  Summations 44 to 38.
- **#262:** a line joins a node it comes within 6 pt of. A catalyst's line stops
  short of its node (5.2 pt in pdf-export's files), so a catalyst under 60 pt wide, drawn
  above its reaction, stood apart from the figure and its 5 pt labels were read into the
  fact above (ADAMTS13 cleaving VWF, in Hemostasis and Disease). Compartments 2 to 0,
  diseases 1 to 0, summations 13 to 12 (a label read into one of Developmental Biology's).
- **#264:** lines are joined until nothing more joins. Each line was looked at once,
  in the order the page draws it, so a catalyst's line drawn before its reaction's lines
  had joined the reaction's nodes into one figure reached only its own node (Immune System,
  REG3A oligomerising, its catalyst LPS drawn below the reaction). Summations 12 to 9, one more recorded.
- **#265:** the cover's names and the edit history, read as both books write them.
  **(a)** `event-pdf`'s cover has no label before its names, ends each with a full stop and
  parts them with commas (`CoverPage.render`, `getName`); its U+2060 is not in the text
  pdf.js reads. Its names were read as none: now those after the title, to the
  institutions. **(b)** Both books' names run on to the cover's next page where they are
  many (the longest lists, in both books): they were read to the page's end. **(c)** A digit ended the names, for
  the cover's date, and a name may hold one (`Surname IN, 3rd`): now a date alone on its
  line ends them. Cover, names count 29 to 0: the same people on every cover. **(d)**
  pdf-export's edit history's header, which Chromium repeats at the top of each page the
  table runs on to, joined the row before it. **(e)** A short entry whose name wraps, or
  whose stable identifier wraps to a line of its own, whole or broken at its hyphen,
  outside the name's link, was read into the part before it, a section's edit history. Edits, text 1,149 to 7, of
  which (d) 1,100 (7 of them now in another order only) and (e) 42; edits, order 31 to 38, sections whose rows
  were otherwise the same.
- **This change:** `event-pdf`'s raised text is read in its line. It sets a summation's
  `<sup>` at the line's own size, 10 pt, raised 3.3 pt, which #258's rule (smaller text
  only) left as a row of its own, read before its line: a row no larger and shorter than a
  line, within half a size of it, now joins it where it starts within the line or at its
  end. Not a page number well to the right of its entry, set 2 pt above it, as
  `event-pdf`'s index does, nor where the space between them, which pdf.js gives as wide as
  the gap, would reach it. Summations 8 to 3; the contents read as before.

## What the comparison learned of `event-pdf`'s form

Read from release 98's files with each letter masked, so their form was seen and not their
words. Each is a rule of the comparison, applied to both sides, not a difference:

| Form                                | `event-pdf`                                                                                                    | pdf-export                                           | The comparison                                                                                                                       |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| A linked title or reference         | ends in an arrow, U+2197                                                                                       | no arrow                                             | the arrow is left out (#239)                                                                                                         |
| A location's pathways               | joined by `→`                                                                                                  | joined by `›`                                        | both are a list's parts (#239)                                                                                                       |
| The edit history's heading          | `Editions`                                                                                                     | `Edit history`                                       | both head the edits (#239)                                                                                                           |
| References                          | unnumbered, each at the left edge, a hanging indent                                                            | numbered                                             | both read (#239)                                                                                                                     |
| A long location                     | wrapped to the section's left edge, often at a hyphen                                                          | in one line                                          | read as the fact's; hyphens left out (#239)                                                                                          |
| A fact wrapped over several lines   | at the left edge, at 1.5 times its size; a summation's lines at 1.15, its paragraphs at 2.3                    | indented                                             | read as the fact's: a later fact's label within six lines (#241), or a wrap's spacing in `event-pdf`'s files (#243)                  |
| A long title, a summation           | broken at a line's end with a hyphen (`glyco-` `genin`)                                                        | not broken                                           | hyphens left out of names and summations, on both sides (#247)                                                                       |
| A fact's label                      | always with its colon (`Diseases:`)                                                                            | also without one                                     | in `event-pdf`'s files a fact's label only with its colon, so a summation's line beginning "Disease" is not the Diseases fact (#247) |
| An initial                          | ends in a full stop (`Surname, I.`)                                                                            | none (`Surname, I`)                                  | full stops left out of names and references (#239)                                                                                   |
| A reference's words at a line's end | broken by a hyphen                                                                                             | not broken                                           | hyphens left out of references (#239)                                                                                                |
| An edit's names                     | parted by commas                                                                                               | parted by semicolons                                 | both a list's commas (this change)                                                                                                   |
| The events inferred from            | parted by commas (`EventsDetails.addInferred`)                                                                 | parted by semicolons                                 | an entry ends at its species' closing bracket (#252)                                                                                 |
| A fact's label on a justified line  | its letters spread, read as `P r e c e d e d b y :`                                                            | not spread                                           | a label's letters may each be followed by a space (#252)                                                                             |
| A summation's list                  | its bullets, `•`, written as text                                                                              | the list's markers, not read as text                 | bullets left out of summations (#252)                                                                                                |
| The cover's names                   | no label; each ends in a full stop, parted by commas (`Surname, I., Surname, I.`); U+2060 not in the text read | a label; parted by semicolons                        | after the label, or the title where there is none; parted by semicolons, or by a comma after a full stop (this change)               |
| Many names on the cover             | run on to the next page                                                                                        | run on to the next page                              | read to their end there, before the introduction (this change)                                                                       |
| A table run on to the next page     | —                                                                                                              | the edit history's header repeated at the page's top | the header is no row (this change)                                                                                                   |
| A short entry's identifier          | —                                                                                                              | may wrap alone to a line, outside the name's link    | the entry read to its identifier (this change)                                                                                       |

Before these, 19,816 sections' titles and 15,023 sections' facts read as different, from
the reading alone.

## The differences, by part and kind

Counts are summed over the 29 files: a count is of sections (or entries) differing in that
part, not of PDFs.

### Expected, with their reasons

These are recorded for `compare --expected` in
[`expected-98.json`](expected-98.json), each with its reason. With it, release 98's
comparison (22 Nov 2026, after this change) reports 320 differences, 319 recorded and 1 not (a
file's summations split between recorded and not):
those of the next table, each by its count; no record matched nothing.

| Part, kind                          | Count                | Reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Decided                                                                                                                                          |
| ----------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sections, order                     | 15,838               | The order of lists: `event-pdf` writes a pathway's children in the database's order below the PDF's root, pdf-export in the curators' (`hasEvent`'s `order`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Spec 001, expected differences; research R2                                                                                                      |
| Compartments, order                 | 4,389                | The same, for compartments.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | As above                                                                                                                                         |
| References, order                   | 75                   | The same, for literature.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | As above                                                                                                                                         |
| Diseases, order                     | 174                  | The same, for diseases.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | As above                                                                                                                                         |
| Inferred from, order                | 53                   | `event-pdf`'s graph library holds an event's `inferredFrom` as a `java.util.Set` (graph-core's `Event`), and `EventsDetails.addInferred` writes it in that set's order; pdf-export in the graph's.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Research R2; checked in `event-pdf`'s source 22 Nov 2026                                                                                         |
| Summation, order                    | 78 sections          | An event's several summations in another order: `event-pdf` writes them as graph-core loads the list (`EventsDetails.addSummations`, `getSummation()`), pdf-export by the relationship's `order` (research R2), as with references (a) below. Counted as the sections with more than one summation and the same characters; the comparison counts them as text.                                                                                                                                                                                                                                                                                                                                     | Research R2; checked in `event-pdf`'s source 22 Nov 2026                                                                                         |
| Summation, a table                  | 25 sections          | A table in the summation (24 in Developmental Biology, 1 in Disease): both print it, its cells wrapped differently, so read line by line their text interleaves in another order. The same characters on both sides, and in each between 17 and 361 of its lines in several columns on both.                                                                                                                                                                                                                                                                                                                                                                                                        | Checked 22 Nov 2026 (characters, columns)                                                                                                        |
| Location, text                      | 217                  | A recurring event's location is the path to where its section is written, and each book writes it at its first place in its own order of lists: `event-pdf` prints an event once (`EventsDetails.details`, its `printed` set) and gives the path of that visit (`nav`). 160 of 221 (before #251) have the same depth with one pathway another; the rest, another depth. Seven, one location a prefix of the other, not checked.                                                                                                                                                                                                                                                                     | Spec 001, expected differences; checked in `event-pdf`'s source 21 Nov 2026                                                                      |
| References, text                    | 17,522               | Three reasons, the first the largest: **(a)** a reference's **authors in the publication's order** (`author`'s `order`) in pdf-export, in graph-core's list as loaded in `event-pdf` (`References.getAuthorList`; research R2: not by `order`), seen on Autophagy as the same names in another order; **(b)** **which five** references show, by the order of lists above; **(c)** a **book**'s reference: `event-pdf` writes its publisher and pages and no ISBN (`References.getBook`, "APA style does not provide ISBN"), pdf-export its publisher, pages and ISBN (the pages put back in this change, left out before).                                                                         | (a) research R2, checked in `event-pdf`'s source 21 Nov 2026; (b) spec 001; (c) the ISBN kept as pdf-export's; WebsiteAngular's register (#1027) |
| Before and after, text              | 2,106 and 2,204      | The order of lists (the events before and after), and with it which are written first.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Spec 001, expected differences                                                                                                                   |
| Contents, missing and extra; target | 2,704 and 2,064; 216 | The contents list is pdf-export's own (before the sections, every event beneath the pathway), `event-pdf`'s after them; an entry's title and target are read as each prints them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Spec 001, expected differences                                                                                                                   |
| Short entries, count                | 21                   | Short entries at every later place an event recurs in one PDF, where `event-pdf` writes nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Spec 001, expected differences                                                                                                                   |
| Figures, extra; cover, diagram      | 1; 1                 | Digestion and absorption: pdf-export prints its diagram on the cover and in its section, `event-pdf` neither. `event-pdf` leaves a diagram out when drawing it fails (`Diagrams.insertDiagram` catches the error and logs it); this pathway has an illustration (EHLD), likely the failure, though `event-pdf`'s log for release 98 was not seen.                                                                                                                                                                                                                                                                                                                                                   | Checked in `event-pdf`'s source and the graph 22 Nov 2026                                                                                        |
| Name, text                          | 2                    | The graph holds U+2019 (a right single quotation mark), which pdf-export prints; `event-pdf`'s file reads as U+02BC (a modifier letter apostrophe). `event-pdf`'s font, Source Serif Pro (`PdfProfile`, embedded as Identity-H), draws both with one glyph, which its file maps back to U+02BC: the same mark printed, read back as the other.                                                                                                                                                                                                                                                                                                                                                      | Checked against the graph 22 Nov 2026; the font's glyphs this change                                                                             |
| Edits, text                         | 7                    | **Six people, then _et al._:** an edit's row of more than six people (7 to 12 here) `event-pdf` writes as the first six and "et al." (`Tables.createEditionsTable` through `References.getAuthorList`); pdf-export writes every one, the same six first on both sides. Edit-history rows name every person, as the website's pages do; `event-pdf` cut them at six and "et al." only because it printed them through its references' author list (`References.getAuthorList`). One of them (DNA Replication) has two rows of one date in another order besides. Otherwise the same rows, dates, kinds and people in every section: the grouping, recorded here before this change, differs in none. | Checked in `event-pdf`'s source and both books' rows 22 Nov 2026; every person kept, as the website's pathway pages show them, 22 Nov 2026       |
| Edits, order                        | 38                   | Rows of one date in another order, the same rows on both sides (4 files: Hemostasis 19, Disease 16, Extracellular matrix organization 2, Signal Transduction 1; most on three dates when an event had several edits). Both sort by date, then the first author's surname (`Tables.getEditions`); `event-pdf` takes the first of graph-core's list as loaded, pdf-export the first by `order` (research R2), and ties fall to the order each lists them in. Each book's order fits that sort, with a first author chosen from each row, in all 38.                                                                                                                                                   | Checked in `event-pdf`'s source and both books' rows 22 Nov 2026; the graph's lists not read                                                     |

### Not yet explained

Each is open in T040 until it is fixed or recorded with its reason:

| Part, kind      | Count             | What is known                                                                                                                                                                                                                                                             |
| --------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Summation, text | 3 of 116 sections | Down from 372 with #249 to this change; 78 more are several summations in another order and 25 a table, under Expected. Left: **3** in Developmental Biology, each a summation holding a table with a caption, two of them with two `<table>` tags opened and one closed. |

## Still to do in T040

- The open rows above, each fixed (in the comparison or the book) or recorded, and added to
  `expected-98.json` with its reason.
- A sample of single-event PDFs against `event-pdf`'s, and a reaction's with a token
  (research R10).
- With every row recorded, `expected-98.json` complete, so the comparison exits 0 on
  release 98 and 1 on anything new (today 1: the 7 open).
