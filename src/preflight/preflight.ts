// The book's preflight (spec 001 T024, contracts/cli.md): every check made before anything is
// printed, each fault a line naming a stable identifier or a file, never a text or a person.
// Any fault means the book is not written (exit 1). Its checks are exported one by one for
// `figures` (T046), which runs the release files' and the characters' before drawing.
import type { Graph } from '../graph/connection.ts';
import type { ReleaseInfo } from '../graph/queries.ts';
import { buildBook } from '../model/build.ts';
import type { Document } from '../model/types.ts';
import { checkCharacters } from './characters.ts';
import { checkFiles, neededFiles, readSummary, SUMMARY } from './files.ts';
import { checkFolder, expectedFigures } from './folder.ts';
import { checkFileNames } from './names.ts';

export interface PreflightSettings {
  species: string;
  /** The release's folder: `diagram/`, `ehld/` and the EHLD summary. */
  files: string;
  /** The figures' folder `figures` wrote. */
  figures: string;
}

export interface Preflight {
  /** Each fault, in the order the checks run: names, files, folder, characters. */
  faults: string[];
  /** The book's PDFs, as built for the checks; none when the summary is missing. */
  docs: Document[] | null;
}

/** The top-level pathways the book's PDFs are named by: each PDF's first place. */
export function bookPathways(docs: readonly Document[]): { stId: string; name: string }[] {
  return docs.flatMap((doc) => {
    const [first] = doc.places;
    if (!first) return [];
    return [first.full ? first.section.event : first.event].map(({ stId, name }) => ({
      stId,
      name,
    }));
  });
}

/** The book's preflight, against its graph (whose release was read at the start). */
export async function preflight(
  graph: Graph,
  release: ReleaseInfo,
  { species, files, figures }: PreflightSettings
): Promise<Preflight> {
  const summary = readSummary(files);
  // without the summary the Figure rules cannot be followed, so nothing more is checked
  if (!summary) return { faults: [`missing-file ${SUMMARY}`], docs: null };
  const docs = await buildBook(graph, { species, illustrated: summary.illustrated });
  const expected = expectedFigures(docs);
  const faults = [
    ...checkFileNames(bookPathways(docs)),
    ...checkFiles(files, neededFiles(expected.values())),
    ...checkFolder(figures, { release, summary: summary.hash, expected }),
    ...(await checkCharacters(graph, docs, { files, expected: expected.values() })),
  ];
  return { faults, docs };
}
