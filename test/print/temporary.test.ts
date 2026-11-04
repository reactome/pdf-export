// A process's private temporary folder (spec 001 T029, T030 from #159's review): one live at
// a time in a process, TMPDIR pointing at it until it is removed, then as it was; and removed
// as the process exits only once the processes it started, which write there, are gone.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
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

test('removed as the process exits once what it started has gone, not while it still writes', async (t) => {
  if (!existsSync('/proc/self/environ')) {
    t.skip('reads /proc');
    return;
  }
  // a process exiting the moment it has started a writer, as a run stopped by a signal just
  // as its browser launched: the browser, sent SIGKILL by its launcher's exit handler, may
  // still write into its profile, making its folders again, while this one's exit handler
  // runs (a loaded host's full test run left the folder so). Here the writer (TMPDIR
  // inherited, as the browser's) writes for 300 ms after the exit, then says so outside it.
  const parent = mkdtempSync(join(tmpdir(), 'pdfx-temporary-'));
  try {
    const done = join(parent, 'done');
    const script = join(parent, 'exits.ts');
    const writer = [
      `const fs = require('node:fs');`,
      `const dir = require('node:path').join(process.env.TMPDIR, 'profile', 'Default');`,
      `fs.mkdirSync(dir, { recursive: true });`,
      `process.stdout.write('writing');`,
      `setTimeout(() => {`,
      `  const end = Date.now() + 300;`,
      `  for (let n = 0; Date.now() < end; n++) {`,
      `    try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(dir + '/' + (n % 9), ''); } catch {}`,
      `  }`,
      `  fs.writeFileSync(${JSON.stringify(done)}, '');`,
      `}, 50);`,
    ].join('\n');
    writeFileSync(
      script,
      [
        `import { spawn } from 'node:child_process';`,
        `import { privateTemporary } from ${JSON.stringify(new URL('../../src/print/temporary.ts', import.meta.url).href)};`,
        `const { root } = privateTemporary('test');`,
        `process.stdout.write(root + '\\n');`,
        `const writer = spawn(process.execPath, ['-e', ${JSON.stringify(writer)}], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });`,
        `writer.stdout.once('data', () => process.exit(130));`,
      ].join('\n')
    );
    const child = spawn(process.execPath, [script], {
      env: { ...process.env, TMPDIR: parent },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
    const code = await new Promise<number | null>((resolve) => child.once('exit', resolve));
    assert.equal(code, 130);
    const root = out.split('\n')[0] ?? '';
    assert.ok(root.startsWith(join(parent, 'pdf-export.test-')), out);
    // the writer done: whatever it wrote, it wrote before the folder's removal
    const deadline = Date.now() + 60_000;
    while (!existsSync(done)) {
      assert.ok(Date.now() < deadline, 'the writer never finished');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(!existsSync(root), 'the folder was left, made again by its writer');
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
