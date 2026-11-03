# Research: Reactome's pathway PDFs from the graph

Measured 29 Oct 2026 unless said otherwise. "Inference" marks what was reasoned, not
measured. Nothing here went to a production service. The reference build of `event-pdf`
and every experiment ran in a private scratch folder, outside the repository.

## R1. The language: TypeScript on Node, throughout

**Decision.** pdf-export is written in TypeScript on Node 24, as one package with two
entry points: the book's command line and the single-event service (R9).

**Rationale.**

- Everything it is built from is TypeScript or Node already:
  - the website's renderer, which draws the figures (R3);
  - Chromium, driven by Playwright, which lays out and prints the PDF (R4);
  - the Neo4j JavaScript driver (Apache-2.0), which reads the graph (R2);
  - the website's own content service, which will call the single-event service.
- graph-core, the only reason for the JVM, has no licence (constitution II).
- TypeScript's strict mode gives the null safety Kotlin would.

**Alternatives considered.** Kotlin for the graph and the sections, with TypeScript for
the figures and the printing: two builds, two dependency trees to check for licences,
and a hand-off between them, for nothing the graph needs.

## R2. What `event-pdf` reads, and the queries that replace it

**Measured from its source** (event-pdf `2c070d5`, the commit WebsiteAngular's
deployment pins; built here against graph-core 2.0.9, which its pom names).

