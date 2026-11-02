# Contract: the figures' folder

What `pdf-export figures` writes and `pdf-export book` reads (SC-010, research R7).

- **One file per figure the book prints,** `{stId}.svg`, named by the event whose section
  shows it, whatever was drawn:
  - a reaction: its reaction drawing;
  - a pathway with a diagram of its own: that diagram, or its illustration (EHLD) where
    it has one;
  - a pathway drawn in its nearest ancestor's diagram: that diagram with the pathway's
    events selected (data-model.md, Figure).
- **The SVG is the render service's answer as it came** (contracts/render.md): ids are
  prefixed and FR-017 applied when the book inlines it, not in the file.
- **Nothing else** is in the folder but `report.json` when `--report` points there: no
  names, only stable identifiers, kinds, times and counts.
- **A figure the book needs and the folder lacks** is the preflight's
  `missing-file {stId}.svg` (contracts/cli.md): the book is not begun.
- **A file the book does not need** is ignored, so a folder drawn for a release can be
  read again by a book made from the same graph.
