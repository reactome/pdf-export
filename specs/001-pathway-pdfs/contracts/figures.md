# Contract: the figures' folder

What `pdf-export figures` writes and `pdf-export book` reads (SC-010, research R7).

- **One file per figure the book prints,** `{stId}.svg`, named by the event whose section
  shows it, whatever was drawn:
  - a reaction: its reaction drawing;
  - a pathway with a diagram of its own: that diagram, or its illustration (EHLD) where
    it has one;
  - a pathway drawn in its nearest ancestor's diagram (data-model.md, Figure rule 2:
    a top-level ancestor last): that diagram with the pathway's events selected; where
    the EHLD summary names that ancestor, its illustration instead, drawn unselected
    until the render service can select in one (research R10).
- **The SVG is the render service's answer as it came** (contracts/render.md): ids are
  prefixed and FR-017 applied when the book inlines it, not in the file.
- **The manifest,** `figures.json`: the graph's release, and for each file its kind, the
  stable identifier drawn (`source`) and its sorted `highlight` ids. `book` compares it with
  what the Figure rules choose from its own graph and summary: a figure whose entry
  differs, or a manifest naming another release, is a fault `stale-figure <stId>`. A
  graph changed within a release (a rerun before it is published) is drawn into a new
  folder: the manifest cannot tell two graphs of one release apart.
- **Nothing else** is in the folder but the manifest, and `report.json` when `--report` points there: no
  names, only stable identifiers, kinds, times and counts.
- **A figure the book needs and the folder lacks** is the preflight's
  `missing-file {stId}.svg` (contracts/cli.md): the book is not begun.
- **A file the book does not need** is ignored, so a folder drawn for a release can be
  read again by a book made from the same graph.
- **A figure that could not be drawn** has no file: `figures` exits 1, and the book's
  preflight would fail on it.
