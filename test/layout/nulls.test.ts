// What the graph may give as null, read from the fixture graph, printed exactly as before
// the graph's rows were typed: an author with no name (a null `displayName`) empty, as the
// old code joined the null into a list, and a summation with no text empty, as
// sanitize-html gave for null. Needs the fixture graph.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { graphSettings, openGraph, type Graph } from '../../src/graph/connection.ts';
import { eventByIdentifier } from '../../src/graph/queries.ts';
import type { Row } from '../../src/graph/rows.ts';
import { layoutSingle, pageStyles } from '../../src/layout/document.ts';
import { buildSingle } from '../../src/model/build.ts';
import { skipWithoutGraph } from './fixture.ts';

/** The graph, the summation first by order of each event with no text. */
function textlessSummation(graph: Graph): Graph {
  return {
    async read(query, params): Promise<Row[]> {
      const rows = await graph.read(query, params);
      if (!query.includes('AS summations')) return rows;
      return rows.map((row) => {
        const list = row['summations'];
        if (!Array.isArray(list)) return row;
        return {
          ...row,
          summations: list.map((s: Row) => (s['order'] === 0 ? { ...s, text: null } : s)),
        };
      });
    },
    close: () => graph.close(),
  };
}

/** Reaction one or Alpha pathway alone, laid out. */
async function laid(graph: Graph, stId: string): Promise<{ names: unknown; html: string }> {
  const found = await eventByIdentifier(graph, stId);
  assert.ok(found && 'event' in found);
  const doc = await buildSingle(graph, found.event, { depth: 0, illustrated: new Set() });
  const { html } = layoutSingle(doc, {
    site: 'https://site.example',
    date: new Date(0),
    figures: new Map(),
    styles: pageStyles(),
  });
  return { names: doc.cover.names, html };
}

/** The graph, each edit's first author with no name. */
function unnamedFirstAuthor(graph: Graph): Graph {
  return {
    async read(query, params): Promise<Row[]> {
      const rows = await graph.read(query, params);
      if (!query.includes('AS dateTime')) return rows;
      return rows.map((row) => {
        const authors = row['authors'];
        if (!Array.isArray(authors)) return row;
        return {
          ...row,
          authors: authors.map((author: Row, i) => (i === 0 ? { ...author, name: null } : author)),
        };
      });
    },
    close: () => graph.close(),
  };
}

describe('a null the graph gives', { skip: skipWithoutGraph }, () => {
  test("an author with no name is printed empty in the cover's names and the edit history", async () => {
    const graph = unnamedFirstAuthor(openGraph(graphSettings(process.env)));
    try {
      // Reaction one: its edits' authors are placeholders
      const { names, html } = await laid(graph, 'R-HSA-90000211');
      assert.deepEqual(names, [null, 'Placeholder02, P.']);
      // what the code printed before its rows were typed
      assert.match(html, /<p class="names">; Placeholder02, P\.<\/p>/);
      assert.match(
        html,
        /<tbody><tr><td>2026-01-01<\/td><td>Authored<\/td><td>; Placeholder02, P\.<\/td><\/tr><tr><td>2026-02-01<\/td><td>Reviewed<\/td><td><\/td><\/tr><tr><td>2026-03-01<\/td><td>Edited<\/td><td>; <\/td><\/tr><\/tbody>/
      );
    } finally {
      await graph.close();
    }
  });

  test('a summation with no text is printed empty', async () => {
    const graph = textlessSummation(openGraph(graphSettings(process.env)));
    try {
      // Alpha pathway: one summation, first by order
      const { html } = await laid(graph, 'R-HSA-90000200');
      assert.match(html, /<div class="summation"><\/div>/);
    } finally {
      await graph.close();
    }
  });
});
