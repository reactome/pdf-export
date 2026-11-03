import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { startContentStub, type ContentStub } from './content.ts';

let stub: ContentStub;
before(async () => {
  stub = await startContentStub();
});
after(async () => {
  await stub.close();
});

test('answers its release as ContentService does, as set, and nothing when silenced', async () => {
  const version = () =>
    fetch(`${stub.url}/data/database/version`, { signal: AbortSignal.timeout(300) });
  const first = await version();
  assert.match(first.headers.get('content-type') ?? '', /^text\/plain/);
  assert.equal(await first.text(), '98');
  stub.release = 99;
  assert.equal(await (await version()).text(), '99');
  assert.equal((await fetch(`${stub.url}/data/other`)).status, 404);
  stub.silence();
  await assert.rejects(version(), { name: 'TimeoutError' });
  stub.reset();
  assert.equal(await (await version()).text(), '98');
  assert.deepEqual(stub.requests, ['/data/database/version']);
});
