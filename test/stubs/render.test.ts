import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { startRenderStub, type RenderStub } from './render.ts';

const ALPHA = 'R-HSA-90000200';
const BETA = 'R-HSA-90000100';
const REACTION = 'R-HSA-90000211';

describe('the render stub', () => {
  let stub: RenderStub;
  before(async () => {
    stub = await startRenderStub();
  });
  after(async () => {
    await stub.close();
  });

  const get = (path: string, signal?: AbortSignal) =>
    fetch(`${stub.url}${path}`, signal ? { signal } : {});

  test("answers a diagram as SVG in the website's form", async () => {
    const res = await get(`/render/${ALPHA}.svg`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/svg+xml');
    const svg = await res.text();
    assert.match(svg, /font: normal 600 16px Roboto/);
    assert.match(svg, /id="clip-1"/);
    assert.match(svg, /data:image\/png;base64,/);
  });

  test('two recorded diagrams share their ids, as two of the website’s do', async () => {
    const ids = async (stId: string): Promise<string[]> =>
      [...(await (await get(`/render/${stId}.svg`)).text()).matchAll(/ id="([^"]+)"/g)].map(
        (m) => m[1] ?? ''
      );
    const beta = await ids(BETA);
    assert.ok((await ids(ALPHA)).some((id) => beta.includes(id)));
  });

  test('a reaction, a selection and an analysis are each answered and marked', async () => {
    assert.equal((await get(`/render/${REACTION}.svg?layout=reaction`)).status, 200);
    const selected = await (await get(`/render/${ALPHA}.svg?highlight=${REACTION}`)).text();
    assert.match(selected, new RegExp(`data-highlight="${REACTION}"`));
    const overlaid = await (await get(`/render/${ALPHA}.svg?token=MjAyNi0xMC0yOQ%3D%3D`)).text();
    assert.match(overlaid, /data-token="MjAyNi0xMC0yOQ%3D%3D"/);
  });

  test('answers 400 to a parameter the contract does not name, or a bad value', async () => {
    assert.equal((await get(`/render/${ALPHA}.svg?analysis=abc`)).status, 400);
    assert.equal((await get(`/render/${ALPHA}.svg?layout=diagram`)).status, 400);
    assert.equal((await get(`/render/${ALPHA}.svg?highlight=not-an-id`)).status, 400);
  });

  test('answers 404 for an event it has no figure for', async () => {
    assert.equal((await get('/render/R-HSA-90000999.svg')).status, 404);
  });

  test('refuses on request: 404, 503 a given number of times, or a timeout', async () => {
    stub.refuse(BETA, 503, 1);
    assert.equal((await get(`/render/${BETA}.svg`)).status, 503);
    assert.equal((await get(`/render/${BETA}.svg`)).status, 200);
    stub.refuse(ALPHA, 404);
    assert.equal((await get(`/render/${ALPHA}.svg`)).status, 404);
    assert.equal((await get(`/render/${ALPHA}.svg`)).status, 404);
    stub.refuse(REACTION, 'timeout');
    await assert.rejects(
      get(`/render/${REACTION}.svg?layout=reaction`, AbortSignal.timeout(300)),
      /TimeoutError|aborted/
    );
  });

  test('records every request', () => {
    assert.ok(stub.requests.includes(`/render/${ALPHA}.svg?analysis=abc`));
  });
});
