// A process's private temporary folder (spec 001 T029, T030 from #159's review): one live at
// a time in a process, TMPDIR pointing at it until it is removed, then as it was.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
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