- **The graph's shape** (release 98):
  - `(Pathway)-[:hasEvent {order}]->(Event)`;
  - `(Event)-[:compartment {order}]->`, `-[:disease]->`, `-[:summation]->(Summation {text})`;
  - `(source)-[:inferredTo]->(event)` for what an event was inferred from;
  - `(event)-[:precedingEvent]->(before)`, read backwards for the events after;
  - `(event)-[:literatureReference {order}]->(Publication)`: `LiteratureReference`
    (title, journal, volume, pages, year, pubMedIdentifier), `URL`
    (uniformResourceLocator), `Book` (chapterTitle, `-[:publisher]->` an affiliation);
  - `(Person)-[:author {order}]->(Publication | InstanceEdit)`;
  - `(InstanceEdit {dateTime})-[:authored | edited | reviewed | revised]->(event)`;
  - `(:DBInfo {releaseNumber})` (graph-core 2.0.9's `version` reads null on release 98), and `:TopLevelPathway {speciesName}`.
- **Order today is mostly the database's, not the curators'.** graph-core 2.0.9 loads
  each list below the PDF's root with no `ORDER BY` on the relationship's `order`:
  children (so the sections' order), compartments, literature (so _which_ five are
  shown), summations, diseases and the events before and after. Only the root's own
  `hasEvent` and `compartment` are sorted. `inferredFrom` is a hash set.
- **The top-level pathways** are written in database-id order today. FR-002 asks for
  name order, ignoring case, for making, checking and reporting the book's PDFs.
- **The cover's names** are written with U+2060 between every character and no-break
  spaces between words, presumably to stop the reader breaking them. A text comparison
  must normalise both.
- **Its parts' rules**, read from its section writers:
  - diseases leave out the one named exactly "disease";
  - an event already written is left out with its whole subtree;
  - references show six authors, then "et al.", and link PubMed;
  - the edit history drops edits with no date or no author, sorts by date then the first
    author's surname, groups edits sharing a date and either a kind or the same authors,
    and orders each row's authors by database id;
  - with an analysis, a reaction's entities and interactors are its first parent
    pathway's, filtered to the reaction's identifiers.
- **The introduction** has fixed text, four of Reactome's papers by year, the release,
  and the counts of distinct pathways and reactions.

**Decision.** pdf-export reads the graph with the Neo4j JavaScript driver, in batched
Cypher (one query per level of the tree, one per part across a level's events), and
sorts every list by the relationship's `order`. The parts' rules above are kept. Where
today's order is the database's, the new order is the curators', and FR-012's comparison
treats list order as an expected difference (spec amended, Assumptions).

**Alternatives considered.** graph-core: no licence, and the JVM (R1). The content
service's HTTP API: it is the website's, built for pages, and the book would put tens of
thousands of requests on it.

## R3. The figures: the website's render service

**Measured.** WebsiteAngular's renderer has three layers:

- the render page in the built site (`/PathwayBrowser/render/{id}`);
- `render-core`, which drives a page;
- a command line and an HTTP service.

Only the render page draws. It needs the built site, its content service (two of whose
calls are still Java's: the events hierarchy and the reaction layout), and the release's
diagram and EHLD files.

- **What it draws:**
  - a pathway's diagram;
  - a subpathway in its ancestor's diagram (`highlight=`);
  - an EHLD;
  - a reaction (`layout=reaction`);
  - an analysis overlay by token.
- **What it cannot draw yet** (WebsiteAngular changes, R10):
  - an ancestor's diagram with events selected when that ancestor has an EHLD, since
    highlighting an illustration throws and nothing forces the plain diagram (no human
    pathway at release 98 needs one, R7);
  - an overlay on a reaction's own drawing (the reaction component never reads the
    analysis, and `event-pdf` overlays reactions, R7).
- **SVG** stays vector in Chromium's PDF when inlined.
  - Diagrams carry text in Roboto without the font embedded, and node shapes as small
    PNGs.
  - EHLDs are all outlines.
  - Two figures on one page share ids such as `clip-1`. Inlined together, they change
    each other's drawing: 13.6% of one figure's pixels in one measurement. Every id is
    prefixed per figure.
- **Time per figure** (through beta's render service, uncached; beta's service is shared
  and was under the site's own load, so these are not a quiet machine's times): diagrams
  3.4–5.0 s, a subpathway's selection 4.1 s, a reaction 2.6 s, an EHLD 2.2–2.4 s. On a
  page that is reused, a reaction takes 0.65 s and a diagram 2.8–4.0 s. Two renders at
  once gave 1.65 times one's throughput.
- **The human book's figures:** 19,313, counted from the graph (R7). Inference, from
  these times:
  - through the service as it is: 16,424 reactions × 2.6 s, 1,170 diagrams × 3.4–5.0 s,
    220 EHLDs × 2.2–2.4 s and 1,499 selections × 4.1 s make 53,000–55,000 s, so about
    7.4–7.7 h at its concurrency of 2 (more, at its measured 1.65 times);
  - with four reused pages: 16,424 × 0.65 s and 2,889 × 2.8–4.0 s make
    18,800–22,200 s of drawing, so about 1.3–1.5 h if four pages ran four times as fast.
    They do not: two at once measured 1.65 times one, so four would give less than four
    times, and the real time would be longer than 1.3–1.5 h.
- **A licence trap.** The built site carries FoamTree, under Carrot Search's commercial
  licence, in a chunk every render loads. pdf-export cannot ship the built site in its
  own image (constitution II).

**Decision.** pdf-export asks a render service for each figure, over HTTP, as SVG. It
never ships the website's code.

- **For the website's PDF:** the deployment's own render service, beside the content
  service that calls pdf-export, on the same graph.
- **For the book:** the figures' step (`pdf-export figures`, R7's route) runs
  WebsiteAngular's render service (with its content service) on the release's graph and
  files, as a neighbour of pdf-export's container; the book's own step reads the folder
  it writes and needs no render service.
- **The service's limits are settings,** for the figures' run, rather than the website's
  defaults: concurrency, queue and timeout. Its cache is turned off for that run.
  For the website's PDF, the website's own cache serves what it holds, a benefit in
  service outside SC-005, which is measured cold (R7).
- **pdf-export prefixes every SVG id** before it inlines the figure.

**Alternatives considered.**

- _pdf-export drives the render page itself:_ it would ship the built site, and with it
  FoamTree. WebsiteAngular could publish a render bundle without FoamTree. That is the
  better long-term shape and needs a WebsiteAngular spec; it is noted under R10.
- _The old Java exporters' figures:_ against constitution IV.

**For the release's owners** (spec, Assumptions): the release step then needs
WebsiteAngular's render and content services on the release's graph. R7's measurement
decided it: the figures are drawn by a step of their own, before the book.

**A limitation** (constitution II's run-time exception, 1.2.0): the render service loads
FoamTree, under a commercial licence. pdf-export ships none of it, but cannot make
figures without that service running, until WebsiteAngular's render bundle without
FoamTree exists (R10).

## R4. Layout and printing: HTML and paged CSS, printed by Chromium in parts

**Measured** with Playwright 1.64 (Chromium 156), pdf-lib 1.17 and pdfjs 6.4, on
synthetic documents, on this host under load.

- **One pass does not scale.** 500 pages printed in 9.7 s at 1.3 GB; 1,990 pages in 61 s
  at 3.9 GB. 4,930 pages passed 6 GB and was stopped. Inference: 9–10 GB.
- **Parts, joined, do.** 4,930 pages in 26 parts of about 190 printed in 88 s, or 53 s
  four at a time, with Chromium's peak at 0.8 GB, or 2.1 GB with four. The join took
  6 s and gave a 120 MB file.
- **Joining breaks internal links** (pdf-lib's `copyPages`). This works instead, and
  resolved 21,375 links of 21,375:
  - every internal link is printed as a placeholder URI;
  - a 1-pixel probe link inside each target gives its page, and its position on the page;
  - after the join, each placeholder becomes a real destination (`/XYZ`, at the probe's
    height, so a link lands on its heading, not the top of the page) and the probes are
    removed.
- **Bookmarks.** Chromium writes nested bookmarks only with `outline` and `tagged`
  together. A joined file loses them, and its tagging. pdf-lib has no outline API, but
  writing the outline's dictionaries directly works: 7,126 nested entries, each landing
  on its page.
- **Paged CSS in Chromium:**
  - works: `@page` size (A4 must be set) and margins; margin boxes with literal text and
    page counters; named pages, one per chapter, for running headers;
    `break-inside: avoid` for figures;
  - does not work: `string-set`, running elements, `target-counter()` and `leader()`.
- **Contents page numbers** come from a second pass, in the book and in a single-event
  PDF that has a contents list. The first pass prints fixed-width
  placeholders; each section's page is read back; the front part is printed again. Page
  counts and anchors were identical between the passes.
- **Page numbers across parts:** `html { counter-reset: page N }` starts a part at N+1.
  "Of M" must be literal text. With parts printed a few at a time, no part but the first
  knows its N, and none knows M, until all are printed.
- **A single-event PDF of about 30 pages** printed in 0.7 s with bookmarks and tagging,
  on a browser already running.
- **A trap:** `setContent` cannot load fonts from `file://`, and the text silently falls
  back to the system's. Pages are loaded with `goto` on a file.

**Decision.**

- **The book: one PDF per top-level pathway** (user's decision, 3 Nov 2026, in place of
  one PDF of the whole book, which joined about 23,500 pages in one process and grew
  with every release; FR-001):
  - each PDF printed in parts at section boundaries, about 200 pages a part, so a small
    pathway's PDF is one part and the largest today (3,760 pages) about 19;
  - printed untagged, a few parts at a time across the PDFs, then each PDF's parts
    joined, the PDFs' joins independent of one another;
  - links rewritten, and the outline written by pdf-export, which it needs anyway: an
    event's later places in a PDF point at its one section (FR-004), which Chromium's
    headings would not do. An event held only by another of the book's PDFs is, as
    FR-003 has it for any event a PDF does not hold: plain text in a location, a link to
    its page on the website for what an event was inferred from, and left out of a
    reaction's events before and after;
  - **page numbers and running headers stamped after the join,** not printed: the parts
    are printed without them, and pdf-lib writes each page's number ("12 of 3,760") and
    its top-level pathway's name, which the model knows from where each part landed,
    in an embedded subset of Roboto, in the compiled theme's on-surface-variant colour,
    read from the compiled CSS, not written here (FR-015). SC-009's check sees that font
    and colour too. The other
    way, printing every part, counting, and printing them again with their offsets,
    doubles the printing time. Stamping is to be measured in the first tasks;
  - the contents list numbered by the second pass, its front part only;
  - **the join's memory** re-measured at the largest PDF's size (pdf-lib holds the whole
    file): 120 MB for 4,930 synthetic pages, and today's 3,760-page file is 383 MB from
    another producer, so perhaps near 400 MB (inference). A join takes one of
    `--parallel`'s slots, as a part's print does, so printing and joining together stay
    within that bound. Joining in groups is kept only as a fallback, if T011 finds even
    one PDF's join does not fit.
- **A single-event PDF:** printed tagged, with Chromium's own bookmarks and page numbers
  from its margin boxes. Where it has a contents list (a pathway at depth 1), its pages
  are numbered as the book's are: a first print with placeholders, its anchors' pages
  read back, and a second print. A reaction alone, or depth 0, has no contents list and
  is printed once. The second print is in SC-005's budget (R7).
- **Figure size** (FR-016, T008): a figure prints as large as the page allows, never
  split: in the portrait text, or on a landscape page of its own where that prints it
  larger. Its labels' size follows from its scale (the smallest label, not the first); one
  whose labels print below 1 pt even so is listed in the run report.
  - **Planned first:** a 5 pt floor, diagrams' node labels being 12 px in the render
    service's SVG (measured in its cache on 30 Oct 2026: 140–165 labels a diagram at 12 px,
    compartments' at 80 px, a few at 16 px). 5 pt allows about 1,155 of the SVG's pixels
    in portrait and 1,750 on a landscape page (481.9 and 728.5 pt of text width).
  - **Measured (T008):** release 98's 1,170 human diagrams, each drawn by the render
    service from the release's files (its `RENDER_FILES`, WebsiteAngular #777–#779),
    measured and placed by `measure()` and `place()`; none failed. Their sizes cannot be
    read from the files: the render draws at twice the files' coordinates, with margins
    of −10 to +478 px. 1,168 have 12 px labels, two 6 px. The median is 3,654 px wide,
    the widest 19,652. Even on its best page, only 80 (7%) print labels at 5 pt, 311 at
    3 pt, 652 at 2 pt and 1,070 at 1 pt; the median prints at 2.1 pt.
  - **Today's book has no floor.** `event-pdf` (2c070d5) scales each diagram, a vector
    drawing from the Java DiagramExporter, to the portrait text's width and at most half
    the page's height (40% for a reaction), whatever its labels' size. The old exporter's
    labels are 8 units of the diagram files' coordinates (Arial Bold, `FontProperties`,
    shrunk further to fit a node); the render service's are 6 (12 px at twice the
    coordinates), 25% smaller beside their diagram. From the files' sizes (inference, the
    book's pages not measured; its margins taken as 20 mm), today's labels print at a
    median of 1.85 pt (10% under 0.93, 10% over 3.8), and 51 diagrams reach 5 pt. The
    rule above prints a median of 2.14 pt (1.08 and 4.36), at least today's size for
    1,143 of the 1,170.
  - **So 1,060 diagrams (91%) print on a landscape page**, being wider than tall, about
    1.5 times as large as in the portrait text; 110 stay in portrait; 100 are
    listed below 1 pt (the widest, at 0.44 pt).
  - **Illustrations, measured from their outlines.** Their lettering is drawn as
    outlines, so no font size can be read. Each pathway's label is one path
    (`id="PATHWAY TEXT…"`), each letter a closed subpath of absolute commands. A label's
    letters are measured as their cap height: from a line's baseline (the bottom most of its
    letters share) to the top of the letters standing on it, the label taken at its tallest
    line, since one label is one text layer at one size and a dash set apart on a line of
    its own would otherwise pass for small letters (five illustrations have such lines).
    A letter's holes (the counters of B, O, d) lie within its outline and are left out
    before the vote, or a short label's holes could set its baseline. A line with
    ascenders (l, d, G) reads a little tall, by up to the ascender's height over the
    capitals' (about 8% in Roboto), which errs large; a line with neither capitals nor
    ascenders reads its x-height, which errs small; a long name, which each illustration's
    smallest label is, reads within a few percent. A line is the letters whose heights
    overlap, directly or through others, so a dot or an accent does not split one; on a
    tied vote the lower bottom is the baseline, so a mark set high is not. The cap height
    is taken as a font's of the same cap height (0.71 of its size, Roboto's 0.711, Arial's
    0.716). A label transformed (by attribute or style), or inside an element so
    transformed other than the render service's viewport, inside a nested `<svg>`, or in
    content not drawn where it stands (`<defs>`), is not read and leaves the figure
    unmeasured. The viewport writes its scale twice, by attribute and by style to six
    figures; the two must agree. Only the pathways' labels (`PATHWAY TEXT`) are read: the
    illustrations' other lettering (`LABEL_TEXT`, and paths in groups named `TEXT`) is
    about the same size at release 98, as #107's review measured. Markup the render service
    does not write is caught where it can be: a label in a title, description or
    metadata, or after a close tag that skips open elements or a tag holding a `<`, is
    unread. Other malformed markup (a quote left open, a stray close tag ending the
    viewport itself) may be read wrongly, and a style element's rules or `display="none"`
    are not looked for (`src/layout/lettering.ts` lists them). Release 98's 221 illustrations, every one with labels, none
    transformed:
    - every label's cap height is 8.49–8.94 of the file's units, a font of about 12 px,
      as the diagrams' labels are;
    - the render service fits each into its 1,600 × 1,000 frame (its viewport's
      `matrix(a,0,0,a,e,f)`, 1.17 for the usual 1,366 × 768), so in the figure the
      lettering is 13.9–14.8 px, except R-HSA-5619102 (2,664 × 1,230, fitted at 0.60), at
      7.2 px. The reading from the render service's SVG and from the file agree, checked on
      two (13.92 and 7.18 px);
    - in the portrait text that prints at 4.2–4.5 pt; on a landscape page, larger, at
      6.3–6.7 pt (R-HSA-5619102 at 3.3 pt), so every illustration prints landscape.
  - **Decision** (user, 3 Nov 2026), for the reader, who reads the book on a screen: most
    screens are wider than tall, so a wide figure on a landscape page fills more of one;
    no page makes most diagrams' labels readable unzoomed, so every figure links to its
    interactive form on the website (FR-003), where they are. The rule is in `src/layout/figure.ts`: the constant `FLOOR_PT` (the report's threshold)
    and the orientation chosen in `place()`, so curators who prefer another, such as
    portrait unless the labels would fall below a size, change it there. `measure()` reads an illustration's lettering
    (`src/layout/lettering.ts`) as it reads text's sizes, the smaller of the two counting;
    a label whose outlines are not read (a relative command, an arc, a viewport that is
    not a plain scale) counts as unread, so the figure is reported as unmeasured.
- **pdf-lib:** the maintained MIT fork `@cantoo/pdf-lib`, if it passes the same tests;
  otherwise pdf-lib 1.17.

**Alternatives considered.**

- _One pass:_ out of memory at the book's size.
- _A paged-media engine with `target-counter`_ (Prince, WeasyPrint): commercial, or AGPL
  and outside Node.
- _Paged.js:_ a polyfill that lays out in the page's script, untested at thousands of
  pages; kept in reserve for the contents list's numbers.

## R5. The website's look: its theme as a dependency, its fonts embedded

**Measured.**

- **The theme compiles without Angular itself.** The website's theme package, with Sass
  and Angular Material's Sass (`@angular/material` and `@angular/cdk`), compiles in
  0.6 s to CSS variables: 160 `--mat-sys-*` values in the light theme (165 as T017 compiles it, with the website's pinned versions), 29 distinct
  colours as hex. For example: primary `#006781`, on-primary `#ffffff`, tertiary
  `#1660a5`, surface `#effbff`, on-surface `#001f25`, surface-container-lowest
  `#ffffff`, outline `#6d797f`.
- **Its install is 25 packages** (76 MB, Angular's packages as peers). All are under
  allowed licences, except the theme package, which declares none; its repository is
  CC0.
- **The fonts:** Roboto, Roboto Mono and Noto Sans from `@fontsource`, each OFL-1.1 with
  its licence file. Chromium embeds subsets of them.
- **Fallback is silent.** A character none of the three has is drawn in whatever the
  system has: on this host, Liberation Serif for an arrow, DejaVu Sans for a check mark.
- **The website's diagrams ask for Roboto at weight 600**, which the site does not load.

**Decision.**

- **Colours:** the build compiles the theme to CSS variables, from `ngx-reactome-style`,
  pinned in the lockfile to the commit the website's lockfile pins, with
  `@angular/material` and `@angular/cdk` at the website's version; they are raised
  together. The stylesheet uses only those variables. No colour value
  is written in pdf-export's own code (FR-015). The page is surface-container-lowest
  (white). The theme's `color-mix()` surfaces are not used, since their colours are not
  in the palette.
- **Fonts:**
  - Roboto (300, 400, 500 and 600, so the diagrams' labels get their own weight) and
    Roboto Mono, from `@fontsource`;
  - the Noto Sans family, Noto Sans with Noto Sans Symbols 2 and Noto Sans Math for
    arrows and signs, all OFL-1.1 (FR-015 and SC-009 amended to name the family);
  - the container carries no other font, so nothing can fall back to one. Chromium's
    system dependencies, as `playwright install-deps` installs them, bring fonts such as
    `fonts-liberation`; the image leaves them out, and its build lists the fonts it has
    and fails on any other;
  - with no fallback, a character none of the fonts covers would be drawn as an empty
    box, still silently. So before printing, each text's characters are checked against
    the fonts' character maps (`fontkit`, MIT), and one no font covers is a fault,
    named by its code point and its section's stable identifier. Amended by FR-017
    (30 Oct 2026): a fixed list is substituted first, and a PDF made on request prints
    any other as U+FFFD, logged, instead of failing. The figures' labels are checked
    too: before drawing, from the names the graph gives them and the labels of the
    diagram files the Figure rules choose to draw (a diagram's figure reads its file,
    research R3; a reaction's figure is laid out by the content service from the graph's
    names); and after drawing, in each SVG's text, before the part holding it is printed
    (the book's PDFs are printed in parts, R4);
  - the check of FR-011 and SC-009 lists every font in the PDF.

**Alternatives considered.**

- _A copy of the palette's values:_ against FR-015.
- _Fonts from Google's servers at print time:_ the release step would depend on a third
  party, and a failure would fall back silently.

## R6. The analysis overlay: through the analysis service's API

**Measured from the source.**

- **Results are stored as Kryo 5.3.0 files,** named after the token, with class names as
  strings. A TypeScript reader would depend on the analysis library's internal Java
  fields, and would break silently when they changed.
- **The analysis service's API reads the same files by the same rules:**
  - 404 or 410 for a token with no stored result, judged by the date inside the token
    (measured below);
  - `/token/{token}` gives the summary, the resource summary, the not-found count and the
    pathways hit;
  - `/token/{token}/found/entities/{pathway}` and `/found/interactors/{pathway}` give the
    found lists, a 404 meaning none (or that the result has gone since: the service
    answers both alike);
  - the count of identifiers found is in neither the summary nor `result.json` (measured
    below).
- **Today's errors:** a malformed token throws an unhandled Base64 error, and the
  content service answers it with an empty response, as it does the other token errors.
- **The render page** reads the same API for its overlays.

**Measured (T009, 3 Nov 2026)**, against a non-production instance of the analysis
service on release 98, never production. Nothing was deleted from its storage: each case
was made from a token the service reads by its own rules, and one small analysis was
submitted (three accessions that map and one that does not; projection to human, without
and then with interactors). The rules were read from the deployed analysis-core
(3.6.0-SNAPSHOT: `TokenUtils`, `Tokenizer`, `AnalysisResult`) and the analysis service's
own source, and the answers agree with them.

- **A token** is Base64 of `{yyyyMMddHHmmss}_{counter}`, URL-encoded (`=` as `%3D`). The
  service URL-decodes it until it no longer changes (Java's `URLDecoder`, which reads `+`
  as a space), then Base64-decodes it with Java's basic decoder (padding optional).
- **The service reads the stored result first.** Only when there is none does it judge
  the token's date: within 7 days, 410; otherwise, or with no date in it, 404. The 7 is
  `DAYS_TO_LIVE`, a constant in analysis-core, not a setting, and counted in whole days
  (Joda's `daysBetween`, `<= 7` alive) in the service's time zone (UTC on this instance;
  the token's date is written and read in the JVM's default zone): a token dated 7 days
  23 hours ago is still 410, one dated 8 days ago 404, and one dated in the future 410.
  So the 7 days only tell a missing result's 410 from its 404; they delete nothing.
- **How long a result is kept** is not set by the token's age:
  - The service's own cleanup is hard-coded in its configuration (`WebConfig`): every
    10 s a checker (reactome-utils' `LruFolderContentChecker`) measures the results
    folder, and only once it reaches its maximum less a threshold (2.5 GB less 500 MB)
    deletes the files last accessed more than a week ago, least recently used first,
    until it is under. "Last accessed" is the file system's access time, which a mount
    may update at most daily or never, so a read result may or may not count as recent.
  - Results are also removed outside the service's code: its API documents its 410 as a
    result deleted for a new data release, and five recorded tokens from September and
    October were all 404 here, which the cleanup alone would explain only if the folder
    had passed about 2 GB. How and when is not known from here.
  - Submitting the same data again reuses its earlier token while the service has not
    restarted (an in-memory map), and runs the analysis again under it if its result is
    gone: a token answered 404 can later be answered 200. This holds after the
    service's own cleanup too: it asks the map to forget a deleted file's token
    (`removeAssociatedToken`), but compares the file's decoded name with the map's
    encoded tokens, which never match (read).
  - So a token older than 7 days whose result is still stored is answered in full.
    Read from the code; not seen here, as no stored result older than 7 days was at
    hand.
- **A stored result that cannot be read** (a class changed after an analysis-core
  upgrade, say) is the catch-all 500 (read, not run).
- **The answers,** each `application/json;charset=UTF-8`:

  | Case                                                                                         | Status | Body                                                                                                                                                            |
  | -------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | a good token, `/token/{token}`                                                               | 200    | the summary (below)                                                                                                                                             |
  | dated within 7 days (or in the future), no result stored                                     | 410    | `{"code":410,"reason":"Gone","messages":[]}`                                                                                                                    |
  | dated 8 days ago or more, no result stored                                                   | 404    | `{"code":404,"reason":"Not Found","messages":[]}`                                                                                                               |
  | Base64 of text with no date (no `_`)                                                         | 404    | as above                                                                                                                                                        |
  | Base64 of `_` alone (`Xw==`): the date part is missing, and reading it fails                 | 500    | the 500 body below                                                                                                                                              |
  | not Base64 (`not-base64!`, or `QQ=` with the wrong padding), or a URL-decoding error (`%25`) | 500    | `{"code":500,"reason":"Internal Server Error","messages":["Please get in touch with our help desk ({help-desk address}) for more details about this problem"]}` |
  | a `/` in the token: encoded (`%2F`)                                                          | 400    | the servlet container's own HTML page, not the service's JSON                                                                                                   |
  | a `/` in the token: raw                                                                      | —      | another route: the framework's own JSON 404, or another endpoint (`{x}/resources`)                                                                              |
  | `found/interactors/{pathway}`, none found (with or without interactors in the analysis)      | 404    | the 404 body above                                                                                                                                              |

  A malformed token is the service's catch-all 500, the same answer as any failure of its
  own, so it cannot be told apart from one by its answer.

- **The summary** (`summary` in `/token/{token}`) holds `token`, `projection`,
  `interactors`, `type`, `sampleName`, `text` and `includeDisease`. Beside it,
  `/token/{token}` gives `identifiersNotFound` (a count), `pathwaysFound`, `pathways` (a
  page of them), `resourceSummary`, `speciesSummary`, `expression` and `warnings`. **None
  of them is a count of identifiers found,** nor of identifiers submitted. These are this
  analysis's fields: the service leaves out null ones, and the summary may also hold
  `species`, `fileName`, `gsaToken` and `gsaMethod` (its `server` is never written), with `type` one of six
  values (the ReactomeGSA ones among them), so the client's types stay open to them.
- **`pathwaysFound` follows `includeDisease`:** the answer is filtered by the stored
  analysis's own setting unless the request names one, and the summary it returns then
  reports the request's setting, not the analysis's. For the analysis submitted here, 229
  with disease pathways and 191 without.
- **Today's book counts after its own filter, over every species:** `filterBySpecies`
  first filters the stored result by resource and importable-only (`filterPathways`,
  which writes the filtered pathways back into the result, every species kept): disease
  pathways kept, those found for the resource, those with a p-value. The species only
  shapes the list it returns. The book then counts the pathways hit and the identifiers
  found from the written-back, all-species result (`PropertiesSection`). Under FR-006's
  defaults (all resources, not importable-only) the pathways hit are `pathwaysFound` with
  `includeDisease=true` and no species (229 here, both ways): the service's filter
  skips a pathway with no p-value as the book's does, and differs only in dropping a
  p-value above 1, which the book would keep, and which analysis-core's own p-values
  never are (only imported statistics could be): so in practice they select the same
  pathways, as spec 002's research (R1) says. `identifiersNotFound` is the stored not-found set's size, as today's book's.
- **`/download/{token}/result.json`** has no such count either: its keys are `summary`,
  `pathways`, `notFound`, `expressionSummary` and `warnings`, and it was 468 KB for this
  four-identifier analysis.
- **`/download/{token}/entities/found/TOTAL/{name}.csv`** lists them: a header row,
  then a row per submitted identifier and each identifier it maps to (one submitted
  identifier mapping to two gives two rows), in three columns (submitted identifier,
  found identifier, resource), so it is counted by distinct first column, not by row; 113
  bytes here. It is built from the same map
  as today's book's count (`getAnalysisIdentifiers()`, the found entities map's keys,
  which are equal when their ids are; interactors are a separate map, left out of both),
  so the count of distinct submitted identifiers in it, the header skipped, is that
  count, but over all the stored pathways rather than the book's filtered ones: the same
  except where a pathway the filter leaves out (no p-value, say) holds an identifier no
  kept pathway does. Its values are not quoted. Each request writes a temporary file on the service's
  host, cleared within about half an hour.

**Decision.**

- **Only the token's form is checked here,** before the service is asked; whether it has
  expired is the service's to say. Judging the date here would refuse a result the
  service still answers, and the website still shows, whenever its file outlives 7 days.
  - The identifier is checked first: an unknown or non-event identifier is answered as
    such whatever the token.
  - A malformed token: `unknown-token` (404), as the service's answers to one (a 500, a
    400 page, another route) would read as `unavailable` or worse. Malformed is anything
    but the form the service issues: URL-decoded until it no longer changes (a decoding
    error is malformed), it must be non-empty ASCII letters and digits with at most two
    `=` of padding (the length then a multiple of 4, and not 1 modulo 4 without it), and
    its Base64 must decode to `{14 digits}_{1 to 19 digits}` (the counter is a Java
    `long`). A check of the Base64 alone is not enough: `Xw==`, Base64 of `_`, is well
    formed and the service fails on it; and without the bound, a token with a
    7,000-digit counter is answered by the servlet container's HTML 400. The service's
    tokens never hold `+` or `/`, and this instance writes their dates in ASCII digits
    in the Gregorian calendar (as its JVM's locale does; one with other digits or another
    calendar would issue tokens this rule refuses, or the service misdates), so the rule
    refuses none it issues. **What is sent is the canonical token,** never the input as
    given: the decoded value encoded again as padded Base64, with `=` encoded as `%3D`, as
    one path segment. The counter's bound is on the decoded form, so a token wrapped in
    many `%25` layers passes the rule; sent as given, it too would reach the servlet
    container's HTML 400. Each layer is decoded over the whole token, so the time grows
    with the square of its length (about a tenth of a second at 8 KiB in the worst shape,
    nearer a second than a third at 32 KB, and about 38 s at 200 KB): a token longer than
    8 KiB as given is refused before it is decoded, which still reads one the service issues
    nested in a thousand layers.
  - The service's 404: `unknown-token`. Its 410, for a result not stored though its date
    is within 7 days: `gone-token` (410). Its other answers, a 500 among them, are
    `unavailable`.
  - **No retention setting:** the period is the service's constant, and it alone applies
    it. CI's stub has a case for each row of the table.
- **The requests carry FR-006's defaults:** all resources together (`TOTAL`), no
  expression column, all identifiers rather than only importable ones.
- **The counts,** as today's book's: the identifiers found are the distinct submitted
  identifiers in `/download/{token}/entities/found/TOTAL/{name}.csv` (header skipped),
  which grows with what was found, not with the pathways hit as `result.json` does; the
  total adds `/token/{token}`'s `identifiersNotFound`; the pathways hit are its
  `pathwaysFound`, asked for with `includeDisease=true` so that an analysis submitted
  without disease pathways is counted as today's book counts it, and with no species, as
  it counts every species. The identifiers found may differ from the book's where a
  pathway the filter leaves out holds an identifier no kept pathway does; the comparison
  (FR-012) records any such difference. The CSV's file name is a constant, never taken
  from the request (the service writes a file under it). The exact count would be spec 002's (`POST
/token/{token}/found/all` over every kept pathway, its research R1), at the cost of
  sending the whole pathway list; the CSV is one small request, and its edge is rare.
- **Each call says what it accepts:** the CSV call `Accept: text/csv, application/json`,
  the others `Accept: application/json`. The CSV endpoint produces only `text/csv`: asked
  with `Accept: application/json` alone it answers the framework's own 406, not the
  service's JSON, and `/token/{token}` asked for `text/csv` answers an empty 406. With
  `text/csv` listed (alone, or with JSON), or no `Accept` at all, an error comes back in
  the service's JSON (ran). Weights are ignored: `text/csv;q=0, application/json` is
  answered with the CSV (ran).
- **`/token/{token}` is paged to one pathway** (`pageSize=1&page=1`): the counts and the
  summary are the same, and the answer was 1 KB rather than 94 KB unpaged for 229
  pathways (ran).
- **A 404 from `found/…` is read as none found,** as today's book reads it, though it
  may mean the result went between `/token/{token}` and that call. **A later 410** (from
  `found/…` or the CSV), or a 404 from the CSV, means the result went while the PDF was
  being made: `gone-token` and `unknown-token` as for the first call, and no PDF. The analysis's own `includeDisease`, if shown, is read from an answer
  asked for without the parameter.
- pdf-export reads the analysis through the analysis service's API, at an address that
  is a setting. It is the same service, reading the same files by the same rules, and
  the render page reads it too, so a PDF's figures and its text agree.
- FR-007's wording ("from where the analysis service writes it") is amended to "through
  the analysis service that holds it".
- In tests, a non-production instance, or a stub of its answers.

**Alternatives considered.** A Kryo reader in TypeScript: tied to Java's internals.

## R7. How long, and how big: the baseline

**Measured** on 29 Oct 2026, on a private, read-only copy of release 98's graph on this
host. `event-pdf` was built at its pinned commit, with `reaction-exporter` 1.2.9's
snapshot in place of 1.2.8: only a Reactome-hosted repository serves 1.2.8, and the
figures are not what this baseline compares. The release's diagram files, EHLD files and
EHLD summary were fetched one at a time from the release's download directory, for the
human pathways that have a diagram: 2,780 files and 221 illustrations, 373 MB.

The EHLD summary named 221 pathways, and all 221 illustrations were fetched; the graph
counts 220 human pathways with a diagram of their own and an illustration (the table
below). The one more is a stable identifier the release's graph does not hold at all:
the summary still names an illustration whose pathway is gone. So the preflight lists
the files the figures need from the graph's events, and takes from the summary only
which of them are illustrations; a summary entry for an event the graph does not hold
is ignored, not a missing file.

- **The human book,** by `event-pdf`'s command line (`-Xmx6g`):

  | Measure              | Value                         |
  | -------------------- | ----------------------------- |
  | Wall time            | 1 h 18 min 41 s (4,721 s)     |
  | Peak resident memory | 4.7 GB                        |
  | Files                | 29, one per top-level pathway |
  | Pages                | 23,541                        |
  | Size                 | 1.42 GB                       |
  | Smallest file        | 44 pages, 1.1 MB              |
  | Largest file         | 3,760 pages, 383 MB           |
  - Two diagrams could not be inserted (an index error in the diagram exporter). The
    rest of the log is iText's licence notice, 33 times.
  - The figures are about half the size: the old exporters write raster images.

- **Single events at depth 1,** as the content service makes them, timed on the second
  of two runs in one JVM (the service's JVM is warm):

  | Event                                          | Pages  | Time         |
  | ---------------------------------------------- | ------ | ------------ |
  | Five reactions, one of each kind               | 3 each | 0.5–1.7 s    |
  | Pathways with 1–34 reactions beneath them      | 5–19   | 1.3–3.8 s    |
  | Pathways with 143–1,150 reactions beneath them | 10–15  | 4.4–9.5 s    |
  | Signal Transduction                            | 30     | 46 s (15 MB) |

  A cold JVM, as the command line starts, took 11–21 s for a reaction.

- **The figures the human book needs,** from the graph:

  | Kind                                                                | Count  |
  | ------------------------------------------------------------------- | ------ |
  | Pathways with a diagram of their own                                | 1,390  |
  | of which illustrations (EHLD)                                       | 220    |
  | Pathways drawn in their nearest ancestor's diagram, events selected | 1,499  |
  | of which that ancestor has an EHLD                                  | 0      |
  | Reactions                                                           | 16,424 |
  | In all                                                              | 19,313 |

  None of release 98's human pathways needs an ancestor's illustration with events
  selected, which the render service cannot draw (R10). That gap does not touch the human
  book at this release; the book's check would find it if it ever does.

- **Overlays on reactions:** `event-pdf` overlays the analysis on a reaction's figure too
  (`Diagrams.insertReaction` passes the result to the diagram exporter). So the render
  service's reaction drawing needs its overlay (R10) before the website's PDF matches
  today's with an analysis.

**What this sets.**

- **SC-003:** the book in no more than 1 h 18 min on this host, against this baseline.
  SC-003 compares on the same machine: if the release's book is made on another, the
  baseline is run again there, and its time is the budget.
- **SC-005:** each single-event PDF in no more time than these, warm. Measured with the
  render service's cache off: a cached figure is not a measurement (constitution V).
  - **The risk:** a figure alone takes 2.2–5.0 s through the service (R3: reactions
    2.6 s, illustrations 2.2–2.4 s, diagrams 3.4–5.0 s, selections 4.1 s), and a pathway
    at depth 1 has a figure for itself and for each child, two drawn at once, which R3
    measured at 1.65 times one, not twice. A pathway with five children (six figures)
    would take about 8–18 s in figures alone (inference), against `event-pdf`'s
    1.3–9.5 s. A reaction's one figure (2.6 s) is over its 0.5–1.7 s.
  - **A budget per stage,** for a pathway at depth 1 with n figures: reading the graph
    0.3 s; figures n × 2.2–5.0 s, divided by 1.65 at two at once; the first print 0.7 s; the
    contents' second print 0.7 s; the analysis, with a token, 0.5 s.
  - **The answers, in order:** the figures asked in parallel within the service's
    limits; many figures per page load (R10). The website's render cache helps readers
    in service, but SC-005 is measured cold, so it is no answer to the criterion.
  - If the measurement still exceeds `event-pdf`'s times, SC-005 is amended with the
    user, with the numbers.
  - **Measured (T007), 2 Nov 2026:** each event of the baseline's sample at depth 1, in
    a render service of its own (the website's image at its website settings, two at
    once; a fresh `RENDER_CACHE_KEY`; the release's files read locally through
    `RENDER_FILES`; its browser warmed on a reaction under Digestion and absorption,
    R-HSA-8878787, which no sampled event draws, the warm-up's 200 checked), on this
    host, by pdf-export's own code: the graph read and model, the figures two at once,
    the layout, and the print with the contents' second pass. No figure came from a
    cache (each output records the service's hit count across its run: 0) and none was
    missing. Outputs in `ci/measure/results/2026-11-02/single/`: `events.jsonl`, one
    line per event, each from its own run of the script, with the render service's
    `build`, the warm-up and the hit count added; `token.json`, the token runs, from a
    container of their own, likewise. An earlier run (`events-unwarmed.jsonl`), whose
    warm-up asked for a pathway as a reaction and was refused unchecked, gave totals
    within 2.2 s of these (R-HSA-68875, 15.99 s then, 18.14 s now; the warmed run was
    the slower one on its three widest differences). The per-event containers, the
    warm-up and its status check, and the hit counts were done by a wrapper outside the
    repository; the outputs record the warm-up's event and the hit count, not its
    status.

    | Event                                | Figures | Pages | Graph (s) | Figures (s) | Print (s) | Total (s) | `event-pdf` (s) |
    | ------------------------------------ | ------- | ----- | --------- | ----------- | --------- | --------- | --------------- |
    | Five reactions                       | 1 each  | 3–6   | 0.1       | 2.3–3.0     | 0.3–0.4   | 3.9–4.9   | 0.5–1.7         |
    | Pathways, 1–34 reactions beneath (6) | 2–13    | 6–28  | 0.1–0.2   | 5.1–18.6    | 1.0–2.3   | 7.4–21.5  | 1.3–3.8         |
    | Pathways, 143–1,150 beneath (4)      | 5–9     | 13–26 | 0.1–0.2   | 10.6–20.7   | 2.3–3.3   | 14.2–25.3 | 4.4–9.5         |
    | Signal Transduction (2,589 beneath)  | 18      | 36    | 0.2       | 26.7        | 5.2       | 33.2      | 46              |
    - **The layout** took about 1 s in each, the first layout of a process (its styles
      and fonts compiled once). In one process over all sixteen (`one-process.json`, an
      earlier run whose render cache served 5 of its 104 figures, which does not touch
      the layout; its page counts, from an earlier count, are superseded) it took
      0.0–0.1 s after the first, so a running service pays it once. The totals above
      include it.
    - **Figures alone exceed `event-pdf`'s whole time** for every reaction and every
      pathway but Signal Transduction, which is faster (33.2 s against 46 s): in each
      group the fastest figures (2.3, 5.1 and 10.6 s) are over the group's slowest
      `event-pdf` time (1.7, 3.8 and 9.5 s). R7's `event-pdf` times are ranges per group,
      not per event, so the comparison is per group. At two at once a pathway's figures
      take about 1.8 s each (1.3–2.6 s per pathway).
    - **One figure with an analysis token** (T005's (c), cold, at the website settings; a
      plain diagram, the only kind with an overlay today, T042): 4.6 s alone; 5.6 s for
      the slower of two at once; 9.3 s for the last of four; 18.7 s for the last of
      eight, each later pair waiting for the service's two slots. None was refused (the
      queue is 8). A plain diagram took about 3.4 s alone without a token in T005, a
      run that fetched its files from the public site: not like for like, so a token's
      cost is not measured here; T023 measures it.
    - So SC-005 cannot be met as written by drawing figures on request; raised with the
      user, with these numbers (T007), who left the choice to us.
    - **Decided:** a PDF without an analysis, of an event the release's figures' folder
      holds (the human book's, SC-010), reads its figures from it and must keep
      `event-pdf`'s times. What is left without drawing (graph 0.1–0.2 s; layout, 0.0–0.1
      s in a running service; print 0.3–5.2 s) is under `event-pdf`'s ranges for the
      larger groups and overlaps them for the small pathways (about 1.0–2.4 s in
      `one-process.json` against 1.3–3.8 s), before reading and inlining the folder's
      files; per event, to be measured in T023. A PDF with an analysis cannot use the folder, its figures
      carrying the analysis, nor can one of another species, whose figures the folder
      lacks: their figures are drawn on request, within 8 s plus 3 s per figure. Every
      event above meets it with room: the tightest by margin is R-HSA-68881 (8.3 s against
      14 s, 5.7 s to spare), by share R-HSA-73857 (25.3 s against 35 s); against
      run-to-run variation of up to 2.2 s between the two runs, and a token's cost, which
      T023 measures.
- **Figures:** 19,313 for the book. From R3's times (inference): about 7.4–7.7 hours
  through the render service as it is, at its concurrency of 2, and about 1.3–1.5 hours
  with four reused pages if four pages ran four times as fast, which they do not, still
  over SC-003's whole budget.
- **A budget per stage,** within SC-003's 78 minutes on this host:

  | Stage                                          | Budget | Why                                                                                                              |
  | ---------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------- |
  | Figures                                        | 44 min | the largest; may overlap the graph reads and printing                                                            |
  | Reading the graph                              | 4 min  | batched queries, one per level and part                                                                          |
  | Printing the parts                             | 13 min | about 11 ms a page four at once (18 ms one at a time) in the synthetic test; real figures are heavier            |
  | Join, links, outline, page numbers and headers | 6 min  | 6 s for 4,930 synthetic pages, scaled, with room                                                                 |
  | The contents' second pass                      | 2 min  | each PDF's front part only                                                                                       |
  | `check-book`                                   | 9 min  | 84 s for 4,930 pages scales to 6.7 min for 23,541 (inference), before the graph and text checks; 2 min of margin |

  The stages sum to 78 minutes, the whole of SC-003's budget, with no margin of their
  own; the figures gave a minute and printing a minute to `check-book`'s margin.
  **Since T006** the figures are drawn before the book (SC-010), and the book's figures
  stage is reading and inlining 19,313 files, which T031 measures; its 44 minutes are now
  margin, not a drawing budget.

- **Go or no-go, first:** the first task measures the render service's throughput at the
  book's scale, on the machine the release would use, with its concurrency raised and
  its pages reused. 44 minutes for 19,313 figures is about 7.3 figures a second: at
  R3's reused-page times that is 7–8 pages at once if they scaled linearly, and two at
  once gave only 1.65 times one. **On the plan's own data a no-go is likely.** If the
  figures cannot be drawn within 44 minutes, before any of the book's code is written past
  the foundations, the routes are, in order:
  1. **many figures per page load,** through an in-page API on the render page
     (WebsiteAngular, R10), which saves the page loads that dominate a reaction's time.
     This is the realistic route;
  2. SC-003 amended with the release's owners, with the measurement.

  A shared figure cache is not a route for the book: at release time the website has not
  yet drawn the new release, so it would hold little, and the drawing run turns the cache
  off so every figure is drawn from the release's data (contracts/render.md). More render
  workers on the same machine compete with printing for its cores, so they are a lever
  only within the 44 minutes, not a way past them.

- **Measured (T005), 2 Nov 2026:** a no-go. On this host (8 cores), a private render
  service per run (the website's image, cold, with a fresh `RENDER_CACHE_KEY`), on a
  private copy of release 98's graph, drawing a seeded sample in the book's mix through
  pdf-export's own client (`ci/measure/throughput.ts`):

  | `RENDER_CONCURRENCY` and the client's `--parallel` | Figures | Figures a second | The book's 19,313 | Render container's CPU, mean (cores) | Core-seconds a figure | Peak memory |
  | -------------------------------------------------- | ------- | ---------------- | ----------------- | ------------------------------------ | --------------------- | ----------- |
  | 1                                                  | 100     | 0.394            | 13 h 37 min       | 1.37                                 | 3.5                   | 0.7 GB      |
  | 2                                                  | 200     | 0.712            | 7 h 32 min        | 2.86                                 | 4.0                   | 0.7 GB      |
  | 4                                                  | 200     | 1.166            | 4 h 36 min        | 5.13                                 | 4.4                   | 1.2 GB      |
  | 8                                                  | 200     | 1.523            | 3 h 31 min        | 6.96 (7.7 at peak)                   | 4.6                   | 1.9 GB      |
  - **The diagrams' files came from the public download site:** before WebsiteAngular
    #777, the render page fetched a diagram's and an illustration's files there, so
    these runs did too (about 430 requests, up to 8 at once) and their pathway times
    include those fetches. Reactions fetch no such files. From T007 on, every run reads
    the release's files from a local folder (`RENDER_FILES`).
  - Every figure asked was drawn. One at a time a reaction took 2.3 s (median), a
    diagram 3.4 s and a selection 3.7 s; at 8 at once a reaction took 4.6 s and a
    selection 8.7 s. Medians and p90s are lower-rank quantiles.
  - The container's CPU is sampled every 5 s by `docker stats`, asynchronously, so the
    sampling does not stall the client. (A first pilot, sampling synchronously and
    choosing a selection's ancestor differently from the book, gave 1.41 a second at 8;
    the numbers above replace it.)
  - **The limit is the machine's processors:** a figure costs 3.5–4.6 seconds of a core
    in the render container alone (mean CPU ÷ figures a second), rising with concurrency;
    the content service, the graph and the client share the host uncounted. So all 8
    cores would give at most about 1.7–2.3 figures a second (inference), against the 7.3
    needed. The runs' outputs are in `ci/measure/results/2026-11-02/`, written before the script
    recorded the release, species, seed (98, Homo sapiens, 98 for all four) and the render
    service's `build`.
  - **Not run, and why:** the samples are 100–200 figures, not the 2,000 T005 set; the
    gap to the threshold is close to fivefold at the best setting, and the cost per
    figure rises rather than falls with concurrency, so a larger sample would not turn
    it into a go (inference). Page reuse, (b), was not measured: how much of a figure's
    CPU is the page's load, which reuse would save, is unknown, and the route taken
    (below) takes the figures out of the book's run, where reuse or many figures per page
    load would shorten the figures' own step instead. One figure on request, (c), is
    measured with T007.

- **The route taken (T006), the user's choice, 2 Nov 2026:** a third route, **the figures
  drawn in a step of their own, before the book.** `pdf-export figures` draws every figure
  the book needs, through the render service, into a folder; `book` reads them from it
  and needs no render service (contracts/cli.md, contracts/figures.md).
  - SC-003 is the book's time from figures already drawn; the figures' step has its own
    criterion, SC-010. At the rate above the step takes about 3.5 hours on this host
    (inference), so it needs a larger machine, several machines each drawing a share (inference: each share would be a folder of its own, with its own fingerprint, and the book would need to read several; not specified now), or
    many figures per page load (route 1, still wanted, T042) to come down.
  - This answers the shared cache's objection above: the step draws the new release
    from its own data, before the website serves it, and what it writes could (inference) fill the
    website's cache for the release.
  - The release's own diagram images today are the old look, and only pathways' diagrams
    and illustrations (1,390 of the book's figures, none of its reactions or selections),
    so they are no source for the new book.

- **To measure in the first tasks:** the render service's throughput (above); the
  diagrams' widths, from the release's diagram files, for FR-016's floor (R4); what the
  analysis service answers for an expired and a malformed token, and how long it keeps
  a result (R6; measured by T009); the join's memory and stamping (R4).

- **Parts:** the largest top-level pathway is 3,760 pages today. At about 200 pages a
  part (R4), its PDF is split at section boundaries and joined; the 29 PDFs are made
  several at a time, so the joins overlap the printing.

## R8. The checks: by meaning, with tools under loose licences

**Measured.** pdfjs-dist (Apache-2.0) reads what the checks need:

- each piece of text, with the font it is drawn in;
- the structure tree of a tagged PDF;
- the outline;
- every link and its target: the 4,930-page test book's 21,375 links and 7,126
  bookmarks were checked in 84 s;
- fill and stroke colours, from operator lists.

Marked content does not separate figures from layout. Printing the same HTML with the
figures hidden gives the same pages, and only the layout's colours: `#006781`,
`#001f25` and `#ffffff` in the test, each a theme colour. pdf-lib shows which fonts are
embedded.

**Decision.**

- **FR-011's check** (`check-book`) reads the book with pdfjs. The book is untagged
  (R4), so it finds the sections by the outline pdf-export wrote and the text at each
  outline entry's destination, not by a structure tree. It checks every top-level
  pathway present, every event in the contents and the bookmarks, every section named
  and every section with its stable identifier (two faults), every figure present where
  its source exists, and every link landing on a page. Each fault is seen to fail once
  (SC-007). The release's files are checked before printing, by `book`'s preflight
  (contracts/cli.md).
- **SC-008's figure comparison** draws both by the same means, as SC-008 asks: the
  render service's SVG is printed alone by the same Chromium to a one-page PDF at the
  figure's size on the page, on a page with the same `@font-face` rules as the book's
  (the image has no fallback font, so without them its text would be lost), and both that and the book's page are rasterised by pdf.js
  inside that Chromium, at the same scale, the book's cropped to the figure's box. No
  more than 1% of pixels may differ. Run on a sample, in development.
- **FR-012's comparison** (`compare`) reduces both sides to the parts FR-012 lists. Its
  reference may be a folder of today's files, as today's book is 29 of them, compared
  with the new book's folder file by file, by top-level pathway.
  - It normalises the cover's hidden characters and white space.
  - It treats list order as a recorded difference.
  - It prints counts and hashes of names, never names (FR-013).
  - It is run in development against `event-pdf`'s output, never in the release.
- **SC-009's check** prints a sample with figures hidden, takes it through the same join
  and stamping as the book, and compares every colour on the result's own pages with the
  compiled theme and every font with FR-015's, so the stamped page numbers and headers
  are checked too.

**Alternatives considered.** Poppler's or MuPDF's tools: GPL and AGPL, so not
dependencies, though a person may use them to look.

## R9. Shape: one package, a command line and a service

**Decision.**

- **One TypeScript package, two entry points:**
  - `pdf-export figures`, the release's first command: graph, files and render service
    in, the figures' folder out (R7's route, contracts/figures.md);
  - `pdf-export book`, the release's command line: graph, files, the figures' folder and
    output folder in, the `TheReactomeBook` folder of PDFs and a run report out;
  - `pdf-export serve`, an HTTP service for the website: `GET /event/{stId}.pdf` with
    depth and token, answering a PDF or the errors of Story 2's scenario 4. Its bind
    address is a setting, loopback by default: in its own container it binds where its
    two callers can reach it, the content service (these PDFs) and the analysis gateway
    (spec 002's reports, served by the same process), and nothing else can.
- **The website's address** for FR-003's links to its pages is a setting (`--site`),
  written into the links and never fetched.
- **WebsiteAngular's content service calls it** as it calls the Java library service
  for SBML. The website's part (routes, parameters, envelope, caching) is in
  WebsiteAngular's specs (FR-014).
- **One container image,** for both.
- **CI:** type checks, lint, the unit tests, a fixture graph (a Neo4j service seeded
  from a placeholder fixture, with no real names, as BioPAX3Exporter's CI does), the
  render service stubbed with recorded SVGs, the licence check and Prettier.

**Alternatives considered.** A library that WebsiteAngular's content service imports:
it would bring Chromium into that service's image, and the release would need a second
packaging.

## R10. What WebsiteAngular must change (its own specs)

- **The plain diagram on demand.** A render option to draw an ancestor's diagram, not
  its EHLD, with events selected. Release 98's human book needs none (R7), so this
  waits until a release does. Until then such a figure would be the ancestor's EHLD
  without a selection, recorded as a difference.
- **An overlay on a reaction's drawing:** `event-pdf` overlays reactions today (R7), so
  the website's PDF with an analysis needs it.
- **The render service's limits as settings** for a batch run (R3).
- **The release's files from a local folder** (`RENDER_FILES`, WebsiteAngular #777): the
  render page otherwise fetches diagram and EHLD files from the public download site,
  which holds a release's files only once it is published.
- **Many figures per page load,** an in-page API on the render page: R7's go/no-go was a
  no-go, and the figures moved to a step of their own; this would shorten that step.
- **The render service's health answer naming what draws:** the build of the website's
  page it loads, and its content service's release and `DBInfo` checksum, so the
  figures' folder's fingerprint (contracts/figures.md) need not trust the operator; and a
  header on each drawing naming both, so each figure records what drew it.
- **The single-event route** in the content service, nginx and the dev proxy (FR-014).
- **Later:** a render bundle without FoamTree, which would let pdf-export draw figures
  in its own process.

## R11. Licences, checked in CI

**Measured.**

- `npm query '*'` lists every installed package with its licence and whether it is for
  development only, in 0.6 s.
- `license-checker-rseidelsohn` stops at its first offender, and its own dependencies
  bring in CC-BY-3.0.

**Decision.** A short check of our own, `ci/licences.ts`:

- an allowlist (MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0, ISC, 0BSD, OFL-1.1,
  CC0-1.0, Zlib, and BlueOak-1.0.0, permissive like MIT, which one of the lint tools' dependencies uses);
- SPDX expressions, such as pako's `(MIT AND Zlib)`;
- one documented exception: the website's theme package, CC0 by its repository;
- every offender listed, not only the first;
- the fonts' licence files checked too (FR-009).

It is shown failing on a GPL package and on a package with no licence (SC-006).
