// The figures client (spec 001 T014, contracts/render.md): asks the website's render
// service for each figure as SVG. A 503 is tried once more after a pause; any other
// refusal, a second 503 or a timeout is a missing figure, with its reason, for the caller
// to fail the book on (FR-011) or go on without (a single-event PDF).

/** What to draw (data-model.md's Figure). */
export type FigureRequest =
  | { kind: 'diagram' | 'ehld'; stId: string; token?: string }
  | { kind: 'ancestor'; stId: string; highlight: readonly string[]; token?: string }
  | { kind: 'reaction'; stId: string; token?: string };

export type FigureAnswer = { svg: string } | { missing: string };

export interface ClientOptions {
  /** How long one request may take. */
  timeoutMs?: number;
  /** The pause before the one retry of a 503, unless its Retry-After asks for less. */
  retryPauseMs?: number;
}

/**
 * The request's URL. The token is given as the analysis service issued it, and
 * URLSearchParams encodes it once: encoding it before would send a different token.
 */
export function figureUrl(base: string, request: FigureRequest): URL {
  const url = new URL(
    `render/${encodeURIComponent(request.stId)}.svg`,
    base.endsWith('/') ? base : `${base}/`
  );
  if (request.kind === 'ancestor') url.searchParams.set('highlight', request.highlight.join(','));
  if (request.kind === 'reaction') url.searchParams.set('layout', 'reaction');
  if (request.token !== undefined) url.searchParams.set('token', request.token);
  return url;
}

export async function fetchFigure(
  base: string,
  request: FigureRequest,
  { timeoutMs = 60_000, retryPauseMs = 5_000 }: ClientOptions = {}
): Promise<FigureAnswer> {
  const url = figureUrl(base, request);
  for (let attempt = 1; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      return { missing: `${request.stId}: no answer (${(error as Error).name})` };
    }
    if (response.ok) {
      const type = response.headers.get('content-type') ?? '';
      if (!/^image\/svg\+xml(;|$)/.test(type)) {
        await response.body?.cancel();
        return { missing: `${request.stId}: not an SVG (${type || 'no type'})` };
      }
      return { svg: await response.text() };
    }
    await response.body?.cancel();
    if (response.status === 503 && attempt === 1) {
      const asked = Number(response.headers.get('retry-after')) * 1000;
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Number.isFinite(asked) && asked > 0 ? Math.min(asked, retryPauseMs) : retryPauseMs
        )
      );
      continue;
    }
    return { missing: `${request.stId}: the render service answered ${String(response.status)}` };
  }
}
