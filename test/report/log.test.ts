// The token as the report's log line names it (spec 002 T015, research R7): a hash keyed for
// the process. A token is a date and a counter, which a plain hash would give back to anyone
// who hashed the few thousand of a day.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { tokenHash } from '../../src/report/report.ts';
import { REPORT_TOKENS } from '../stubs/analysis.ts';

test("a token's hash: the same for one token, another for another, never a plain hash", () => {
  const token = REPORT_TOKENS.expression;
  assert.match(tokenHash(token), /^[0-9a-f]{16}$/);
  assert.equal(tokenHash(token), tokenHash(token));
  assert.notEqual(tokenHash(token), tokenHash(REPORT_TOKENS.interactors));
  for (const form of [token, decodeURIComponent(token)]) {
    for (const algorithm of ['sha256', 'sha1', 'md5']) {
      const plain = createHash(algorithm).update(form).digest('hex');
      assert.ok(!plain.startsWith(tokenHash(token)), algorithm);
    }
  }
  assert.ok(!token.toLowerCase().includes(tokenHash(token).slice(0, 6)));
});
