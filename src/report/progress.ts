// A report's progress while it is made, its status in the 202 (spec 002 T029; WebsiteAngular
// spec 031, contracts/report-status.md), and the estimate of the time left from past
// reports' times. A reader waiting minutes for a report was told nothing: a page asking
// again every 10 s in a tab of its own.

/** Where a report being made is: reading, then drawing its figures, then printing. */
export type ReportProgress =
  /** `expected`: the figures it is likely to draw, from the pathways asked for. */
  | { stage: 'reading'; expected?: number }
  | { stage: 'figures'; done: number; total: number }
  | { stage: 'printing' };

/** The 202's `status`: each field absent where it does not apply, never null or 0. */
export interface ReportStatus {
  state: 'queued' | 'making';
  /** Reports ahead of it in the queue, from 1. */
  place?: number;
  stage?: ReportProgress['stage'];
  done?: number;
  total?: number;
  /** Whole seconds left until the report is ready, when past reports give one. */
  estimate?: number;
}

/** One finished report's times. */
export interface ReportTimes {
  figures: number;
  /** From its figures' first to their last. */
  figuresMs: number;
  /** Everything else: reading, layout, printing. */
  otherMs: number;
}

/** How many past reports the estimate is taken from. */
const KEPT = 20;

/**
 * The last reports' times, and the estimate they give. A rolling window, so the estimate
 * follows the render service's speed now; none before the first report has finished.
 */
export class Times {
  readonly #kept: ReportTimes[] = [];

  record(times: ReportTimes): void {
    this.#kept.push(times);
    if (this.#kept.length > KEPT) this.#kept.shift();
  }

  /** Mean milliseconds per figure, and of everything else; null with no report yet. */
  means(): { perFigureMs: number; otherMs: number; reportMs: number } | null {
    if (this.#kept.length === 0) return null;
    const sum = (f: (t: ReportTimes) => number): number =>
      this.#kept.reduce((total, t) => total + f(t), 0);
    const figures = sum((t) => t.figures);
    const perFigureMs = figures > 0 ? sum((t) => t.figuresMs) / figures : 0;
    const otherMs = sum((t) => t.otherMs) / this.#kept.length;
    return {
      perFigureMs,
      otherMs,
      reportMs: sum((t) => t.figuresMs + t.otherMs) / this.#kept.length,
    };
  }

  /**
   * Seconds left for a report: queued (`place` ahead, `making` made at once), or being made
   * at `progress`, `madeMs` since it started and `otherSpentMs` of that outside its figures.
   * Undefined with no past report.
   */
  estimate(
    at:
      | { queued: true; place: number; making: number }
      | { queued: false; progress: ReportProgress; madeMs: number; otherSpentMs: number }
  ): number | undefined {
    const means = this.means();
    if (means === null) return undefined;
    let ms: number;
    if (at.queued) {
      // the reports ahead, made `making` at once, then this one
      ms = Math.ceil(at.place / Math.max(1, at.making)) * means.reportMs + means.reportMs;
    } else if (at.progress.stage === 'reading') {
      // its figures not yet counted: those expected at the past reports' pace, or without
      // them a past report's time, which over-estimated a small report by nearly twice
      // (spec 031 SC-004: 10 pathways, 38 s for 22)
      ms =
        at.progress.expected === undefined
          ? means.reportMs - at.madeMs
          : at.progress.expected * means.perFigureMs + Math.max(0, means.otherMs - at.otherSpentMs);
    } else if (at.progress.stage === 'figures') {
      // the figures left at the past reports' pace, then the rest of the other time
      const left = Math.max(0, at.progress.total - at.progress.done);
      ms = left * means.perFigureMs + Math.max(0, means.otherMs - at.otherSpentMs);
    } else {
      ms = means.otherMs - at.otherSpentMs;
    }
    return Math.max(0, Math.round(ms / 1000));
  }
}

/**
 * The hold a request asks for with `Prefer: wait=<seconds>` (RFC 7240), in milliseconds, at
 * most `maxMs`; undefined without one or with one that is not a whole number of seconds.
 */
export function preferredWaitMs(
  prefer: string | string[] | undefined,
  maxMs: number
): number | undefined {
  const values = Array.isArray(prefer) ? prefer : prefer === undefined ? [] : [prefer];
  for (const value of values) {
    for (const part of value.split(',')) {
      const match = /^\s*wait\s*=\s*(\d+)\s*$/i.exec(part);
      if (match?.[1] !== undefined) return Math.min(Number(match[1]) * 1000, maxMs);
    }
  }
  return undefined;
}
