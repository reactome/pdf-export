# Contract: what pdf-export asks of the render service

The website's render service (WebsiteAngular `tools/render/service.ts`), the
deployment's own, on the same graph, answers `GET /render/{name}.{ext}` with a drawing. pdf-export uses it as follows (research R3).
What it cannot do yet is listed in research R10, and is asked of WebsiteAngular there.

## Requests

| Figure (data-model.md) | Request                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------- |
| `diagram`              | `/render/{stId}.svg`                                                                  |
| `ancestor`             | `/render/{ancestorStId}.svg?highlight={id},{id},…`                                    |
| `ehld`                 | `/render/{stId}.svg`; the render page draws the illustration when the pathway has one |
| `reaction`             | `/render/{stId}.svg?layout=reaction`                                                  |
| with an analysis       | the same, plus `token={token}`, decoded once (the service's parameter name)           |

## Its health answer

`GET /health` answers JSON with `build`: twelve hex digits hashing the service's own
modules (WebsiteAngular `tools/render/service.ts`), or `unknown`. `figures` records it
in its folder's fingerprint and refuses `unknown` (contracts/figures.md). It does not
identify the website's built page the service loads, which is what draws; that is asked
of WebsiteAngular (research R10).

## Answers pdf-export relies on

- **200** with `image/svg+xml`. Before inlining it, pdf-export prefixes every `id`,
  `url(#…)` and `href="#…"` in it with the section's anchor, and applies FR-017 to the
  text of its labels: their text content only, never an element, an id or an
  attribute.
- **A refusal** (any 4xx, a 5xx, or a timeout): the figure is missing. Retried once
  after a pause for a 503. Then:
  - `figures` fails on it, and so the book's preflight would (contracts/figures.md);
  - a single-event PDF goes on without it.
- **The text** is set in Roboto. pdf-export's page supplies the font, at weights 300 to
  600 (research R5).
- **Node labels are 12 px** in the SVG (compartments' 80 px), and the smallest sets the figure's scale
  against the legibility floor (research R4).

## Settings for the figures' run (research R3, R7)

`pdf-export figures` is the only caller for the book; `book` itself asks no render service.

- The service's concurrency, queue and timeout are raised for the run, by its own
  settings.
- Its cache is not used for the run, so every figure is drawn from the release's data.
- It reads the release's graph, through its content service, and the release's diagram
  and EHLD files.

## Tests

- **CI:** a stub that answers recorded SVGs for the fixture graph's events, including
  two figures whose ids collide. The test checks that inlining both leaves each figure's
  ids unique.
