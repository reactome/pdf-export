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
- **The manifest,** `figures.json`, written beside its name and moved into place each
  time it changes:
  - **the folder's fingerprint:** the graph's release number and checksum (its `DBInfo`),
    the release the content service behind the render service answers, and the render
    service's build (its health answer's `build`);
  - **an entry per file:** its kind, the stable identifier drawn (`source`) and its
    sorted `highlight` ids.
- **The order of writing:** a figure's file is moved into place first, then its entry is
  written. A file with no entry, or an entry whose file is missing, is drawn again; so a
  run stopped between the two never leaves an old file under a new entry.
- **Resuming** (`figures` into a folder that has a manifest): only with the same
  fingerprint. A different graph, release, content service release or render build is
  refused (exit 2): a new folder is drawn, so one folder never mixes two looks or two
  graphs. With the same fingerprint, a file whose entry matches what the Figure rules
  now choose is kept; one that differs is drawn again.
- **What `book` checks** against its own graph and EHLD summary (contracts/cli.md):
  - the fingerprint's release number and checksum are its graph's, or the fault is
    `stale-folder <release>`, and nothing is printed;
  - each figure's entry is what the Figure rules choose, or the fault is
    `stale-figure <stId>`;
  - each figure's file is there, or the fault is `missing-file {stId}.svg`.
- **Beside the figures:** the manifest, and `report.json` when `--report` points there,
  holding no names, only stable identifiers, kinds, times and counts. Any other file
  is ignored, so a folder drawn for a release can be read again by a book made from the
  same graph.
- **A figure that could not be drawn** has no file: `figures` exits 1, and the book's
  preflight would fail on it.
