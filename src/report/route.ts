// The report's address and its answers (spec 002 T012, contracts/service.md, research R5):
// `GET /AnalysisService/report/{token}/{species}/{filename}.pdf`, answered as today's analysis
// service answers it. A number or flag that is not one is today's framework 400, exactly, before
// anything else; then the species (404); then the token (its form, then the analysis
// service's check: 404, 410, 503); then the report. Errors are the analysis service's JSON,
// `{"code","reason","messages"}` and a newline, with no path, host, name or submitted
// identifier in a message; every answer allows any origin, as today's does.
import type { ServerResponse } from 'node:http';

import type { ReportFailure } from './report.ts';

/** The report's address: its token, species and file name, each as the path gives it. */
const ADDRESS = /^\/AnalysisService\/report\/([^/]+)\/([^/]+)\/([^/]+)\.pdf$/;

export interface ReportAddress {
  /** As given, still encoded: the token's own reading decodes it. */
  token: string;
  /** Decoded; null for one that cannot be, which no species is. */
  species: string | null;
}

/** The address's parts, or null for a path that is not the report's. */
export function reportAddress(path: string): ReportAddress | null {
  const match = ADDRESS.exec(path);
  if (!match?.[1] || !match[2]) return null;
  let species: string | null;
  try {
    species = decodeURIComponent(match[2]);
  } catch {
    species = null;
  }
  return { token: match[1], species };
}

/** Every answer's own headers, as today's: any origin may read it. */
const CORS = { 'Access-Control-Allow-Origin': '*' };

const REASONS: Readonly<Record<number, string>> = {
  404: 'Not Found',
  410: 'Gone',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

/** Each failure's status (contracts/service.md). */
export const FAILURE_STATUS: Readonly<Record<ReportFailure, number>> = {
  'no-species': 404,
  'unknown-token': 404,
  'gone-token': 410,
  unavailable: 503,
  failed: 500,
};

/** The pause a 503 asks for before the next request. */
export const RETRY_AFTER_S = 10;

/** A message for a status: never a path, a host, a name or a submitted identifier. */
const MESSAGES: Readonly<Record<number, string[]>> = {
  404: [],
  410: [],
  500: [],
  503: ['The report cannot be made now. Please try again later.'],
};

/** The analysis service's error answer: its JSON and a newline, as today's writes it. */
export function serviceError(res: ServerResponse, status: number): void {
  if (res.writableEnded || res.destroyed) return;
  const body = `${JSON.stringify({ code: status, reason: REASONS[status] ?? 'Error', messages: MESSAGES[status] ?? [] })}\n`;
  res
    .writeHead(status, {
      ...CORS,
      'Content-Type': 'application/json;charset=UTF-8',
      'Content-Length': String(Buffer.byteLength(body)),
      ...(status === 503
        ? { 'Retry-After': String(RETRY_AFTER_S), 'Cache-Control': 'no-store' }
        : {}),
    })
    .end(body);
}

/** A time as today's framework writes it: ISO 8601 with milliseconds and `+00:00`. */
export function frameworkTime(date: Date): string {
  return date.toISOString().replace('Z', '+00:00');
}

/**
 * Today's framework's 400 for a number or flag that is not one (research R5): its fields in
 * order, the time of the request and its path as received, without the query.
 */
export function frameworkBadRequest(res: ServerResponse, path: string, now: Date): void {
  const body = JSON.stringify({
    timestamp: frameworkTime(now),
    status: 400,
    error: 'Bad Request',
    path,
  });
  res
    .writeHead(400, {
      ...CORS,
      'Content-Type': 'application/json;charset=UTF-8',
      'Content-Disposition': 'inline;filename=f.txt',
      Connection: 'close',
      'Content-Length': String(Buffer.byteLength(body)),
    })
    .end(body);
}

/** The PDF, named `report.pdf` whatever the address's file name, never kept by a cache. */
export function reportPdf(res: ServerResponse, pdf: Uint8Array): void {
  res
    .writeHead(200, {
      ...CORS,
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="report.pdf"',
      'Cache-Control': 'private, no-store',
      'Content-Length': String(pdf.byteLength),
    })
    .end(pdf);
}
