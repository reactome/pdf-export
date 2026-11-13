// Making a report (spec 002 T011): the species from the graph, the token's check, the
// analysis, the model, the pathways' details, the figures, the layout and the print, in that
// order, with spec 001's printer. The PDF's bookmarks are Chromium's, from the parts'
// headings and, a level below the details', each pathway's; its running header names the
// report, or on a part's pages that part; every page but the cover is numbered. Every
// internal link is checked: its anchor on the page before the print, and its landing on a
// page of the PDF after.
import { createHmac, randomBytes } from 'node:crypto';

import { getDocument, VerbosityLevel } from 'pdfjs-dist/legacy/build/pdf.mjs';

import { AnalysisError, type AnalysisFailure } from '../analysis/error.ts';
import {
  checkToken,
  readReportAnalysis,
  reportResource,
  type TokenCheck,
} from '../analysis/report.ts';
import type { Graph } from '../graph/connection.ts';
import {
  release as readRelease,
  speciesByDbId,
  speciesByIdentifier,
  type SpeciesRef,
} from '../graph/queries.ts';
import { CharacterLog } from '../layout/characters.ts';
import { htmlPage, marginBoxes, pageStyles, type Styles } from '../layout/document.ts';
import { Links } from '../layout/html.ts';
import { isPageRef } from '../print/pdfjs.ts';
import { isRecord } from '../unknown.ts';
import { readDetails } from './details.ts';
import { OVERVIEW, Slots, drawReportFigures, pathwayFigures } from './figures.ts';
import {
  PARTS,
  PART_NAMES,
  onRequestReport,
  reportBodyHtml,
  reportContents,
  reportTitle,
  type ReportPart,
} from './layout.ts';
import { buildReport, type ReportModel } from './model.ts';

/** Why a report could not be made: the species unknown, the token's reasons, or a failure. */
export type ReportFailure = 'no-species' | AnalysisFailure | 'failed';

export class ReportError extends Error {
  readonly reason: ReportFailure;
  constructor(reason: ReportFailure, message: string) {
    super(message);
    this.name = 'ReportError';
    this.reason = reason;
  }
}

/** What a report is asked for: the address's token and species, and its parameters. */
export interface ReportRequest {
  token: string;
  /** As the address gives it: a name, a taxonomy id or a database id. */
  species: string;
  /** Already clamped to 1–50 (src/report/model.ts). */
  number: number;
  resource: string | undefined;
  importableOnly: boolean;
}

/** What prints the report: spec 001's `Printer`, or a test's. */
export interface ReportPrinter {
  single(html: string, signal?: AbortSignal): Promise<Uint8Array>;
}

export interface ReportServices {
  graph: Graph;
  printer: ReportPrinter;
  /** The analysis service's address, its `/AnalysisService` included. */
  analysis: string;
  /** The render service's address. */
  render: string;
  /** The website's address, for the report's links. */
  site: string;
  /** The pathways drawn as their illustration (the release's EHLD summary). */
  illustrated: ReadonlySet<string>;
  /** The render service's slots, shared by every report being made. */
  slots: Slots;
  /** Where the report's lines go: missing figures, characters no font draws. */
  log: (line: string) => void;
  styles?: Styles;
  /** How long one analysis call may take. */
  analysisTimeoutMs?: number;
  /** How long one figure may take, and the pause before its one retry. */
  figureTimeoutMs?: number;
  retryPauseMs?: number;
  /** The cover's date: now, without it. */
  now?: () => Date;
}

export interface MadeReport {
  pdf: Uint8Array;
  model: ReportModel;
}

/** The species, then the token, then the rest: a report, or a ReportError saying why not. */
export async function makeReport(
  request: ReportRequest,
  services: ReportServices,
  signal?: AbortSignal
): Promise<MadeReport> {
  return makeChecked(await checkReport(request, services, signal), services, signal);
}

/**
 * A request, checked as every request is (contracts/service.md): the species from the
 * graph, then the token's form and its check (call 1). The key names the report it asks
 * for: the token, the species' database id, the number, the resource as decided from the
 * check, and importable-only where it acts (with `TOTAL`).
 */
export interface CheckedRequest {
  request: ReportRequest;
  species: SpeciesRef;
  /** The graph's release, read with the species: a change drops every kept report. */
  release: number;
  check: TokenCheck;
  key: string;
}

