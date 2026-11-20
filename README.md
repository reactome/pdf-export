# pdf-export

Reactome's pathway PDFs from the graph: the release's book (`TheReactomeBook`), the
website's PDF of one pathway or reaction, and the report of an analysis, from one
implementation, under loose open-source licences, with diagrams in the website's pathway
browser's look. It is to replace [`reactome/event-pdf`](https://github.com/reactome/event-pdf)
and, for the analysis report, `reactome/analysis-report`.

## The release's book (spec 001)

The book is a folder of PDFs, one per top-level pathway of the release's species, named as
`event-pdf`'s are, which the release archives as it does today's. It is made in two runs of
this repository's image (`Dockerfile`), one after the other:

1. **`pdf-export figures`** draws every figure the book prints through WebsiteAngular's
   render service, which must read the release's own files and draw from a content service
   of the same release. Its inputs: the release's graph (`NEO4J_URI`, and the credentials as
   `NEO4J_USER` and `NEO4J_PASSWORD`), the release's folder (`--files`: `diagram/`, `ehld/`
   and the EHLD summary), the render service (`--render`) and that content service
   (`--content`). It writes the figures' folder (`--out`, which must be empty or absent;
   [`contracts/figures.md`](specs/001-pathway-pdfs/contracts/figures.md)). Set `--parallel`
   to the render service's `RENDER_CONCURRENCY`.
2. **`pdf-export book`** reads the graph, the release's folder and that figures' folder
   (`--figures`); it asks no service. `--site` is the website's address, written into the
   PDFs' links and never fetched. It writes the book's folder (`--out`) and, with
   `--report`, a run report.

```
docker build -t pdf-export .
docker run --rm --network host -e NEO4J_URI=... -v <release folder>:/files:ro -v <work>:/work \
  pdf-export figures --files /files --render <render service> --content <content service> \
  --parallel 4 --out /work/figures --report /work/figures.json
docker run --rm --network host -e NEO4J_URI=... -v <release folder>:/files:ro -v <work>:/work \
  pdf-export book --files /files --figures /work/figures --site <website> \
  --out /work/TheReactomeBook --report /work/book.json
```

- **Exit codes** ([`contracts/cli.md`](specs/001-pathway-pdfs/contracts/cli.md)): 0, done; 1,
  a fault in the release's data or files, each named (a figure missing, a character no font
  draws, a figure that could not be drawn): the step has failed and nothing is to be
  published; 2, bad arguments or a service or graph that cannot be reached. Either run
  refuses an `--out` that is not empty, so a failed run is run again into a new folder.
- **`pdf-export check-book <book folder> --files <release folder>`** checks a finished book
  for FR-011's faults (exit 1 on any); `book` runs it itself before it succeeds.
- **What it takes,** measured on release 98 (research R7): the book in about 18 minutes and
  6 GB of memory; the figures, about 19,000 of them, in hours at four at once, which spec 018
  of WebsiteAngular (render page reuse) is shortening.
- **CI** builds the image and runs both steps over the fixture graph against stub services,
  and a book with a figure missing, which must fail with exit 1 and no PDFs
  (`ci/image/run.sh`); `ci/image/check.sh` checks the image's licences and fonts.

## The website's PDF of one event (spec 001, Story 2)

**`pdf-export serve`** answers `GET /event/{stId}.pdf` (and `?token=` for an analysis's
overlay) and `GET /health`
([`contracts/service.md`](specs/001-pathway-pdfs/contracts/service.md)). WebsiteAngular's
content service sends it the website's requests. It reads the graph (`--graph` or
`NEO4J_URI`), the release's folder (`--files`), the figures' folder `figures` wrote
(`--figures`, for PDFs without an analysis), the render service (`--render`) for any other
figure, and the analysis service (`--analysis`) for a token's results. It binds
`127.0.0.1:4370` by default (`--bind`, `--port`). Every setting of every command is in
[`contracts/cli.md`](specs/001-pathway-pdfs/contracts/cli.md).

## Working on it

- **Install:** Node 24, then `npm ci` and `npx playwright-core install --with-deps
--only-shell chromium`. Commands run from the checkout: `node src/cli.ts <command>`.
- **Test:** `npm run check` runs types, lint, formatting, the unit tests and the licence
  check, as CI does. Most tests need the fixture graph: a Neo4j 4.4 with
  `ci/fixture/fixture.cypher` loaded into `graph.db` and `NEO4J_URI` set
  ([`ci/fixture/README.md`](ci/fixture/README.md)); without it they are skipped. The render,
  content and analysis services are stubs (`test/stubs/`).
- **The image:** CI builds `Dockerfile` and runs `ci/image/run.sh` (both release steps over
  the fixture, a single-event PDF, a planted fault) and `ci/image/check.sh` (licences and
  fonts in the image).
- **The checks:**
  - `check-book`: FR-011's faults in a finished book; `book` runs it before it succeeds.
  - `compare`: FR-012's comparison with `event-pdf`'s files, or with a baseline of reduced
    PDFs (`--reduced`). CI compares the fixture's book and a single-event PDF with
    `ci/fixture/expected.json`; a change to what they print rewrites it in the same pull
    request (`BASELINE=write bash ci/image/run.sh <image> <bolt address>`).
  - `src/check/look.ts`: SC-009's colours and fonts, on pages printed with the figures
    hidden; `src/check/figures.ts`: SC-008's figures against the render service's SVGs. Both
    run in the tests, on the fixture book.
  - `ci/licences.ts`: every package's licence on the allowlist (`npm run check` runs it).

## The analysis report (spec 002)

- **`pdf-export serve`** answers today's address,
  `GET /AnalysisService/report/{token}/{species}/{filename}.pdf?number&resource&importableOnly`,
  as the analysis service answers it: the species checked against the graph first, then
  the token against the analysis service, then the report. A report is made in the
  background: a request waits up to 30 s, then gets `202` with `Retry-After` (a browser, a
  page that asks again), and the same address gives the PDF once it is ready. A finished
  report is kept for an hour. Its settings, besides spec 001's: `--work` (or
  `PDF_EXPORT_WORK`), the printer's private working folder, emptied at start; the limits
  (two reports made at once, eight waiting, two of those per client as
  `X-Reactome-Client` names it, a 5-minute budget, 512 MB kept) are `ServeLimits`.
- **`pdf-export report --token <t> --species <s> -o <file>`** (`--number`, `--resource`,
  `--importable-only`, and `serve`'s `--graph`, `--files`, `--render`, `--analysis`,
  `--site`) makes one report, for checks by hand and the comparison.
- **`pdf-export compare-report <today's.pdf> <new.pdf> [--expected <file>]`** compares a
  report with today's by meaning (FR-208), printing counts and salted hashes, never a
  name or a submitted identifier. One listed difference it marks itself: a pathway's
  Modified rows where it has two or more `modified` edits (the spec's Assumptions).

See [`specs/002-analysis-report/`](specs/002-analysis-report/) for the address's answers
(`contracts/service.md`) and what the report holds.

The work is specified before it is built: see [`specs/`](specs/) and
[`CLAUDE.md`](CLAUDE.md). The principles are in
[`.specify/memory/constitution.md`](.specify/memory/constitution.md).

Licensed under the Apache License 2.0 ([`LICENSE`](LICENSE)).
