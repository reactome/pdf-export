# Working in this repository

Day-to-day guidance for anyone, human or agent, changing pdf-export. The principles
are in [`.specify/memory/constitution.md`](.specify/memory/constitution.md); where
this file and the constitution disagree, the constitution wins.

## What it is

pdf-export is to write Reactome's pathway PDFs from the Neo4j graph, in place of
`reactome/event-pdf`:

- **the release's book,** `TheReactomeBook`, a folder of pathway PDFs made during
  the release;
- **the website's PDF of one pathway or reaction,** made on request.

Both from one implementation, under loose licences only, with diagrams in the
website's pathway browser's look. How is spec 001's to decide.

## Specs first: use Spec Kit

Feature-sized work goes through Spec Kit before any code, and the specs live in
`specs/`:

- **Feature-sized** means a new capability, a change to what is written, or
  anything that will take more than one pull request.
- **The sequence** is `/speckit-specify` → `/speckit-plan` → `/speckit-tasks`, then
  implementation task by task.
- **Keep `tasks.md` current.** The pull request that completes a task ticks it and
  adds its number, in the same pull request.
- **A single-PR fix** needs no new spec, but its description names the spec it
  belongs to, if any.
- **Work that also touches the website** (`reactome/WebsiteAngular`) keeps its
  website part in that repository's specs.

## The checks

- **`format`**: Markdown, YAML and JSON as Prettier 3.9.10 writes them
  (`.prettierrc`, `.prettierignore`; WebsiteAngular's settings). Fix with
  `npx prettier@3.9.10 --write .`, which a Spec Kit run needs afterwards: Spec Kit
  writes `[X]` and `*emphasis*`, which Prettier writes `[x]` and `_emphasis_`.
- The build, tests, lint and licence check come with the code, from spec 001.

## Proving what is written

- **The reference** is what `event-pdf` writes today, and the release's published
  book, from the release's download directory: fetched one file at a time, only
  when a comparison needs it, and kept out of the repository, since it holds
  people's names. No other Reactome production service is used.
- **Compare by meaning**, not bytes: a PDF's text and structure, not its bytes,
  which carry dates and ids.
- **Run against a private copy of the release's graph**, not a shared database.

## This repository is public

Nothing internal goes in it, in code, comments, commit messages or pull request
descriptions:

- no host names or server paths;
- no credentials;
- no internal release-process detail;
- no people's names from exported data.

## Before pushing

- The checks above pass.
- Every fix has a test seen failing first.
- No personal names in fixtures, samples, logs or test output.
