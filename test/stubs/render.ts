// The render stub (spec 001 T004): contracts/render.md's service, answering the fixture's
// events from recorded SVGs in ci/fixture/figures/, as WebsiteAngular's render service
// answers (tools/render/service.ts): its type, a 400 for another format or a parameter
// given twice, a JSON error body, and Retry-After on a 503. It answers 400 to a query
// parameter the contract does not name, so a wrongly named one fails a test instead of
// passing silently, and refuses on request with 404, 503 or a timeout.
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
export type Refusal = 404 | 503 | 'timeout' | 'stall-body' | 'not-svg';

export interface RenderStub {
  /** The base URL: requests go to `${url}/render/{stId}.svg`. */
  url: string;
  /** Every request's path and query, in order. */
  requests: string[];
  /** Refuse requests for a stable id, `times` times (every time without it). */
  refuse(stId: string, how: Refusal, times?: number): void;
  /** Forget the refusals and the recorded requests, for the next test. */
  reset(): void;
  close(): Promise<void>;
}

/**
 * The figure for a request: the recorded SVG, with a highlight marked as the render
 * service selects events (`data-highlight`) and an analysis marked as an overlay
 * (`data-token`), so a test can tell which was asked for.
 */
function figure(stId: string, query: URLSearchParams): string | undefined {
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
  return svg;
}

export async function startRenderStub(): Promise<RenderStub> {
  const requests: string[] = [];
  const refusals = new Map<string, { how: Refusal; left: number }>();
  const hanging = new Set<import('node:http').ServerResponse>();

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://stub');
    requests.push(url.pathname + url.search);
    const error = (status: number, message: string, headers: Record<string, string> = {}) =>
      res
        .writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers })
        .end(JSON.stringify({ error: message }));
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
    const refusal = refusals.get(stId);
    if (refusal && refusal.left !== 0) {
      refusal.left -= 1;
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
      else error(404, `No figure for ${stId}`);
      return;
    }
    const svg = figure(stId, url.searchParams);
    if (svg === undefined) {
      error(404, `No figure for ${stId}`);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8' }).end(svg);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${String(port)}`,
    requests,
    refuse(stId, how, times = -1) {
      refusals.set(stId, { how, left: times });
    },
    reset() {
      refusals.clear();
      requests.length = 0;
    },
    async close() {
      // A timed-out request's response is held open; close it with the connections, so the
      // tests end even when a client never gave up on one.
      for (const res of hanging) res.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        })
      );
    },
  };
}
