# pdf-export

Reactome's pathway PDFs from the graph: the release's book (`TheReactomeBook`), the
website's PDF of one pathway or reaction, and the report of an analysis, from one
implementation, under loose open-source licences, with diagrams in the website's pathway
browser's look. It is to replace [`reactome/event-pdf`](https://github.com/reactome/event-pdf)
and, for the analysis report, `reactome/analysis-report`.

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
  name or a submitted identifier.

See [`specs/002-analysis-report/`](specs/002-analysis-report/) for the address's answers
(`contracts/service.md`) and what the report holds.

The work is specified before it is built: see [`specs/`](specs/) and
[`CLAUDE.md`](CLAUDE.md). The principles are in
[`.specify/memory/constitution.md`](.specify/memory/constitution.md).

Licensed under the Apache License 2.0 ([`LICENSE`](LICENSE)).
