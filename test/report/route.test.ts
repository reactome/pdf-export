// The service's own answers (src/report/route.ts): a browser's waiting page carries none of
// a 202's status, its Preference-Applied included (contracts/service.md; review of 25 Nov).
import assert from 'node:assert/strict';
import type { ServerResponse } from 'node:http';
import { test } from 'node:test';
import { serviceError } from '../../src/report/route.ts';

/** A response that keeps what it was given. */
function response() {
  const kept: { status?: number; headers: Record<string, string>; body: string } = {
    headers: {},
    body: '',
  };
  const res = {
    headersSent: false,
    destroyed: false,
    writeHead(status: number, headers: Record<string, string>) {
      kept.status = status;
      kept.headers = headers;
      return this;
    },
    end(body: string) {
      kept.body = body;
      return this;
    },
  };
  return { res: res as unknown as ServerResponse, kept };
}

test("a 202 says the hold it was given; a browser's page does not", () => {
  const json = response();
  serviceError(json.res, 202, false, { status: { state: 'making' }, waitedS: 2 });
  assert.equal(json.kept.headers['Preference-Applied'], 'wait=2');
  assert.match(json.kept.body, /"status"/);

  const page = response();
  serviceError(page.res, 202, true, { status: { state: 'making' }, waitedS: 2 });
  assert.match(page.kept.headers['Content-Type'] ?? '', /text\/html/);
  assert.equal(page.kept.headers['Preference-Applied'], undefined);
});
