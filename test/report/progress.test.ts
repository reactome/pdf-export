// The report's status (spec 002 T029): the estimate from past reports' times, and the hold
// a request asks for with `Prefer: wait`.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { Times, preferredWaitMs } from '../../src/report/progress.ts';

describe('the estimate', () => {
  test('none before a report has finished', () => {
    assert.equal(new Times().estimate({ queued: true, place: 0, making: 2 }), undefined);
  });

  test('a report being made: its figures left at the past pace, then the rest', () => {
    const times = new Times();
    // two past reports: 2 s a figure, 10 s besides
    times.record({ figures: 10, figuresMs: 20_000, otherMs: 10_000 });
    times.record({ figures: 30, figuresMs: 60_000, otherMs: 10_000 });
    const progress = { stage: 'figures', done: 5, total: 25 } as const;
    // 20 figures left at 2 s, and 10 s of other time less the 4 s spent before the figures
    assert.equal(
      times.estimate({ queued: false, progress, madeMs: 14_000, otherSpentMs: 4_000 }),
      20 * 2 + 6
    );
    // printing: what is left of the other time, never below zero
    assert.equal(
      times.estimate({
        queued: false,
        progress: { stage: 'printing' },
        madeMs: 60_000,
        otherSpentMs: 7_000,
      }),
      3
    );
    assert.equal(
      times.estimate({
        queued: false,
        progress: { stage: 'printing' },
        madeMs: 60_000,
        otherSpentMs: 30_000,
      }),
      0
    );
  });

  test('a report reading: its expected figures at the past pace, not a past report whole', () => {
    const times = new Times();
    // a past report of 50 figures: 2 s a figure, 10 s besides
    times.record({ figures: 50, figuresMs: 100_000, otherMs: 10_000 });
    // 11 figures expected, 2 s of the other time spent: 22 s and 8 s, not the past 110 s
    assert.equal(
      times.estimate({
        queued: false,
        progress: { stage: 'reading', expected: 11 },
        madeMs: 2_000,
        otherSpentMs: 2_000,
      }),
      30
    );
    // none expected: a past report's time, less what has passed
    assert.equal(
      times.estimate({
        queued: false,
        progress: { stage: 'reading' },
        madeMs: 2_000,
        otherSpentMs: 2_000,
      }),
      108
    );
  });

  test('a report queued: those ahead, made so many at once, then its own', () => {
    const times = new Times();
    times.record({ figures: 10, figuresMs: 20_000, otherMs: 10_000 });
    // three ahead, two made at once: two rounds of 30 s, then its own 30 s
    assert.equal(times.estimate({ queued: true, place: 3, making: 2 }), 90);
  });

  test('from the last 20 reports only', () => {
    const times = new Times();
    for (let i = 0; i < 20; i++) times.record({ figures: 1, figuresMs: 1_000, otherMs: 0 });
    times.record({ figures: 1, figuresMs: 21_000, otherMs: 0 });
    // 19 of 1 s and one of 21 s: 2 s a figure
    assert.equal(times.means()?.perFigureMs, 2_000);
  });
});

describe('Prefer: wait', () => {
  test('a whole number of seconds, held at most the most allowed', () => {
    assert.equal(preferredWaitMs('wait=2', 30_000), 2_000);
    assert.equal(preferredWaitMs('respond-async, wait=5', 30_000), 5_000);
    assert.equal(preferredWaitMs(['handling=lenient', 'wait=0'], 30_000), 0);
    assert.equal(preferredWaitMs('wait=99', 30_000), 30_000);
  });

  test('none, or one not a whole number of seconds, is no preference', () => {
    assert.equal(preferredWaitMs(undefined, 30_000), undefined);
    assert.equal(preferredWaitMs('wait=1.5', 30_000), undefined);
    assert.equal(preferredWaitMs('wait=-1', 30_000), undefined);
    assert.equal(preferredWaitMs('return=minimal', 30_000), undefined);
  });
});
