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

## Answers pdf-export relies on

- **200** with `image/svg+xml`. pdf-export prefixes every `id`, `url(#…)` and
  `href="#…"` in it with the section's anchor before inlining it.
- **A refusal** (any 4xx, a 5xx, or a timeout): the figure is missing. Retried once
  after a pause for a 503. Then:
  - the book fails on it (FR-011);
  - a single-event PDF goes on without it.
- **The text** is set in Roboto. pdf-export's page supplies the font, at weights 300 to
  600 (research R5).
- **Node labels are 12 px** in the SVG (compartments' 80 px), and the smallest sets the figure's scale
  against the legibility floor (research R4).

## Settings for the book's run (research R3)

- The service's concurrency, queue and timeout are raised for the run, by its own
  settings.
- Its cache is not used for the run, so every figure is drawn from the release's data.
- It reads the release's graph, through its content service, and the release's diagram
  and EHLD files.

## Tests

- **CI:** a stub that answers recorded SVGs for the fixture graph's events, including
  two figures whose ids collide. The test checks that inlining both leaves each figure's
  ids unique.
