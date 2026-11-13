# Working in this repository

Day-to-day guidance for anyone, human or agent, changing pdf-export. The principles
are in [`.specify/memory/constitution.md`](.specify/memory/constitution.md); where
this file and the constitution disagree, the constitution wins.

## What it is

pdf-export is to write Reactome's pathway PDFs from the Neo4j graph, in place of
`reactome/event-pdf`:

- **the release's book,** `TheReactomeBook`, a folder of pathway PDFs made during
  the release;
- **the website's PDF of one pathway or reaction,** made on request;
- **the analysis report** (spec 002), in place of `reactome/analysis-report`: today's
  address, `/AnalysisService/report/…`, made in the background by `serve`, and once by
  `pdf-export report`; `pdf-export compare-report` compares it with today's.

All from one implementation, under loose licences only, with diagrams in the
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

`npm run check` runs the code's gates as CI does: types (`tsc`, strict), lint
(typescript-eslint's strict type-checked rules), formatting, the unit tests (`node
--test`, on Node 24's own type stripping) and the licence check.

- **`format`**: every file as Prettier 3.9.10 writes it (`.prettierrc`,
  `.prettierignore`). Fix with `npx prettier@3.9.10 --write .`, which a Spec Kit run
  needs afterwards: Spec Kit writes `[X]` and `*emphasis*`, which Prettier writes `[x]`
  and `_emphasis_`.
- **The licence check**, `node ci/licences.ts`: every installed package's licence on
  the allowlist, and every shipped font's licence file (research R11).
- **Imports name their `.ts` file:** Node runs the TypeScript as it is, so a relative
  import, export or dynamic import of `.js` passes the type check but fails at run time;
  lint refuses each.
- **Run from a checkout:** the `pdf-export` command is `src/cli.ts`, run by Node's type
  stripping, which does not work from an installed package. Publishing would need a
  build step.

## Types, as fully as possible

The compiler is as strict as WebsiteAngular's (`tsconfig.json`): `strict`,
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`noPropertyAccessFromIndexSignature`, `noImplicitReturns`, `noUnusedLocals`,
`noUnusedParameters`, `noImplicitOverride`. Beyond the compiler:

- **Nothing on trust in `src/`.** What the code reads (a graph row, an analysis
  answer, a manifest, a JSON file, what pdf.js gives back, a thrown error) arrives
  as `unknown` and is checked into its type, refusing what does not fit: a graph
  row through `src/graph/rows.ts`, whose errors name the column and never the
  value (a null the graph may give is typed as one, not refused, where the code
  prints it sensibly: an author with no name prints empty); pdf.js's values through `src/print/pdfjs.ts`; the rest through
  `src/unknown.ts`'s checks or a reader of its own. Lint allows no `as` in
  `src/`, and no `any` or non-null `!` anywhere. The one assertion left,
  `mapStrings` in `src/layout/characters.ts`, says why on its line.
- **Say what is returned.** Every exported function has its return type written,
  and so has every function in `src/` whose type its use does not give.
- **Name the domain.** An event's kind, an edit's kind, a figure's kind, a front
  part: a union, not a bare string, where it lets the compiler catch a mix-up.
- **Scripts and tests** may assert the type of something they have just parsed,
  but never an object literal's.

## Proving what is written

- **The reference** is what `event-pdf` writes today, and the release's published
  book, from the release's download directory: fetched one file at a time, only
  when a comparison needs it, and kept out of the repository, since it holds
  people's names. No other Reactome production service is used.
- **The analysis report's reference** is today's report from a private copy of the
  analysis service, for tokens of made-up identifiers, kept outside the repository; the
  tests use the analysis and render stubs (`test/stubs/`), never a real service.
- **Compare by meaning**, not bytes: a PDF's text and structure, not its bytes,
  which carry dates and ids.
- **Run against a private copy of the release's graph**, not a shared database.

## This repository is public

Nothing internal goes in it, in code, comments, commit messages or pull request
descriptions:

- no host names or server paths;
- no credentials;
- no internal release-process detail;
- no people's names from exported data;
- nothing a user submitted to an analysis: its identifiers, its sample's or file's name,
  or its token. The report's log line holds a hash of the token keyed for the service's
  run, and its working pages live in `--work`, emptied as the service starts (FR-211).

## Before pushing

- The checks above pass.
- Every fix has a test seen failing first.
- No personal names in fixtures, samples, logs or test output.
