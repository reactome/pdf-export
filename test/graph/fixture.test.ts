// The fixture graph holds each case the later tasks test (spec 001 T003). Needs the
// fixture loaded into a Neo4j at NEO4J_URI (CI's service; locally, see
// ci/fixture/README.md). Without NEO4J_URI the tests are skipped, and CI sets it, so
// there they run.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';

import neo4j, { type Driver } from 'neo4j-driver';

const uri = process.env['NEO4J_URI'];
// Skipped locally without a graph, but never in CI, where a missing graph is a failure
if (!uri && process.env['CI'])
  throw new Error('CI must give the fixture graph: NEO4J_URI is not set');
const skip = uri ? false : 'no fixture graph: set NEO4J_URI (ci/fixture/README.md)';

let driver: Driver | undefined;

async function count(query: string): Promise<number> {
  if (!driver) throw new Error('no driver');
  const session = driver.session({ database: process.env['NEO4J_DATABASE'] ?? 'graph.db' });
  try {
    const result = await session.run(query);
    const value: unknown = result.records[0]?.get(0);
    return neo4j.isInt(value) ? value.toNumber() : Number(value);
  } finally {
    await session.close();
  }
}

describe('the fixture graph', { skip }, () => {
  before(() => {
    driver = neo4j.driver(
      uri ?? '',
      neo4j.auth.basic(process.env['NEO4J_USER'] ?? 'neo4j', process.env['NEO4J_PASSWORD'] ?? '')
    );
  });
  after(async () => {
    await driver?.close();
  });

  test('is release 98', async () => {
    assert.equal(await count('MATCH (d:DBInfo) RETURN d.releaseNumber'), 98);
  });

  test('has three human top-level pathways whose orders all differ, and a non-human one', async () => {
    const names = async (order: string): Promise<string> => {
      if (!driver) throw new Error('no driver');
      const session = driver.session({ database: process.env['NEO4J_DATABASE'] ?? 'graph.db' });
      try {
        const result = await session.run(
          `MATCH (p:TopLevelPathway {speciesName: 'Homo sapiens'}) RETURN p.displayName AS n ORDER BY ${order}`
        );
        return result.records.map((r) => String(r.get('n'))).join(' | ');
      } finally {
        await session.close();
      }
    };
    const byId = await names('p.dbId');
    const byCase = await names('p.displayName');
    const ignoringCase = await names('toLower(p.displayName)');
    assert.equal(
      new Set([byId, byCase, ignoringCase]).size,
      3,
      `${byId} / ${byCase} / ${ignoringCase}`
    );
    assert.equal(
      await count(
        "MATCH (p:TopLevelPathway) WHERE p.speciesName <> 'Homo sapiens' RETURN count(p)"
      ),
      1
    );
  });

  test('has each kind of figure', async () => {
    // a subpathway with no diagram, under a pathway with one but no illustration
    assert.ok(
      (await count(
        'MATCH (a:Pathway {hasDiagram: true, hasEHLD: false})-[:hasEvent]->(s:Pathway {hasDiagram: false}) RETURN count(s)'
      )) >= 1
    );
    // a subpathway beneath a pathway with an illustration
    assert.ok(
      (await count(
        'MATCH (:Pathway {hasEHLD: true})-[:hasEvent]->(s:Pathway {hasDiagram: false}) RETURN count(s)'
      )) >= 1
    );
    // a subpathway with two parents that have diagrams
    assert.ok(
      (await count(
        'MATCH (s:Pathway {hasDiagram: false})<-[:hasEvent]-(p:Pathway {hasDiagram: true}) WITH s, count(p) AS n WHERE n >= 2 RETURN count(s)'
      )) >= 1
    );
    // reactions of three kinds
    assert.ok(
      (await count(
        'MATCH (r:ReactionLikeEvent {speciesName: "Homo sapiens"}) RETURN count(DISTINCT r.schemaClass)'
      )) >= 3
    );
  });

  test('has sharing, inference from two species, and preceding events in and out', async () => {
    assert.ok(
      (await count(
        'MATCH (e:Event)<-[:hasEvent]-(p:Pathway) WITH e, count(p) AS n WHERE n >= 2 RETURN count(e)'
      )) >= 1
    );
    assert.equal(
      await count(
        'MATCH (s:Event)-[:inferredTo]->(e:Event) WITH e, count(DISTINCT s.speciesName) AS n WHERE n >= 2 RETURN count(e)'
      ),
      1
    );
    assert.ok(
      (await count('MATCH (:ReactionLikeEvent)-[:precedingEvent]->() RETURN count(*)')) >= 2
    );
    // one pointing outside its source's top-level pathways, so outside a PDF of any of them
    assert.ok(
      (await count(
        `MATCH (a:ReactionLikeEvent)-[:precedingEvent]->(b)
         WHERE NOT EXISTS { MATCH (t:TopLevelPathway)-[:hasEvent*]->(a) WHERE (t)-[:hasEvent*]->(b) }
         RETURN count(*)`
      )) >= 1
    );
  });

  test('has a list whose order differs from database-id order', async () => {
    const differing = await count(
      `MATCH (p)-[r:hasEvent]->(c) WITH p, r, c ORDER BY r.order
       WITH p, collect(c.dbId) AS byOrder
       WHERE any(i IN range(1, size(byOrder) - 1) WHERE byOrder[i] < byOrder[i - 1])
       RETURN count(p)`
    );
    assert.ok(differing >= 1);
  });

  test('has the literature, edit and text cases', async () => {
    assert.ok(
      (await count(
        'MATCH (e:Event)-[:literatureReference]->(l) WITH e, count(l) AS n WHERE n > 5 RETURN count(e)'
      )) >= 1
    );
    assert.ok(
      (await count(
        'MATCH (p:Person)-[:author]->(l:Publication) WITH l, count(p) AS n WHERE n > 6 RETURN count(l)'
      )) >= 1
    );
    assert.equal(
      await count(
        'MATCH (x:Publication) RETURN count(DISTINCT [l IN labels(x) WHERE l IN ["LiteratureReference", "Book", "URL"]][0])'
      ),
      3
    );
    assert.equal(
      await count(
        'MATCH (i:InstanceEdit)-[k:authored|edited|reviewed|revised]->() RETURN count(DISTINCT type(k))'
      ),
      4
    );
    assert.ok(
      (await count('MATCH (i:InstanceEdit) WHERE i.dateTime IS NULL RETURN count(i)')) >= 1
    );
    assert.ok(
      (await count(
        'MATCH (i:InstanceEdit)-[:authored|edited|reviewed|revised]->() WHERE NOT (i)<-[:author]-() RETURN count(i)'
      )) >= 1
    );
    assert.ok(
      (await count(
        'MATCH (i:InstanceEdit) WITH i.dateTime AS d, count(i) AS n WHERE d IS NOT NULL AND n >= 2 RETURN count(d)'
      )) >= 1
    );
    assert.ok(
      (await count("MATCH (s:Summation) WHERE s.text CONTAINS '<script>' RETURN count(s)")) >= 1
    );
    // an event with two diseases, one named exactly "disease", and marked as in disease
    assert.equal(
      await count(
        `MATCH (e:Event {isInDisease: true})-[:disease]->(d) WITH e, collect(d.displayName) AS names
         WHERE size(names) >= 2 AND 'disease' IN names RETURN count(e)`
      ),
      1
    );
    assert.equal(await count('MATCH (b:Book)-[:publisher]->(:Affiliation) RETURN count(b)'), 1);
    // edit times as the release writes them
    assert.equal(
      await count(
        "MATCH (i:InstanceEdit) WHERE i.dateTime IS NOT NULL AND NOT i.dateTime =~ '\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}' RETURN count(i)"
      ),
      0
    );
  });

  test('has a node that is not an event, with a stable id', async () => {
    assert.ok(
      (await count(
        'MATCH (c:PhysicalEntity) WHERE c.stId IS NOT NULL AND NOT c:Event RETURN count(c)'
      )) >= 1
    );
  });

  test("has the release's files the preflight looks for", async () => {
    const files = new URL('../../ci/fixture/files/', import.meta.url);
    const has = (path: string): boolean => existsSync(new URL(path, files));
    if (!driver) throw new Error('no driver');
    const session = driver.session({ database: process.env['NEO4J_DATABASE'] ?? 'graph.db' });
    try {
      const result = await session.run(
        'MATCH (p:Pathway) RETURN p.stId AS stId, p.hasDiagram AS diagram, p.hasEHLD AS ehld'
      );
      for (const record of result.records) {
        const stId = String(record.get('stId'));
        if (record.get('diagram') === true) {
          assert.ok(has(`diagram/${stId}.json`), `${stId}.json`);
          assert.ok(has(`diagram/${stId}.graph.json`), `${stId}.graph.json`);
        }
        if (record.get('ehld') === true) assert.ok(has(`ehld/${stId}.svg`), `${stId}.svg`);
      }
      const named = readFileSync(new URL('ehld/svgsummary.txt', files), 'utf8')
        .split('\n')
        .filter((line) => line.startsWith('R-'));
      const held = await session.run(
        'MATCH (p:Pathway) WHERE p.stId IN $named RETURN count(p) AS n',
        { named }
      );
      const n: unknown = held.records[0]?.get('n');
      assert.ok(
        (neo4j.isInt(n) ? n.toNumber() : Number(n)) < named.length,
        'an entry the graph lacks'
      );
    } finally {
      await session.close();
    }
  });

  test('holds placeholder people only', async () => {
    assert.equal(
      await count("MATCH (p:Person) WHERE NOT p.surname STARTS WITH 'Placeholder' RETURN count(p)"),
      0
    );
  });
});
