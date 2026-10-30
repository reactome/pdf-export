# The fixture

A small release for the tests (spec 001 T003): `fixture.cypher`, a graph in release 98's
schema, and `files/`, the release's files the book's preflight looks for.

**No real names or text.** Every `Person` is a placeholder (`Placeholder01, P.` …) and every
text is made up (constitution VII). Ids are from 90000000, beyond Reactome's, so none is
taken for a real event. `test/graph/fixture.test.ts` fails if a person's surname is not a
placeholder. Edit `fixture.cypher` directly; its labels, properties and relationships are
release 98's (every relationship has `order` and `stoichiometry`).

## The cases

| Case                                                                                 | Where                                                                                       | For                                       |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Release 98                                                                           | `DBInfo.releaseNumber`                                                                      | the introduction, the base of ids         |
| Three human top-level pathways, ordered differently by id, by case and ignoring case | `beta pathway`, `Alpha pathway`, `Gamma pathway`                                            | FR-002's order                            |
| A non-human top-level pathway                                                        | `Mouse pathway`                                                                             | `--species`                               |
| A subpathway with no diagram, under one with a diagram                               | `Alpha sub one`                                                                             | the ancestor's diagram with a selection   |
| A subpathway beneath a pathway with an illustration                                  | `Gamma sub`                                                                                 | the illustration unselected, recorded     |
| A subpathway with two parents that have diagrams                                     | `Two-parent sub`                                                                            | which ancestor's diagram                  |
| A pathway with an illustration of its own                                            | `Gamma pathway`                                                                             | EHLD figures                              |
| Reactions of three kinds                                                             | `Reaction one`, `Black box two`, `Polymerisation four`                                      | reaction figures and types                |
| An event shared by two pathways                                                      | `Shared reaction`                                                                           | FR-004's short entries                    |
| An event inferred from two species                                                   | `Inferred reaction`, from a mouse and a rat source                                          | inferred-from, sorted by species          |
| Preceding events, one outside a single-event PDF                                     | `Black box two` → `Reaction one` → `Polymerisation four`                                    | FR-003's links                            |
| Lists whose order differs from id order                                              | `Alpha pathway`'s and `beta pathway`'s events; `Reaction one`'s compartments and literature | list order                                |
| Seven references, one with eight authors                                             | `Reaction one`                                                                              | the first five, six authors then "et al." |
| A book with a publisher, and a web page                                              | `Shared reaction`                                                                           | each kind of literature                   |
| Edits of each kind; one with no date; one with no author; two sharing a date         | `Reaction one`                                                                              | the edit history's rules                  |
| A summation whose HTML must be sanitised                                             | `Alpha pathway`                                                                             | sanitising                                |
| A disease, and one named exactly "disease"                                           | `Disease reaction`                                                                          | the "disease" exclusion                   |
| A node that is not an event, with a stable id                                        | `Placeholder complex`                                                                       | 400 `not-an-event`                        |

## The release's files

`files/diagram/` holds a placeholder `{stId}.json` and `{stId}.graph.json` for each pathway
with a diagram; `files/ehld/` holds the illustration and `svgsummary.txt`. The summary also
names `R-HSA-99999999`, an event the graph does not hold, which the preflight must ignore
(research R7). The files are placeholders: the figures come from the render stub.

## Running the graph tests locally

```sh
docker run -d --name pdfx-fixture -p 127.0.0.1:17700:7687 -e NEO4J_AUTH=none \
  -e NEO4J_dbms_default__database=graph.db \
  neo4j:4.4.48-community
docker exec -i pdfx-fixture cypher-shell -d graph.db < ci/fixture/fixture.cypher
NEO4J_URI=bolt://127.0.0.1:17700 npm test
```

To reload after an edit, delete everything (`MATCH (n) DETACH DELETE n`) and load it again
through standard input. Mounting the file instead would keep the copy git replaced on a
branch change. Without `NEO4J_URI` the graph tests are skipped; CI sets it.
