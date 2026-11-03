// The preflight's checks that need no graph (spec 001 T024): the manifest's reading, the file
// names, the order the figures' names are blamed in, and the book's mode of FR-017 in texts
// and in a drawn figure's labels.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { labelsInBook } from '../../src/figures/labels.ts';
import { prefixIds } from '../../src/figures/prefix.ts';
import { BookCharacters, SUBSTITUTIONS } from '../../src/layout/characters.ts';
import type { Document, Section } from '../../src/model/types.ts';
import { namesInOrder } from '../../src/preflight/characters.ts';
import { diagramLabels } from '../../src/preflight/labels.ts';
import { manifestLine, readManifest, type Fingerprint } from '../../src/preflight/folder.ts';
import { checkFileNames } from '../../src/preflight/names.ts';

const PRINT: Fingerprint = {
  release: 98,
  checksum: '9007199254740993',
  summary: 'sha256:00',
  content: 98,
  build: 'b1',
};
const fig = (stId: string) =>
  manifestLine({ type: 'figure', stId, kind: 'reaction', source: stId, highlight: [] });
const whole = (...figures: string[]) =>
  manifestLine({ type: 'fingerprint', ...PRINT }) +
  figures.join('') +
  manifestLine({ type: 'complete', ...PRINT });

test('a whole manifest is read: its fingerprint and a line per figure', () => {
  const read = readManifest(whole(fig('R-HSA-1'), fig('R-HSA-2')));
  assert.ok(read);
  assert.deepEqual(read.fingerprint, PRINT);
  assert.deepEqual([...read.figures.keys()], ['R-HSA-1', 'R-HSA-2']);
});

test('a manifest that is not whole is refused, each way', () => {
  const first = manifestLine({ type: 'fingerprint', ...PRINT });
  const complete = manifestLine({ type: 'complete', ...PRINT });
  const cases: Record<string, string> = {
    'no complete line': first + fig('R-HSA-1'),
    'a figure line after complete': first + complete + fig('R-HSA-1'),
    'a complete line in the middle': first + complete + fig('R-HSA-1') + complete,
    'a second fingerprint': first + first + fig('R-HSA-1') + complete,
    'a torn last line': whole(fig('R-HSA-1')).slice(0, -5),
    'a last line with no newline': whole(fig('R-HSA-1')).slice(0, -1),
    'a middle line that is not JSON': first + '{"type":"figure",\n' + complete,
    'a middle line that is JSON but not an object': first + '[1]\n' + complete,
    'two lines for one figure': whole(fig('R-HSA-1'), fig('R-HSA-1')),
    'complete differing from the first line':
      first + manifestLine({ type: 'complete', ...PRINT, build: 'b2' }),
    'no fingerprint first': fig('R-HSA-1') + complete,
    'a figure line of no known kind':
      first + fig('R-HSA-1').replace('reaction', 'photo') + complete,
    'a fingerprint whose checksum is a number':
      first.replace('"9007199254740993"', '9007199254740993') +
      complete.replace('"9007199254740993"', '9007199254740993'),
    empty: '',
  };
  for (const [name, text] of Object.entries(cases)) assert.equal(readManifest(text), null, name);
});

test('a name a file cannot hold, or two equal ignoring case, is bad-file-name', () => {
  const ok = { stId: 'R-HSA-1', name: 'Plain pathway' };
  assert.deepEqual(checkFileNames([ok]), []);
  assert.deepEqual(
    checkFileNames([
      ok,
      { stId: 'R-HSA-2', name: 'A/B pathway' },
      { stId: 'R-HSA-3', name: 'Nul\0pathway' },
      // 251 bytes and `.pdf` is 255, the most a name may hold; 252 is one over
      { stId: 'R-HSA-4', name: 'x'.repeat(251) },
      { stId: 'R-HSA-5', name: 'x'.repeat(252) },
      // bytes, not characters: 126 two-byte characters are 252 bytes
      { stId: 'R-HSA-6', name: '\u00E9'.repeat(126) },
      { stId: 'R-HSA-7', name: 'Case pathway' },
      { stId: 'R-HSA-8', name: 'CASE Pathway' },
    ]),
    [
      'bad-file-name R-HSA-2',
      'bad-file-name R-HSA-3',
      'bad-file-name R-HSA-5',
      'bad-file-name R-HSA-6',
      'bad-file-name R-HSA-7',
      'bad-file-name R-HSA-8',
    ]
  );
});

