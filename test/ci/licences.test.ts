import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  allowed,
  declared,
  fontsWithoutLicence,
  offenders,
  unusedExceptions,
} from '../../ci/licences.ts';

test('a single allowed licence passes, and the GPL family does not', () => {
  for (const ok of ['MIT', 'Apache-2.0', 'BSD-3-Clause', 'ISC', 'OFL-1.1', 'CC0-1.0', '0BSD']) {
    assert.equal(allowed(ok), true, ok);
  }
  for (const bad of ['GPL-3.0', 'GPL-3.0-only', 'LGPL-2.1', 'AGPL-3.0', 'SSPL-1.0', 'UNLICENSED']) {
    assert.equal(allowed(bad), false, bad);
  }
});

test('SPDX expressions: OR needs one, AND needs both, WITH keeps its base', () => {
  assert.equal(allowed('(MIT AND Zlib)'), true);
  assert.equal(allowed('MIT AND GPL-3.0'), false);
  assert.equal(allowed('(MIT OR GPL-3.0)'), true);
  assert.equal(allowed('GPL-3.0 OR AGPL-3.0'), false);
  assert.equal(allowed('Apache-2.0 WITH LLVM-exception'), true);
  assert.equal(allowed('(MIT OR (Apache-2.0 AND GPL-2.0))'), true);
  assert.equal(allowed('((Apache-2.0 AND GPL-2.0) OR AGPL-3.0)'), false);
});

test('an expression that cannot be read is not allowed', () => {
  for (const broken of ['(MIT', 'MIT)', 'MIT OR', 'AND MIT', '', 'MIT GPL-3.0']) {
    assert.equal(allowed(broken), false, JSON.stringify(broken));
  }
});

test('the old licence forms are read: { type } and a list', () => {
  assert.equal(declared({ type: 'MIT' }), 'MIT');
  assert.equal(declared([{ type: 'MIT' }, { type: 'Apache-2.0' }]), 'MIT OR Apache-2.0');
  assert.equal(declared(undefined), null);
  assert.equal(declared('  '), null);
});

test('every offender is listed, not only the first, with its reason', () => {
  const found = offenders([
    { name: 'fine', version: '1.0.0', license: 'MIT' },
    { name: 'copyleft', version: '2.0.0', license: 'GPL-3.0' },
    { name: 'silent', version: '0.1.0' },
    { name: 'also-copyleft', version: '1.0.0', license: 'AGPL-3.0-only' },
  ]);
  assert.deepEqual(
    found.map((o) => `${o.name}: ${o.reason}`),
    [
      'also-copyleft: not on the allowlist',
      'copyleft: not on the allowlist',
      'silent: declares no licence',
    ]
  );
});

test('the theme package is the one documented exception, by name, and only while it declares none', () => {
  assert.deepEqual(offenders([{ name: 'ngx-reactome-style', version: '0.1.0' }]), []);
  assert.equal(offenders([{ name: 'ngx-reactome-styles', version: '0.1.0' }]).length, 1);
  // A declared licence is always read, even the excepted package's
  assert.equal(
    offenders([{ name: 'ngx-reactome-style', version: '0.2.0', license: 'GPL-3.0' }]).length,
    1
  );
});

test('an exception that matches nothing installed is reported, to be removed', () => {
  assert.deepEqual(unusedExceptions([{ name: 'other' }]), ['ngx-reactome-style']);
  assert.deepEqual(unusedExceptions([{ name: 'ngx-reactome-style' }]), []);
});

test('a shipped font without its licence file is an offender, found by its location', () => {
  const root = mkdtempSync(join(tmpdir(), 'licences-'));
  mkdirSync(join(root, 'node_modules/@fontsource/roboto'), { recursive: true });
  mkdirSync(join(root, 'node_modules/@fontsource/noto-sans'), { recursive: true });
  writeFileSync(join(root, 'node_modules/@fontsource/roboto/OFL.txt'), 'SIL Open Font License 1.1');
  const found = fontsWithoutLicence(
    [
      {
        name: '@fontsource/roboto',
        version: '5.3.0',
        license: 'OFL-1.1',
        location: 'node_modules/@fontsource/roboto',
      },
      {
        name: '@fontsource/noto-sans',
        version: '5.3.0',
        license: 'OFL-1.1',
        location: 'node_modules/@fontsource/noto-sans',
      },
      {
        name: 'not-a-font',
        version: '1.0.0',
        license: 'MIT',
        location: 'node_modules/@fontsource/noto-sans',
      },
    ],
    root
  );
  assert.deepEqual(
    found.map((o) => o.name),
    ['@fontsource/noto-sans']
  );
});
