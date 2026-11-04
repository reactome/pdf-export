// FR-012's comparison (spec 001 T035): each part's difference is caught, list order is a
// difference of its own that `--expected` records, and no name is printed. The PDFs are
// printed here from a sample document (samples.ts): pdf-export's own, and a reference in
// `event-pdf`'s shape. No assertion here prints a text read from a PDF: a failure says
// which part, never what a name is.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { compareCommand, compareReduced, type Difference } from '../../src/compare/compare.ts';
import { readLayout } from '../../src/compare/read.ts';
import { coverNames, hashNames, reduce, type Reduced } from '../../src/compare/reduce.ts';
import type { Document } from '../../src/model/types.ts';
import { Printer } from '../../src/print/print.ts';
import {
  PEOPLE,
  R1,
  R2,
  S,
  joined,
  printOurs,
  printReference,
  sampleAnalysis,
  sampleDocument,
  type ReferenceOptions,
} from './samples.ts';

/** A difference as the tests name it: part, field and kind, and its events. */
const brief = (d: Difference) =>
  [d.part, d.field, d.kind, ...(d.events ?? [])].filter((w) => w !== undefined).join(' ');

/** The resource, which `event-pdf` reports and pdf-export does not print. */
const RESOURCE = 'analysis resource missing';

/** Every surname and initial of the placeholders, as a printed name could show them. */
const NAME_PARTS = PEOPLE.flatMap((name) => name.split(/[\s,]+/)).filter((w) => w.length > 2);

/** Whether a text holds any placeholder's name, or any part of one; never prints the text. */
function assertNoName(text: string, where: string): void {
  for (const part of NAME_PARTS) {
    assert.ok(!text.includes(part), `a name was printed in ${where}`);
  }
}

/** The reference's first child section moved to the end. */
function moveFirstChildLast(doc: Document): void {
  const [root, child, ...rest] = doc.places;
  if (root && child) doc.places = [root, ...rest, child];
}

