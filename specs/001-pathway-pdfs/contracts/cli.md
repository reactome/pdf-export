# Contract: the command line

One executable, `pdf-export`, with five commands. Settings come from flags or from the
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
| `--report`                           |                   | where its run report is written, as JSON                                                                                                                             |

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
  (exit 2). What this cannot see is in contracts/figures.md.
- **One run, one folder:** `--out` must be empty or absent (exit 2 otherwise); a
  stopped run is not resumed. The manifest (contracts/figures.md) records the folder's
  fingerprint and what each file draws.
- **Exit 0:** every figure is in the folder. **Exit 1:** a preflight fault
  (`missing-file`, `uncovered-character`), a label fault after drawing, or a figure that
  could not be drawn, each named by stable identifier or file name. **Exit 2:** bad
  arguments; the render or content service unreachable at the start; another release
  at `--content`; no graph checksum, no render `build`, or a render service not reading local files; or an `--out` that is not
  empty. A `build` or content release that changes during the run, a render or content
  service that stops answering, or the breaker, is exit 1 (contracts/figures.md).

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
| `--parallel` |                                | parts printed and PDFs joined at once, across the PDFs; default 4                  |
| `--report`   |                                | where the run report (data-model.md) is written, as JSON                           |

- **The preflight,** before anything is printed (and the character check's second half,
  on reading each figure, below): from the graph and the EHLD summary it
  lists the release's files the figures need (the events from the graph; which are
  illustrations from the summary, ignoring an entry for an event the graph does not
  hold) and the figures' files in `--figures`, and a file missing is a fault
  `missing-file <name>`. The folder must pass the checks contracts/figures.md lists under
  "What `book` checks": `incomplete-folder`, `no-checksum`, `stale-folder`,
  `stale-summary` and `stale-figure <stId>`. A top-level pathway's name a file cannot
  hold, or two equal ignoring case, is a fault `bad-file-name <stId>` (data-model Book).
  Any of these ends the step with exit 1 and no book written (Story 5,
  scenario 3). A character no font covers, after FR-017's substitutions, is a fault
  `uncovered-character <code point> <stId>` (research R5, Story 5 scenario 4), checked
  twice:
  - **before any figure is read** (and by `figures`, before any is drawn), in the graph's texts the layout writes, in the names
    the figures label (every physical entity a reaction's figure draws: its inputs,
    outputs, catalysts and regulators; and their compartments, from the graph), and in
    the labels of the diagram files the Figure rules choose to draw (`--files`; today an
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
  beside its name and moved into place, so a failed run never leaves a partial book. A
  run is whole: a failure in any PDF writes none, and the step is run again.
- **Exit 1:** a fault from the preflight or FR-011. The report names each one by stable
  identifier or file name, never a person.
- **Exit 2:** bad arguments; an `--out` that is not absent or empty, as for `figures`
  (an old book is never replaced in place); or the graph cannot be reached at the start.

## `pdf-export check-book <folder>`

FR-011's check, alone. Also run by `book`.

| Flag                   | Meaning                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `--graph`, `--species` | the graph the book was made from, for the list of top-level pathways and events expected |
| `--files`              | the release's folder, for which events have a figure's source (FR-011)                   |

- **Exit 0:** every check passed.
- **Exit 1:** at least one fault, one line each:
  - `fault missing-pathway <stId>`: a top-level pathway with no PDF;
  - `fault extra-file "<file name>"`: a PDF in the folder that is no top-level pathway's;
  - `fault <kind> "<file name>" <stId>` for the rest (the file name quoted as a JSON
    string, as names hold spaces), naming the PDF, as an event under two
    top-level pathways is in both: `not-in-contents`, `not-in-outline`, `no-name`,
    `no-stable-id`, `missing-figure` and `broken-link`.

  A file is matched to its top-level pathway by name: the names expected are made from
  the graph as `book` makes them. The PDFs are untagged, so sections are found by the
  outline and the text at each entry's destination (research R8).

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
