// T007 (research R7, SC-005): how long a single event's PDF takes, stage by stage, cold.
//
// For each event, at depth 1 as the website asks: the graph read and model (buildSingle),
// the figures drawn through the render service two at once (as the service's website
// settings allow), the layout, and the print with the contents' second pass. Then T005's
// (c): one figure with an analysis token, and how its time grows with requests at once.
// The render service is the caller's to start: cold (RENDER_CACHE_MAX=0, so nothing is
// cached), at its website settings, reading the release's files (RENDER_FILES).
//
//   NEO4J_URI=bolt://127.0.0.1:7687 node ci/measure/single.ts \
//     --render http://127.0.0.1:4311/ --files <release folder>/98 \
//     --token <analysis token> R-HSA-69278 R-HSA-162582 ...
//
// The output is identifiers and numbers only: no names.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fetchFigure, type FigureRequest } from '../../src/figures/client.ts';
import { graphSettings, openGraph } from '../../src/graph/connection.ts';
import { eventByIdentifier } from '../../src/graph/queries.ts';
import { layoutSingle, pageStyles } from '../../src/layout/document.ts';
import { figureKey } from '../../src/layout/figure.ts';
import { buildSingle } from '../../src/model/build.ts';
import type { Figure } from '../../src/model/types.ts';
import { Printer } from '../../src/print/print.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    render: { type: 'string' },
    files: { type: 'string' },
    token: { type: 'string' },
    parallel: { type: 'string', default: '2' },
    site: { type: 'string', default: 'https://reactome.org' },
    // Enough distinct diagrams for the largest burst of requests with a token.
    burst: { type: 'string', default: '1,2,4,8' },
  },
});
if (!values.render || !URL.canParse(values.render)) throw new Error('--render must be a URL');
if (!values.files)
  throw new Error('--files is required: the release folder with ehld/svgsummary.txt');
if (positionals.length === 0) throw new Error('name the events to measure');
const render = values.render;
const parallel = Number(values.parallel);
if (!Number.isInteger(parallel) || parallel < 1) throw new Error('--parallel must be >= 1');
const bursts = values.burst.split(',').map(Number);

const health = await fetch(new URL('health', render.endsWith('/') ? render : `${render}/`));
const { build, files } = (await health.json()) as { build?: string; files?: string };
if (files !== 'local') throw new Error(`the render service reads its files from ${String(files)}`);

const summary = readFileSync(path.join(values.files, 'ehld', 'svgsummary.txt'), 'utf8');
const illustrated = new Set(summary.split(/\r?\n/).filter((line) => line.startsWith('R-')));

/** What the render service is asked to draw a model's figure. */
function requestFor(figure: Figure, token?: string): FigureRequest {
  const t = token === undefined ? {} : { token };
  if (figure.kind === 'ancestor')
    return { kind: 'ancestor', stId: figure.stId, highlight: figure.highlight, ...t };
  return { kind: figure.kind, stId: figure.stId, ...t };
}

const seconds = (since: number) => Number(((performance.now() - since) / 1000).toFixed(2));

/** Each request in turn, `n` at once, with each one's time. */
async function drawAll(requests: FigureRequest[], n: number) {
  const times: { kind: string; s: number; ok: boolean }[] = [];
  let next = 0;
  const svgs = new Map<number, string>();
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < requests.length) {
        const i = next++;
        const request = requests[i] as FigureRequest;
        const t = performance.now();
        const answer = await fetchFigure(render, request, { timeoutMs: 120_000 });
        times.push({ kind: request.kind, s: seconds(t), ok: 'svg' in answer });
        if ('svg' in answer) svgs.set(i, answer.svg);
      }
    })
  );
  return { times, svgs };
}

const graph = openGraph(graphSettings(process.env));
const printer = await Printer.start();
const events: unknown[] = [];
try {
  for (const id of positionals) {
    const started = performance.now();
    const found = await eventByIdentifier(graph, id);
    if (!found || !('event' in found)) throw new Error(`${id} is not an event`);
    const doc = await buildSingle(graph, found.event, { depth: 1, illustrated });
    const graphS = seconds(started);

    const figures = new Map<string, Figure>();
    for (const place of doc.places) {
      const figure = place.full ? place.section.figure : null;
      if (figure) figures.set(figureKey(figure), figure);
    }
    const keys = [...figures.keys()];
    const t1 = performance.now();
    const drawn = await drawAll(
      keys.map((key) => requestFor(figures.get(key) as Figure)),
      parallel
    );
    const figuresS = seconds(t1);
    const svgs = new Map<string, string>();
    for (const [i, svg] of drawn.svgs) svgs.set(keys[i] as string, svg);

    const t2 = performance.now();
    const { html } = layoutSingle(doc, {
      site: values.site,
      date: new Date('2026-11-02T00:00:00Z'),
      figures: svgs,
      styles: pageStyles(),
    });
    const layoutS = seconds(t2);
    const t3 = performance.now();
    const pdf = await printer.single(html);
    const printS = seconds(t3);
    const pages = (
      Buffer.from(pdf)
        .toString('latin1')
        .match(/\/Type\s*\/Page[^s]/g) ?? []
    ).length;

    const reactionsBeneath = (
      await graph.read<{ n: number }>(
        `MATCH (e:Event {stId: $id}) OPTIONAL MATCH (e)-[:hasEvent*0..]->(r:ReactionLikeEvent)
         RETURN count(DISTINCT r) AS n`,
        { id: found.event.stId }
      )
    )[0]?.n;
    const row = {
      stId: found.event.stId,
      kind: found.event.kind,
      reactionsBeneath,
      figures: keys.length,
      missing: drawn.times.filter((t) => !t.ok).length,
      pages,
      seconds: {
        graph: graphS,
        figures: figuresS,
        layout: layoutS,
        print: printS,
        total: seconds(started),
      },
      figureTimes: drawn.times.map((t) => t.s),
    };
    events.push(row);
    console.error(JSON.stringify(row));
  }

  // T005's (c): one figure with an analysis token, then several at once, each distinct.
  let tokenRuns: unknown = null;
  const token = values.token;
  if (token) {
    const largest = Math.max(...bursts);
    const ids = (
      await graph.read<{ stId: string }>(
        `MATCH (p:Pathway {speciesName: 'Homo sapiens'})
         WHERE coalesce(p.hasDiagram, false) AND NOT p.stId IN $illustrated
         RETURN p.stId AS stId ORDER BY p.dbId LIMIT ${String(largest * bursts.length)}`,
        { illustrated: [...illustrated] }
      )
    ).map((row) => row.stId);
    let offset = 0;
    tokenRuns = [];
    for (const n of bursts) {
      const requests = ids
        .slice(offset, offset + n)
        .map((stId): FigureRequest => ({ kind: 'diagram', stId, token }));
      offset += n;
      const t = performance.now();
      const { times } = await drawAll(requests, n);
      (tokenRuns as unknown[]).push({
        atOnce: n,
        wallS: seconds(t),
        each: times.map((x) => x.s).sort((a, b) => a - b),
        missing: times.filter((x) => !x.ok).length,
      });
    }
  }
  console.log(JSON.stringify({ render, build, parallel, events, tokenRuns }, null, 2));
} finally {
  await printer.close();
  await graph.close();
}
