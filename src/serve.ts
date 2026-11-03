// The single-event service (spec 001 T022, contracts/service.md, User Story 2): `GET
// /event/{stId}.pdf?depth&token` answers one event's PDF, `GET /health` the service's state.
// The checks go in the contract's order, the depth, then the identifier, then the token's
// form, then the concurrency limit, and only then is anything made. Every figure is drawn on
// request, with the token where there is one; one that cannot be drawn leaves its section
// without it, logged. Characters no font draws print as U+FFFD (FR-017), logged once per PDF.
// Each request has a deadline across everything it waits for, the graph's reads and the
// analysis service's calls among them; past it, or once the client has gone, the work stops
// between stages, its calls are stopped, nothing more is printed, and the answer is 503
// `unavailable`. The browser that prints is started again if it goes. A reason never carries
// a path, a host or a name: the content service writes WebsiteAngular's envelope from it.
import { readFileSync } from 'node:fs';
import { setTimeout as pause } from 'node:timers/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import { AnalysisError, readAnalysis, type AnalysedEvent } from './analysis/client.ts';
import { canonicalToken } from './analysis/token.ts';
import { fetchFigure, type FigureRequest } from './figures/client.ts';
import { labelsOnRequest } from './figures/labels.ts';
import { graphSettings, openGraph, type Graph, type GraphSettings } from './graph/connection.ts';
import {
  eventByIdentifier,
  parentPathways,
  reactionIdentifiers,
  release,
  type Child,
} from './graph/queries.ts';
import { CharacterLog, onRequestStrings } from './layout/characters.ts';
import { layoutSingle, pageStyles } from './layout/document.ts';
import { figureKey } from './layout/figure.ts';
import { buildSingle } from './model/build.ts';
import type { Document, Figure, Section } from './model/types.ts';
import { Printer } from './print/print.ts';

/** Why a PDF is not made (contracts/service.md). */
export type Reason =
  'bad-depth' | 'not-an-event' | 'no-event' | 'unknown-token' | 'gone-token' | 'unavailable';

const STATUS: Readonly<Record<Reason, number>> = {
  'bad-depth': 400,
  'not-an-event': 400,
  'no-event': 404,
  'unknown-token': 404,
  'gone-token': 410,
  unavailable: 503,
};

export interface ServeSettings {
  bind: string;
  port: number;
  graph: GraphSettings;
  /** The release's folder: its EHLD summary says which pathways are illustrated. */
  files: string;
  /** The release's figures' folder: read from T047; until then every figure is drawn. */
  figures: string | null;
  render: string;
  analysis: string;
  site: string;
  /** PDFs made at once; a request beyond them is answered 503 at once. */
  concurrency: number;
}

/** What the service waits for, and how long: the defaults suit the website. */
export interface ServeLimits {
  /** A request's whole time, from its arrival to its answer. */
  deadlineMs: number;
  /** One call to the analysis service. */
  analysisTimeoutMs: number;
  /** One attempt at a figure. */
  figureTimeoutMs: number;
  /** The pause before a figure's one retry after a 503. */
  retryPauseMs: number;
  /** A health check's call to another service, and its read of the graph. */
  healthTimeoutMs: number;
  /** The least time between two starts of the browser, so a crashing one is not restarted in a loop. */
  relaunchPauseMs: number;
}

export const LIMITS: ServeLimits = {
  deadlineMs: 120_000,
  analysisTimeoutMs: 30_000,
  figureTimeoutMs: 60_000,
  retryPauseMs: 5_000,
  healthTimeoutMs: 5_000,
  relaunchPauseMs: 5_000,
};

/** Figures asked of the render service at once: its own default concurrency. */
const FIGURES_AT_ONCE = 2;

/** An argument the command line refuses (exit 2). */
export class SettingsError extends Error {
  override name = 'SettingsError';
}

/**
 * The settings from `serve`'s flags and the environment (contracts/cli.md): a flag wins
 * over its variable. The graph's credentials come from the environment only.
 */
