# Contract: the analysis report service

What WebsiteAngular's analysis gateway sends on (research R6), and what people's scripts
already call. The address and parameters are today's.

## `GET /AnalysisService/report/{token}/{species}/{filename}.pdf`

| Query                                                   | Meaning                                                               |
| ------------------------------------------------------- | --------------------------------------------------------------------- |
| `number`                                                | pathways to report, 25 by default, clamped to 1–50                    |
| `resource`                                              | `TOTAL` by default; one the result lacks becomes the result's default |
| `importableOnly`                                        | `false` by default; acts only with `TOTAL`                            |
| `diagramProfile`, `analysisProfile`, `fireworksProfile` | accepted and ignored                                                  |

`{species}` is a name (any case, `_` as a space), a taxonomy id or a database id.
`{filename}` is ignored.

| Status     | When                                                                                                                         | Body                                                                                            |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 200        | the report is made                                                                                                           | `application/pdf`, `Content-Disposition: attachment; filename="report.pdf"`, sent once complete |
| 404        | the species is not in the graph (checked before the token)                                                                   | JSON `{ "code": 404, "reason": "Not Found", "messages": [ … ] }`                                |
| 404        | the analysis service does not know the token                                                                                 | as above                                                                                        |
| 410        | the token's result was deleted by a release                                                                                  | JSON, code 410                                                                                  |
| as today's | a number or flag that is not one                                                                                             | as today's, recorded by the replay (research R5)                                                |
| 500        | making the PDF fails                                                                                                         | JSON, code 500                                                                                  |
| 503        | the analysis service, the graph or the render service cannot answer, or the service is at its limit, or past its time budget | JSON, code 503, with `Retry-After`                                                              |

- **The order of checks:** the species, then the token, then the rest.
- **No message carries a path, a host, a name or a submitted identifier.**
- **Limits** (FR-210): two reports at once by default, a bounded queue, and a time
  budget of what the edge's 100 s leaves after the queues (research R4).
- **A figure that cannot be drawn** leaves its part without it, logged; the report is
  still 200.
- **Characters no font draws:** spec 001 FR-017 for PDFs made on request.

## `GET /health`

Spec 001's, plus whether the analysis service answers.
