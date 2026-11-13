// The reports in the background (spec 002 T013 and T014, FR-210, FR-211, data-model Job,
// contracts/service.md): a request starts the report its key names, or joins the one queued,
// being made or kept for that key, and waits for it a while; the report goes on whatever its
// requests do, within a time budget from when it starts being made.
//
// Limits (T014): a few made at once and a few more waiting, a new report beyond them refused;
// at most a share of the waiting from one client; a request that joins is never counted. A
// report past its budget is answered with its error at once, but keeps its place among those
// being made until its work has stopped, so no more than the limit are ever at work.
//
// Keeping (T014): a finished report is kept for an hour, the kept ones together at most a
// total size, the oldest dropped first; a kept report is dropped when its token is no longer
// known, and every one when the graph's release changes. One that ends in an error gives that
// error to every request then waiting and to the next request, and is then forgotten, so the
// one after starts it again; unasked, it is forgotten after the hour too.

/** A report's state (data-model Job). */
export type JobState = 'queued' | 'making' | 'ready' | 'failed';

export interface Job<T> {
  readonly key: string;
  readonly state: JobState;
  /** The report, once ready. */
  readonly result: T | undefined;
  /** What ended it, once failed. */
  readonly error: unknown;
}

/** Why a new report is not taken: all the waiting places, or the client's share of them. */
export type Refused = 'full' | 'share';

/** How a wait ended: the job finished (ready or failed), or the wait's time was up first. */
export type Waited = 'done' | 'waiting';

export interface JobSettings<T> {
  /** Reports made at once. */
  making: number;
  /** Reports waiting their turn, beyond those being made. */
  waiting: number;
  /** Of those waiting, at most this many from one client. */
  perClient: number;
  /** A report's time from when it starts being made. */
  budgetMs: number;
  /** How long a finished report, or a failed one nobody has asked about, is kept. */
  keepMs: number;
  /** The most the kept reports may hold together, by `size`. */
  keepBytes: number;
  size: (result: T) => number;
  /** What ends a report past its budget: its error. */
  budgetError: () => Error;
  /** The clock keeping is measured by. */
  now?: () => number;
}

interface Entry<T> {
  key: string;
  client: string;
  state: JobState;
  result: T | undefined;
  error: unknown;
  make: (signal: AbortSignal) => Promise<T>;
  done: Promise<void>;
  finish: () => void;
  /** When it finished, for keeping. */
  endedAt: number;
}

/** The counts `/health` gives. */
export interface JobCounts {
  making: number;
  waiting: number;
  kept: number;
}

export class Jobs<T> {
  readonly #settings: JobSettings<T>;
  readonly #now: () => number;
  readonly #jobs = new Map<string, Entry<T>>();
  readonly #queue: Entry<T>[] = [];
  /** Reports at work: those being made, and those past their budget still stopping. */
  #working = 0;
  #release: number | null = null;

  constructor(settings: JobSettings<T>) {
    this.#settings = settings;
    this.#now = settings.now ?? Date.now;
  }

