// The reports in the background (spec 002 T013, FR-210, data-model Job, contracts/service.md):
// a request starts the report its key names, or joins the one queued, being made or kept for
// that key, and waits for it a while; the report goes on whatever its requests do, within a
// time budget from when it starts being made. A finished report is kept for an hour. One
// that ends in an error gives that error to every request then waiting and to the next
// request, and is then forgotten, so the one after starts it again; unasked, it is forgotten
// after the hour too. Reports beyond those being made wait their turn, in order (T014 bounds
// them).

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

/** How a wait ended: the job finished (ready or failed), or the wait's time was up first. */
export type Waited = 'done' | 'waiting';

export interface JobSettings {
  /** Reports made at once. */
  making: number;
  /** A report's time from when it starts being made. */
  budgetMs: number;
  /** How long a finished report, or a failed one nobody has asked about, is kept. */
  keepMs: number;
  /** What ends a report past its budget: its error. */
  budgetError: () => Error;
}

interface Entry<T> {
  key: string;
  state: JobState;
  result: T | undefined;
  error: unknown;
  make: (signal: AbortSignal) => Promise<T>;
  done: Promise<void>;
  finish: () => void;
  forget: ReturnType<typeof setTimeout> | null;
}

export class Jobs<T> {
  readonly #settings: JobSettings;
  readonly #jobs = new Map<string, Entry<T>>();
  readonly #queue: Entry<T>[] = [];
  #making = 0;

  constructor(settings: JobSettings) {
    this.#settings = settings;
  }

  /** The reports queued, being made and kept, for `/health` and tests. */
  get counts(): Record<JobState, number> {
    const counts: Record<JobState, number> = { queued: 0, making: 0, ready: 0, failed: 0 };
    for (const job of this.#jobs.values()) counts[job.state] += 1;
    return counts;
  }

  /**
   * The job for `key`: the one queued, being made, kept or failed, or a new one that `make`
   * makes. A failed one is given to this request, its last, and forgotten.
   */
  join(key: string, make: (signal: AbortSignal) => Promise<T>): Job<T> {
    const known = this.#jobs.get(key);
    if (known) {
      if (known.state === 'failed') this.#drop(known);
      return view(known);
    }
    let finish = (): void => undefined;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const entry: Entry<T> = {
      key,
      state: 'queued',
      result: undefined,
      error: undefined,
      make,
      done,
      finish,
      forget: null,
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
    const entry = this.#jobs.get(job.key);
    if (!entry || entry.state === 'ready' || entry.state === 'failed') return 'done';
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

  /** Forgets every job: the service is closing. */
  clear(): void {
    for (const entry of this.#jobs.values()) if (entry.forget) clearTimeout(entry.forget);
    this.#jobs.clear();
    this.#queue.length = 0;
  }

  #next(): void {
    while (this.#making < this.#settings.making) {
      const entry = this.#queue.shift();
      if (!entry) return;
      this.#start(entry);
    }
  }

  #start(entry: Entry<T>): void {
    this.#making += 1;
    entry.state = 'making';
    const budget = new AbortController();
    const timer = setTimeout(() => {
      budget.abort(this.#settings.budgetError());
    }, this.#settings.budgetMs);
    timer.unref();
    const ended = new Promise<never>((_resolve, reject) => {
      budget.signal.addEventListener(
        'abort',
        () => {
          reject(this.#settings.budgetError());
        },
        { once: true }
      );
    });
    // the budget ends the report's wait at once, whatever its work still holds
    void Promise.race([entry.make(budget.signal), ended])
      .then(
        (result) => {
          entry.state = 'ready';
          entry.result = result;
        },
        (error: unknown) => {
          entry.state = 'failed';
          entry.error = error;
        }
      )
      .finally(() => {
        clearTimeout(timer);
        budget.abort(this.#settings.budgetError());
        this.#making -= 1;
        entry.finish();
        // kept for the hour, or, failed, until it is next asked about
        entry.forget = setTimeout(() => {
          this.#drop(entry);
        }, this.#settings.keepMs);
        entry.forget.unref();
        this.#next();
      });
  }

  #drop(entry: Entry<T>): void {
    if (this.#jobs.get(entry.key) === entry) this.#jobs.delete(entry.key);
    if (entry.forget) clearTimeout(entry.forget);
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
