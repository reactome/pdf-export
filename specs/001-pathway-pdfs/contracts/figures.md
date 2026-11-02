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
  never interleaves it) and flushed to disk after each line. A line is a JSON object
  ended by a newline; a last line with no newline is torn.
  - **Its first line, the folder's fingerprint:** the graph's release number and checksum
    (its `DBInfo`; both present, or the run is refused); a hash of the EHLD summary in
    `--files`; the release the content service named by `--content` answers (it serves
    no checksum); and the render service's `build` (contracts/render.md; `unknown` is
    refused).
  - **Then a line per figure:** its stable identifier, kind, the stable identifier drawn
    (`source`), its sorted `highlight` ids, and the render `build` and content release
    read just before it was drawn. A figure whose label check fails after drawing gets
    no line, and its file is removed. A later line for the same figure replaces an
    earlier one.
  - **Its last line, when every figure is in place:** `complete`, whose fingerprint
    fields (all those of the first line) equal the first line's.
- **The order of writing:** a figure to be drawn again first loses its file; then the
  render service's `build` and the content release are read; then the figure is drawn,
  its new file moved into place, and its line appended. A file with no line, or a line
  with no file, is drawn again, so a run stopped anywhere never leaves a file under a
  line that does not describe it.
- **What `--out` may be:**
  - **empty:** a new folder;
  - **a folder whose first line is whole:** resumed, only with the same fingerprint, read
    afresh at the start. A torn last line is first cut off, back to the last newline.
    A file is kept only if its line matches what the Figure rules now choose and records
    the fingerprint's `build` and content release; any other is drawn again. Once a
    figure is redrawn in a `complete` folder, its `complete` line is no longer last, so
    the book refuses the folder until the run appends a new one;
  - **anything else** (files with no manifest, a torn or missing first line, another
    fingerprint): refused (exit 2); the run needs a new, empty `--out`.
- **A deployment changed during a run** is seen at the next figure: one whose `build` or
  content release differs from the fingerprint is exit 1, and its line records the
  difference, so neither a resumed run nor the book uses it. A rollback before resuming
  has every figure drawn under the other build drawn again.
- **What the fingerprint cannot see** (research R10):
  - the render service's `build` hashes its own code, not the website's built page it
    loads, which is what draws;
  - a deployment changed and undone within the drawing of one figure;
  - `--content` is whatever the operator names, which nothing ties to the content
    service the render service reads, and a graph rebuilt within a release behind it is
    not caught.

  So the website's page must not be redeployed during a run or between a run and its
  resumption, and `--content` must be the render service's own content service. Three
  things are asked of WebsiteAngular (T042): the render service's health answer
  reporting the build of the page it loads; reporting its content service's release and
  graph checksum, which needs the content service to serve the checksum (a new
  endpoint) or the render service to read the graph's `DBInfo` itself; and a header on
  each drawing naming both, so each figure's line records what drew it rather than what
  was read beside it.

- **What `book` checks,** against its own graph and EHLD summary (contracts/cli.md),
  before anything is printed:
  - the journal's last line is whole and is a `complete` line whose fingerprint fields
    equal the first line's, and no line is torn or unreadable, or the fault is
    `incomplete-folder`;
  - its graph has a `DBInfo` checksum, or the fault is `no-checksum`;
  - the fingerprint's release number, checksum and summary hash are its graph's and its
    `--files`', or the fault is
    `stale-folder <folder's release>/<checksum> <graph's release>/<checksum>`;
  - each figure's line is what the Figure rules choose, and records the fingerprint's
    `build` and content release, or the fault is `stale-figure <stId>`;
  - each figure's file is there, or the fault is `missing-file {stId}.svg`.
- **Beside the figures:** the manifest, `figures.jsonl`, and `report.json` when `--report` points there,
  holding no names, only stable identifiers, kinds, times and counts. Any other file
  is ignored, so a folder drawn for a release can be read again by a book made from the
  same graph.
- **A figure that could not be drawn** has no file (one drawn again loses its old file
  first): `figures` exits 1, and the book's preflight would fail on it.
