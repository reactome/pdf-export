// The replay (spec 002 T020, SC-202, research R5): T001's set of requests for the report's
// address, sent to today's analysis service and to pdf-export's `serve`, one at a time, and
// each pair of answers compared: the status, the `Content-Type`, the file name, and for
// anything but a PDF the body. The framework's 400 carries the time of the request, the one
// field that differs between two requests; it is compared by its form. A difference is
// allowed only where the spec's Assumptions list one, and then pdf-export's answer must be
// the listed one: the same answer as today's there is a difference too.
//
// What it prints holds no token, no identifier and no body: a case's name, the statuses,
// the types and the file names (a body echoes the token in its path).
import { isRecord } from '../unknown.ts';

/** What pdf-export must answer instead of today's, and why (spec Assumptions). */
export interface Listed {
  status: number;
  /** The body, for an error. */
  body?: string;
  reason: string;
}

export interface ReplayCase {
  name: string;
  /** The path and query, from the service's root: `/AnalysisService/report/…`. */
  path: string;
  listed?: Listed;
}

export interface ReplayTokens {
  /** A result the service holds. */
  good: string;
  /** Dated long ago, never issued: 404. */
  unknown: string;
  /** Dated within the service's 7 days, with no result: 410. */
  gone: string;
}

/** The analysis service's JSON error, as today's writes it and pdf-export too. */
export const serviceBody = (code: number, reason: string): string =>
  `${JSON.stringify({ code, reason, messages: [] })}\n`;

const MALFORMED: Listed = {
  status: 404,
  body: serviceBody(404, 'Not Found'),
  reason: "a malformed token is 404, where today's answers 500 or the container's 400 (R8)",
};

/** A token as the analysis service issues it: Base64 of `{yyyyMMddHHmmss}_{counter}`. */
export function issued(decoded: string): string {
  return Buffer.from(decoded, 'latin1').toString('base64').replaceAll('=', '%3D');
}

/** Tokens for the unknown and gone cases, beside the caller's good one. */
export function replayTokens(good: string, now: Date): ReplayTokens {
  const today = now.toISOString().replace(/\D/g, '').slice(0, 8);
  return {
    good,
    unknown: issued('20200101000000_999999999'),
    gone: issued(`${today}000000_999999999999`),
  };
}

/**
 * T001's set (research R5's table), with T020's additions: a parameter given twice, and
 * `importableOnly` of a space.
 */
export function replayCases(tokens: ReplayTokens): ReplayCase[] {
  const at = (token: string, species: string, query = '', file = 'report'): string =>
    `/AnalysisService/report/${token}/${species}/${file}.pdf${query}`;
  const good = (query: string, species = '9606'): string => at(tokens.good, species, query);
  const cases: ReplayCase[] = [
    { name: 'the defaults', path: good('') },
    ...['0', '1', '-1', '50', '51', '', 'abc', '1.5'].map((n) => ({
      name: `number=${n}`,
      path: good(`?number=${n}`),
    })),
    ...['UNIPROT', 'uniprot', 'CHEBI', 'NOTONE'].map((r) => ({
      name: `resource=${r}`,
      path: good(`?resource=${r}`),
    })),
    ...['true', 'false', '1', 'maybe'].map((f) => ({
      name: `importableOnly=${f}`,
      path: good(`?importableOnly=${f}`),
    })),
    {
      name: 'importableOnly=%20',
      path: good('?importableOnly=%20'),
      listed: {
        status: 200,
        reason: "a flag of spaces alone is the default; today's reads it as no value (T006)",
      },
    },
    { name: 'diagramProfile=Standard', path: good('?diagramProfile=Standard') },
    { name: 'analysisProfile=Strosobar', path: good('?analysisProfile=Strosobar') },
    { name: 'fireworksProfile=Copper%20Plus', path: good('?fireworksProfile=Copper%20Plus') },
    { name: 'diagramProfile=nonesuch', path: good('?diagramProfile=nonesuch') },
    ...['Homo_sapiens', 'hOMO_SAPIENS', 'Homo%20sapiens', '48887', 'Mus_musculus'].map((s) => ({
      name: `species ${s}`,
      path: good('', s),
    })),
    { name: 'species unknown', path: good('', 'Nonesuch_species') },
    { name: 'species unknown, token unknown', path: at(tokens.unknown, 'Nonesuch_species') },
    { name: 'number=abc, species unknown', path: good('?number=abc', 'Nonesuch_species') },
    { name: 'token unknown', path: at(tokens.unknown, '9606') },
    { name: 'token gone', path: at(tokens.gone, '9606') },
    { name: 'token malformed', path: at('notatoken', '9606'), listed: MALFORMED },
    { name: 'token malformed, species unknown', path: at('notatoken', 'Nonesuch_species') },
    { name: 'token holding %2F', path: at(`ab%2F${tokens.good}`, '9606'), listed: MALFORMED },
    { name: 'another file name', path: at(tokens.good, '9606', '', 'another') },
    { name: 'number=7&number=abc', path: good('?number=7&number=abc') },
    {
      name: 'importableOnly=true&importableOnly=maybe',
      path: good('?importableOnly=true&importableOnly=maybe'),
    },
    { name: 'resource=UNIPROT&resource=ENSEMBL', path: good('?resource=UNIPROT&resource=ENSEMBL') },
  ];
  return cases;
}