  get counts(): JobCounts {
    this.#expire();
    let kept = 0;
    for (const job of this.#jobs.values()) if (job.state === 'ready') kept += 1;
    return { making: this.#working, waiting: this.#queue.length, kept };
  }

  /**
   * The job for `key`: the one queued, being made, kept or failed, or a new one that `make`
   * makes, for `client`. A failed one is given to this request, its last, and forgotten. A
   * new one beyond the waiting places, or the client's share of them, is refused.
   */
  join(key: string, client: string, make: (signal: AbortSignal) => Promise<T>): Job<T> | Refused {
    this.#expire();
    const known = this.#jobs.get(key);
    if (known) {
      if (known.state === 'failed') this.#jobs.delete(key);
      return view(known);
    }
    // a new report waits unless one may start at once
    if (this.#working >= this.#settings.making) {
      if (this.#queue.length >= this.#settings.waiting) return 'full';
      const theirs = this.#queue.filter((entry) => entry.client === client).length;
      if (theirs >= this.#settings.perClient) return 'share';
    }
    let finish = (): void => undefined;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const entry: Entry<T> = {
      key,
      client,
      state: 'queued',
      result: undefined,
      error: undefined,
      make,
      done,
      finish,
      endedAt: 0,
    };
    this.#jobs.set(key, entry);
    this.#queue.push(entry);
    this.#next();
    return view(entry);
  }

  /**
   * Waits up to `ms` for a job to finish, or until `signal` ends (a request abandoned):
   * only this wait ends, never the job.
   */
  async wait(job: Job<T>, ms: number, signal?: AbortSignal): Promise<Waited> {
    if (job.state === 'ready' || job.state === 'failed') return 'done';
    const entry = this.#jobs.get(job.key);
    if (!entry) return 'done';
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeUp = new Promise<Waited>((resolve) => {
      timer = setTimeout(() => {
        resolve('waiting');
      }, ms);
    });
    const ended = new Promise<Waited>((resolve) => {
      signal?.addEventListener(
        'abort',
        () => {
          resolve('waiting');
        },
        { once: true }
      );
    });
    try {
      return await Promise.race([entry.done.then((): Waited => 'done'), timeUp, ended]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Drops the kept reports of a token its check no longer finds (404 or 410). */
  dropToken(token: string): void {
    for (const entry of [...this.#jobs.values()]) {
      if (entry.state === 'ready' && entry.key.startsWith(`${token} `)) {
        this.#jobs.delete(entry.key);
      }
    }
  }

  /** The graph's release, read with a request's species: a change drops every kept report. */
  release(release: number): void {
    if (this.#release !== null && this.#release !== release) {
      for (const entry of [...this.#jobs.values()]) {
        if (entry.state === 'ready') this.#jobs.delete(entry.key);
      }
    }
    this.#release = release;
  }

  /** Forgets every job: the service is closing. */
  clear(): void {
    this.#jobs.clear();
    this.#queue.length = 0;
  }

  #next(): void {
    while (this.#working < this.#settings.making) {
      const entry = this.#queue.shift();
      if (!entry) return;
      this.#start(entry);
    }
  }

  #start(entry: Entry<T>): void {
    this.#working += 1;
    entry.state = 'making';
    const budget = new AbortController();
    const timer = setTimeout(() => {
      budget.abort(this.#settings.budgetError());
    }, this.#settings.budgetMs);
    timer.unref();
    const work = entry.make(budget.signal);
    // the answer: the work's, or the budget's error once it has passed
    const pastBudget = new Promise<never>((_resolve, reject) => {
      budget.signal.addEventListener(
        'abort',
        () => {
          reject(this.#settings.budgetError());
        },
        { once: true }
      );
    });
    void Promise.race([work, pastBudget])
      .then(
        (result) => {
          entry.state = 'ready';
          entry.result = result;
          this.#keep(entry);
        },
        (error: unknown) => {
          entry.state = 'failed';
          entry.error = error;
        }
      )
      .finally(() => {
        entry.endedAt = this.#now();
        entry.finish();
      });
    // its place among those being made, held until its work has stopped, however it ended
    void work
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(timer);
        budget.abort(this.#settings.budgetError());
        this.#working -= 1;
        this.#next();
      });
  }

  /** A finished report kept within the total, the oldest kept dropped first. */
  #keep(entry: Entry<T>): void {
    const kept = [...this.#jobs.values()]
      .filter((e) => e.state === 'ready' && e !== entry)
      .sort((a, b) => a.endedAt - b.endedAt);
    const size = (e: Entry<T>): number =>
      e.result === undefined ? 0 : this.#settings.size(e.result);
    let total = size(entry) + kept.reduce((sum, e) => sum + size(e), 0);
    for (const old of kept) {
      if (total <= this.#settings.keepBytes) break;
      this.#jobs.delete(old.key);
      total -= size(old);
    }
  }

  /** Drops what has been kept longer than the keeping time: finished reports, unasked failures. */
  #expire(): void {
    const now = this.#now();
    for (const entry of [...this.#jobs.values()]) {
      const finished = entry.state === 'ready' || entry.state === 'failed';
      if (finished && now - entry.endedAt >= this.#settings.keepMs) this.#jobs.delete(entry.key);
    }
  }
}

/** A read-only view of a job that follows it as it changes. */
function view<T>(entry: Entry<T>): Job<T> {
  return {
    key: entry.key,
    get state() {
      return entry.state;
    },
    get result() {
      return entry.result;
    },
    get error() {
      return entry.error;
    },
  };
}
