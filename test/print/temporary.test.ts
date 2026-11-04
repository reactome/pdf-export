// A process's private temporary folder (spec 001 T029, T030 from #159's review): one live at
// a time in a process, TMPDIR pointing at it until it is removed, then as it was.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
