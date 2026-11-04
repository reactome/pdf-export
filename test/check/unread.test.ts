// A PDF pdf.js throws on, its message quoting the file (spec 001 T035, from #168's review):
// check-book, and the contents' reader `book` uses, say it by its error's kind alone. The
// planted word stands for a name the book's PDFs hold.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
import { PLANTED, plantedFilter } from '../compare/planted.ts';
import { illustrated, skipWithoutGraph } from '../layout/fixture.ts';

const FILES = fileURLToPath(new URL('../../ci/fixture/files/', import.meta.url));

describe('a PDF pdf.js cannot read, its error quoting it', () => {
  test("the contents' reader says pdf.js's errors by their kind alone", async () => {
    // it reads no page's content, so the filter is not reached: a file pdf.js cannot open
    const broken = new TextEncoder().encode(`%PDF-1.7\n${PLANTED}\n`);
    const error: unknown = await landed(broken, ['entry']).then(
      () => null,
      (e: unknown) => e
    );
    assert.ok(error instanceof UnreadPdf, 'not an UnreadPdf');
    assert.ok(!error.message.includes(PLANTED), 'the planted word is in its message');
  });

  test(
    'check-book stops, saying the error by its kind alone',
    { skip: skipWithoutGraph },
    async () => {
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
        const bytes = await plantedFilter();
        for (const name of names) writeFileSync(join(folder, name), bytes);
        let out = '';
        let err = '';
        const code = await checkBookCommand([folder, '--files', FILES], process.env, {
          out: (t) => (out += t),
          err: (t) => (err += t),
        });
        assert.equal(code, 2);
        assert.ok(!(out + err).includes(PLANTED), 'the planted word was printed');
        assert.equal(err, 'The check stopped: UnreadPdf\n');
      } finally {
        rmSync(folder, { recursive: true, force: true });
      }
    }
  );
});