export async function checkReport(
  request: ReportRequest,
  services: Pick<ReportServices, 'graph' | 'analysis'>,
  signal?: AbortSignal
): Promise<CheckedRequest> {
  const [species, release] = await Promise.all([
    reading(() => speciesByIdentifier(services.graph, request.species)),
    reading(() => readRelease(services.graph)),
  ]);
  if (species === null) throw new ReportError('no-species', 'The graph holds no such species');
  signal?.throwIfAborted();
  const check = await analysing(() =>
    checkToken(services.analysis, request.token, signal ? { signal } : {})
  );
  const resource = reportResource(request.resource, check.resources);
  const importableOnly = resource === 'TOTAL' && request.importableOnly;
  const key = [
    check.token,
    String(species.dbId),
    String(request.number),
    resource,
    String(importableOnly),
  ].join(' ');
  return { request, species, release, check, key };
}

/** The report a checked request asks for: calls 2 to 5, and the rest. */
export async function makeChecked(
  { request, species, check }: CheckedRequest,
  services: ReportServices,
  signal?: AbortSignal
): Promise<MadeReport> {
  const { graph, log } = services;
  const going = (): void => {
    signal?.throwIfAborted();
  };
  // each stage's time, for the report's one log line (FR-211, research R7)
  const stages: [string, number][] = [];
  let mark = performance.now();
  const stage = (stageName: string): void => {
    const now = performance.now();
    stages.push([stageName, Math.round(now - mark)]);
    mark = now;
  };
  const analysis = await analysing(() =>
    readReportAnalysis(
      services.analysis,
      check,
      { resource: request.resource, importableOnly: request.importableOnly },
      {
        ...(services.analysisTimeoutMs === undefined
          ? {}
          : { timeoutMs: services.analysisTimeoutMs }),
        ...(signal === undefined ? {} : { signal }),
      }
    )
  );
  going();
  const compared = analysis.result.summary.species;
  const comparedWith =
    compared === undefined ? null : await reading(() => speciesByDbId(graph, compared));
  const model = buildReport(analysis, species, request.number, comparedWith);
  stage('analysis');
  const [release, details] = await Promise.all([
    reading(() => readRelease(graph)),
    reading(() => readDetails(graph, model.pathways, services.illustrated)),
  ]);
  going();
  stage('graph');
  // the code points no font draws, gathered for the report's one line: each line the log
  // would write names one, and nothing else of the text
  const replaced: string[] = [];
  const characters = new CharacterLog('report', (line) => {
    replaced.push(line.split(' ')[1] ?? '');
  });
  const figures = await drawReportFigures(
    { species: species.taxId, token: model.token, figures: pathwayFigures(details.values()) },
    {
      render: services.render,
      slots: services.slots,
      characters,
      log,
      ...(services.figureTimeoutMs === undefined ? {} : { timeoutMs: services.figureTimeoutMs }),
      ...(services.retryPauseMs === undefined ? {} : { retryPauseMs: services.retryPauseMs }),
      ...(signal === undefined ? {} : { signal }),
    }
  );
  going();
  stage('figures');
  const printed = onRequestReport(model, details, characters);
  const html = reportPage(printed.model, printed.details, {
    site: services.site,
    release,
    date: (services.now ?? (() => new Date()))(),
    figures,
    styles: services.styles ?? pageStyles(),
  });
  // Chromium drops a link to an anchor the page lacks without a word: refused before printing
  const missing = missingAnchors(html);
  if (missing.length > 0) {
    throw new ReportError(
      'failed',
      `${String(missing.length)} of the report's links have no target`
    );
  }
  stage('layout');
  let pdf: Uint8Array;
  try {
    pdf = await services.printer.single(html, signal);
  } catch (error) {
    signal?.throwIfAborted();
    throw new ReportError('failed', `The report could not be printed (${name(error)})`);
  }
  const broken = await brokenLinks(pdf);
  if (broken > 0) {
    throw new ReportError('failed', `${String(broken)} of the report's links land nowhere`);
  }
  stage('print');
  // one line a report made, never a request's: no submitted identifier, nothing about the
  // client, and the token only as a keyed hash, which cannot be guessed back from the log
  log(
    [
      `report ${tokenHash(check.token)}`,
      `species=${species.taxId}`,
      `number=${String(request.number)}`,
      `pathways=${String(model.pathways.length)}`,
      ...stages.map(([stageName, ms]) => `${stageName}=${String(ms)}ms`),
      `size=${String(pdf.byteLength)}`,
      `replaced=${replaced.length > 0 ? replaced.join(',') : 'none'}`,
    ].join(' ')
  );
  return { pdf, model };
}

