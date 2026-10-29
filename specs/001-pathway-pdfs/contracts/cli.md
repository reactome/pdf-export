# Contract: the command line

One executable, `pdf-export`, with four commands. Settings come from flags or from the
environment variables named beside them. A password never goes on the command line.

## `pdf-export book`

Writes the release's book (Story 1).

| Flag         | Environment                    | Meaning                                                  |
| ------------ | ------------------------------ | -------------------------------------------------------- |
| `--graph`    | `NEO4J_URI`                    | Bolt address of the release's graph                      |
|              | `NEO4J_USER`, `NEO4J_PASSWORD` | its credentials                                          |
| `--database` | `NEO4J_DATABASE`               | default `graph.db`                                       |
| `--render`   | `RENDER_SERVICE`               | the render service's base URL (contracts/render.md)      |
| `--species`  |                                | default `Homo sapiens` (spec: the book's scope)          |
| `--out`      |                                | the output path; default `TheReactomeBook.pdf`           |
| `--parallel` |                                | parts printed at once; default 4                         |
| `--report`   |                                | where the run report (data-model.md) is written, as JSON |

- **Exit 0:** the book is written, and `check-book` passed on it. The file is written
  beside its name and moved into place, so a failed run never leaves a partial book.
- **Exit 1:** a fault from FR-011, or a figure that could not be drawn. The report names
  each one by stable identifier, never a person.
- **Exit 2:** bad arguments, or a service that cannot be reached at the start.

## `pdf-export check-book <file>`

FR-011's check, alone. Also run by `book`.

| Flag                   | Meaning                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `--graph`, `--species` | the graph the book was made from, for the list of top-level pathways and events expected |

- **Exit 0:** every check passed.
- **Exit 1:** at least one fault. Each is printed as `fault <kind> <stId>`. The kinds:
  `missing-pathway`, `not-in-contents`, `not-in-outline`, `unnamed-section`,
  `missing-figure` and `broken-link`.

## `pdf-export compare <reference.pdf> <new.pdf>`

FR-012's comparison, for development only; it is never run by the release.

- **Output:** a JSON report of the differences by part and kind, with counts. Names
  appear only as counts and hashes (FR-013).
- **`--expected <file>`:** the recorded differences. With it, the exit is 1 only for a
  difference not recorded.

## `pdf-export serve`

The single-event service (contracts/service.md).

| Flag                  | Environment        | Meaning                                            |
| --------------------- | ------------------ | -------------------------------------------------- |
| `--port`              | `PORT`             | default 4370; the service listens on loopback only |
| `--graph`, `--render` |                    | as for `book`                                      |
| `--analysis`          | `ANALYSIS_SERVICE` | the analysis service's base URL                    |
| `--concurrency`       |                    | PDFs made at once; default 2                       |
