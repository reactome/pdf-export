import assert from 'node:assert/strict';
import { after, afterEach, before, describe, test } from 'node:test';

import { fetchFigure, type FigureRequest } from '../../src/figures/client.ts';
import { startRenderStub, type Refusal, type RenderStub } from '../stubs/render.ts';

const ALPHA = 'R-HSA-90000200';
const REACTION = 'R-HSA-90000211';
// a token as the analysis service issues it: base64, so with characters a URL encodes
const TOKEN = 'MjAyNjEwMjkxMjAwMDBfMQ==';

describe('the figures client', () => {
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

  const ask = (request: FigureRequest) =>
    fetchFigure(stub.url, request, { timeoutMs: 500, retryPauseMs: 20 });

  test('asks for each kind of figure by the URL the contract gives', async () => {
    const requests: [FigureRequest, string][] = [
      [{ kind: 'diagram', stId: ALPHA }, `/render/${ALPHA}.svg`],
      [{ kind: 'ehld', stId: 'R-HSA-90000300' }, '/render/R-HSA-90000300.svg'],
      [
        { kind: 'ancestor', stId: ALPHA, highlight: [REACTION, 'R-HSA-90000212'] },
        `/render/${ALPHA}.svg?highlight=${REACTION}%2CR-HSA-90000212`,
      ],
      [{ kind: 'reaction', stId: REACTION }, `/render/${REACTION}.svg?layout=reaction`],
    ];
    for (const [request, path] of requests) {
      const answer = await ask(request);
      assert.ok('svg' in answer, JSON.stringify(answer));
      assert.equal(stub.requests.at(-1), path);
    }
  });

  test('sends a token encoded once, so the service reads the token it issued', async () => {
    const answer = await ask({ kind: 'diagram', stId: ALPHA, token: TOKEN });
    assert.ok('svg' in answer);
    // the stub marks the token it read, encoded once for the attribute
    assert.match(answer.svg, new RegExp(`data-token="${encodeURIComponent(TOKEN)}"`));
  });

  test('tries a 503 once more, and then gives up', async () => {
    stub.refuse(ALPHA, 503, 1);
    assert.ok('svg' in (await ask({ kind: 'diagram', stId: ALPHA })));
    assert.equal(stub.requests.length, 2);
    stub.reset();
    stub.refuse(ALPHA, 503);
    const answer = await ask({ kind: 'diagram', stId: ALPHA });
    assert.ok('missing' in answer);
    assert.match(answer.missing, /503/);
    assert.equal(stub.requests.length, 2);
  });

  test('a 404, a 400 or a timeout is a missing figure, not retried', async () => {
    stub.refuse(ALPHA, 404);
    assert.ok('missing' in (await ask({ kind: 'diagram', stId: ALPHA })));
    assert.ok('missing' in (await ask({ kind: 'diagram', stId: 'R-HSA-90000999' })));
    stub.refuse(REACTION, 'timeout');
    const late = await ask({ kind: 'reaction', stId: REACTION });
    assert.ok('missing' in late);
    assert.match(late.missing, /no answer/);
    assert.equal(stub.requests.length, 3);
  });

  test('an answer that stops part way, or is not SVG, is a missing figure, not a failure', async () => {
    stub.refuse(ALPHA, 'stall-body');
    const cut = await ask({ kind: 'diagram', stId: ALPHA });
    assert.ok('missing' in cut);
    assert.match(cut.missing, /cut short/);
    stub.refuse(ALPHA, 'not-svg');
    const json = await ask({ kind: 'diagram', stId: ALPHA });
    assert.ok('missing' in json);
    assert.match(json.missing, /not an SVG/);
  });

  test("names each missing figure's cause (contracts/figures.md)", async () => {
    const cause = async (how: Refusal | null, stId = ALPHA): Promise<string> => {
      stub.reset();
      if (how !== null) stub.refuse(stId, how);
      const answer = await ask({ kind: 'diagram', stId });
      return 'missing' in answer ? answer.cause : 'drawn';
    };
    assert.equal(await cause(404), 'refused');
    assert.equal(await cause(null, 'R-HSA-90000999'), 'refused');
    assert.equal(await cause(500), 'failed');
    assert.equal(await cause(503), 'unanswered');
    assert.equal(await cause(504), 'unanswered');
    assert.equal(await cause('timeout'), 'unanswered');
    assert.equal(await cause('stall-body'), 'unanswered');
    assert.equal(await cause('not-svg'), 'invalid');
    assert.equal(await cause(null), 'drawn');
  });

  test('serve keeps one try of a 504 or a timeout; figures retries each once', async () => {
    const tries = async (how: Refusal, retryUnanswered: boolean, times = -1) => {
      stub.reset();
      stub.refuse(ALPHA, how, times);
      const answer = await fetchFigure(
        stub.url,
        { kind: 'diagram', stId: ALPHA },
        { timeoutMs: 300, retryPauseMs: 10, retryUnanswered }
      );
      return { drawn: 'svg' in answer, requests: stub.requests.length };
    };
    for (const how of [504, 'timeout', 'stall-body'] as const) {
      assert.deepEqual(await tries(how, false), { drawn: false, requests: 1 }, String(how));
      assert.deepEqual(await tries(how, true), { drawn: false, requests: 2 }, String(how));
      assert.deepEqual(await tries(how, true, 1), { drawn: true, requests: 2 }, String(how));
    }
    // a body cut off by its connection closing is gone, not slow: not retried
    assert.deepEqual(await tries('cut-body', true), { drawn: false, requests: 1 });
    stub.reset();
    stub.refuse(ALPHA, 'cut-body');
    const cut = await ask({ kind: 'diagram', stId: ALPHA });
    assert.deepEqual('missing' in cut && cut.cause, 'unanswered');
    // a 500 or a 404 is the figure's own: never retried
    assert.deepEqual(await tries(500, true), { drawn: false, requests: 1 });
    assert.deepEqual(await tries(404, true), { drawn: false, requests: 1 });
  });
});

test('a render service that is not there is a missing figure that says why', async () => {
  const gone = await startRenderStub();
  const url = gone.url;
  await gone.close();
  const answer = await fetchFigure(url, { kind: 'diagram', stId: ALPHA }, { timeoutMs: 500 });
  assert.ok('missing' in answer);
  assert.match(answer.missing, /ECONNREFUSED/);
  assert.equal(answer.cause, 'unanswered');
  // no connection is not retried, even by figures: the service is gone, not slow
  const again = await fetchFigure(
    url,
    { kind: 'diagram', stId: ALPHA },
    { timeoutMs: 500, retryPauseMs: 2000, retryUnanswered: true }
  );
  assert.ok('missing' in again);
});