/** One answer, as compared. */
export interface Answer {
  status: number;
  contentType: string | null;
  /** `Content-Disposition`'s file name, if it names one. */
  fileName: string | null;
  /** The body as text, for anything but a PDF. */
  body: string | null;
  /** Whether the body began as a PDF does. */
  pdf: boolean;
  /** pdf-export's 202s before its answer (FR-210, a listed difference). */
  accepted: number;
}

/** `Content-Disposition`'s file name. */
export function fileName(disposition: string | null): string | null {
  const match = /filename="?([^";]+)"?/i.exec(disposition ?? '');
  return match?.[1] ?? null;
}

/** A PDF's type as today's sends it; pdf-export's names no charset (contracts/service.md). */
const PDF_TYPES = new Set(['application/pdf;charset=UTF-8', 'application/pdf']);

/**
 * The framework's 400 by its form (research R5): its fields in order, the time of the request
 * in its own form, and the path as received. Anything else is returned as it is.
 */
export function frameworkForm(body: string): string {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return body;
  }
  if (!isRecord(value) || Object.keys(value).join() !== 'timestamp,status,error,path') return body;
  const time = value['timestamp'];
  if (typeof time !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}\+00:00$/.test(time)) {
    return body;
  }
  return JSON.stringify({ ...value, timestamp: '(the time of the request)' });
}

/** The differences between today's answer and pdf-export's for one case, in words. */
export function compareAnswers(
  replay: ReplayCase,
  today: Answer,
  ours: Answer
): { differences: string[]; listed: boolean } {
  const differences: string[] = [];
  const { listed } = replay;
  if (listed) {
    if (ours.status !== listed.status) {
      differences.push(`status ${String(ours.status)}, listed ${String(listed.status)}`);
    }
    if (listed.body !== undefined && ours.body !== listed.body) {
      differences.push('body not the listed one');
    }
    if (listed.status === 200 && !ours.pdf) differences.push('not a PDF, listed one');
    if (
      today.status === ours.status &&
      (today.body === null || frameworkForm(today.body) === frameworkForm(ours.body ?? ''))
    ) {
      differences.push("today's answer, where a difference is listed");
    }
    return { differences, listed: true };
  }
  if (today.status !== ours.status) {
    differences.push(`status ${String(ours.status)}, today's ${String(today.status)}`);
  }
  const bothPdf = today.status === 200 && ours.status === 200;
  const sameType =
    today.contentType === ours.contentType ||
    (bothPdf && PDF_TYPES.has(today.contentType ?? '') && PDF_TYPES.has(ours.contentType ?? ''));
  if (!sameType) {
    differences.push(
      `Content-Type ${String(ours.contentType)}, today's ${String(today.contentType)}`
    );
  }
  if (today.fileName !== ours.fileName) {
    differences.push(`file name ${String(ours.fileName)}, today's ${String(today.fileName)}`);
  }
  if (today.pdf !== ours.pdf) differences.push(ours.pdf ? 'a PDF, not today' : 'not a PDF');
  if (!today.pdf && frameworkForm(today.body ?? '') !== frameworkForm(ours.body ?? '')) {
    differences.push('body');
  }
  return { differences, listed: false };
}

export interface FetchOptions {
  /** Follow pdf-export's 202 until another answer, for at most this long. */
  followMs?: number;
  /** Headers to send. */
  headers?: Record<string, string>;
}

