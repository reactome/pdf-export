# Contract: what the report adds to spec 001's render requests

Spec 001's contracts/render.md holds: SVG only, ids prefixed and labels after FR-017
before inlining, a 503 retried once after its pause, and a refusal leaving the figure
out of a PDF made on request. The report adds:

| Figure                   | Request                                                     |
| ------------------------ | ----------------------------------------------------------- |
| the genome-wide overview | `GET /render/genome-wide.svg?species={taxId}&token={token}` |

- **Pacing:** a report asks for its figures at the render service's concurrency (a
  setting, 2 by default), never more at once, so a burst never passes its queue of 8.
- **The resource:** not taken by the render service today (a 400). A WebsiteAngular task
  adds `resource`; once it ships, the report passes the report's resource for the
  pathways' diagrams, and nothing for the overview, which today's report overlays for
  the result's default resource.
