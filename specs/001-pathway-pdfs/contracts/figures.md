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
  never interleaves it). A line is a JSON object ended by a newline; a last line with no
  newline is torn.
  - **Its first line, the folder's fingerprint:** the graph's release number and checksum
    (its `DBInfo`; both present, or the run is refused); the release the content service
    named by `--content` answers (it serves no checksum); and the render service's
    `build` (contracts/render.md; `unknown` is refused).
  - **Then a line per figure:** its stable identifier, kind, the stable identifier drawn
    (`source`) and its sorted `highlight` ids. A later line for the same figure replaces
    an earlier one.
  - **Its last line, when the run succeeds:** `complete`, repeating the fingerprint,
    written only after every figure is in place and the end-of-run check has passed.
  - **Or, when the end-of-run check fails:** `failed`, with what changed. A folder holding
    a `failed` line is never resumed.
- **The order of writing:** a figure to be drawn again first loses its file; then its new
  file is moved into place; then its line is appended. A file with no line, or a line
  with no file, is drawn again, so a run stopped anywhere never leaves an old file under
  a new line.
- **What `--out` may be:**
  - **empty:** a new folder;
  - **a folder whose first line is whole, with no `failed` line:** resumed, only with the
    same fingerprint. A file whose line matches what the Figure rules now choose is kept;
    one that differs, or whose line is torn, is drawn again. Once a resumed `complete`
    folder has a figure redrawn, its old `complete` line is no longer last, so the book
    refuses it until the run appends a new one;
  - **anything else** (files with no manifest, a torn or missing first line, a `failed`
    line, another fingerprint): refused (exit 2); the run needs a new, empty `--out`.
- **Checked again at the end:** the render service's `build` and the content service's
  release are read again when the last figure is drawn; a change is exit 1 and a
  `failed` line, so neither `book` nor a resumed run uses the folder.
- **What the fingerprint cannot see** (research R10):
  - the render service's `build` hashes its own code, not the website's built page it
    loads, which is what draws;
  - the `build` and the content release are read at the start and the end, not per
    figure, so a change undone within one run (a deployment rolled back) is not seen;
  - `--content` is whatever the operator names, which nothing ties to the content
    service the render service reads, and a graph rebuilt within a release behind it is
    not caught.

  So the website's page and the render service must not be redeployed during a run or
  between a run and its resumption, and `--content` must be the render service's own
  content service. Three things are asked of WebsiteAngular (T042): the render
  service's health answer reporting the build of the page it loads; reporting its
  content service's release and graph checksum, which needs the content service to
  serve the checksum (a new endpoint) or the render service to read the graph's
  `DBInfo` itself; and a header on each drawing naming both, so each figure's line can
  record what drew it and the book check it.

- **What `book` checks,** against its own graph and EHLD summary (contracts/cli.md),
  before anything is printed:
  - the journal's last line is whole and is a `complete` line equal to its first line,
    and no line is torn or unreadable, or the fault is `incomplete-folder`;
  - its graph has a `DBInfo` checksum, or the fault is `no-checksum`;
  - the fingerprint's release number and checksum are its graph's, or the fault is
    `stale-folder <folder's release>/<checksum> <graph's release>/<checksum>`;
  - each figure's line is what the Figure rules choose, or the fault is
    `stale-figure <stId>`;
  - each figure's file is there, or the fault is `missing-file {stId}.svg`.
- **Beside the figures:** the manifest, `figures.jsonl`, and `report.json` when `--report` points there,
  holding no names, only stable identifiers, kinds, times and counts. Any other file
  is ignored, so a folder drawn for a release can be read again by a book made from the
  same graph.
- **A figure that could not be drawn** has no file (one drawn again loses its old file
  first): `figures` exits 1, and the book's preflight would fail on it.
