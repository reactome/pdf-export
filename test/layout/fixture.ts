// The fixture's model and figures for the layout's tests (spec 001 T018): the documents are
// built from the fixture graph, and each figure is the recorded SVG the render stub answers.
import { existsSync, readFileSync } from 'node:fs';

import { graphSettings, openGraph } from '../../src/graph/connection.ts';
import { eventByIdentifier } from '../../src/graph/queries.ts';
import { figureKey } from '../../src/layout/figure.ts';
import { buildBook, buildSingle } from '../../src/model/build.ts';
import type { Document } from '../../src/model/types.ts';

const FIXTURE = new URL('../../ci/fixture/', import.meta.url);

export const skipWithoutGraph = process.env['NEO4J_URI']
  ? false
  : 'no fixture graph: set NEO4J_URI';

/** The fixture's EHLD summary: the illustrated pathways. */
export const illustrated = new Set(
  readFileSync(new URL('files/ehld/svgsummary.txt', FIXTURE), 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('R-'))
);

export interface Built {
  book: Document;
  /** A pathway at depth 1, with a contents list. */
  pathway: Document;
  /** A reaction alone. */
  reaction: Document;
}

export async function buildFixture(): Promise<Built> {
  const graph = openGraph(graphSettings(process.env));
  try {
    const single = async (stId: string, depth: 0 | 1) => {
      const found = await eventByIdentifier(graph, stId);
      if (!found || !('event' in found)) throw new Error(`${stId} is not an event`);
      return buildSingle(graph, found.event, { depth, illustrated });
    };
    return {
      book: await buildBook(graph, { illustrated }),
      // beta pathway, and Reaction one
      pathway: await single('R-HSA-90000100', 1),
      reaction: await single('R-HSA-90000211', 0),
    };
  } finally {
    await graph.close();
  }
}

/** Each document's figures, by figureKey, as the render stub draws them. */
export function fixtureFigures(...docs: Document[]): Map<string, string> {
  const figures = new Map<string, string>();
  for (const doc of docs) {
    for (const place of doc.places) {
      const figure = place.full ? place.section.figure : null;
      if (!figure) continue;
      const file = new URL(
        `figures/${figure.stId}${figure.kind === 'reaction' ? '.reaction' : ''}.svg`,
        FIXTURE
      );
      if (existsSync(file)) figures.set(figureKey(figure), readFileSync(file, 'utf8'));
    }
  }
  return figures;
}