export function serveSettings(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>
): ServeSettings {
  const FLAGS = [
    '--port',
    '--bind',
    '--graph',
    '--database',
    '--files',
    '--figures',
    '--render',
    '--analysis',
    '--site',
    '--concurrency',
  ];
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const [name = '', inline] = (args[i] ?? '').split(/=(.*)/s, 2);
    if (!FLAGS.includes(name)) throw new SettingsError(`Unknown argument: ${name}`);
    const value = inline ?? args[++i];
    if (value === undefined || value === '') throw new SettingsError(`${name} needs a value`);
    if (flags.has(name)) throw new SettingsError(`${name} is given twice`);
    flags.set(name, value);
  }
  const setting = (flag: string, variable?: string) =>
    flags.get(flag) ?? (variable === undefined ? undefined : env[variable] || undefined);
  const required = (flag: string, variable?: string) => {
    const value = setting(flag, variable);
    if (value === undefined) {
      throw new SettingsError(`${flag}${variable ? ` (or ${variable})` : ''} is needed`);
    }
    return value;
  };
  const whole = (flag: string, value: string, max: number) => {
    if (!/^[0-9]+$/.test(value) || Number(value) < 1 || Number(value) > max) {
      throw new SettingsError(`${flag} must be a whole number from 1 to ${String(max)}`);
    }
    return Number(value);
  };
  const graphEnv = { ...env };
  const uri = setting('--graph');
  if (uri !== undefined) graphEnv['NEO4J_URI'] = uri;
  const database = setting('--database');
  if (database !== undefined) graphEnv['NEO4J_DATABASE'] = database;
  let graph: GraphSettings;
  try {
    graph = graphSettings(graphEnv);
  } catch {
    throw new SettingsError('--graph (or NEO4J_URI) is needed');
  }
  return {
    bind: setting('--bind', 'BIND_ADDRESS') ?? '127.0.0.1',
    port: whole('--port', setting('--port', 'PORT') ?? '4370', 65_535),
    graph,
    files: required('--files'),
    figures: setting('--figures') ?? null,
    render: required('--render', 'RENDER_SERVICE'),
    analysis: required('--analysis', 'ANALYSIS_SERVICE'),
    site: required('--site', 'REACTOME_SITE'),
    concurrency: whole('--concurrency', setting('--concurrency') ?? '2', 1_000),
  };
}

export interface Service {
  /** The address it answers at: `http://{bind}:{port}`. */
  url: string;
  close(): Promise<void>;
}

/** What prints the PDFs: T019's `Printer`, or a test's. */
export interface ServicePrinter {
  /** The PDF; its print stops when `signal` ends. */
  single(html: string, signal?: AbortSignal): Promise<Uint8Array>;
  readonly connected: boolean;
  onDisconnected(listener: () => void): void;
  close(): Promise<void>;
}

export interface ServiceOptions {
  /** The graph, if not opened from the settings (tests give one). */
  graph?: Graph;
  /** How a printer is started: T019's `Printer` by default (tests wrap it). */
  startPrinter?: () => Promise<ServicePrinter>;
  /** Where log lines go: standard error by default. */
  log?: (line: string) => void;
  limits?: Partial<ServeLimits>;
}

/** The package's version, for the health answer. */
const VERSION = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

/** The pathways the EHLD summary names: their figure is their illustration. */
function readIllustrated(files: string): Set<string> {
  return new Set(
    readFileSync(join(files, 'ehld', 'svgsummary.txt'), 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('R-'))
  );
}

/** A refusal with its reason, answered as JSON. */
class Refusal extends Error {
  readonly reason: Reason;
  constructor(reason: Reason, message: string = reason) {
    super(message);
    this.reason = reason;
  }
}

/** A request whose client went before its answer. */
class ClientGone extends Refusal {
  constructor() {
    super('unavailable', 'the client went');
  }
}

