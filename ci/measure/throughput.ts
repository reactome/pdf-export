// T005 (research R3, R7): how fast the render service draws the book's figures.
//
// Draws a fixed sample of figures, in the book's mix, through a running render
// service, as the book's client asks for them (src/figures/client.ts), and reports
// figures a second, each kind's times, and the extrapolation to the book. The
// service's own settings (RENDER_CONCURRENCY, RENDER_QUEUE, a cold cache) are the
// caller's: start it with them, then run this once per setting.
//
//   NEO4J_URI=bolt://127.0.0.1:7687 node ci/measure/throughput.ts \
//     --render http://127.0.0.1:4311/RenderService --figures 2000 --parallel 4 \
//     [--container name] [--seed 98] [--min-free-mb 2500]
//
// The sample comes from the release graph, seeded, so every run draws the same
// figures. The output is identifiers and numbers only: no names.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { graphSettings, openGraph, type Graph } from '../../src/graph/connection.ts';
import { diagramChoices } from '../../src/graph/queries.ts';
import { fetchFigure, type FigureRequest } from '../../src/figures/client.ts';

/** The book's mix (research R7): 16,424 reactions, 1,170 + 220 diagrams, 1,499 selections. */
const MIX = { reaction: 0.85, diagram: 0.06, ehld: 0.01, ancestor: 0.08 } as const;
/** The figures the human book needs at release 98 (research R7). */
const BOOK = 19_313;
/** SC-003's figures stage (research R7). */
const BUDGET_S = 44 * 60;

const { values } = parseArgs({
  options: {
    render: { type: 'string' },
    figures: { type: 'string', default: '2000' },
    parallel: { type: 'string', default: '2' },
    container: { type: 'string' },
    seed: { type: 'string', default: '98' },
    species: { type: 'string', default: 'Homo sapiens' },
    'min-free-mb': { type: 'string', default: '2500' },
  },
});
if (!values.render) throw new Error('--render is required: the render service to measure');
const render = values.render;
const total = Number(values.figures);
const parallel = Number(values.parallel);
const minFreeMb = Number(values['min-free-mb']);

/** A small seeded generator (mulberry32), so a sample can be drawn again. */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(from: readonly T[], n: number, next: () => number): T[] {
  const pool = [...from];
  const chosen: T[] = [];
  while (chosen.length < n && pool.length > 0) {
    chosen.push(pool.splice(Math.floor(next() * pool.length), 1)[0] as T);
  }
  return chosen;
}

async function sample(graph: Graph, species: string, n: number, seed: number) {
  const next = random(seed);
  const ids = async (where: string) =>
    (
      await graph.read<{ stId: string; dbId: number }>(
        `MATCH (e:Event {speciesName: $species}) WHERE ${where}
         RETURN e.stId AS stId, e.dbId AS dbId ORDER BY e.dbId`,
        { species }
      )
    ).map((row) => row);
  const reactions = await ids('e:ReactionLikeEvent');
  const diagrams = await ids(
    'e:Pathway AND coalesce(e.hasDiagram, false) AND NOT coalesce(e.hasEHLD, false)'
  );
  const ehlds = await ids(
    'e:Pathway AND coalesce(e.hasDiagram, false) AND coalesce(e.hasEHLD, false)'
  );
  const drawnElsewhere = await ids('e:Pathway AND NOT coalesce(e.hasDiagram, false)');

  const count = (share: number) => Math.round(n * share);
  const chosenSelections = pick(drawnElsewhere, count(MIX.ancestor), next);
  const choices = await diagramChoices(
    graph,
    chosenSelections.map((p) => p.dbId)
  );
  const requests: FigureRequest[] = [
    ...pick(reactions, n - count(MIX.diagram) - count(MIX.ehld) - count(MIX.ancestor), next).map(
      (r): FigureRequest => ({ kind: 'reaction', stId: r.stId })
    ),
    ...pick(diagrams, count(MIX.diagram), next).map((p): FigureRequest => ({
      kind: 'diagram',
      stId: p.stId,
    })),
    ...pick(ehlds, count(MIX.ehld), next).map((p): FigureRequest => ({
      kind: 'ehld',
      stId: p.stId,
    })),
    ...chosenSelections.flatMap((p): FigureRequest[] => {
      const choice = choices.get(p.dbId);
      const ancestor = choice?.ancestors[0];
      return ancestor
        ? [{ kind: 'ancestor', stId: ancestor.stId, highlight: choice.reactions }]
        : [];
    }),
  ];
  // Interleaved, as the book's sections are: kinds in a run are not drawn apart.
  return pick(requests, requests.length, next);
}