test("the labels of a diagram file are its nodes', compartments', notes', shadows' and links' names", () => {
  const item = (displayName: string) => ({ displayName, id: 1 });
  assert.deepEqual(
    diagramLabels({
      displayName: 'not a label',
      nodes: [item('n')],
      compartments: [item('c')],
      notes: [item('o')],
      shadows: [item('s')],
      links: [item('l'), { id: 2 }],
      edges: [item('not drawn as a label')],
    }),
    ['n', 'c', 'o', 's', 'l']
  );
});

test('a name the figures label is blamed on the first event in document order drawing it', () => {
  const section = (dbId: number, stId: string, kind: 'reaction' | 'diagram') =>
    ({
      event: { dbId, stId },
      figure: { kind, stId },
    }) as unknown as Section;
  const doc = (...sections: Section[]) =>
    ({ places: sections.map((s) => ({ full: true, section: s })) }) as unknown as Document;
  const names = new Map([
    [1, ['shared', 'one']],
    [2, ['shared', 'two']],
    [3, ['three']],
  ]);
  const first = namesInOrder(
    [doc(section(2, 'R-HSA-2', 'reaction')), doc(section(1, 'R-HSA-1', 'reaction'))],
    names
  );
  assert.equal(first.get('shared'), 'R-HSA-2');
  assert.equal(first.get('one'), 'R-HSA-1');
  // a pathway's figure is its diagram, drawn from its file, not from these names
  assert.equal(namesInOrder([doc(section(3, 'R-HSA-3', 'diagram'))], names).size, 0);
});

test("the book's mode: each substitution made and counted, none a fault", () => {
  const characters = new BookCharacters();
  assert.equal(
    characters.text('non\u2011breaking, \uFB01ne, O2\u02D9\u2212, 2\u05F3-O \u2011', 'R-HSA-1'),
    'non-breaking, fine, O2\u2022\u2212, 2\u2032-O -'
  );
  assert.deepEqual(characters.faults, []);
  assert.deepEqual(
    [...characters.replaced],
    [
      [0x2011, 2],
      [0xfb01, 1],
      [0x02d9, 1],
      [0x05f3, 1],
    ]
  );
  assert.equal(SUBSTITUTIONS.size, 4);
});

test("the book's mode: any other character no font draws is a fault naming its subject, kept", () => {
  const characters = new BookCharacters();
  assert.equal(characters.text('a\u2030b\u2030', 'R-HSA-1'), 'a\u2030b\u2030');
  characters.text('\u2103', 'R-HSA-2');
  characters.text('\u2030', 'R-HSA-2');
  characters.text('\u2030 again', 'R-HSA-1');
  assert.deepEqual(characters.faults, [
    'uncovered-character U+2030 R-HSA-1',
    'uncovered-character U+2103 R-HSA-2',
    'uncovered-character U+2030 R-HSA-2',
  ]);
});

test("the book's mode in markup: text and references only, a summation's among a value's strings", () => {
  const characters = new BookCharacters();
  const value = {
    name: 'x\u2011y',
    summations: ['<p title="\u2011">a&#x2011;b &#8209;</p><!-- \u2030 -->'],
  };
  assert.deepEqual(characters.strings(value, 'R-HSA-1'), {
    name: 'x-y',
    summations: ['<p title="\u2011">a-b -</p><!-- \u2030 -->'],
  });
  assert.deepEqual(characters.faults, []);
  characters.markup('<p>&#x2030;</p>', 'R-HSA-3');
  assert.deepEqual(characters.faults, ['uncovered-character U+2030 R-HSA-3']);
});

test("a drawn figure's label off the list is a fault naming the figure's event", () => {
  const svg = '<svg><text id="t1">Label \u2030</text></svg>';
  const characters = new BookCharacters();
  labelsInBook(svg, 'R-HSA-90000211', characters);
  assert.deepEqual(characters.faults, ['uncovered-character U+2030 R-HSA-90000211']);
});

test('a substitution in an inlined figure changes its labels and leaves its elements, ids and attributes', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><defs><clipPath id="c\u2011p"/></defs>' +
    '<g clip-path="url(#c\u2011p)" data-name="\uFB01"><text id="t\u2011" x="1">a\u2011b \uFB01 &#x2D9;</text>' +
    '<style>.x\u2011y{fill:red}</style></g></svg>';
  const prefixed = prefixIds(svg, 's-R-HSA-1');
  const characters = new BookCharacters();
  const out = labelsInBook(prefixed, 'R-HSA-1', characters);
  assert.deepEqual(characters.faults, []);
  assert.equal(out, prefixed.replace('a\u2011b \uFB01 &#x2D9;', 'a-b fi \u2022'));
});