/**
 * Starts that may fail in a row before `/health` answers 503: three, a quarter of a minute at
 * the default pause, is past a crash's single restart and a slow start's retry, and soon
 * enough for a container's health check to replace a service that cannot print.
 */
const DEAD_AFTER = 3;

/** A stable identifier, a versioned one, or a database id: anything else names nothing. */
const IDENTIFIER = /^(?:R-[A-Z]{3}-[0-9]{1,12}(?:\.[0-9]{1,6})?|[0-9]{1,15})$/;

export async function startService(
  settings: ServeSettings,
  options: ServiceOptions = {}
): Promise<Service> {
  const limits: ServeLimits = { ...LIMITS, ...options.limits };
  const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const illustrated = readIllustrated(settings.files);
  // a read the database runs longer than a request may wait is ended there too
  const graph =
    options.graph ?? openGraph(settings.graph, { transactionTimeoutMs: limits.deadlineMs });
  const ownGraph = options.graph === undefined;
  const startPrinter = options.startPrinter ?? (() => Printer.start());
  const styles = pageStyles();
  let active = 0;
  const state = { closing: false };
  // read through a call: a check before an await does not hold after it
  const closing = () => state.closing;

  // The browser: started at once, and again whenever it goes (a crash, a kill), never twice
  // within relaunchPauseMs, so one that dies at once is not restarted in a loop.
  let printer: ServicePrinter | null = null;
  let launching: Promise<ServicePrinter> | null = null;
  let lastLaunch = -Infinity;
  /** Starts failed since a browser was last up: past DEAD_AFTER, the service is unhealthy. */
  let failedStarts = 0;
  /** A browser; `retry` keeps trying after a failed start (the first start does not). */
  function launch(retry = true): Promise<ServicePrinter> {
    launching ??= (async () => {
      for (;;) {
        const wait = lastLaunch + limits.relaunchPauseMs - Date.now();
        if (wait > 0) await pause(wait);
        if (closing()) throw new Error('the service is closing');
        lastLaunch = Date.now();
        try {
          const started = await startPrinter();
          started.onDisconnected(() => {
            if (printer !== started) return;
            printer = null;
            void started.close().catch(() => undefined);
            if (closing()) return;
            log('printer: the browser went; starting another');
            void launch().catch(() => undefined);
          });
          printer = started;
          failedStarts = 0;
          return started;
        } catch (error) {
          failedStarts += 1;
          log(`printer: the browser could not start (${describe(error)})`);
          if (!retry || closing()) throw error;
        }
      }
    })().finally(() => {
      launching = null;
    });
    return launching;
  }
  await launch(false);
  const currentPrinter = (): Promise<ServicePrinter> =>
    printer?.connected ? Promise.resolve(printer) : launch();

  /**
   * Rejects once the signal ends (with its reason), so a wait that cannot be stopped is not
   * waited on.
   */
  const within = <T>(work: Promise<T>, signal: AbortSignal): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const stop = () => {
        reject(stopReason(signal));
      };
      if (signal.aborted) stop();
      signal.addEventListener('abort', stop, { once: true });
      void work.then(resolve, reject).finally(() => {
        signal.removeEventListener('abort', stop);
      });
    });

  /**
   * The graph as one request reads it: each read given up when the request ends, and given
   * the time left before its deadline as its transaction timeout, so the database ends it
   * there too. Each read under way is kept in `reads`: the request's slot is held until they
   * have settled, so the reads in flight never outnumber the slots.
   */
  const graphFor = (signal: AbortSignal, endsAt: number, reads: Set<Promise<unknown>>): Graph => ({
    read: <T>(query: string, params?: Record<string, unknown>) => {
      if (signal.aborted) return Promise.reject(stopReason(signal));
      const read = graph.read<T>(query, params, { timeoutMs: Math.max(1, endsAt - Date.now()) });
      const settled = read.then(
        () => undefined,
        () => undefined
      );
      reads.add(settled);
      void settled.then(() => reads.delete(settled));
      return within(read, signal);
    },
    close: () => Promise.resolve(),
  });

  async function identify(identifier: string, reading: Graph): Promise<Child> {
    let found;
    try {
      found = await eventByIdentifier(reading, identifier);
    } catch (error) {
      if (error instanceof Refusal) throw error;
      throw new Refusal('unavailable', `the graph: ${describe(error)}`);
    }
    if (found === null) throw new Refusal('no-event');
    if ('notAnEvent' in found) throw new Refusal('not-an-event');
    return found.event;
  }

  /** The PDF: the model, the analysis, the figures, the characters, the layout, the print. */
  async function make(
    root: Child,
    depth: 0 | 1,
    token: string | null,
    deadline: AbortSignal,
    reading: Graph
  ): Promise<Uint8Array> {
    // between stages: a request that has ended goes no further
    const going = () => {
      if (deadline.aborted) throw stopReason(deadline);
    };
    const doc = await buildSingle(reading, root, {
      depth,
      illustrated,
      analysis: token !== null,
    });
    going();
    const sections = doc.places.flatMap((place) => (place.full ? [place.section] : []));
    const analysis =
      token === null
        ? null
        : await readAnalysis(
            settings.analysis,
            {
              token,
              species: sections[0]?.event.speciesName ?? '',
              events: await analysedEvents(reading, sections),
            },
            { timeoutMs: limits.analysisTimeoutMs, signal: deadline }
          );
    going();
    const characters = new CharacterLog(
      token === null ? root.stId : `${root.stId} token=${token}`,
      log
    );
    // the token as the render service is to receive it once decoded: its padding as `=`
    const figures = await drawFigures(doc, token === null ? undefined : decodeURIComponent(token), {
      characters,
      deadline,
    });
    going();
    const laid = layoutSingle(onRequestStrings(doc, characters), {
      site: settings.site,
      date: new Date(),
      figures,
      styles,
      analysis: analysis === null ? null : onRequestStrings(analysis, characters),
    });
    const printing = await within(currentPrinter(), deadline);
    // never printed once the request has ended
    going();
    return printing.single(laid.html, deadline);
  }

  /** Each figure the document draws, once, at most FIGURES_AT_ONCE at a time. */
  async function drawFigures(
    doc: Document,
    token: string | undefined,
    { characters, deadline }: { characters: CharacterLog; deadline: AbortSignal }
  ): Promise<Map<string, string>> {
    const wanted = new Map<string, Figure>();
    for (const place of doc.places) {
      const figure = place.full ? place.section.figure : null;
      if (figure) wanted.set(figureKey(figure), figure);
    }
    if (doc.cover.figure) wanted.set(figureKey(doc.cover.figure), doc.cover.figure);
    const queue = [...wanted];
    const drawn = new Map<string, string>();
    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const [key, figure] = next;
        const answer = await fetchFigure(settings.render, figureRequest(figure, token), {
          timeoutMs: limits.figureTimeoutMs,
          retryPauseMs: limits.retryPauseMs,
          signal: deadline,
        });
        if ('missing' in answer) {
          log(`missing-figure ${key}: ${answer.missing}`);
          continue;
        }
        try {
          drawn.set(key, labelsOnRequest(answer.svg, characters));
        } catch (error) {
          log(`missing-figure ${key}: its labels could not be read (${describe(error)})`);
        }
      }
    };
    await Promise.all(Array.from({ length: FIGURES_AT_ONCE }, worker));
    return drawn;
  }

  async function answerPdf(req: IncomingMessage, res: ServerResponse, rawId: string) {
    // the request's end: its deadline, or its client gone before it is answered
    const ending = new AbortController();
    const deadline = ending.signal;
    const endsAt = Date.now() + limits.deadlineMs;
    const timer = setTimeout(() => {
      ending.abort(new Refusal('unavailable', 'the deadline passed'));
    }, limits.deadlineMs);
    timer.unref();
    res.once('close', () => {
      clearTimeout(timer);
      if (!res.writableFinished) ending.abort(new ClientGone());
    });
    const query = new URL(req.url ?? '/', 'http://service').searchParams;
    // the depth first
    const depths = query.getAll('depth');
    if (depths.length > 1 || (depths.length === 1 && depths[0] !== '0' && depths[0] !== '1')) {
      refuse(res, 'bad-depth');
      return;
    }
    const depth = depths[0] === '0' ? 0 : 1;
    // then the identifier, whatever the token
    let identifier: string;
    try {
      identifier = decodeURIComponent(rawId);
    } catch {
      refuse(res, 'no-event');
      return;
    }
    if (!IDENTIFIER.test(identifier)) {
      refuse(res, 'no-event');
      return;
    }
    // then the limit, before the first read of the graph, so the reads in flight never
    // outnumber the slots: a request beyond it is not queued; nor is one while no browser is up
    if (active >= settings.concurrency) {
      log(`unavailable ${identifier}: ${String(active)} PDFs already being made`);
      refuse(res, 'unavailable');
      return;
    }
    if (!printer?.connected) {
      log(`unavailable ${identifier}: no browser is up`);
      if (!closing()) void launch().catch(() => undefined);
      refuse(res, 'unavailable');
      return;
    }
    active += 1;
    // the slot is held until the request's work has ended and every read it began has
    // settled, each bounded by its transaction timeout, not only until the answer
    const reads = new Set<Promise<unknown>>();
    let held = true;
    const release = (): void => {
      if (!held) return;
      held = false;
      void Promise.allSettled([...reads]).then(() => {
        active -= 1;
      });
    };
    const reading = graphFor(deadline, endsAt, reads);
    let root: Child;
    try {
      root = await identify(identifier, reading);
    } catch (error) {
      release();
      fail(res, error, identifier);
      return;
    }
    // then the token's form
    const tokens = query.getAll('token');
    let token: string | null = null;
    if (tokens.length > 0) {
      try {
        if (tokens.length > 1) throw new AnalysisError('unknown-token', 'two tokens given');
        token = canonicalToken(tokens[0] ?? '');
      } catch (error) {
        release();
        fail(res, error, root.stId);
        return;
      }
    }
    const work = make(root, depth, token, deadline, reading);
    void work.catch(() => undefined).finally(release);
    let pdf: Uint8Array;
    try {
      pdf = await within(work, deadline);
    } catch (error) {
      fail(res, error, root.stId);
      return;
    }
    res
      .writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdf.byteLength),
        'Content-Disposition': `attachment; filename="${root.stId}.pdf"`,
      })
      .end(pdf);
  }

  /** A failure's answer: its reason, and a log line; never its message in the answer. */
  function fail(res: ServerResponse, error: unknown, subject: string) {
    const reason: Reason =
      error instanceof Refusal || error instanceof AnalysisError ? error.reason : 'unavailable';
    // a client that went is no failure of the service: logged as such, and not answered
    if (error instanceof ClientGone) log(`client-gone ${subject}`);
    else if (reason === 'unavailable') log(`unavailable ${subject}: ${describe(error)}`);
    refuse(res, reason);
  }

  async function answerHealth(res: ServerResponse) {
    const answers = async (url: string, ok: (status: number) => boolean) => {
      try {
        const response = await fetch(url, {
          redirect: 'error',
          signal: AbortSignal.timeout(limits.healthTimeoutMs),
        });
        await response.body?.cancel();
        return ok(response.status);
      } catch {
        return false;
      }
    };
    const base = (url: string) => (url.endsWith('/') ? url : `${url}/`);
    let graphRelease: number;
    try {
      // its own short time, in the database too
      const quick: Graph = {
        read: (query, params) => graph.read(query, params, { timeoutMs: limits.healthTimeoutMs }),
        close: () => Promise.resolve(),
      };
      graphRelease = await within(release(quick), AbortSignal.timeout(limits.healthTimeoutMs));
    } catch (error) {
      log(`unavailable health: the graph: ${describe(error)}`);
      refuse(res, 'unavailable');
      return;
    }
    const [render, analysis] = await Promise.all([
      answers(new URL('health', base(settings.render)).href, (status) => status === 200),
      // any answer of its own: the service has no health endpoint of its own to ask
      answers(new URL('database/version', base(settings.analysis)).href, (status) => status < 500),
    ]);
    // a browser that cannot be started again leaves the service unable to print: 503, so a
    // health check that reads only the status replaces it
    json(res, failedStarts >= DEAD_AFTER ? 503 : 200, {
      version: VERSION,
      release: graphRelease,
      render,
      analysis,
      printer: printer?.connected === true,
      making: active,
      figures: 'none',
    });
  }

  const server: Server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    if (req.method !== 'GET') {
      res.writeHead(405, { Allow: 'GET' }).end();
      return;
    }
    const pdf = /^\/event\/([^/]+)\.pdf$/.exec(path);
    const handle = pdf?.[1]
      ? answerPdf(req, res, pdf[1])
      : path === '/health'
        ? answerHealth(res)
        : Promise.resolve(void res.writeHead(404).end());
    handle.catch((error: unknown) => {
      log(`unavailable: ${describe(error)}`);
      if (!res.headersSent) refuse(res, 'unavailable');
      else res.destroy();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(settings.port, settings.bind, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const { address, port } = server.address() as AddressInfo;
  const host = address.includes(':') ? `[${address}]` : address;

  return {
    url: `http://${host}:${String(port)}`,
    async close() {
      state.closing = true;
      server.closeAllConnections();
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        })
      );
      try {
        await launching?.catch(() => undefined);
        await printer?.close();
      } finally {
        if (ownGraph) await graph.close();
      }
    },
  };
}

