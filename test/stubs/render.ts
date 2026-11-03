// The render stub (spec 001 T004): contracts/render.md's service, answering the fixture's
// events from recorded SVGs in ci/fixture/figures/, as WebsiteAngular's render service
// answers (tools/render/service.ts): its type, a 400 for another format or a parameter
// given twice, a JSON error body, and Retry-After on a 503. It answers 400 to a query
// parameter the contract does not name, so a wrongly named one fails a test instead of
// passing silently, and refuses on request: 404, 500, 503, 504, a timeout, a body that stops
// part way, or an answer that is not SVG, for one figure or every one. A test can also plant
// text in a figure's first label, slow every answer, or silence the stub (every request held
// unanswered, `/health`'s too). Its `/health` answers as the service's does, its `build` and
// `files` settable, also from a hook run as each figure request is answered (T046), so a test can
// change the deployment between a figure's render and the read after it.
import { readFileSync, existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const FIGURES = new URL('../../ci/fixture/figures/', import.meta.url);

/** The parameters contracts/render.md names, and the values each may take. */
const PARAMETERS: Readonly<Record<string, (value: string) => boolean>> = {
  highlight: (value) => value.split(',').every((id) => /^R-[A-Z]{3}-\d+$/.test(id)),
  layout: (value) => value === 'reaction',
  token: (value) => value.length > 0,
};

/**
 * How to refuse: a status, no answer at all, an answer whose body stops part way, or an
 * answer that is not SVG.
 */
export type Refusal = 404 | 500 | 503 | 504 | 'timeout' | 'stall-body' | 'not-svg';

/** The service's health answer (contracts/render.md). */
export interface Health {
  build: string;
  files: string;
}

export interface RenderStub {
  /** The base URL: requests go to `${url}/render/{stId}.svg`. */
  url: string;
  /** Every request's path and query, in order. */
  requests: string[];
  /** Refuse requests for a stable id, `times` times (every time without it). */
  refuse(stId: string, how: Refusal, times?: number): void;
  /** Refuse requests for every figure, `times` times in all (every time without it). */
  refuseAll(how: Refusal, times?: number): void;
  /** The health answer, changed in place by a test; its build a placeholder at the start. */
  health: Health;
  /**
   * Run `hook` with each figure request's stable id just before its answer is sent: a drawing
   * or a refusal (`refused` true), a held one's as it is held.
   */
  onRender(hook: ((stId: string, refused: boolean) => void) | null): void;
  /** Hold every request from now on unanswered, `/health`'s too: a service gone silent. */
  silence(): void;
  /** Wait `ms` before each figure's answer, a refusal's too. */
  slow(ms: number): void;
  /** Put `text` at the start of the first label of every figure drawn for a stable id. */
  label(stId: string, text: string): void;
  /**
   * Forget the refusals, the planted labels, the hook, the slowness, the silence, the health
   * set and the recorded requests, and drop every answer held or delayed, for the next test.
   */
  reset(): void;
  close(): Promise<void>;
}

/**
 * The figure for a request: the recorded SVG, with a highlight marked as the render
 * service selects events (`data-highlight`) and an analysis marked as an overlay
 * (`data-token`), so a test can tell which was asked for.
 */
function figure(
  stId: string,
  query: URLSearchParams,
  label: string | undefined
): string | undefined {
  const name = query.get('layout') === 'reaction' ? `${stId}.reaction.svg` : `${stId}.svg`;
  const file = new URL(name, FIGURES);
  if (!existsSync(file)) return undefined;
  let svg = readFileSync(file, 'utf8');
  const highlight = query.get('highlight');
  const token = query.get('token');
  const marks = [
    highlight === null ? '' : ` data-highlight="${highlight}"`,
    token === null ? '' : ` data-token="${encodeURIComponent(token)}"`,
  ].join('');
  if (marks) svg = svg.replace('<svg ', `<svg${marks} `);
  if (label !== undefined) svg = svg.replace(/<text\b[^>]*>/, (tag) => `${tag}${label}`);
  return svg;
}

export async function startRenderStub(): Promise<RenderStub> {
  const requests: string[] = [];
  const refusals = new Map<string, { how: Refusal; left: number }>();
  let every: { how: Refusal; left: number } | null = null;
  const labels = new Map<string, string>();
  const hanging = new Set<import('node:http').ServerResponse>();
  const health: Health = { build: '000000000000', files: 'local' };
  let hook: ((stId: string, refused: boolean) => void) | null = null;
  let silent = false;
  let delayMs = 0;
  const delayed = new Map<NodeJS.Timeout, import('node:http').ServerResponse>();

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://stub');
    requests.push(url.pathname + url.search);
    if (silent) {
      hanging.add(res);
      return;
    }
    const error = (status: number, message: string, headers: Record<string, string> = {}) =>
      res
        .writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers })
        .end(JSON.stringify({ error: message }));
    if (url.pathname === '/health') {
      // the service's health answer (contracts/render.md)
      res
        .writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        .end(JSON.stringify(health));
      return;
    }
    const match = /^\/render\/(R-[A-Z]{3}-\d+)\.([a-z]+)$/.exec(url.pathname);
    if (!match?.[1]) {
      error(404, 'Not a render request');
      return;
    }
    const stId = match[1];
    if (match[2] !== 'svg') {
      error(400, `Not a format pdf-export asks for: ${String(match[2])}`);
      return;
    }
    const seen = new Set<string>();
    for (const [name, value] of url.searchParams) {
      if (seen.has(name)) {
        error(400, `${name} given more than once`);
        return;
      }
      seen.add(name);
      const valid = PARAMETERS[name];
      if (!valid?.(value)) {
        error(400, `Unknown parameter, or a bad value: ${name}`);
        return;
      }
    }
    if (delayMs > 0) {
      const timer = setTimeout(() => {
        delayed.delete(timer);
        if (silent) hanging.add(res);
        else answer(stId, url.searchParams, res, error);
      }, delayMs);
      delayed.set(timer, res);
      return;
    }
    answer(stId, url.searchParams, res, error);
  });

  /** Every answer held or delayed, dropped, so none reaches a later test. */
  const drop = () => {
    for (const [timer, res] of delayed) {
      clearTimeout(timer);
      res.destroy();
    }
    delayed.clear();
    for (const res of hanging) res.destroy();
    hanging.clear();
  };

  /** A figure's answer: its refusal, if it has one left, or its drawing. */
  const answer = (
    stId: string,
    query: URLSearchParams,
    res: import('node:http').ServerResponse,
    error: (status: number, message: string, headers?: Record<string, string>) => void
  ) => {
    const own = refusals.get(stId);
    const refusal = own && own.left !== 0 ? own : every && every.left !== 0 ? every : undefined;
    if (refusal) {
      refusal.left -= 1;
      hook?.(stId, true);
      if (refusal.how === 'timeout') {
        hanging.add(res);
        return;
      }
      if (refusal.how === 'stall-body') {
        res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8' });
        res.write('<svg');
        hanging.add(res);
        return;
      }
      if (refusal.how === 'not-svg') {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
        return;
      }
      if (refusal.how === 503) error(503, 'Busy', { 'Retry-After': '5' });
      else if (refusal.how === 500) error(500, `The page failed on ${stId}`);
      else if (refusal.how === 504) error(504, `No drawing in time for ${stId}`);
      else error(404, `No figure for ${stId}`);
      return;
    }
    const svg = figure(stId, query, labels.get(stId));
    if (svg === undefined) {
      error(404, `No figure for ${stId}`);
      return;
    }
    hook?.(stId, false);
    res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8' }).end(svg);
  };

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${String(port)}`,
    requests,
    refuse(stId, how, times = -1) {
      refusals.set(stId, { how, left: times });
    },
    refuseAll(how, times = -1) {
      every = { how, left: times };
    },
    health,
    onRender(next) {
      hook = next;
    },
    silence() {
      silent = true;
    },
    slow(ms) {
      delayMs = ms;
    },
    label(stId, text) {
      labels.set(stId, text);
    },
    reset() {
      drop();
      refusals.clear();
      every = null;
      labels.clear();
      hook = null;
      silent = false;
      delayMs = 0;
      Object.assign(health, { build: '000000000000', files: 'local' });
      requests.length = 0;
    },
    async close() {
      // A timed-out request's response is held open; close it with the connections, so the
      // tests end even when a client never gave up on one.
      drop();
      server.closeAllConnections();
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        })
      );
    },
  };
}
