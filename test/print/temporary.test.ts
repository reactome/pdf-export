// A process's private temporary folder (spec 001 T029, T030 from #159's review): one live at
// a time in a process, TMPDIR pointing at it until it is removed, then as it was; and removed
// as the process exits though writes begun before land in it meanwhile.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { privateTemporary } from '../../src/print/temporary.ts';

test('one private temporary folder is live in a process at a time', () => {
  const parent = mkdtempSync(join(tmpdir(), 'pdfx-temporary-'));
  const was = process.env['TMPDIR'];
  process.env['TMPDIR'] = parent;
  try {
    const first = privateTemporary('test');
    assert.equal(process.env['TMPDIR'], first.root);
    assert.throws(() => privateTemporary('again'), /live in this process already/);
    // the refusal changed nothing
    assert.equal(process.env['TMPDIR'], first.root);
    assert.ok(existsSync(first.root));
    first.remove();
    assert.equal(process.env['TMPDIR'], parent);
    assert.ok(!existsSync(first.root));
    // once it is removed, another may be made
    const second = privateTemporary('test');
    assert.equal(process.env['TMPDIR'], second.root);
    second.remove();
    assert.equal(process.env['TMPDIR'], parent);
  } finally {
    if (was === undefined) delete process.env['TMPDIR'];
    else process.env['TMPDIR'] = was;
    rmSync(parent, { recursive: true, force: true });
  }
});

test('a removal that fails keeps an exit handler, to try again as the process exits', () => {
  const parent = mkdtempSync(join(tmpdir(), 'pdfx-temporary-'));
  const was = process.env['TMPDIR'];
  process.env['TMPDIR'] = parent;
  const handlers = process.listenerCount('exit');
  let locked: string | undefined;
  try {
    const temporary = privateTemporary('test');
    // a folder inside it that cannot be emptied: its file cannot be unlinked
    locked = join(temporary.root, 'locked');
    mkdirSync(locked);
    writeFileSync(join(locked, 'file'), '');
    chmodSync(locked, 0o500);
    assert.throws(() => {
      temporary.remove();
    });
    assert.ok(existsSync(temporary.root));
    assert.equal(process.listenerCount('exit'), handlers + 1, 'no exit handler kept');
    assert.equal(process.env['TMPDIR'], parent);
  } finally {
    if (locked) chmodSync(locked, 0o700);
    if (was === undefined) delete process.env['TMPDIR'];
    else process.env['TMPDIR'] = was;
    rmSync(parent, { recursive: true, force: true });
  }
});

test('removed as the process exits, though writes begun before land in it as it goes', () => {
  // a launch's mkdtemp on libuv's thread pool, at a signal's exit, as `serve` met it: the
  // writes go on while the exit handlers run, and a removal that met one was left undone
  const parent = mkdtempSync(join(tmpdir(), 'pdfx-temporary-'));
  const module = new URL('../../src/print/temporary.ts', import.meta.url).href;
  const script = `
    import { mkdir } from 'node:fs/promises';
    import { join } from 'node:path';
    const { privateTemporary } = await import(${JSON.stringify(module)});
    const { root } = privateTemporary('test');
    for (let i = 0; i < 200; i++) void mkdir(join(root, 'd' + i)).catch(() => undefined);
    process.exit(143);
  `;
  try {
    for (let run = 0; run < 20; run++) {
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        env: { ...process.env, TMPDIR: parent },
        encoding: 'utf8',
      });
      assert.equal(child.status, 143, child.stderr);
      assert.deepEqual(readdirSync(parent), [], `run ${String(run + 1)}: ${child.stderr}`);
    }
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
