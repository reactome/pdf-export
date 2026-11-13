// The species the report's address names (spec 002 T006), resolved on the fixture graph.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { graphSettings, openGraph, type Graph } from '../../src/graph/connection.ts';
import { speciesByDbId, speciesByIdentifier } from '../../src/graph/queries.ts';

const skip = process.env['NEO4J_URI'] ? false : 'no fixture graph: set NEO4J_URI';
const HUMAN = { dbId: 90000002, taxId: '9606', name: 'Homo sapiens' };
const MOUSE = { dbId: 90000003, taxId: '10090', name: 'Mus musculus' };

describe("the report's species", { skip }, () => {
  let graph: Graph;
  before(() => {
    graph = openGraph(graphSettings(process.env));
  });
  after(async () => {
    await graph.close();
  });

  test('a name in any case, `_` or spaces as one space; a taxonomy id; a database id', async () => {
    for (const given of [
      'Homo sapiens',
      'Homo_sapiens',
      'hOMO_SAPIENS',
      'homo__sapiens',
      'homo _ sapiens',
      '9606',
      '90000002',
    ]) {
      assert.deepEqual(await speciesByIdentifier(graph, given), HUMAN, given);
    }
    assert.deepEqual(await speciesByIdentifier(graph, 'Mus_musculus'), MOUSE);
    assert.deepEqual(await speciesByIdentifier(graph, '10090'), MOUSE);
    assert.deepEqual(await speciesByDbId(graph, 90000003), MOUSE);
  });

  test('none for a species the graph does not hold', async () => {
    for (const given of [
      '',
      'Pan troglodytes',
      'Homo',
      ' Homo sapiens',
      '9598',
      '90000001',
      '99999999999999999999',
      'R-HSA-90000200',
    ]) {
      assert.equal(await speciesByIdentifier(graph, given), null, given);
    }
    assert.equal(await speciesByDbId(graph, 90000100), null, 'a pathway, not a species');
  });
});
