# Contract: the single-event service

What the website's content service calls (Story 2). The public URL, its parameter names
and its error envelope are WebsiteAngular's (FR-014). This is the interface behind them.

## `GET /event/{stId}.pdf`

| Query   | Meaning                                                                          |
| ------- | -------------------------------------------------------------------------------- |
| `depth` | `0` or `1`; default `1`                                                          |
| `token` | an analysis token, as the analysis service issued it (not percent-encoded twice) |

| Status | When                                                                                                                               | Body                                                                                 |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 200    | the PDF is made                                                                                                                    | `application/pdf`, with the stable identifier in the `Content-Disposition` file name |
| 400    | `depth` is not 0 or 1, or the identifier names something that is not a pathway or reaction                                         | JSON `{ "reason": "not-an-event" \| "bad-depth" }`                                   |
| 404    | the identifier names nothing in the graph                                                                                          | JSON `{ "reason": "no-event" }`                                                      |
| 404    | the token is malformed, or the analysis service answers 404 for it                                                                 | JSON `{ "reason": "unknown-token" }`                                                 |
| 410    | the analysis service answers 410 for it: no result, though dated within its 7 days or in the future                                | JSON `{ "reason": "gone-token" }`                                                    |
| 503    | the graph, the render service or the analysis service cannot answer, the service is at its limit, or the request's deadline passes | JSON `{ "reason": "unavailable" }`                                                   |

- **The order of checks:** the depth, then the identifier, then the token. An unknown or
  non-event identifier is answered as such whatever the token.
- **The token's form** is checked here before the analysis service is asked (research
  R6): a malformed token is `unknown-token`. Whether it has expired is the service's to
  say: its 404 is `unknown-token`, its 410 `gone-token`, and any other failure
  `unavailable`.
- **The reasons** are for the content service, which writes WebsiteAngular's envelope.
  They never carry a path, a host or a name.
- **Where a figure comes from:** without a token, from the release's figures' folder
  (`--figures`, contracts/figures.md), if it passes `book`'s folder checks against the
  graph's current release (the book's species, Homo sapiens, and the EHLD summary in
  `--files`, read once at the start): the full checks when the service starts and whenever
  the folder's manifest (its fingerprint among its lines) or the graph's release and checksum
  change, which are read again once a minute; a folder of another release, or incomplete,
  is not used, and every figure is drawn on request until one that passes is in place, as
  it is while the checks run. A figure the folder lacks (another species' event), or whose
  file cannot be read, is drawn on request and logged (`not-in-folder <figure>`). A folder
  changed on disk is noticed at the next read, so for up to a minute (longer while a poll
  waits on the graph) a PDF can read a folder put in place since the last checks. A graph
  of another release is noticed at once: each PDF's own read of the release must be the
  one the folder was checked against, or its figures are drawn on request; a change of
  checksum alone, within a release, is noticed only at the next poll. With a token, every figure is drawn on request, with the
  analysis's overlay (SC-005). A PDF can so mix figures from the folder with figures
  drawn on request by another render build; contracts/figures.md lists what the
  fingerprint cannot see.
- **The limit and the deadline:** a request beyond the concurrency limit is answered
  503 at once, not queued. It is counted before its first read of the graph, so the
  depth and an identifier of no known form are answered whatever the load, and a lookup
  at the limit is 503. A PDF holds its place until its work has ended and every graph read
  it began has ended, each given the time left before the deadline as its transaction
  timeout, so the database ends it there, or until its deadline and a grace of 5 s have
  passed, whichever is first (a read on a connection gone silent never ends); not only
  until it is answered. So the reads in flight never outnumber the places, but for reads
  still unsettled past their deadline and grace, which `/health` counts as `stuck`. Each request has a deadline across everything
  it waits for, the analysis service's calls together among them (each of which also
  has its own timeout); past it, or once the client has gone, the request's reads and
  calls are given up on, its print under way is stopped, nothing more is printed, and
  the answer is 503. A browser that goes is started again; while none is up, a PDF is
  answered 503 at once.
- **A figure that cannot be drawn** does not fail the PDF. The section is written without
  it and the absence is logged (spec, Edge Cases).
- **A character no font draws** does not fail the PDF (FR-017): after the fixed list's
  substitutions, it prints as U+FFFD, and each such code point is logged once per PDF
  with the stable identifier or token, never the text.
- **The species** of the overlay is the event's (FR-006). The analysis options the
  website does not send are ignored (spec, Assumptions).

## `GET /health`

200 with the package's version (`version`), the graph's release (`release`), whether the
render and analysis services answer (`render`, `analysis`), whether its browser is up
(`printer`), how many PDFs are being made (`making`), how many PDFs' graph reads are
unsettled past their deadline and grace (`stuck`), and the figures' folder (`figures`):
`{ "state": "ready", "release": 98, "checksum": "…" }` (the release and checksum it was
checked against, the checksum as its decimal digits), or `{ "state": … }` with `checking`
(its checks under way, or failed and to be tried again), `stale` (another release's,
summary's or Figure rules', or a graph with no checksum), `incomplete` (its manifest not
whole, or a figure's file missing) or `none` (no `--figures`, no folder or no manifest).
Used by the container's health check; a folder not in use does not make it 503.

503 with the same body once three starts of the browser in a row have failed (the service cannot print, and is to be replaced; a browser gone within 30 s
of its start, having printed nothing, counts as a start that failed), or while a graph read
is unsettled past its request's deadline and grace (its connection gone silent), or when the
graph does not answer its release within the health check's own timeout (then the body is
the reason).
