// The figures client (spec 001 T014, T046; contracts/render.md): asks the website's render
// service for each figure as SVG. A 503 is tried once more after a pause; when `figures` asks
// (`retryUnanswered`, T046), a 504 or a timeout (the body's included) is too, while `serve`
// keeps one try of them, as SC-005 bounds its time. Any other refusal, or the second try's,
// is a missing figure with its reason and its cause (contracts/figures.md): `unanswered` (no
// connection, a timeout, a body cut short, a 502, 503 or 504), `failed` (any other 5xx: the
// page failed on that figure), `refused` (a 4xx) or `invalid` (any other answer that is not
// an SVG drawing), for the caller to fail the book's figures on or go on without (a
// single-event PDF). The caller's own end (its signal) is thrown as it is, never read as a
// missing figure.
import { setTimeout as pause } from 'node:timers/promises';
import { causeCode } from '../unknown.ts';

/**
 * What to draw (data-model.md's Figure), and the analysis report's genome-wide overview
 * of a species, by its taxonomy id (spec 002 contracts/render.md).
 */
export type FigureRequest =
  | { kind: 'diagram' | 'ehld'; stId: string; token?: string }
  | { kind: 'ancestor'; stId: string; highlight: readonly string[]; token?: string }
  | { kind: 'reaction'; stId: string; token?: string }
  | { kind: 'genome-wide'; species: string; token?: string };

/** What a request's messages name it by: its stable id, or the overview. */
export function requestName(request: FigureRequest): string {
  return request.kind === 'genome-wide' ? 'genome-wide' : request.stId;
}

/** Why a figure is missing (contracts/figures.md). */
export type MissingCause = 'unanswered' | 'failed' | 'refused' | 'invalid';

export type FigureAnswer = { svg: string } | { missing: string; cause: MissingCause };

export interface ClientOptions {
  /** How long one request may take, its body included. */
  timeoutMs?: number;
  /** The pause before the one retry (the render service asks for 5 s after a 503). */
  retryPauseMs?: number;
  /** Retry a 504 or a timeout once too, as a 503 is: `figures` asks it, `serve` does not. */
  retryUnanswered?: boolean;
  /** The caller's own end: the service's deadline for the PDF, or `figures`' stop. */
  signal?: AbortSignal;
}

/**
 * The request's URL. The token is given decoded (its padding as `=`), and URLSearchParams
 * encodes it once, so the service is sent the canonical token, `=` as `%3D`: a token given
 * already encoded (`canonicalToken`'s answer) would be sent as `%253D`, another token.
 */
export function figureUrl(base: string, request: FigureRequest): URL {
  const url = new URL(
    `render/${encodeURIComponent(requestName(request))}.svg`,
    base.endsWith('/') ? base : `${base}/`
  );
  if (request.kind === 'genome-wide') url.searchParams.set('species', request.species);
  if (request.kind === 'ancestor') url.searchParams.set('highlight', request.highlight.join(','));
  if (request.kind === 'reaction') url.searchParams.set('layout', 'reaction');
  if (request.token !== undefined) url.searchParams.set('token', request.token);
  return url;
}

/** A status's cause: 502, 503 and 504 say the service did not draw for want of time or room. */
function statusCause(status: number): MissingCause {
  if (status === 502 || status === 503 || status === 504) return 'unanswered';
  if (status >= 500) return 'failed';
  if (status >= 400) return 'refused';
  return 'invalid';
}

export async function fetchFigure(
  base: string,
  request: FigureRequest,
  { timeoutMs = 60_000, retryPauseMs = 5_000, retryUnanswered = false, signal }: ClientOptions = {}
): Promise<FigureAnswer> {
  const url = figureUrl(base, request);
  /** The caller's end is its own, not the render service failing: it is thrown, not missing. */
  const stopped = (): void => {
    if (signal?.aborted) throw signal.reason;
  };
  for (let attempt = 1; ; attempt++) {
    stopped();
    const answer = await once(url, requestName(request), timeoutMs, signal, stopped);
    if (!('retry' in answer)) return answer;
    if (attempt > 1 || !(answer.retry === 503 || retryUnanswered)) return answer.missing;
    // the pause ends with the caller's end too
    try {
      await pause(retryPauseMs, undefined, signal ? { signal } : {});
    } catch (error) {
      stopped();
      throw error;
    }
  }
}

type Attempt =
  | FigureAnswer
  /** A missing figure that may be tried again: a 503, or (for `figures`) a 504 or a timeout. */
  | { retry: 503 | 'other'; missing: FigureAnswer & { cause: MissingCause } };

/** One request for a figure, its answer read whole within `timeoutMs`. */
async function once(
  url: URL,
  stId: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  stopped: () => void
): Promise<Attempt> {
  const timeout = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, { signal: signal ? AbortSignal.any([timeout, signal]) : timeout });
  } catch (error) {
    stopped();
    const missing = {
      missing: `${stId}: no answer (${reason(error)})`,
      cause: 'unanswered',
    } as const;
    return timedOut(error) ? { retry: 'other', missing } : missing;
  }
  if (response.ok) {
    const type = response.headers.get('content-type') ?? '';
    if (!/^image\/svg\+xml(;|$)/.test(type)) {
      await response.body?.cancel();
      return { missing: `${stId}: not an SVG (${type || 'no type'})`, cause: 'invalid' };
    }
    // The timeout covers the body too: one cut short is a missing figure, not a failure
    try {
      return { svg: await response.text() };
    } catch (error) {
      stopped();
      const missing = {
        missing: `${stId}: the answer was cut short (${reason(error)})`,
        cause: 'unanswered',
      } as const;
      return timedOut(error) ? { retry: 'other', missing } : missing;
    }
  }
  await response.body?.cancel();
  const missing = {
    missing: `${stId}: the render service answered ${String(response.status)}`,
    cause: statusCause(response.status),
  };
  if (response.status === 503) return { retry: 503, missing };
  if (response.status === 504) return { retry: 'other', missing };
  return missing;
}

/** A request ended by its own timeout (fetch's, or the body's read). */
function timedOut(error: unknown): boolean {
  return error instanceof Error && error.name === 'TimeoutError';
}

/** An error's name, and its cause's code where there is one (ECONNREFUSED, say). */
function reason(error: unknown): string {
  const name = error instanceof Error ? error.name : String(error);
  const code = causeCode(error);
  return code === undefined ? name : `${name}: ${code}`;
}