describe('compare (FR-012)', { timeout: 300_000 }, () => {
  let printer: Printer;
  let folder: string;
  let ours: Uint8Array;
  let oursReduced: Reduced;
  const analysis = sampleAnalysis();

  // a copy each time: pdf.js may take the buffer it is given
  const reduced = async (pdf: Uint8Array) => reduce(await readLayout(pdf.slice()));
  /** The reference printed from a document changed by `change`, with these options. */
  const reference = async (
    change: (doc: Document) => void = () => undefined,
    options: ReferenceOptions = {}
  ) => {
    const doc = sampleDocument();
    change(doc);
    return printReference(printer, doc, { analysis, ...options });
  };
  /** The differences between a reference and pdf-export's sample, briefly. */
  const differences = async (ref: Uint8Array) =>
    compareReduced('sample.pdf', await reduced(ref), oursReduced).map(brief);

  before(async () => {
    folder = mkdtempSync(join(tmpdir(), 'pdf-export-compare-'));
    printer = await Printer.start();
    ours = await printOurs(printer, sampleDocument(), analysis);
    oursReduced = await reduced(ours);
  });
  after(async () => {
    await printer.close();
    rmSync(folder, { recursive: true, force: true });
  });

  test('the same document in both layouts differs in nothing but the resource', async () => {
    assert.deepEqual(await differences(await reference()), [RESOURCE]);
  });

  test('each section is read with its parts, figure and items, names held as hashes', () => {
    const byId = new Map(oursReduced.sections.map((s) => [s.stId, s]));
    assert.deepEqual([...byId.keys()], ['R-HSA-9000001', R1.stId, S.stId, R2.stId]);
    const parts = (stId: string) => byId.get(stId)?.parts.map((p) => p.part);
    assert.deepEqual(parts(R1.stId), [
      'name',
      'location',
      'stId',
      'type',
      'compartments',
      'inferredFrom',
      'summation',
      'after',
      'references',
      'edits',
      'entities',
    ]);
    // a summation beginning with a label's word is still a summation
    assert.deepEqual(parts(S.stId), [
      'name',
      'location',
      'stId',
      'compartments',
      'diseases',
      'summation',
      'references',
      'edits',
    ]);
    assert.deepEqual(
      oursReduced.sections.map((s) => s.figure),
      ['diagram', 'reaction', 'selection', 'reaction']
    );
    const edits = byId.get(R1.stId)?.parts.find((p) => p.part === 'edits')?.items ?? [];
    assert.equal(edits.length, 2);
    assert.ok(
      edits.every((item) => /^[0-9a-f]{16}$/.test(item)),
      'edits are held as hashes'
    );
    assertNoName(JSON.stringify(oursReduced), 'the reduced form');
  });

  describe('the cover', () => {
    test('its distinct names: another name, or one more, is caught as a count and hash', async () => {
      const more = await differences(
        await reference(undefined, { names: [...PEOPLE.slice(0, 3)] })
      );
      assert.deepEqual(more, ['cover names count', RESOURCE]);
      const other = await differences(
        await reference(undefined, { names: [PEOPLE[0], PEOPLE[3]] })
      );
      assert.deepEqual(other, ['cover names value', RESOURCE]);
      // each side as a count and a hash, nothing else
      const [names] = compareReduced(
        'x',
        await reduced(await reference(undefined, { names: [PEOPLE[3]] })),
        oursReduced
      );
      assert.deepEqual(Object.keys(names?.reference ?? {}), ['count', 'hash']);
      assert.deepEqual(Object.keys(names?.new ?? {}), ['count', 'hash']);
    });

    test('its title, diagram and excerpt note', async () => {
      const changed = await differences(
        await reference((doc) => {
          doc.cover.title = 'Another title';
          doc.cover.figure = null;
          doc.cover.excerpt = false;
        })
      );
      assert.deepEqual(changed, [
        'cover title value',
        'cover diagram value',
        'cover excerpt value',
        RESOURCE,
      ]);
    });

    test('names written with U+2060 and no-break spaces read as the same names', () => {
      const plain = PEOPLE.slice(0, 3);
      const written = plain.map(joined).join(', ');
      assert.ok(written.includes('\u2060') && written.includes('\u00a0'));
      assert.deepEqual(hashNames(coverNames(written)), hashNames(plain));
      // each once, however often it is written
      assert.deepEqual(hashNames(coverNames(`${written}, ${joined(PEOPLE[0])}`)), hashNames(plain));
      assert.deepEqual(hashNames(coverNames(plain.join('; '))), hashNames(plain));
      assert.notDeepEqual(hashNames(coverNames(written)), hashNames(PEOPLE.slice(0, 2)));
    });
  });

  test("the introduction's release and counts", async () => {
    const changed = await differences(await reference(undefined, { release: 97 }));
    assert.deepEqual(changed, ['introduction release value', RESOURCE]);
    const counts = await differences(
      await reference((doc) => {
        doc.release = { version: 98, pathways: 3, reactions: 1 };
      })
    );
    assert.deepEqual(counts, [
      'introduction pathways value',
      'introduction reactions value',
      RESOURCE,
    ]);
  });

  test("the analysis's properties, not its explanatory text", async () => {
    const p = analysis.properties;
    const changed = await differences(
      await reference(undefined, {
        properties: [
          ['Token', p.token],
          ['Analysis type', p.type],
          ['Species', p.species],
          ['Projection', 'false'],
          ['Interactors', String(p.interactors)],
          ['Identifiers found', '3 of 6'],
          ['Pathways found', '5'],
          ['Resource', 'TOTAL'],
        ],
      })
    );
    assert.deepEqual(changed, [
      'analysis identifiersTotal value',
      'analysis pathways value',
      'analysis projection value',
      RESOURCE,
    ]);
  });

  describe('the sections', () => {
    test("a part's text, a part missing, and a list's order, each by its section", async () => {
      const changed = await differences(
        await reference((doc) => {
          for (const place of doc.places) {
            if (!place.full) continue;
            const { section } = place;
            if (section.event.stId === R1.stId) section.summations = ['<p>Other text.</p>'];
            if (section.event.stId === S.stId) section.diseases = [];
            if (section.event.stId === R2.stId) section.event.compartments.reverse();
          }
        })
      );
      assert.deepEqual(changed, [
        RESOURCE,
        `section summation text ${R1.stId}`,
        `section diseases extra ${S.stId}`,
        `section compartments order ${R2.stId}`,
      ]);
    });

    test('a section missing, and the sections in another order', async () => {
      const missing = await differences(
        await reference((doc) => {
          doc.places = doc.places.filter((p) => !p.full || p.section.event.stId !== S.stId);
        })
      );
      assert.ok(missing.includes(`sections extra ${S.stId}`), missing.join('\n'));
      const moved = await differences(await reference(moveFirstChildLast));
      assert.ok(moved.includes(`sections order ${R1.stId}`), 'the order is missed');
    });

    test('the references and the edit history, compared by their hashes', async () => {
      const changed = await differences(
        await reference((doc) => {
          for (const place of doc.places) {
            if (!place.full || place.section.event.stId !== R2.stId) continue;
            place.section.edits = [...place.section.edits].reverse();
            const [first] = place.section.references;
            if (first) place.section.references = [{ ...first, authors: [PEOPLE[0]] }];
          }
        })
      );
      assert.deepEqual(changed, [
        RESOURCE,
        `section references text ${R2.stId}`,
        `section edits order ${R2.stId}`,
      ]);
    });
  });

  test("the contents list's entries, their order and their targets", async () => {
    const entries = (sampleDocument().contents ?? []).map((c) => ({
      title: c.title,
      target: c.target,
    }));
    const fewer = await differences(await reference(undefined, { contents: entries.slice(1) }));
    assert.deepEqual(fewer, [RESOURCE, 'contents extra']);
    const [first, second, ...rest] = entries;
    const swapped = await differences(
      await reference(undefined, { contents: first && second ? [second, first, ...rest] : [] })
    );
    assert.deepEqual(swapped, [RESOURCE, 'contents order']);
    const retargeted = await differences(
      await reference(undefined, {
        contents: entries.map((e) =>
          e.target === `s-${R1.stId}` ? { ...e, target: `s-${S.stId}` } : e
        ),
      })
    );
    assert.deepEqual(retargeted, [RESOURCE, 'contents target']);
    // a target not read, on either side, is a difference of its own
    const unread = await differences(
      await reference(undefined, {
        contents: entries.map((e) =>
          e.target === `s-${R1.stId}` ? { ...e, target: 'nowhere' } : e
        ),
      })
    );
    assert.deepEqual(unread, [RESOURCE, 'contents missing-target']);
  });

  test('the figures: one missing, and one of another kind', async () => {
    const missing = await differences(await reference(undefined, { noFigure: [R1.stId] }));
    assert.deepEqual(missing, [RESOURCE, `figure extra ${R1.stId}`]);
    // pdf-export's own on both sides, where each figure's kind is read
    const doc = sampleDocument();
    for (const place of doc.places) {
      if (place.full && place.section.event.stId === S.stId) {
        place.section.figure = { kind: 'diagram', stId: S.stId };
      }
    }
    const other = await reduced(await printOurs(printer, doc, analysis));
    assert.deepEqual(compareReduced('x', oursReduced, other).map(brief), [`figure kind ${S.stId}`]);
  });

  test('a short entry is counted, apart from the section before it', async () => {
    const doc = sampleDocument();
    doc.places.push({ full: false, anchor: `s-${R1.stId}`, event: R1, path: [], depth: 1 });
    const other = await reduced(await printOurs(printer, doc, analysis));
    assert.deepEqual(compareReduced('x', oursReduced, other).map(brief), ['short-entries count']);
  });

  describe('the command', () => {
    let refFolder: string;
    let newFolder: string;
    let expected: string;
    const run = async (args: string[]) => {
      let out = '';
      let err = '';
      const code = await compareCommand(args, {
        out: (text) => (out += text),
        err: (text) => (err += text),
      });
      return { code, out, err };
    };

    before(async () => {
      refFolder = join(folder, 'reference');
      newFolder = join(folder, 'new');
      mkdirSync(refFolder);
      mkdirSync(newFolder);
      // names that differ, a section moved, and a file on each side alone
      const ref = await reference(moveFirstChildLast, { names: [...PEOPLE] });
      writeFileSync(join(refFolder, 'Alpha signalling pathway.pdf'), ref);
      writeFileSync(join(newFolder, 'Alpha signalling pathway.pdf'), ours);
      writeFileSync(join(refFolder, 'Only today.pdf'), ref);
      writeFileSync(join(newFolder, 'Only new.pdf'), ours);
      expected = join(folder, 'expected.json');
    });

    test('folders file by file, a file on one side only a difference; exit 1', async () => {
      const { code, out, err } = await run([refFolder, newFolder]);
      assert.equal(code, 1);
      assert.equal(err, '');
      const report = JSON.parse(out) as { differences: Difference[] };
      assert.deepEqual(
        report.differences.map((d) => `${d.file}: ${brief(d)}`),
        [
          'Only today.pdf: file missing',
          'Only new.pdf: file extra',
          'Alpha signalling pathway.pdf: cover names count',
          'Alpha signalling pathway.pdf: analysis resource missing',
          `Alpha signalling pathway.pdf: sections order ${R1.stId}`,
        ]
      );
    });

    test('--expected: recorded differences pass, with their reasons; exit 0 only if all are', async () => {
      const records = [
        { part: 'file', kind: 'missing', reason: 'a sample' },
        { part: 'file', kind: 'extra', reason: 'a sample' },
        { part: 'cover', field: 'names', kind: 'count', reason: 'a sample' },
        { part: 'analysis', field: 'resource', kind: 'missing', reason: 'not printed yet' },
        { part: 'sections', kind: 'order', reason: "today's lists are in the database's order" },
        { part: 'contents', kind: 'order', reason: 'matches nothing' },
      ];
      writeFileSync(expected, JSON.stringify({ differences: records }));
      const all = await run([refFolder, newFolder, '--expected', expected]);
      assert.equal(all.code, 0);
      const report = JSON.parse(all.out) as {
        counts: { differences: number; recorded: number; unrecorded: number };
        differences: Difference[];
        unmatched: number[];
      };
      assert.deepEqual(report.counts, { differences: 5, recorded: 5, unrecorded: 0 });
      assert.deepEqual(report.unmatched, [5]);
      assert.ok(report.differences.every((d) => typeof d.recorded === 'string'));
      // the order's record left out: that difference alone fails the run
      writeFileSync(expected, JSON.stringify({ differences: records.slice(0, 4) }));
      const some = await run([refFolder, newFolder, `--expected=${expected}`]);
      assert.equal(some.code, 1);
      const unrecorded = (JSON.parse(some.out) as { differences: Difference[] }).differences.filter(
        (d) => d.recorded === undefined
      );
      assert.deepEqual(unrecorded.map(brief), [`sections order ${R1.stId}`]);
    });

    test('a file that cannot be read is named and is a difference; the others are compared', async () => {
      const refs = join(folder, 'broken-reference');
      const news = join(folder, 'broken-new');
      mkdirSync(refs);
      mkdirSync(news);
      writeFileSync(join(refs, 'Broken.pdf'), 'not a PDF: Placeholder, A');
      writeFileSync(join(news, 'Broken.pdf'), ours);
      writeFileSync(join(refs, 'Whole.pdf'), ours);
      writeFileSync(join(news, 'Whole.pdf'), ours);
      const { code, out, err } = await run([refs, news]);
      assert.equal(code, 1);
      assert.match(err, /^Not read: .*Broken\.pdf \(\w+/);
      assertNoName(out + err, 'the report of an unreadable file');
      const report = JSON.parse(out) as { differences: Difference[] };
      assert.deepEqual(
        report.differences.map((d) => `${d.file}: ${brief(d)}`),
        ['Broken.pdf: file reference unreadable']
      );
    });

    test('no name is printed, in the report or its errors', async () => {
      const differ = await run([refFolder, newFolder]);
      assertNoName(differ.out + differ.err, 'the report');
      const pdfs = await run([
        join(refFolder, 'Alpha signalling pathway.pdf'),
        join(newFolder, 'Alpha signalling pathway.pdf'),
      ]);
      assert.equal(pdfs.code, 1);
      assertNoName(pdfs.out + pdfs.err, 'the report of two PDFs');
      // a reference whose names are all others: still only a count and a hash
      const report = JSON.parse(pdfs.out) as { differences: Difference[] };
      assert.ok(report.differences.some((d) => d.field === 'names'));
    });

    test('bad arguments: exit 2, saying what is needed', async () => {
      assert.equal((await run([refFolder])).code, 2);
      const mixed = await run([refFolder, join(newFolder, 'Only new.pdf')]);
      assert.equal(mixed.code, 2);
      assert.match(mixed.err, /both be PDFs or both be folders/);
      assert.equal((await run([refFolder, newFolder, '--depth', '1'])).code, 2);
      writeFileSync(expected, JSON.stringify({ differences: [{ part: 'cover' }] }));
      const unrecorded = await run([refFolder, newFolder, '--expected', expected]);
      assert.equal(unrecorded.code, 2);
      assert.match(unrecorded.err, /needs a part, a kind and a reason/);
      writeFileSync(
        expected,
        JSON.stringify({
          differences: [{ part: 'cover', kind: 'count', reason: 'x', feild: 'names' }],
        })
      );
      const misspelt = await run([refFolder, newFolder, '--expected', expected]);
      assert.equal(misspelt.code, 2);
      assert.match(misspelt.err, /keys not known: feild/);
      assert.equal((await run([refFolder, newFolder, '--reference-margin', 'wide'])).code, 2);
    });

    test("--reference-margin: the reference's margin band, in points", async () => {
      const file = join(newFolder, 'Alpha signalling pathway.pdf');
      assert.equal((await run([file, file])).code, 0);
      // a band 300 pt deep leaves the reference little of its text
      const deep = await run([file, file, '--reference-margin', '300']);
      assert.equal(deep.code, 1);
    });

    test('it is a command of the command line', () => {
      const result = spawnSync(
        process.execPath,
        [fileURLToPath(new URL('../../src/cli.ts', import.meta.url)), 'compare'],
        { encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '' } }
      );
      assert.equal(result.status, 2);
      assert.match(result.stderr, /Two paths are needed/);
    });
  });
});
