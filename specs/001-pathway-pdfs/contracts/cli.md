# Contract: the command line

One executable, `pdf-export`, with five commands. Settings come from flags or from the
environment variables named beside them. A password never goes on the command line.

## `pdf-export figures`

Draws every figure the book needs, before the book, into a folder (SC-010, research R7,
contracts/figures.md).

| Flag                                 | Environment      | Meaning                                                   |
| ------------------------------------ | ---------------- | --------------------------------------------------------- |
| `--graph`, `--database`, `--species` |                  | as for `book`                                             |
| `--files`                            |                  | as for `book`: the EHLD summary decides the illustrations |
| `--render`                           | `RENDER_SERVICE` | the render service's base URL (contracts/render.md)       |
| `--out`                              |                  | the folder written (contracts/figures.md)                 |
| `--parallel`                         |                  | figures asked at once; default the service's limit        |
| `--report`                           |                  | where its run report is written, as JSON                  |

- **Which figures:** the events' Figure rules (data-model.md), from the graph and the
  EHLD summary, the same code `book` uses, so the folder holds exactly what the book
  reads.
- **The preflight first:** the same release-file and character checks as `book`'s
  preflight, before anything is drawn, so a missing file or an uncovered character fails
  in minutes, not after hours of drawing; and the label check after each figure is drawn.
- **The manifest** (contracts/figures.md) ties the folder to its release and records what
  each file draws. A folder whose manifest names another release is refused (exit 2).
- **Resumable:** a figure whose file is already in the folder, and whose manifest entry
  matches what the Figure rules now choose, is not drawn again; one that differs is drawn
  again. Each file is written beside its name and moved into place, so a stopped run
  leaves only whole files.
- **Exit 0:** every figure is in the folder. **Exit 1:** a figure could not be drawn
  (named by stable identifier). **Exit 2:** bad arguments, or the service unreachable at
  the start.

## `pdf-export book`

Writes the release's book (Story 1), from the figures already drawn by `figures`.

| Flag         | Environment                    | Meaning                                                                            |
| ------------ | ------------------------------ | ---------------------------------------------------------------------------------- |
| `--graph`    | `NEO4J_URI`                    | Bolt address of the release's graph                                                |
|              | `NEO4J_USER`, `NEO4J_PASSWORD` | its credentials                                                                    |
| `--database` | `NEO4J_DATABASE`               | default `graph.db`                                                                 |
| `--figures`  |                                | the folder `figures` wrote (contracts/figures.md); the book asks no render service |
| `--files`    |                                | the release's folder: `diagram/`, `ehld/` and the EHLD summary                     |
| `--site`     | `REACTOME_SITE`                | the website's address, for links to its pages; never fetched                       |
| `--species`  |                                | default `Homo sapiens` (spec: the book's scope)                                    |
| `--out`      |                                | the output path; default `TheReactomeBook.pdf`                                     |
| `--parallel` |                                | parts printed at once; default 4                                                   |
| `--report`   |                                | where the run report (data-model.md) is written, as JSON                           |

- **The preflight,** before anything is printed (and the character check's second half,
  on reading each figure, below): from the graph and the EHLD summary it
  lists the release's files the figures need (the events from the graph; which are
  illustrations from the summary, ignoring an entry for an event the graph does not
  hold) and the figures' files in `--figures`, and a file missing is a fault
  `missing-file <name>`. The folder's manifest must name the graph's release and, for each
  figure, what the Figure rules choose now; a mismatch is a fault `stale-figure <stId>`
  (contracts/figures.md). Either fault ends the step with exit 1 and no book written (Story 5,
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
    each is drawn), in the text of its SVG's labels, a fault naming the figure's event: the backstop for anything the first
    check's sources did not hold. The book is printed in parts (research R4), so a fault
    here can come after earlier parts are printed; the step still ends with exit 1 and
    no book written, the file being moved into place only at the end.
- **Exit 0:** the book is written, and `check-book` passed on it. The file is written
  beside its name and moved into place, so a failed run never leaves a partial book.
- **Exit 1:** a fault from the preflight or FR-011. The report names each one by stable
  identifier or file name, never a person.
- **Exit 2:** bad arguments, or the graph cannot be reached at the start.

## `pdf-export check-book <file>`

FR-011's check, alone. Also run by `book`.

| Flag                   | Meaning                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `--graph`, `--species` | the graph the book was made from, for the list of top-level pathways and events expected |
| `--files`              | the release's folder, for which events have a figure's source (FR-011)                   |

- **Exit 0:** every check passed.
- **Exit 1:** at least one fault. Each is printed as `fault <kind> <stId>`. The kinds:
  `missing-pathway`, `not-in-contents`, `not-in-outline`, `no-name`, `no-stable-id`,
  `missing-figure` and `broken-link`. The book is untagged, so sections are found by
  the outline and the text at each entry's destination (research R8).

## `pdf-export compare <reference> <new.pdf>`

FR-012's comparison, for development only; it is never run by the release. The reference
is a PDF, or a folder of today's PDFs, as today's book is one file per top-level
pathway; their covers' distinct names are counted across the folder.

- **Output:** a JSON report of the differences by part and kind, with counts. Names
  appear only as counts and hashes (FR-013).
- **`--expected <file>`:** the recorded differences. With it, the exit is 1 only for a
  difference not recorded.

## `pdf-export serve`

The single-event service (contracts/service.md).

| Flag                           | Environment        | Meaning                                                                                                  |
| ------------------------------ | ------------------ | -------------------------------------------------------------------------------------------------------- |
| `--port`                       | `PORT`             | default 4370                                                                                             |
| `--bind`                       | `BIND_ADDRESS`     | default `127.0.0.1`; in its own container, an address the content service can reach                      |
| `--graph`, `--files`, `--site` |                    | as for `book`                                                                                            |
| `--render`                     | `RENDER_SERVICE`   | as for `figures`: the service draws a single-event PDF's figures as it is asked                          |
| `--analysis`                   | `ANALYSIS_SERVICE` | the analysis service's base URL                                                                          |
| `--retention`                  | `TOKEN_RETENTION`  | how long an analysis token is kept, in days; must match the analysis service's own setting (research R6) |
| `--concurrency`                |                    | PDFs made at once; default 2                                                                             |
