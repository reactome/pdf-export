// The checks shared by what is read from outside: a value of the type is let through, and
// anything else is not.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { causeCode, errorCode, isNumbers, isRecord, isStrings } from '../src/unknown.ts';

test('a record is any object, a list among them; null and the primitives are not', () => {
  for (const value of [{}, { a: 1 }, [], new Error('e')]) assert.ok(isRecord(value));
  for (const value of [null, undefined, 'a', 1, true]) assert.ok(!isRecord(value));
});

test('lists of strings and of numbers, and nothing else', () => {
  assert.ok(isStrings([]) && isStrings(['a']));
  assert.ok(!isStrings(['a', 1]) && !isStrings('a') && !isStrings(null));
  assert.ok(isNumbers([]) && isNumbers([1, 2.5]));
  assert.ok(!isNumbers([1, '2']) && !isNumbers(new Float32Array(1)) && !isNumbers(undefined));
});

test("an error's code, and its cause's, where each is a string", () => {
  assert.equal(errorCode(Object.assign(new Error('e'), { code: 'ENOENT' })), 'ENOENT');
  assert.equal(errorCode(Object.assign(new Error('e'), { code: 2 })), undefined);
  assert.equal(errorCode(new Error('e')), undefined);
  assert.equal(errorCode(null), undefined);
  assert.equal(errorCode('ENOENT'), undefined);
  const refused = new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
  assert.equal(causeCode(refused), 'ECONNREFUSED');
  assert.equal(causeCode(new Error('e', { cause: 'ECONNREFUSED' })), undefined);
  assert.equal(causeCode({ cause: { code: 'ECONNREFUSED' } }), undefined);
});
