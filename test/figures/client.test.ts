import assert from 'node:assert/strict';
import { after, afterEach, before, describe, test } from 'node:test';

import { fetchFigure, type FigureRequest } from '../../src/figures/client.ts';
import { startRenderStub, type RenderStub } from '../stubs/render.ts';

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
});
