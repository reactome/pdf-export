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
- **One run, one folder:** `--out` must be empty or absent, or the run is refused
  (exit 2). A run that stops for any reason leaves a folder the book refuses, and the
  next run is given a new, empty `--out`. There is no resuming: at about 3.5 hours a
  run (research R7), a failure costs a rerun, and in exchange no folder ever mixes what
  two runs drew.
- **The manifest,** `figures.jsonl`, appended by one writer (so `--parallel` never
  interleaves it). A line is a JSON object ended by a newline.
  - **Its first line, the folder's fingerprint:** the graph's release number and checksum
    (its `DBInfo`; both present, or the run is refused); a hash of the EHLD summary in
    `--files`; the release the content service named by `--content` answers (it serves
    no checksum); and the render service's `build` (contracts/render.md; `unknown` is
    refused).
  - **Then a line per figure:** its stable identifier, kind, the stable identifier drawn
    (`source`) and its sorted `highlight` ids. A figure's line is appended only after its
    file is written, synced and moved into place, and only if the render service's
    `build` and the content release, read again after the file is in place, still equal
    the fingerprint's (a service that does not answer that read counts as changed);
    otherwise its file is removed and the run stops at once (below).
  - **A figure's own fault** (refused after the client's retry, timed out, or failing its
    label check) leaves it with no file and no line, and the run goes on with the rest:
    it ends with exit 1, no `complete` line, and every such figure named in its report,
    so one run finds them all.
  - **Its last line, when every figure has its line:** `complete`, whose fingerprint
    fields equal the first line's.
- **A deployment changed during a run** is seen at the next figure to finish, which stops
  the run at once with exit 1 and no `complete` line. Figures still being drawn when it
  stops get no line.
- **What the fingerprint cannot see** (research R10):
  - the render service's `build` hashes its own code, not the website's built page it
    loads, which is what draws;
  - a deployment changed and undone between two reads around one figure;
  - `--content` is whatever the operator names, which nothing ties to the content
    service the render service reads, and a graph rebuilt within a release behind it is
    not caught.

  So the website's page must not be redeployed during a run, and `--content` must be the
  render service's own content service. Three things are asked of WebsiteAngular (T042):
  the render service's health answer reporting the build of the page it loads;
  reporting its content service's release and graph checksum, which needs the content
  service to serve the checksum (a new endpoint) or the render service to read the
  graph's `DBInfo` itself; and a header on each drawing naming both, so each figure
  records what drew it rather than what was read around it.

- **What `book` checks,** against its own graph and EHLD summary (contracts/cli.md),
  before anything is printed:
  - the manifest's last line is a whole `complete` line whose fingerprint fields equal
    the first line's, and every line is whole JSON, or the fault is `incomplete-folder`;
  - its graph has a `DBInfo` checksum, or the fault is `no-checksum`;
  - the fingerprint's release number and checksum are its graph's, or the fault is
    `stale-folder <folder's release>/<checksum> <graph's release>/<checksum>`;
  - the fingerprint's summary hash is that of its `--files`' summary, or the fault is
    `stale-summary`;
  - each figure the Figure rules choose has a line, and it is what they choose; a line
    for an event they give no figure is a fault too: `stale-figure <stId>`;
  - each figure's file is there, or the fault is `missing-file {stId}.svg`.
- **Beside the figures:** the manifest, `figures.jsonl`, and `report.json` when `--report` points there,
  holding no names, only stable identifiers, kinds, times and counts. Any other file
  is ignored, so a folder drawn for a release can be read again by a book made from the
  same graph.
- **A figure that could not be drawn** has no file and no line: `figures` draws the rest,
  exits 1 with no `complete` line, and the book refuses the folder.
