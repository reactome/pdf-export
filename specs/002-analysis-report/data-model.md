# Data model: the analysis report

What the report is made of, before any layout. Each entity says where its values come
from (research R1, R2) and its rules. A reported pathway's detail reuses spec 001's
Section (its data-model.md).

## Report request

| Field            | From                                                       | Rules                                                                                                                                            |
| ---------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `token`          | the path                                                   | checked by the analysis service: unknown 404, gone 410                                                                                           |
| `species`        | the path                                                   | a name (any case, `_` as a space), a taxonomy id or a database id; resolved from the graph first, unknown 404                                    |
| `fileName`       | the path                                                   | ignored; the download is named `report.pdf`                                                                                                      |
| `number`         | `?number`                                                  | 25 by default, clamped to 1–50; not a number: as today's (the replay records it)                                                                 |
| `resource`       | `?resource`                                                | `TOTAL` by default; one the result lacks becomes the result's default (the second of its resources when it has exactly two, otherwise the first) |
| `importableOnly` | `?importableOnly`                                          | false by default; acts only with `TOTAL`                                                                                                         |
| profiles         | `?diagramProfile`, `?analysisProfile`, `?fireworksProfile` | accepted and ignored                                                                                                                             |

## Analysis summary

From `GET /token/{token}` (R1, call 1): `type`, `sampleName`, `fileName`, `species` (of
the analysis), `projection`, `interactors`, the resources with their filtered counts,
`identifiersNotFound`, and the expression columns' names. Its **name** (the cover's and
the PDF's title) is the sample's name, else the file's, else the species compared with,
else the type, else the token.

## Reported pathway

One of the first `number` pathways of the report's species, in the service's order.

- From the analysis service (call 1): `stId`, `name`, entities found, total, ratio,
  p-value and FDR; reactions found, total and ratio (unfiltered, research R1).
- From call 2: its found entities (each with what it maps to, per resource, and its
  expression values) and its found interactors.
- From the graph (R2): spec 001's Section for it: compartments, diseases, inferred-from,
  summations, the first five references, the edit history (with "created" and
  "modified" rows), and its figure (its own diagram, the diagram that holds it with its
  events selected, or its illustration).

## Identifier lists

- **Found:** the union of call 2's found entities over every pathway after the filters,
  each with what it maps to and, for an expression analysis, its values; interactors
  apart.
- **Not found:** call 3's list, sorted, without repeats. Left out of the report and its
  contents when empty.

## Report

- **Parts, in order:** cover, contents, introduction, properties, genome-wide overview,
  the most significant pathways' table, each reported pathway's detail, identifiers
  found, identifiers not found (spec Background).
- **Figures:** the overview and one per reported pathway (R3), at most 51.
- **Log line** (R7): token, species, number of pathways, stage times, size, characters
  replaced.

**State:** none kept between requests. The report is made, sent once complete, and
dropped.
