// The report's figures (spec 002 T010, research R3, contracts/render.md and service.md):
// the genome-wide overview of the report's species and each reported pathway's figure as
// spec 001 chooses it, all with the analysis's token, from the render service. Every
// report's requests go through one set of slots, the render service's concurrency (2 by
// default), so reports together never take more of its slots than that. A 503 is tried
// once more after its pause (spec 001's client); a figure that cannot be drawn is left out
// and logged, and the report is still made. Labels follow FR-017 on request.
import { fetchFigure, type FigureRequest } from '../figures/client.ts';
import { labelsOnRequest } from '../figures/labels.ts';
import type { CharacterLog } from '../layout/characters.ts';
import { figureKey } from '../layout/figure.ts';
import type { Figure } from '../model/types.ts';
import type { PathwayDetail } from './details.ts';

/** The key the overview is kept under, beside the pathways' figures' keys. */
export const OVERVIEW = 'genome-wide';

/**
 * Slots for the render service, shared by every report being made: at most `size` requests
 * at once, the rest waiting in the order they came.
 */
export class Slots {
  readonly #size: number;
  #busy = 0;
  readonly #waiting: (() => void)[] = [];

  constructor(size: number) {
    if (!Number.isInteger(size) || size < 1) throw new Error('Slots need a whole number above 0');
    this.#size = size;
  }

  /** `task` run in a slot, once one is free; a caller that ends while waiting leaves the queue. */
  async run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    if (this.#busy >= this.#size) {
      await new Promise<void>((resolve, reject) => {
        const start = (): void => {
          signal?.removeEventListener('abort', leave);
          resolve();
        };
        const leave = (): void => {
          const at = this.#waiting.indexOf(start);
          if (at >= 0) this.#waiting.splice(at, 1);
          reject(signal?.reason instanceof Error ? signal.reason : new Error('ended'));
        };
        this.#waiting.push(start);
        signal?.addEventListener('abort', leave, { once: true });
      });
    } else {
      this.#busy += 1;
    }
    try {
      return await task();
    } finally {
      // the slot passes to the next waiting, or is freed
      const next = this.#waiting.shift();
      if (next) next();
      else this.#busy -= 1;
    }
  }
}

/** Each reported pathway's figure, once each, from their details. */
export function pathwayFigures(details: Iterable<PathwayDetail>): Figure[] {
  const figures = new Map<string, Figure>();
  for (const { section } of details) {
    if (section.figure) figures.set(figureKey(section.figure), section.figure);
  }
  return [...figures.values()];
}

/** A figure as the render service is asked for it, with the token. */
function requestOf(figure: Figure, token: string): FigureRequest {
  switch (figure.kind) {
    case 'ancestor':
      return { kind: 'ancestor', stId: figure.stId, highlight: figure.highlight, token };
    case 'reaction':
      return { kind: 'reaction', stId: figure.stId, token };
    default:
      return { kind: figure.kind, stId: figure.stId, token };
  }
}

export interface FigureOptions {
  /** The render service's address. */
  render: string;
  /** The slots every report shares. */
  slots: Slots;
  /** The report's one log of characters no font draws, its texts' too. */
  characters: CharacterLog;
  /** Where a missing figure is said. */
  log: (line: string) => void;
  timeoutMs?: number;
  retryPauseMs?: number;
  /** The report's end: its time budget. */
  signal?: AbortSignal;
}

/**
 * The report's figures, by key: the overview under `OVERVIEW` for the report's species (by
 * taxonomy id), and each pathway's under its figureKey. A figure that cannot be drawn is
 * not among them.
 */
export async function drawReportFigures(
  { species, token, figures }: { species: string; token: string; figures: readonly Figure[] },
  { render, slots, characters, log, timeoutMs, retryPauseMs, signal }: FigureOptions
): Promise<Map<string, string>> {
  // the client encodes the token once: it is given decoded, as the service issued it
  const decoded = decodeURIComponent(token);
  const wanted: [string, FigureRequest][] = [
    [OVERVIEW, { kind: 'genome-wide', species, token: decoded }],
    ...figures.map((f): [string, FigureRequest] => [figureKey(f), requestOf(f, decoded)]),
  ];
  const drawn = new Map<string, string>();
  await Promise.all(
    wanted.map(([key, request]) =>
      slots.run(async () => {
        const answer = await fetchFigure(render, request, {
          ...(timeoutMs === undefined ? {} : { timeoutMs }),
          ...(retryPauseMs === undefined ? {} : { retryPauseMs }),
          ...(signal === undefined ? {} : { signal }),
        });
        if ('missing' in answer) {
          log(`missing-figure ${key}: ${answer.missing}`);
          return;
        }
        try {
          drawn.set(key, labelsOnRequest(answer.svg, characters));
        } catch (error) {
          const why = error instanceof Error ? error.name : 'error';
          log(`missing-figure ${key}: its labels could not be read (${why})`);
        }
      }, signal)
    )
  );
  return drawn;
}
