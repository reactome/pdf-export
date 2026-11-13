// The report's figures (spec 002 T010) against the render stub.
import assert from 'node:assert/strict';
import { after, afterEach, before, describe, test } from 'node:test';

import { CharacterLog, REPLACEMENT } from '../../src/layout/characters.ts';
import { figureKey } from '../../src/layout/figure.ts';
import type { Figure } from '../../src/model/types.ts';
import {
  OVERVIEW,
  Slots,
  drawReportFigures,
  type FigureOptions,
} from '../../src/report/figures.ts';
import { GENOME_WIDE, startRenderStub, type RenderStub } from '../stubs/render.ts';

// a token as the analysis service issues it, its padding as %3D
const TOKEN = 'MjAyNjExMTMxMjAwMDBfMTE%3D';
const FIGURES: Figure[] = [
  { kind: 'diagram', stId: 'R-HSA-90000200' },
  { kind: 'diagram', stId: 'R-HSA-90000100' },
  { kind: 'ehld', stId: 'R-HSA-90000300' },
  { kind: 'ancestor', stId: 'R-HSA-90000200', highlight: ['R-HSA-90000211'] },
  { kind: 'diagram', stId: 'R-HSA-90000230' },
];

describe("the report's figures", () => {
  let stub: RenderStub;
  before(async () => {
    stub = await startRenderStub();
  });
  afterEach(() => {
    stub.reset();
  });
  after(async () => {
    await stub.close();
  });

  const lines: string[] = [];
  const options = (slots = new Slots(2)): FigureOptions & { lines: string[] } => {
    lines.length = 0;
    return {
      render: stub.url,
      slots,
      characters: new CharacterLog('report with-token', (line) => lines.push(line)),
      log: (line) => lines.push(line),
      retryPauseMs: 10,
      timeoutMs: 2_000,
      lines,
    };
  };
  const draw = (species = '9606', figures = FIGURES, opts = options()) =>
    drawReportFigures({ species, token: TOKEN, figures }, opts);

  test('the overview and each pathway figure, with the token, sent once encoded', async () => {
    const drawn = await draw();
    assert.deepEqual([...drawn.keys()].sort(), [OVERVIEW, ...FIGURES.map(figureKey)].sort());
    assert.ok(
      stub.requests.every((r) => r.includes(`token=${TOKEN}`)),
      'the token as issued'
    );
    assert.ok(stub.requests.includes(`/render/${GENOME_WIDE}.svg?species=9606&token=${TOKEN}`));
    assert.ok(
      stub.requests.includes(`/render/R-HSA-90000200.svg?highlight=R-HSA-90000211&token=${TOKEN}`)
    );
  });

  test("the overview is asked for the report's species", async () => {
    // a report for mouse, of an analysis whatever its own species
    const drawn = await draw('10090', []);
    assert.deepEqual(stub.requests, [`/render/${GENOME_WIDE}.svg?species=10090&token=${TOKEN}`]);
    assert.match(drawn.get(OVERVIEW) ?? '', /data-species="10090"/);
  });

  test('never more than the shared cap at once, across two reports', async () => {
    stub.slow(60);
    const shared = new Slots(2);
    await Promise.all([
      draw('9606', FIGURES, options(shared)),
      draw('10090', FIGURES, options(shared)),
    ]);
    assert.equal(stub.requests.length, 12);
    assert.equal(stub.peak, 2, 'two at once, and no more');
  });

  test('a 503 is tried once more; a refused figure is left out and logged, the rest drawn', async () => {
    stub.refuse('R-HSA-90000100', 503, 1);
    stub.refuse('R-HSA-90000230', 404);
    stub.refuse(GENOME_WIDE, 500);
    const opts = options();
    const drawn = await draw('9606', FIGURES, opts);
    assert.ok(drawn.has('diagram/R-HSA-90000100'), 'drawn on its second try');
    assert.ok(!drawn.has('diagram/R-HSA-90000230'));
    assert.ok(!drawn.has(OVERVIEW));
    assert.equal(drawn.size, FIGURES.length - 1);
    assert.deepEqual(opts.lines.sort(), [
      'missing-figure diagram/R-HSA-90000230: R-HSA-90000230: the render service answered 404',
      'missing-figure genome-wide: genome-wide: the render service answered 500',
    ]);
    assert.ok(
      opts.lines.every((line) => !line.includes(TOKEN)),
      'the token never logged'
    );
  });

  test("a figure's labels follow FR-017, in the report's one log", async () => {
    stub.label('R-HSA-90000200', '\u{E000}');
    stub.label(GENOME_WIDE, '\u{E000}');
    const opts = options();
    const drawn = await draw('9606', FIGURES, opts);
    assert.ok(drawn.get('diagram/R-HSA-90000200')?.includes(REPLACEMENT));
    assert.ok(drawn.get(OVERVIEW)?.includes(REPLACEMENT));
    assert.deepEqual(opts.lines, ['uncovered-character U+E000 report with-token']);
  });

  test("a report's end stops its figures, its waiting ones among them", async () => {
    stub.slow(200);
    const ended = new AbortController();
    const opts = { ...options(new Slots(1)), signal: ended.signal };
    const drawing = draw('9606', FIGURES, opts);
    setTimeout(() => {
      ended.abort(new Error('the budget'));
    }, 50);
    await assert.rejects(drawing, /the budget/);
    assert.ok(stub.requests.length < FIGURES.length + 1, 'the waiting never asked');
  });
});

describe('the slots', () => {
  test('hold at most their size, and pass each freed slot on in order', async () => {
    const slots = new Slots(2);
    let busy = 0;
    let most = 0;
    const order: number[] = [];
    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        slots.run(async () => {
          busy += 1;
          most = Math.max(most, busy);
          await new Promise((resolve) => setTimeout(resolve, 10));
          order.push(i);
          busy -= 1;
        })
      )
    );
    assert.equal(most, 2);
    assert.deepEqual(order, [0, 1, 2, 3, 4, 5]);
    assert.throws(() => new Slots(0));
  });

  test('a slot passed on stays taken: one asked for meanwhile still waits', async () => {
    const slots = new Slots(2);
    let busy = 0;
    let most = 0;
    const task = (ms: number) => async () => {
      busy += 1;
      most = Math.max(most, busy);
      await new Promise((resolve) => setTimeout(resolve, ms));
      busy -= 1;
    };
    const first = [slots.run(task(10)), slots.run(task(60)), slots.run(task(60))];
    // the first ends at 10 ms and passes its slot to the third; then two more arrive
    await new Promise((resolve) => setTimeout(resolve, 30));
    await Promise.all([...first, slots.run(task(10)), slots.run(task(10))]);
    assert.equal(most, 2);
  });

  test('one waiting for a slot leaves when its caller ends, not when the slot frees', async () => {
    const slots = new Slots(1);
    const holding = slots.run(() => new Promise((resolve) => setTimeout(resolve, 400)));
    const ended = new AbortController();
    const started = Date.now();
    const waiting = slots.run(() => Promise.resolve('ran'), ended.signal);
    setTimeout(() => {
      ended.abort(new Error('ended'));
    }, 20);
    await assert.rejects(waiting, /ended/);
    assert.ok(Date.now() - started < 300, 'it left at once');
    await holding;
  });
});