/** The events whose found lists the PDF shows, a reaction's from its first parent's. */
async function analysedEvents(
  graph: Graph,
  sections: readonly Section[]
): Promise<AnalysedEvent[]> {
  const reactions = sections.filter((s) => s.event.kind === 'reaction');
  const identifiers =
    reactions.length > 0
      ? await reactionIdentifiers(
          graph,
          reactions.map((s) => s.event.dbId)
        )
      : new Map<number, string[]>();
  const events: AnalysedEvent[] = [];
  for (const section of sections) {
    const { event } = section;
    if (event.kind === 'pathway') {
      events.push({ kind: 'pathway', stId: event.stId });
      continue;
    }
    // its parent where the PDF places it; a reaction alone, its first in the graph
    const parent = section.path.at(-1)?.stId ?? (await parentPathways(graph, event.dbId))[0];
    if (parent === undefined) continue;
    events.push({
      kind: 'reaction',
      stId: event.stId,
      parent,
      identifiers: identifiers.get(event.dbId) ?? [],
    });
  }
  return events;
}

function figureRequest(figure: Figure, token: string | undefined): FigureRequest {
  const withToken = token === undefined ? {} : { token };
  switch (figure.kind) {
    case 'ancestor':
      return { kind: 'ancestor', stId: figure.stId, highlight: figure.highlight, ...withToken };
    case 'reaction':
      return { kind: 'reaction', stId: figure.stId, ...withToken };
    default:
      return { kind: figure.kind, stId: figure.stId, ...withToken };
  }
}

/** Why a request ended: its signal's reason, a refusal of its own. */
function stopReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Refusal('unavailable', 'the request ended');
}

function refuse(res: ServerResponse, reason: Reason) {
  if (res.writableEnded || res.destroyed) return;
  json(res, STATUS[reason], { reason });
}

function json(res: ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body);
  res
    .writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': String(Buffer.byteLength(text)),
    })
    .end(text);
}

/** An error for the log: its name and message, its cause's code where there is one. */
function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause as { code?: unknown } | undefined;
  const code = typeof cause?.code === 'string' ? ` (${cause.code})` : '';
  return `${error.name}: ${error.message}${code}`;
}
