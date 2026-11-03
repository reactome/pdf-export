import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AnalysisError } from '../../src/analysis/error.ts';
import { canonicalToken } from '../../src/analysis/token.ts';
import { TOKENS, issue } from '../stubs/analysis.ts';

/** Base64 of 16 bytes: 22 characters and `==`. */
const PADDED = issue('20200101000000_1');
const PADDED_BARE = decodeURIComponent(PADDED).replace(/=+$/, '');
/** Base64 of 18 bytes: 24 characters and no padding. */
const WHOLE = issue('20200101000000_123');

/** A token nested in `layers` layers of URL-encoding, each `%` becoming `%25`. */
function nested(token: string, layers: number): string {
  let given = token;
  for (let i = 0; i < layers; i++) given = encodeURIComponent(given);
  return given;
}

const unknown = (error: unknown) =>
  error instanceof AnalysisError && error.reason === 'unknown-token';

test('a token of the form the service issues is sent canonical: padded, its = as %3D', () => {
  assert.equal(canonicalToken(PADDED), PADDED);
  assert.equal(PADDED.endsWith('%3D%3D'), true);
  assert.equal(canonicalToken(PADDED_BARE), PADDED, 'unpadded');
  assert.equal(canonicalToken(`${PADDED_BARE}==`), PADDED, 'its padding raw');
  assert.equal(canonicalToken(WHOLE), WHOLE, 'a length needing no padding');
  assert.equal(canonicalToken(issue('20200101000000_12')), issue('20200101000000_12'));
  // the counter is a Java long: up to 19 digits
  const longest = issue(`20200101000000_${'9'.repeat(19)}`);
  assert.equal(canonicalToken(longest), longest);
});

test('a token nested in many %25 layers is accepted, and sent canonical', () => {
  assert.equal(canonicalToken(nested(PADDED, 1)), PADDED);
  const deep = nested(PADDED, 1000);
  assert.equal(deep.length > 2000, true);
  assert.equal(canonicalToken(deep), PADDED);
});

test("the stub's tokens: every one the service issued is accepted, the two it could not have issued are not", () => {
  for (const [name, token] of Object.entries(TOKENS)) {
    if (name === 'undated' || name === 'underscore') {
      assert.throws(() => canonicalToken(token), unknown, name);
    } else {
      assert.equal(canonicalToken(token), token, name);
    }
  }
});

/** Anything but the form the service issues, each its own test so that each is seen failing. */
const MALFORMED: [string, string][] = [
  ['', 'an empty token'],
  ['%3D%3D', 'padding alone'],
  ['QQ=', 'wrong padding'],
  [`${PADDED_BARE}=`, 'wrong padding on a whole token'],
  [`${WHOLE}==`, 'padding where none belongs'],
  [`${WHOLE}====`, 'more than two ='],
  [`${WHOLE}A`, 'a lone character in its last four'],
  ['Xw==', 'Base64 of _ alone'],
  [issue('_'), 'Base64 of _ alone, as issued'],
  [issue(`20200101000000_${'1'.repeat(20)}`), 'a counter of 20 digits'],
  [issue('20200101000000_'), 'no counter'],
  [issue('2020010100000_1'), 'a date of 13 digits'],
  [issue('20200101T00000_1'), 'a date not all digits'],
  [issue('no date here'), 'no _'],
  [`${WHOLE.slice(0, 8)}/${WHOLE.slice(8)}`, 'a / raw'],
  [`${WHOLE.slice(0, 8)}%2F${WHOLE.slice(8)}`, 'a / encoded'],
  [`${WHOLE.slice(0, 8)}++${WHOLE.slice(8)}`, 'a +, which decodes as a space'],
  [`${WHOLE.slice(0, 8)}%2B%2B${WHOLE.slice(8)}`, 'a + encoded'],
  [`${WHOLE.slice(0, 8)}!!${WHOLE.slice(8)}`, 'other characters'],
  ['not-base64!', 'not Base64'],
  ['%25', 'a decoding error, %25 decoding to a lone %'],
  [`${PADDED_BARE}%E0%A4%A`, 'a decoding error, a broken sequence'],
  [nested(`${PADDED_BARE}%`, 50), 'a decoding error, many layers down'],
];
for (const [token, name] of MALFORMED) {
  test(`unknown-token: ${name}`, () => {
    assert.throws(() => canonicalToken(token), unknown);
  });
}
