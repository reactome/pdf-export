# Contract: the single-event service

What the website's content service calls (Story 2). The public URL, its parameter names
and its error envelope are WebsiteAngular's (FR-014). This is the interface behind them.

## `GET /event/{stId}.pdf`

| Query   | Meaning                                                                          |
| ------- | -------------------------------------------------------------------------------- |
| `depth` | `0` or `1`; default `1`                                                          |
| `token` | an analysis token, as the analysis service issued it (not percent-encoded twice) |

| Status | When                                                                                                | Body                                                                                 |
| ------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 200    | the PDF is made                                                                                     | `application/pdf`, with the stable identifier in the `Content-Disposition` file name |
| 400    | `depth` is not 0 or 1, or the identifier names something that is not a pathway or reaction          | JSON `{ "reason": "not-an-event" \| "bad-depth" }`                                   |
| 404    | the identifier names nothing in the graph                                                           | JSON `{ "reason": "no-event" }`                                                      |
| 404    | the token is unknown, malformed, or older than the retention period                                 | JSON `{ "reason": "unknown-token" }`                                                 |
| 410    | the token's result is gone within the retention period                                              | JSON `{ "reason": "gone-token" }`                                                    |
| 503    | the graph, the render service or the analysis service cannot answer, or the service is at its limit | JSON `{ "reason": "unavailable" }`                                                   |

- **The order of checks:** the depth, then the identifier, then the token. An unknown or
  non-event identifier is answered as such whatever the token.
- **The token** is checked here before the analysis service is asked (research R6): its
  form, and its date against the retention period. A malformed or expired token is
  `unknown-token`; the service's 404 is `unknown-token` and its 410 `gone-token`.
- **The reasons** are for the content service, which writes WebsiteAngular's envelope.
  They never carry a path, a host or a name.
- **Where a figure comes from:** without a token, from the release's figures' folder
  (`--figures`, contracts/figures.md), if it passes `book`'s folder checks against the
  graph's current release: the full checks when the service starts and whenever the
  folder's fingerprint or the graph's release and checksum change, which are read again
  at most once a minute; a folder of another
  release, or incomplete, is not used, and every figure is drawn on request until one
  that passes is in place. A figure the folder lacks (another species' event) is drawn
  on request and logged. With a token, every figure is drawn on request, with the
  analysis's overlay (SC-005). A PDF can so mix figures from the folder with figures
  drawn on request by another render build; contracts/figures.md lists what the
  fingerprint cannot see.
- **A figure that cannot be drawn** does not fail the PDF. The section is written without
  it and the absence is logged (spec, Edge Cases).
- **A character no font draws** does not fail the PDF (FR-017): after the fixed list's
  substitutions, it prints as U+FFFD, and each such code point is logged once per PDF
  with the stable identifier or token, never the text.
- **The species** of the overlay is the event's (FR-006). The analysis options the
  website does not send are ignored (spec, Assumptions).

## `GET /health`

200 with the package's version, the graph's release, whether the render and analysis
services answer, and the figures' folder: `ready` (its release and checksum),
`stale`, `incomplete` or `none`. Used by the container's health check.
