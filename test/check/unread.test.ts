// A PDF that cannot be read (spec 001 T035, from #168's and #171's reviews): check-book names
// it by its path and pdf.js's error's kind, never pdf.js's message, which quotes the file;
// the contents' reader `book` uses likewise. A file system's error says its message. The
// planted word stands for a name the book's PDFs hold.
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { chmodSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

import { checkBookCommand } from '../../src/check/book.ts';
import { graphSettings, openGraph } from '../../src/graph/connection.ts';
import { buildBook } from '../../src/model/build.ts';
import { fileName } from '../../src/preflight/names.ts';
import { bookPathways } from '../../src/preflight/preflight.ts';
import { landed } from '../../src/print/contents.ts';
import { UnreadPdf } from '../../src/print/unread.ts';
import { PLANTED, plantedDestinations, plantedFilter } from '../compare/planted.ts';
import { illustrated, skipWithoutGraph } from '../layout/fixture.ts';

const FILES = fileURLToPath(new URL('../../ci/fixture/files/', import.meta.url));

describe('a PDF pdf.js cannot read, its error quoting it', () => {
  test("the contents' reader names pdf.js's error by its kind alone", async () => {
    const error: unknown = await landed(plantedDestinations(), ['entry']).then(
      () => null,
      (e: unknown) => e
    );
    assert.ok(error instanceof UnreadPdf, 'not an UnreadPdf');
    // pdf.js's own error quoted the word: the planted PDF is one it reads as intended
    assert.ok(
      error.pdfError() instanceof Error && (error.pdfError() as Error).message.includes(PLANTED),
      "pdf.js's error did not quote the planted word"
    );
    assert.ok(!error.message.includes(PLANTED), 'the planted word is in its message');
    assert.equal(error.message, `A PDF not read (${error.kind})`);
    // printed whole, as console.error or an uncaught error prints it: no cause, no word
    assert.ok(!inspect(error).includes(PLANTED), 'the planted word is in the error printed whole');
  });

  /** check-book on a folder of the fixture's book's names, each file written by `write`. */
  async function checkFolder(write: (path: string) => void) {
    const folder = mkdtempSync(join(tmpdir(), 'pdf-export-unread-'));
    try {
      const graph = openGraph(graphSettings(process.env));
      let names: string[];
      try {
        const docs = await buildBook(graph, { illustrated });
        names = bookPathways(docs).map((pathway) => fileName(pathway.name));
      } finally {
        await graph.close();
      }
      for (const name of names) write(join(folder, name));
      let out = '';
      let err = '';
      const code = await checkBookCommand([folder, '--files', FILES], process.env, {
        out: (t) => (out += t),
        err: (t) => (err += t),
      });
      return { code, out, err, folder };
    } finally {
      for (const name of readdirSync(folder)) chmodSync(join(folder, name), 0o600);
      rmSync(folder, { recursive: true, force: true });
    }
  }

  test(
    "check-book names a file pdf.js throws on, quoting it, and pdf.js's error's kind alone",
    { skip: skipWithoutGraph },
    async () => {
      const bytes = await plantedFilter();
      const { code, out, err, folder } = await checkFolder((path) => {
        writeFileSync(path, bytes);
      });
      assert.equal(code, 2);
      assert.ok(!(out + err).includes(PLANTED), 'the planted word was printed');
      assert.ok(err.startsWith(`The check stopped: ${folder}`), 'the file is not named');
      assert.match(err, /\.pdf not read \((?:UnknownErrorException|FormatError)\)\n$/);
    }
  );

  test('check-book names a truncated PDF and its kind', { skip: skipWithoutGraph }, async () => {
    const whole = await plantedFilter();
    const { code, err, folder } = await checkFolder((path) => {
      writeFileSync(path, whole.slice(0, 9));
    });
    assert.equal(code, 2);
    assert.ok(err.startsWith(`The check stopped: ${folder}`), 'the file is not named');
    assert.match(err, /\.pdf not read \(InvalidPDFException\)\n$/);
  });

  test(
    'check-book names a file it may not read, by its path and the error',
    { skip: skipWithoutGraph },
    async () => {
      const { code, err, folder } = await checkFolder((path) => {
        writeFileSync(path, 'x');
        chmodSync(path, 0o000);
      });
      assert.equal(code, 2);
      assert.match(err, /^The check stopped: EACCES: permission denied, open '.*\.pdf'\n$/);
      assert.ok(err.includes(folder), 'the path is not named');
    }
  );
});
