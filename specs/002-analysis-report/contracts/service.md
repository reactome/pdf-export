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
| 503        | the analysis service, the graph or the render service cannot answer, or the service is at its limit, or past its time budget | JSON, code 503, with `Retry-After`; for a browser, the page that asks again                                                                                                   |

- **The order of checks:** the species, then the token, then the rest.
- **No message carries a path, a host, a name or a submitted identifier.**
- **In the background** (FR-210, research R4, data-model Job): a request starts the
  report, or joins the one queued, being made or kept for the same key (the token, the
  species' database id, `number` after clamping, `resource` after defaulting,
  `importableOnly`), and waits up to 30 s. The same address answers 202 until the
  report is ready, then 200 with the PDF.
- **A report that ends in an error** (FR-203's: 404 or 410 when the token goes while it
  is made, 500, or 503 including past its budget) answers
  that error to every request then waiting and to the next request, then is forgotten,
  so the request after starts it again; unasked, it is forgotten after an hour.
- **Kept** (FR-211): a finished report in the service's memory for one hour, at most
  512 MB of them by default, the oldest dropped first. Every request asks the analysis
  service about the token (contracts/analysis-api.md, the check): a 404 or 410 drops a
  kept report and is answered as such; no answer within 5 s is a 503, the kept report
  not sent. Every request reads the graph's release with the species: a change drops
  every kept report.
- **Limits** (FR-210): two reports made at once by default and eight more waiting (503
  beyond that; a joining request is never counted), and at most two of the eight from
  one client, as the gateway names it in `X-Reactome-Client`, a header the gateway always
  sets to its own `clientOf` (the client's address, IPv6 counted by its /64) and
  overwrites whatever a client sent; pdf-export trusts it because only the gateway can
  reach it (loopback or the internal network); `X-Forwarded-For` is not used, as nginx
  appends to what a client sends; a time budget of 5 minutes from
  when a report starts being made. The render requests of all reports together are
  capped (two at once by default), so reports never take every one of the render
  service's slots from the website's own images.
- **Caching:** 202, its page and every 503 carry `Cache-Control: no-store`; the PDF
  `Cache-Control: private, no-store`.
- **A browser** (`Accept: text/html`) is given, for a 202 and for a 503 with
  `Retry-After`, a small page that asks the same address again after that time; for
  the 200, the PDF downloads (`Content-Disposition: attachment`) and the page stays as
  it was, saying the report is ready.
- **One process:** jobs and kept reports live in the service's process. Several
  instances do not share them, so the service runs as one instance; a restart loses
  them, and the next request starts the report again.
- **The working page** (FR-211): the printer's HTML, holding the submitted identifiers,
  in a private folder on a memory-backed filesystem, removed when the print ends; the
  folder is emptied when the service starts.
- **A figure that cannot be drawn** leaves its part without it, logged; the report is
  still 200.
- **Characters no font draws:** spec 001 FR-017 for PDFs made on request.

## `GET /health`

Spec 001's, plus whether the analysis service answers.
