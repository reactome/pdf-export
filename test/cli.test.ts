import assert from 'node:assert/strict';
import { test } from 'node:test';

import { run, USAGE } from '../src/cli.ts';

test('with no command, or --help, it prints its usage and succeeds', () => {
  assert.deepEqual(run([]), { code: 0, out: USAGE });
  assert.deepEqual(run(['--help']), { code: 0, out: USAGE });
});

test('an unknown command is refused with exit 2, naming it', () => {
  const { code, out } = run(['bake']);
  assert.equal(code, 2);
  assert.match(out, /^Unknown command: bake\n/);
});
