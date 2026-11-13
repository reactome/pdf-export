import assert from 'node:assert/strict';
import { after, afterEach, before, describe, test } from 'node:test';

import { GENOME_WIDE, startRenderStub, type RenderStub } from './render.ts';

const ALPHA = 'R-HSA-90000200';
const BETA = 'R-HSA-90000100';
const GAMMA = 'R-HSA-90000300';
const REACTION = 'R-HSA-90000211';

describe('the render stub', () => {
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

  const get = (path: string, signal?: AbortSignal) =>
    fetch(`${stub.url}${path}`, signal ? { signal } : {});
  const ids = async (path: string): Promise<string[]> =>
    [...(await (await get(path)).text()).matchAll(/ id="([^"]+)"/g)].map((m) => m[1] ?? '');

  test("answers a diagram as SVG in the website's form", async () => {
    const res = await get(`/render/${ALPHA}.svg`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /^image\/svg\+xml(;|$)/);
    const svg = await res.text();
    // node labels at 12 px and a compartment's at 80 px, as the website draws them
    assert.match(svg, /font: normal 600 12px Roboto/);
    assert.match(svg, /font: normal 600 80px Roboto/);
    assert.match(svg, /id="clip-1"/);
    assert.match(svg, / href="data:image\/png;base64,/);
  });

  test("two recorded diagrams share their ids, as two of the website's do", async () => {
    const beta = await ids(`/render/${BETA}.svg`);
    assert.ok((await ids(`/render/${ALPHA}.svg`)).some((id) => beta.includes(id)));
  });

  test("the illustration carries its own ids, the pathway's stable id among them", async () => {
    const own = await ids(`/render/${GAMMA}.svg`);
    for (const id of [GAMMA, 'ANALINFO', 'clip0_1_2', 'paint0_linear_1_2', 'path-1-inside-1_1_2']) {
      assert.ok(own.includes(id), id);
    }
  });

  test('a reaction, a selection and an analysis are each answered and marked', async () => {
    assert.equal((await get(`/render/${REACTION}.svg?layout=reaction`)).status, 200);
    assert.equal((await get('/render/R-MMU-90000910.svg?layout=reaction')).status, 200);
    const selected = await (await get(`/render/${ALPHA}.svg?highlight=${REACTION}`)).text();
    assert.match(selected, new RegExp(`data-highlight="${REACTION}"`));
    const overlaid = await (await get(`/render/${ALPHA}.svg?token=MjAyNi0xMC0yOQ%3D%3D`)).text();
    assert.match(overlaid, /data-token="MjAyNi0xMC0yOQ%3D%3D"/);
  });

  test('answers 400 to a parameter the contract does not name, a bad value, a repeat or another format', async () => {
    for (const path of [
      `/render/${ALPHA}.svg?analysis=abc`,
      `/render/${ALPHA}.svg?layout=diagram`,
      `/render/${ALPHA}.svg?highlight=not-an-id`,
      `/render/${ALPHA}.svg?highlight=${REACTION}&highlight=${REACTION}`,
      `/render/${ALPHA}.png`,
    ]) {
      const res = await get(path);
      assert.equal(res.status, 400, path);
      assert.ok(((await res.json()) as { error?: string }).error, path);
    }
  });

  test('answers 404 for an event it has no figure for', async () => {
    assert.equal((await get('/render/R-HSA-90000999.svg')).status, 404);
  });

  test('refuses on request: 404, or 503 a given number of times with Retry-After', async () => {
    stub.refuse(BETA, 503, 1);
    const busy = await get(`/render/${BETA}.svg`);
    assert.equal(busy.status, 503);
    assert.equal(busy.headers.get('retry-after'), '5');
    assert.equal((await get(`/render/${BETA}.svg`)).status, 200);
    stub.refuse(ALPHA, 404);
    assert.equal((await get(`/render/${ALPHA}.svg`)).status, 404);
    assert.equal((await get(`/render/${ALPHA}.svg`)).status, 404);
  });

  test('times out on request, and the client sees no answer', async () => {
    stub.refuse(REACTION, 'timeout');
    await assert.rejects(
      get(`/render/${REACTION}.svg?layout=reaction`, AbortSignal.timeout(300)),
      /TimeoutError|aborted/
    );
  });

  test('records every request, and forgets them on reset', async () => {
    await get(`/render/${ALPHA}.svg?analysis=abc`);
    assert.deepEqual(stub.requests, [`/render/${ALPHA}.svg?analysis=abc`]);
    stub.reset();
    assert.deepEqual(stub.requests, []);
  });

  test('refuses with a 500 or a 504, for one figure or for every one', async () => {
    stub.refuse(ALPHA, 500, 1);
    assert.equal((await get(`/render/${ALPHA}.svg`)).status, 500);
    assert.equal((await get(`/render/${ALPHA}.svg`)).status, 200);
    stub.refuseAll(504, 2);
    assert.equal((await get(`/render/${ALPHA}.svg`)).status, 504);
    assert.equal((await get(`/render/${BETA}.svg`)).status, 504);
    assert.equal((await get(`/render/${BETA}.svg`)).status, 200);
  });

  test('answers its health as set, and runs a hook as each figure is drawn', async () => {
    assert.deepEqual(await (await get('/health')).json(), {
      build: '000000000000',
      files: 'local',
    });
    const drawn: string[] = [];
    stub.onRender((stId) => {
      drawn.push(stId);
      stub.health.build = 'abcdefabcdef';
    });
    await (await get(`/render/${REACTION}.svg?layout=reaction`)).text();
    assert.deepEqual(drawn, [REACTION]);
    assert.equal(
      ((await (await get('/health')).json()) as { build: string }).build,
      'abcdefabcdef'
    );
    stub.reset();
    assert.equal(
      ((await (await get('/health')).json()) as { build: string }).build,
      '000000000000'
    );
  });

  test("answers the genome-wide overview naming its species, the service's own by default", async () => {
    const token = 'MjAyNi0xMC0yOQ%3D%3D';
    const res = await get(`/render/genome-wide.svg?species=10090&token=${token}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /^image\/svg\+xml(;|$)/);
    const svg = await res.text();
    assert.match(svg, /data-species="10090"/);
    assert.match(svg, /<text[^>]*>Genome-wide overview, species 10090</);
    assert.match(svg, new RegExp(`data-token="${token}"`));
    assert.match(await (await get('/render/genome-wide.svg')).text(), /data-species="9606"/);
    stub.refuse(GENOME_WIDE, 503, 1);
    assert.equal((await get('/render/genome-wide.svg?species=9606')).status, 503);
    assert.equal((await get('/render/genome-wide.svg?species=9606')).status, 200);
  });

  test('refuses a resource, as the service takes none, and a species it cannot take', async () => {
    for (const path of [
      '/render/genome-wide.svg?species=9606&token=abc&resource=TOTAL',
      `/render/${ALPHA}.svg?token=abc&resource=UNIPROT`,
      '/render/genome-wide.svg?species=Homo_sapiens',
      '/render/genome-wide.svg?species=9606&species=9606',
      `/render/genome-wide.svg?highlight=${REACTION}`,
      `/render/${ALPHA}.svg?species=9606`,
      '/render/genome-wide.png?species=9606',
    ]) {
      const res = await get(path);
      assert.equal(res.status, 400, path);
      assert.ok(((await res.json()) as { error?: string }).error, path);
    }
  });

  test('silenced, it answers nothing, its health included; slowed, it answers late', async () => {
    stub.slow(150);
    const started = Date.now();
    assert.equal((await get(`/render/${ALPHA}.svg`)).status, 200);
    assert.ok(Date.now() - started >= 140);
    stub.silence();
    for (const path of ['/health', `/render/${ALPHA}.svg`]) {
      await assert.rejects(get(path, AbortSignal.timeout(300)), { name: 'TimeoutError' });
    }
  });
});

test(
  'closing the stub ends a request it is holding, which no client gave up on',
  { timeout: 5000 },
  async () => {
    const stub = await startRenderStub();
    stub.refuse(REACTION, 'timeout');
    const pending = fetch(`${stub.url}/render/${REACTION}.svg?layout=reaction`).then(
      () => 'answered',
      () => 'ended'
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    await stub.close();
    assert.equal(await pending, 'ended');
  }
);
