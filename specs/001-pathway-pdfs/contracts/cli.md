# Contract: the command line

One executable, `pdf-export`, with six commands. Settings come from flags or from the
environment variables named beside them. A password never goes on the command line.

## `pdf-export figures`

Draws every figure the book needs, before the book, into a folder (SC-010, research R7,
contracts/figures.md).

| Flag                                 | Environment       | Meaning                                                                                                                                                              |
| ------------------------------------ | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--graph`, `--database`, `--species` |                   | as for `book`                                                                                                                                                        |
| `--files`                            |                   | as for `book`: the EHLD summary decides the illustrations                                                                                                            |
| `--render`                           | `RENDER_SERVICE`  | the render service's base URL (contracts/render.md)                                                                                                                  |
| `--content`                          | `CONTENT_SERVICE` | the content service the render service draws from, asked only `GET /data/database/version` (contracts/figures.md)                                                    |
| `--out`                              |                   | the folder written (contracts/figures.md)                                                                                                                            |
| `--parallel`                         |                   | figures asked at once; default 2, the service's own default; set it to the service's `RENDER_CONCURRENCY`                                                            |
| `--timeout`                          |                   | seconds the client waits for each attempt at a figure, and for each health or release read; default 60; above the render service's own timeout (contracts/render.md) |
| `--report`                           |                   | where its run report is written, as JSON; a file there already is refused (exit 2)                                                                                   |

- **Which figures:** the events' Figure rules (data-model.md), from the graph and the
  EHLD summary, the same code `book` uses, so the folder holds exactly what the book
  reads.
- **The preflight first:** the same release-file and character checks as `book`'s
  preflight, before anything is drawn, so a missing file or an uncovered character fails
  in minutes, not after hours of drawing; and the label check after each figure is drawn.
- **The same release, checked first:** the content service named by `--content`
  must answer the graph's release (`GET /data/database/version`), the graph must carry a
  `DBInfo` checksum, and the render service's health answer a `build` other than
  `unknown` and `files: local` (contracts/render.md), or the run is refused before anything is drawn
  (exit 2). Both services are probed before the preflight, so one down is said at once, and
  read again after it for the folder's fingerprint; the preflight asks for no figure. What
  this cannot see is in contracts/figures.md.
- **One run, one folder:** `--out` must be empty or absent (exit 2 otherwise); a
  stopped run is not resumed. The manifest (contracts/figures.md) records the folder's
  fingerprint and what each file draws.
- **Exit 0:** every figure is in the folder. **Exit 1:** a preflight fault
  (`missing-file`, `uncovered-character`, `bad-file`), a label fault after drawing, or a figure that
  could not be drawn, each named by stable identifier or file name. **Exit 2:** bad
  arguments; a `--report` file that exists already (the earlier run's report kept, and none
  written); the render or content service unreachable at the start; another release
  at `--content`; no graph checksum, no render `build`, or a render service not reading local files; or an `--out` that is not
  empty. A `build` or content release that changes during the run, a render or content
  service that stops answering, or the breaker, is exit 1 (contracts/figures.md).
  Any other error (the graph failing during the checks, a file that cannot be written) is
  exit 2, its error on stderr, the figures' own faults so far printed, the run stopped and
  its report written. The report is written however the run ends but two: a signal, and a
  `--report` refused; one that cannot be written is said on stderr, and the run keeps its
  exit. The output's lines and the report are in contracts/figures.md.

## `pdf-export book`

Writes the release's book (Story 1), one PDF per top-level pathway into a folder, from
the figures already drawn by `figures`.

| Flag         | Environment                    | Meaning                                                                            |
| ------------ | ------------------------------ | ---------------------------------------------------------------------------------- |
| `--graph`    | `NEO4J_URI`                    | Bolt address of the release's graph                                                |
|              | `NEO4J_USER`, `NEO4J_PASSWORD` | its credentials                                                                    |
| `--database` | `NEO4J_DATABASE`               | default `graph.db`                                                                 |
| `--figures`  |                                | the folder `figures` wrote (contracts/figures.md); the book asks no render service |
| `--files`    |                                | the release's folder: `diagram/`, `ehld/` and the EHLD summary                     |
| `--site`     | `REACTOME_SITE`                | the website's address, for links to its pages; never fetched                       |
| `--species`  |                                | default `Homo sapiens` (spec: the book's scope)                                    |
| `--out`      |                                | the folder written; default `TheReactomeBook`                                      |
| `--parallel` |                                | parts printed and PDFs joined at once, largest PDFs first; default 4, at most 64   |
| `--joins`    |                                | of those, PDFs joined at once; default 1, at most `--parallel` (R4: T031 settles)  |
| `--report`   |                                | where the run report (data-model.md) is written, as JSON, however the run ends     |

- **The preflight,** before anything is printed (and the character check's second half,
  on reading each figure, below): from the graph and the EHLD summary it
  lists the release's files the figures need (the events from the graph; which are
  illustrations from the summary, ignoring an entry for an event the graph does not
  hold) and the figures' files in `--figures`, and a file missing is a fault
  `missing-file <name>`. The folder must pass the checks contracts/figures.md lists under
  "What `book` checks": `incomplete-folder`, `no-checksum`, `stale-folder`,
  `stale-summary` and `stale-figure <stId>`. A diagram file that cannot be read as JSON is
  a fault `bad-file <name>`. A top-level pathway's name a file cannot
  hold, or two equal ignoring case, is a fault `bad-file-name <stId>` (data-model Book).
  Any of these ends the step with exit 1 and no book written (Story 5,
  scenario 3). A character no font covers, after FR-017's substitutions, is a fault
  `uncovered-character <code point> <stId>` (research R5, Story 5 scenario 4), checked
  twice:
  - **before any figure is read** (and by `figures`, before any is drawn), in the graph's texts the layout writes, in the names
    the figures label (every physical entity a reaction's figure draws: its inputs,
    outputs, catalysts and regulators; and their compartments, from the graph), and in
    the labels of the diagram files the Figure rules choose to draw (the `displayName`s
    of their nodes, compartments, notes, shadows and links, and the `label`s of their
    nodes' attachments, a modification's lettering) (`--files`; today an
    illustrated pathway's file is not among them, its figure being its EHLD, data-model
    Figure); a fault in a text names the event whose section holds it, one in a
    figure's names the first event in document order whose figure holds it, and one in
    a diagram file the pathway whose diagram it is. A character in several places is one
    fault per place;
  - **on reading each figure, before its part is printed** (and by `figures`, after
    each is drawn; in `book` a backstop for a folder changed by hand), in the text of its SVG's labels, a fault naming the figure's event: the backstop for anything the first
    check's sources did not hold. The book is printed in parts (research R4), so a fault
    here can come after earlier parts or PDFs are printed; the step still ends with exit
    1 and no book written, the folder being moved into place only at the end.
- **Exit 0:** the book is written, and `check-book` passed on it. The folder is written
  beside its name, checked there (`check-book`'s checks, on the documents the preflight
  built, the printer closed first), and moved into place only once they pass, so a failed
  run never leaves a partial book or one that fails its check. A run is whole: a failure in
  any PDF writes none, and the step is run again.
- **Exit 1:** a fault from the preflight or FR-011, each printed as `check-book` prints it.
  The report names each one by stable identifier or file name, never a person, and gives
  each FR-011 check with its count of faults.
- **Exit 2:** bad arguments; a `--report` that exists already (left untouched, and no
  report written), whose folder cannot be made, or that is inside `--out`; an `--out` that
  is not absent or empty, as for `figures` (an old book is never replaced in place), that
  cannot be read, whose folder cannot be written, or that is a symbolic link, on another
  device than its folder or a mount point (the finished book cannot be moved onto it); the
  graph cannot be reached at the start; any other error during the preflight, as
  `preflight` exits on one (below); or any other error while the book is printed (a
  print or a join that fails, or a PDF refused at its contents, links, outline or
  stamps), after printing the faults found before it. A refused PDF is never saved, and
  no other PDF of the run is kept: no book is written.
- **A signal** (SIGINT, SIGTERM, SIGHUP) stops the run at once, from its start: no book
  or temporary folder is left, the report is written naming the signal, and the exit is
  128 and the signal's number. It exits rather than raising the signal again, as the
  exit handlers that end the browser and remove its folders run only on an exit. A
  signal while the browser is starting is acted on once it has started, and a second
  signal then stops the run at once. Once the book is checked and moved into place, a
  signal stops nothing that is not done: the book is left in place, the report says it
  was written (outcome `written`) and names the signal, and the exit is 0.
- **A private temporary folder:** the run makes one in TMPDIR at its start and points
  everything it starts at it (the printer's pages, the browser launcher's folders and the
  browser itself, by TMPDIR), and removes it, whole, as the process exits, after the
  launcher has ended the browser; so SIGINT, SIGTERM or SIGHUP at any moment leaves nothing
  in TMPDIR (SIGKILL, or the memory cap's kill, leaves it). One is live in a process at a
  time, as TMPDIR is the process's: a second is refused. The browser launcher's own signal
  handling is off, as in `serve`.

## `pdf-export preflight`

`book`'s preflight alone (T024), with `book`'s `--graph`, `--database`, `--files`,
`--figures` (both required) and `--species`, so a release's inputs and figures' folder can
be checked before the book is made. It prints one line per fault, `fault <fault>`, in the
forms above (`missing-file <name>`, `incomplete-folder`, `no-checksum`,
`stale-folder <folder's release>/<checksum> <graph's release>/<checksum>`, `stale-summary`,
`stale-figure <stId>`, `bad-file-name <stId>`, `uncovered-character <code point> <stId>`,
and `bad-file <name>` for a diagram file that cannot be read as JSON, whose labels are then
not checked),
each naming a stable identifier or a file, never a text or a person. A release file is named
as in `--files` (`diagram/R-HSA-….json`), a figure's as in `--figures` (`R-HSA-….svg`).

- **Exit 0:** no fault. **Exit 1:** at least one. **Exit 2:** bad arguments; the graph
  cannot be reached at the start, or its address cannot be parsed (said within seconds:
  that first read's retrying is bounded, the rest keep the driver's own); or any other
  error during the checks (a graph that fails mid-run): the faults found before it are
  printed first, then the error on stderr. The faults are kept check by check: those of
  the check the error stopped are lost. Exit 1 always means faults, never an error.
- A folder that is not whole, or not this graph's release or summary's, is refused as a
  whole: its figures are then not checked one by one.
- Without the EHLD summary the Figure rules cannot be followed: the one fault is
  `missing-file ehld/svgsummary.txt`.

## `pdf-export check-book <folder>`

FR-011's check, alone. Also run by `book`.

| Flag                                 | Meaning                                                                                                                                      |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `--graph`, `--database`, `--species` | as for `book`: the graph the book was made from, for the list of top-level pathways and events expected                                      |
| `--files`                            | the release's folder: its EHLD summary, for the Figure rules, as `book` reads it, and which events have a figure's source (FR-011); required |

- **Exit 0:** every check passed.
- **Exit 2:** bad arguments (one folder, `--files`, and a graph are needed); a folder that is
  not one; no EHLD summary in `--files`; the graph cannot be reached at the start; or any
  other error (a PDF that cannot be read, a graph that fails mid-run), on stderr.
- **Exit 1:** at least one fault, one line each:
  - `fault missing-pathway <stId>`: a top-level pathway with no PDF;
  - `fault extra-file "<file name>"`: a PDF in the folder that is no top-level pathway's;
  - `fault <kind> "<file name>" <stId>` for the rest (the file name quoted as a JSON
    string, as names hold spaces), naming the PDF, as an event under two
    top-level pathways is in both: `not-in-contents`, `not-in-outline`, `no-name`,
    `no-stable-id`, `missing-figure` and `broken-link`.

  A file is matched to its top-level pathway by name: the names expected are made from
  the graph as `book` makes them, and any other file or folder in the folder is an
  `extra-file`. The PDFs are untagged, so they are read with pdf.js for their outline, links
  and text (research R8), each event's printed texts after FR-017's substitutions:
  - names are compared as read back: compatibility forms folded (NFKC), white space and the
    characters never drawn (FR-017's controls and default-ignorables: a soft hyphen, a
    joiner, a variation selector) left out;
  - a **section** is found at its heading's link to the event's page on the website (the
    first link there; a reaction's figure links there too, below it), where an outline or
    contents entry with its name lands too; or else where such an entry lands whose section
    gives the event's stable identifier first (two events of one name), or the first such
    entry; or else at that link. It runs to the next section found;
  - the **contents list's entries** are the links before the first section (where the first
    outline entry with an event's name lands), each one annotation, its rectangle around
    every line of an entry that wraps;
  - `not-in-contents`: no contents entry lands on the section and reads its name;
    `not-in-outline`: no outline entry, at any depth, does both; an event whose section is
    not found at all is these two faults and `no-name`;
  - `no-name`: the section's heading does not read its name. The heading is its leading
    text set larger than the section's own body text by at least 15:14, the ratio of
    11.25 pt to the body's 10.5 (the smallest heading is 12 pt). The body text is the
    section's `Stable identifier` label, which every section prints; for a section without
    it, the size most of its page's characters are set at, leaving out the text inside a
    figure's link (a diagram's labels). Measured against the section, not in points, so a
    part Chromium printed scaled down still reads its names, its scale not a fault: the
    layout keeps realistic content inside the text column (long tokens may break, a table's
    columns narrow to their longest words), but a table of very many columns can still be
    wider; `no-stable-id`: its text holds no `Stable identifier` followed by its stable
    identifier;
  - `missing-figure`: a pathway's or reaction's section with a figure by the Figure rules,
    whose source is in `--files` (its diagram's two files, its EHLD; a reaction's is the
    graph), has no link to that figure's interactive form below its heading. The figure is
    known by its link: a drawing lost with its link kept is not seen;
  - `broken-link`: a link that lands on no page of its PDF, is still a placeholder or probe
    address (T026), or whose address to an event's page cannot be decoded, named by the
    section it is in, or by the PDF's pathway for one in its front parts, one line a
    section.

## `pdf-export compare <reference> <new>`

FR-012's comparison, for development only; it is never run by the release. The reference
is a PDF, or a folder of today's PDFs, as today's book is one file per top-level
pathway, and the new side likewise; a folder is compared file by file, by top-level
pathway, and a file on one side only is reported as a difference.

- **Output:** a JSON report of the differences by part and kind, with counts. Names
  appear only as counts and hashes (FR-013).
- **`--expected <file>`:** the recorded differences. With it, the exit is 1 only for a
  difference not recorded.

## `pdf-export serve`

The single-event service (contracts/service.md).

| Flag                           | Environment        | Meaning                                                                                                                                                           |
| ------------------------------ | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--port`                       | `PORT`             | default 4370                                                                                                                                                      |
| `--bind`                       | `BIND_ADDRESS`     | default `127.0.0.1`; in its own container, an address only the content service and the analysis gateway (spec 002) can reach                                      |
| `--graph`, `--files`, `--site` |                    | as for `book`                                                                                                                                                     |
| `--figures`                    |                    | as for `book`: the release's figures' folder, read for a PDF without an analysis while it passes `book`'s folder checks, ignored otherwise (contracts/service.md) |
| `--render`                     | `RENDER_SERVICE`   | as for `figures`: draws the figures of a PDF with an analysis, and any the folder lacks                                                                           |
| `--analysis`                   | `ANALYSIS_SERVICE` | the analysis service's base URL                                                                                                                                   |
| `--concurrency`                |                    | PDFs made at once; default 2                                                                                                                                      |

- **Signals:** the handlers are set before the service starts. The first SIGINT, SIGTERM or
  SIGHUP once it serves closes it and exits 0; one before it serves, or another while it
  closes, exits at once with 128 and the signal's number. Like `book`, it makes a private
  temporary folder at its start for the printer and the browsers it starts, removed as
  the process exits, so it leaves nothing in TMPDIR when it is stopped by SIGINT, SIGTERM
  or SIGHUP. A process killed outright (SIGKILL, the memory cap's kill) or by a signal it
  does not handle leaves the folder, as no exit handler runs.