/** Free memory on the host, from /proc/meminfo (MemAvailable). */
function freeMb(): number {
  const line = readFileSync('/proc/meminfo', 'utf8').match(/^MemAvailable:\s+(\d+) kB/m);
  return line ? Math.round(Number(line[1]) / 1024) : Number.NaN;
}

/** The container's CPU and memory now, as `docker stats` gives them. */
function containerStats(name: string): { cpu: number; memMb: number } | null {
  try {
    const out = execFileSync(
      'docker',
      ['stats', '--no-stream', '--format', '{{.CPUPerc}} {{.MemUsage}}', name],
      { encoding: 'utf8' }
    ).trim();
    const [cpu = '', mem = ''] = out.split(' ');
    const amount = Number.parseFloat(mem);
    const memMb = /GiB/.test(mem) ? amount * 1024 : /KiB/.test(mem) ? amount / 1024 : amount;
    return { cpu: Number.parseFloat(cpu), memMb: Math.round(memMb) };
  } catch {
    return null;
  }
}

const graph = openGraph(graphSettings(process.env));
let requests: FigureRequest[];
try {
  requests = await sample(graph, values.species, total, Number(values.seed));
} finally {
  await graph.close();
}

type Done = { kind: FigureRequest['kind']; ms: number; ok: boolean; reason?: string };
const done: Done[] = [];
const stats: { cpu: number; memMb: number }[] = [];
let lowestFreeMb = freeMb();
let stoppedFor: string | null = null;

const watch = setInterval(() => {
  lowestFreeMb = Math.min(lowestFreeMb, freeMb());
  if (lowestFreeMb < minFreeMb) stoppedFor ??= `host memory fell to ${String(lowestFreeMb)} MB`;
  if (values.container) {
    const s = containerStats(values.container);
    if (s) stats.push(s);
  }
}, 5_000);

const started = Date.now();
let nextIndex = 0;
async function worker() {
  while (stoppedFor === null && nextIndex < requests.length) {
    const request = requests[nextIndex++] as FigureRequest;
    const t = Date.now();
    const answer = await fetchFigure(render, request, { timeoutMs: 120_000 });
    done.push({
      kind: request.kind,
      ms: Date.now() - t,
      ok: 'svg' in answer,
      ...('missing' in answer ? { reason: answer.missing.slice(0, 120) } : {}),
    });
  }
}
await Promise.all(Array.from({ length: parallel }, worker));
clearInterval(watch);
const seconds = (Date.now() - started) / 1000;

const ok = done.filter((d) => d.ok);
const quantile = (ms: number[], q: number) =>
  ms.length ? ([...ms].sort((a, b) => a - b)[Math.floor(q * (ms.length - 1))] ?? 0) : 0;
const byKind = Object.fromEntries(
  (['reaction', 'diagram', 'ehld', 'ancestor'] as const).map((kind) => {
    const ms = ok.filter((d) => d.kind === kind).map((d) => d.ms);
    return [
      kind,
      {
        drawn: ms.length,
        medianS: quantile(ms, 0.5) / 1000,
        p90S: quantile(ms, 0.9) / 1000,
      },
    ];
  })
);
const perSecond = ok.length / seconds;
const reasons: Record<string, number> = {};
for (const d of done.filter((x) => !x.ok))
  reasons[d.reason ?? '?'] = (reasons[d.reason ?? '?'] ?? 0) + 1;
const peak = (pick: (s: { cpu: number; memMb: number }) => number) =>
  stats.length ? Math.max(...stats.map(pick)) : null;
const mean = (pick: (s: { cpu: number; memMb: number }) => number) =>
  stats.length ? Math.round(stats.map(pick).reduce((a, b) => a + b, 0) / stats.length) : null;

console.log(
  JSON.stringify(
    {
      render,
      parallel,
      sampled: requests.length,
      asked: done.length,
      drawn: ok.length,
      missing: done.length - ok.length,
      missingReasons: reasons,
      stoppedFor,
      seconds: Math.round(seconds),
      figuresPerSecond: Number(perSecond.toFixed(3)),
      byKind,
      bookMinutes: Math.round(BOOK / perSecond / 60),
      budgetMinutes: BUDGET_S / 60,
      neededPerSecond: Number((BOOK / BUDGET_S).toFixed(2)),
      container: values.container
        ? {
            meanCpuPercent: mean((s) => s.cpu),
            peakCpuPercent: peak((s) => s.cpu),
            peakMemMb: peak((s) => s.memMb),
          }
        : null,
      lowestHostFreeMb: lowestFreeMb,
    },
    null,
    2
  )
);