/** The parts that are front parts with pages of their own, named for their running header. */
const NAMED_PARTS: readonly ReportPart[] = [
  'contents',
  'introduction',
  'properties',
  'overview',
  'pathways',
  'details',
  'found',
  'notFound',
];

/** The report as one page of HTML for Chromium. */
export function reportPage(
  model: ReportModel,
  details: Parameters<typeof reportBodyHtml>[1],
  {
    site,
    release,
    date,
    figures,
    styles,
  }: {
    site: string;
    release: number;
    date: Date;
    figures: ReadonlyMap<string, string>;
    styles: Styles;
  }
): string {
  const held = new Set<string>(reportContents(model).map((e) => e.target));
  held.add(PARTS.contents);
  const links = new Links(false, site, held);
  const body = reportBody(model, details, { links, release, date, figures });
  const title = reportTitle(model);
  const pages = NAMED_PARTS.map(
    (part) => `.front[data-part='${PARTS[part]}'] { page: ${pageName(part)}; }`
  );
  const headers = marginBoxes(
    title,
    NAMED_PARTS.map((part): [string, string] => [pageName(part), PART_NAMES[part]])
  );
  return htmlPage(title, 'single', body, styles, `${pages.join('\n')}\n${headers}`);
}

function reportBody(
  model: ReportModel,
  details: Parameters<typeof reportBodyHtml>[1],
  {
    links,
    release,
    date,
    figures,
  }: { links: Links; release: number; date: Date; figures: ReadonlyMap<string, string> }
): string {
  return reportBodyHtml(model, details, {
    links,
    release,
    date,
    overview: figures.get(OVERVIEW),
    figures,
    report: { belowFloor: [], missing: [], unmeasured: [] },
  });
}

/** A part's page's name: its anchor, spec 001's names kept for its own parts. */
function pageName(part: ReportPart): string {
  return `report-${PARTS[part]}`;
}

/** The anchors a page's internal links name that none of its elements carries. */
export function missingAnchors(html: string): string[] {
  const ids = new Set([...html.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1] ?? ''));
  const targets = [...html.matchAll(/\shref="#([^"]*)"/g)].map((m) => m[1] ?? '');
  return [...new Set(targets.filter((target) => !ids.has(target)))];
}

/**
 * How many of a PDF's internal links land on no page of it: one whose target is laid out
 * nowhere (hidden, say). A link to an anchor the page lacks is not printed at all, which
 * `missingAnchors` finds before the print.
 */
export async function brokenLinks(pdf: Uint8Array): Promise<number> {
  const task = getDocument({ data: pdf.slice(), verbosity: VerbosityLevel.ERRORS });
  try {
    const doc = await task.promise;
    let broken = 0;
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const annotations: unknown[] = await page.getAnnotations();
      for (const annot of annotations) {
        if (!isRecord(annot) || annot['subtype'] !== 'Link') continue;
        const address = annot['unsafeUrl'] ?? annot['url'];
        if (typeof address === 'string') continue;
        const dest: unknown = annot['dest'];
        if (!(await lands(doc, dest))) broken += 1;
      }
      page.cleanup();
    }
    return broken;
  } finally {
    await task.destroy();
  }
}

type PdfJs = Awaited<ReturnType<typeof getDocument>['promise']>;

/** Whether a destination names a page of the PDF. */
async function lands(doc: PdfJs, dest: unknown): Promise<boolean> {
  const explicit: unknown = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
  if (!Array.isArray(explicit)) return false;
  const parts: unknown[] = explicit;
  const [ref] = parts;
  try {
    if (typeof ref === 'number') return Number.isInteger(ref) && ref >= 0 && ref < doc.numPages;
    if (isPageRef(ref)) {
      await doc.getPageIndex(ref);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

/** A graph read: any failure is the graph unable to answer, `unavailable`. */
async function reading<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    throw new ReportError('unavailable', `The graph could not be read (${name(error)})`);
  }
}

/** The analysis's calls: their failures by their own reasons. */
async function analysing<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof AnalysisError) throw new ReportError(error.reason, error.message);
    throw error;
  }
}

/** This process's key for the tokens' hashes: a token is a date and a counter, which a plain hash would give back. */
const TOKEN_KEY = randomBytes(32);

/** A token as the log names it: a keyed hash, the same for one token while the process runs. */
export function tokenHash(token: string): string {
  return createHmac('sha256', TOKEN_KEY).update(token).digest('hex').slice(0, 16);
}

function name(error: unknown): string {
  return error instanceof Error ? error.name : 'error';
}
