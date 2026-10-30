# Data model: the analysis report

What the report is made of, before any layout. Each entity says where its values come
from (research R1, R2) and its rules. A reported pathway's detail reuses spec 001's
Section (its data-model.md).

## Report request

| Field            | From                                                       | Rules                                                                                                                                               |
| ---------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `token`          | the path                                                   | checked by the analysis service: unknown 404, gone 410                                                                                              |
| `species`        | the path                                                   | a name (any case, `_` as a space), a taxonomy id or a database id; resolved from the graph first, unknown 404                                       |
| `fileName`       | the path                                                   | ignored; the download is named `report.pdf`                                                                                                         |
| `number`         | `?number`                                                  | 25 by default, clamped to 1–50; not a number: as today's (the replay records it)                                                                    |
| `resource`       | `?resource`                                                | `TOTAL` by default; one the result lacks becomes the result's default (the only resource besides `TOTAL` when it holds just one, otherwise `TOTAL`) |
| `importableOnly` | `?importableOnly`                                          | false by default; acts only with `TOTAL`                                                                                                            |
| profiles         | `?diagramProfile`, `?analysisProfile`, `?fireworksProfile` | accepted and ignored                                                                                                                                |

## Analysis summary

From `GET /token/{token}` (R1, call 2): `type`, `gsaMethod` (which explains a
ReactomeGSA result's type), `sampleName`, `fileName`, `species` (of the analysis), `projection`, `interactors`, the resources with their filtered counts,
`identifiersNotFound`, and the expression columns' names. Its **name** (the cover's and
the PDF's title) is the sample's name, else the file's, else the species compared with,
else the type, else the token.

## Reported pathway

One of the first `number` pathways of the report's species, in the service's order.

- From the analysis service (R1's call 2): `stId`, `name`, entities found, total,
  ratio, p-value and FDR; reactions found, total and ratio, unfiltered (from call 3
  when the report filters, research R1).
- From call 4: its found entities (each with what it maps to, per resource, and its
  expression values), split by resource, and its found interactors, split by the
  resource they interact through.
- From the graph (R2): spec 001's Section for it: compartments, diseases, inferred-from,
  summations, the first five references, the edit history (today's report's rule: one
  row per date and action in today's order, created and modified included (spec 001's
  query extended to read them), authorless edits kept, undated ones left out, research
  R2), and its figure (its own diagram, the diagram that holds it with its events
  selected, or its illustration).

## Identifier lists

- **Found:** for each resource the report is for (KEGG COMPOUND and NCBI Protein
  included, which today's leaves empty, research R1), the pathways read in call 2's
  order, each identifier taken from the first pathway holding it, with that pathway's
  mappings and, for an expression analysis, its values; interactors apart. Not a union
  (research R1). Their count is the distinct identifiers of call 4's entities in every
  resource; the heading's count of Reactome entities is the union of the mapped
  accessions.
- **Not found:** call 5's list, sorted, without repeats. Left out of the report and its
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
