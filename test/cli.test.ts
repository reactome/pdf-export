import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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

test('figures is a command: its bad arguments are exit 2, saying what is needed', () => {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('../src/cli.ts', import.meta.url)), 'figures'],
    { encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '', NEO4J_URI: 'bolt://127.0.0.1:1' } }
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--files is needed/);
  assert.match(USAGE, /^ {2}figures {6}/m);
});
