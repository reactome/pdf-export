# Contract: the command line

One executable, `pdf-export`, with four commands. Settings come from flags or from the
environment variables named beside them. A password never goes on the command line.

## `pdf-export book`

Writes the release's book (Story 1).

| Flag         | Environment                    | Meaning                                                                                              |
| ------------ | ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `--graph`    | `NEO4J_URI`                    | Bolt address of the release's graph                                                                  |
|              | `NEO4J_USER`, `NEO4J_PASSWORD` | its credentials                                                                                      |
| `--database` | `NEO4J_DATABASE`               | default `graph.db`                                                                                   |
| `--render`   | `RENDER_SERVICE`               | the render service's base URL (contracts/render.md)                                                  |
| `--files`    |                                | the release's folder: `diagram/`, `ehld/` and the EHLD summary, as the render service reads them too |
| `--site`     | `REACTOME_SITE`                | the website's address, for links to its pages; never fetched                                         |
| `--species`  |                                | default `Homo sapiens` (spec: the book's scope)                                                      |
| `--out`      |                                | the output path; default `TheReactomeBook.pdf`                                                       |
| `--parallel` |                                | parts printed at once; default 4                                                                     |
| `--report`   |                                | where the run report (data-model.md) is written, as JSON                                             |

- **The preflight,** before anything is printed: from the graph and the EHLD summary it
  lists the release's files the figures need (the events from the graph; which are
  illustrations from the summary, ignoring an entry for an event the graph does not
  hold), and a file missing is a fault
  `missing-file <name>`, the step ending with exit 1 and no book written (Story 5,
  scenario 3). A character no font covers, after FR-017's substitutions, is a fault
  `uncovered-character <code point> <stId>` (research R5, Story 5 scenario 4): in the
  graph's texts the layout writes, and in the labels the figures draw, read from the
  release's diagram files (`--files`), so the check comes before any figure is drawn.
- **Exit 0:** the book is written, and `check-book` passed on it. The file is written
  beside its name and moved into place, so a failed run never leaves a partial book.
- **Exit 1:** a fault from the preflight or FR-011, or a figure that could not be drawn.
  The report names each one by stable identifier or file name, never a person.
- **Exit 2:** bad arguments, or a service that cannot be reached at the start.

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

| Flag                                       | Environment        | Meaning                                                                                                  |
| ------------------------------------------ | ------------------ | -------------------------------------------------------------------------------------------------------- |
| `--port`                                   | `PORT`             | default 4370                                                                                             |
| `--bind`                                   | `BIND_ADDRESS`     | default `127.0.0.1`; in its own container, an address the content service can reach                      |
| `--graph`, `--render`, `--files`, `--site` |                    | as for `book`                                                                                            |
| `--analysis`                               | `ANALYSIS_SERVICE` | the analysis service's base URL                                                                          |
| `--retention`                              | `TOKEN_RETENTION`  | how long an analysis token is kept, in days; must match the analysis service's own setting (research R6) |
| `--concurrency`                            |                    | PDFs made at once; default 2                                                                             |
