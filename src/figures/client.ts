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
  /** The pause before the one retry of a 503 (the render service asks for 5 s). */
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
      return { missing: `${request.stId}: no answer (${reason(error)})` };
    }
    if (response.ok) {
      const type = response.headers.get('content-type') ?? '';
      if (!/^image\/svg\+xml(;|$)/.test(type)) {
        await response.body?.cancel();
        return { missing: `${request.stId}: not an SVG (${type || 'no type'})` };
      }
      // The timeout covers the body too: one cut short is a missing figure, not a failure
      try {
        return { svg: await response.text() };
      } catch (error) {
        return { missing: `${request.stId}: the answer was cut short (${reason(error)})` };
      }
    }
    await response.body?.cancel();
    if (response.status === 503 && attempt === 1) {
      await new Promise((resolve) => setTimeout(resolve, retryPauseMs));
      continue;
    }
    return { missing: `${request.stId}: the render service answered ${String(response.status)}` };
  }
}

/** An error's name, and its cause's code where there is one (ECONNREFUSED, say). */
function reason(error: unknown): string {
  const name = error instanceof Error ? error.name : String(error);
  const cause =
    error instanceof Error ? (error.cause as { code?: unknown } | undefined) : undefined;
  return typeof cause?.code === 'string' ? `${name}: ${cause.code}` : name;
}