/**
 * One request's answer. A PDF is read through and dropped, never kept: it holds names. A 202
 * is asked again at once (its own wait was the pause), until another answer or `followMs`.
 */
export async function fetchAnswer(
  root: string,
  path: string,
  options: FetchOptions = {}
): Promise<Answer> {
  const ends = Date.now() + (options.followMs ?? 0);
  let accepted = 0;
  for (;;) {
    const response = await fetch(`${root.replace(/\/$/, '')}${path}`, {
      headers: options.headers ?? {},
    });
    const contentType = response.headers.get('content-type');
    const name = fileName(response.headers.get('content-disposition'));
    if (response.status === 202 && Date.now() < ends) {
      await response.arrayBuffer();
      accepted += 1;
      continue;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const pdf = Buffer.from(bytes.subarray(0, 5)).toString('latin1') === '%PDF-';
    return {
      status: response.status,
      contentType,
      fileName: name,
      body: pdf ? null : Buffer.from(bytes).toString('utf8'),
      pdf,
      accepted,
    };
  }
}

export interface ReplayResult {
  name: string;
  today: Answer;
  ours: Answer;
  differences: string[];
  listed: boolean;
}

export interface ReplayOptions {
  /** Today's analysis service's root, above `/AnalysisService`. */
  today: string;
  /** pdf-export's `serve`. */
  ours: string;
  cases: readonly ReplayCase[];
  /** The pause between requests. */
  pauseMs?: number;
  /** How long pdf-export's 202 is followed. */
  followMs?: number;
  /** Each result as it comes. */
  onResult?: (result: ReplayResult) => void;
}

/** The replay, one request at a time. */
export async function replay(options: ReplayOptions): Promise<ReplayResult[]> {
  const results: ReplayResult[] = [];
  const pause = (): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, options.pauseMs ?? 0));
  for (const replayCase of options.cases) {
    const today = await fetchAnswer(options.today, replayCase.path);
    await pause();
    const ours = await fetchAnswer(options.ours, replayCase.path, {
      followMs: options.followMs ?? 10 * 60_000,
    });
    await pause();
    const { differences, listed } = compareAnswers(replayCase, today, ours);
    const result = { name: replayCase.name, today, ours, differences, listed };
    options.onResult?.(result);
    results.push(result);
  }
  return results;
}

/** One answer for the log: status, type, file name; never the body. */
export function described(answer: Answer): string {
  const parts = [String(answer.status), answer.contentType ?? '(no type)'];
  if (answer.fileName !== null) parts.push(answer.fileName);
  if (answer.accepted > 0) parts.push(`after ${String(answer.accepted)} × 202`);
  return parts.join(' ');
}

/**
 * Call 4's refusals (research R1), as T004's stub answers them, checked against a service:
 * another content type (415) and an empty body (400), each the framework's body by its form
 * with the path as sent. Returns the differences between the two, in words.
 */
export async function callFourRefusals(
  stub: { root: string; token: string },
  service: { root: string; token: string }
): Promise<string[]> {
  const differences: string[] = [];
  const ask = async (
    at: { root: string; token: string },
    contentType: string,
    body: string
  ): Promise<{ status: number; type: string | null; form: string }> => {
    const path = `/AnalysisService/token/${at.token}/found/all`;
    const response = await fetch(`${at.root.replace(/\/$/, '')}${path}?resource=TOTAL`, {
      method: 'POST',
      headers: { 'Content-Type': contentType, Accept: 'application/json' },
      body,
    });
    const text = await response.text();
    return {
      status: response.status,
      type: response.headers.get('content-type'),
      form: frameworkForm(text).replace(JSON.stringify(path), '"(the path)"'),
    };
  };
  for (const [name, type, body] of [
    ['another content type', 'application/json', 'R-HSA-1'],
    ['an empty body', 'text/plain', ''],
  ] as const) {
    const expected = await ask(stub, type, body);
    const got = await ask(service, type, body);
    if (expected.status !== got.status) {
      differences.push(`${name}: ${String(got.status)}, the stub's ${String(expected.status)}`);
    }
    if (expected.type !== got.type) {
      differences.push(`${name}: ${String(got.type)}, the stub's ${String(expected.type)}`);
    }
    if (expected.form !== got.form) differences.push(`${name}: the body's form`);
  }
  return differences;
}
