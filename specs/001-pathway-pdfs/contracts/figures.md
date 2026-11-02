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

  An event the Figure rules give no figure has no file, and none is expected.

- **The SVG is the render service's answer as it came** (contracts/render.md): ids are
  prefixed and FR-017 applied when the book inlines it, not in the file.
- **The manifest,** `figures.jsonl`, a journal appended by one writer (so `--parallel`
  never interleaves it), a line per event, the last line for a stable identifier
  winning:
  - **its first line, the folder's fingerprint:** the graph's release number and checksum
    (its `DBInfo`; both present, or the run is refused); the release the content
    service behind the render service answers (it serves no checksum); and the render service's `build`
    (contracts/render.md; `unknown` is refused);
  - **then a line per file:** its kind, the stable identifier drawn (`source`) and its
    sorted `highlight` ids.
- **The order of writing:** a figure to be drawn again first loses its file; then its new
  file is moved into place; then its line is appended. A file with no line, or a line
  with no file, is drawn again, so a run stopped anywhere never leaves an old file under
  a new line.
- **Resuming** (`figures` into a folder that has a manifest): only with the same
  fingerprint. A different one is refused (exit 2), and the run must be given a new,
  empty `--out`. With the same fingerprint, a file whose line matches what the Figure
  rules now choose is kept; one that differs is drawn again.
- **Checked again at the end:** the render service's `build` and the content service's
  release are read again when the last figure is drawn; a change during the
  run is exit 1, the folder kept for a new run to replace.
- **What the fingerprint cannot see** (research R10): the render service's `build` hashes
  its own code, not the website's built page it loads, which is what draws; and
  `--content` is whatever the operator names, which nothing ties to the content service
  the render service reads. So the website's page must not be redeployed during a run or
  between a run and its resumption; `--content` must be the render service's own
  content service; and a graph rebuilt within a release behind it is not caught. Both are asked of WebsiteAngular: the render service's health answer
  reporting its page's build and its content service's release and checksum (T042).
- **What `book` checks** against its own graph and EHLD summary (contracts/cli.md):
  - the fingerprint's release number and checksum are its graph's, or the fault is
    `stale-folder <folder's release>/<checksum> <graph's release>/<checksum>`, and
    nothing is printed;
  - each figure's entry is what the Figure rules choose, or the fault is
    `stale-figure <stId>`;
  - each figure's file is there, or the fault is `missing-file {stId}.svg`.
- **Beside the figures:** the manifest, `figures.jsonl`, and `report.json` when `--report` points there,
  holding no names, only stable identifiers, kinds, times and counts. Any other file
  is ignored, so a folder drawn for a release can be read again by a book made from the
  same graph.
- **A figure that could not be drawn** has no file (one drawn again loses its old file
  first): `figures` exits 1, and the book's preflight would fail on it.
