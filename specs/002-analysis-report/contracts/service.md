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

| Status     | When                                                                                                                         | Body                                                                                                                                                                          |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 200        | the report is ready (made within the request's wait, or earlier)                                                             | `application/pdf`, `Content-Disposition: attachment; filename="report.pdf"`, sent once complete                                                                               |
| 202        | the report is being made and was not ready within the request's wait (30 s by default)                                       | `Retry-After: 10`; JSON `{ "code": 202, "reason": "Accepted", "messages": [ … ] }`, or for a request accepting `text/html` a page that asks the same address again after 10 s |
| 404        | the species is not in the graph (checked before the token)                                                                   | JSON `{ "code": 404, "reason": "Not Found", "messages": [ … ] }`                                                                                                              |
| 404        | the analysis service does not know the token                                                                                 | as above                                                                                                                                                                      |
| 410        | the token's result was deleted by a release                                                                                  | JSON, code 410                                                                                                                                                                |
| as today's | a number or flag that is not one                                                                                             | as today's, recorded by the replay (research R5)                                                                                                                              |
| 500        | making the PDF fails                                                                                                         | JSON, code 500                                                                                                                                                                |
| 503        | the analysis service, the graph or the render service cannot answer, or the service is at its limit, or past its time budget | JSON, code 503, with `Retry-After`                                                                                                                                            |

- **The order of checks:** the species, then the token, then the rest.
- **No message carries a path, a host, a name or a submitted identifier.**
- **In the background** (FR-210, research R4): a request starts the report, or joins
  the one being made for the same token and parameters (`number` after clamping,
  `resource` after defaulting, `importableOnly`, the species' database id), and waits
  up to 30 s. The same address answers 202 until the report is ready, then 200 with the
  PDF; a report that failed answers its error once, and is then forgotten so that the
  next request starts it again.
- **Kept** (FR-211): a finished report for one hour, or until a release clears its
  token; then deleted.
- **Limits** (FR-210): two reports at once by default, a bounded queue (503 beyond it),
  and a time budget of 5 minutes a report, past which it is abandoned (503 when asked
  for again).
- **A figure that cannot be drawn** leaves its part without it, logged; the report is
  still 200.
- **Characters no font draws:** spec 001 FR-017 for PDFs made on request.

## `GET /health`

Spec 001's, plus whether the analysis service answers.
