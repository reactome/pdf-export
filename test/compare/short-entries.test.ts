// pdf-export's short entries as release 98's book lays them out (T040), read from a layout
// written here line by line: an entry whose name fills its line, its stable identifier
// wrapped alone to the next, outside the name's link. Every name is a placeholder.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Layout, Line, Link } from '../../src/compare/read.ts';
import { reduce } from '../../src/compare/reduce.ts';

/** A section's lines from the top of a page: its heading, its identifier, one edit. */
function section(page: number, top: number, stId: string, name: string): Line[] {
  return [
    { page, y: top, x: 58, size: 12, text: name },
    { page, y: top - 20, x: 57, size: 10.5, text: `Stable identifier ${stId}` },
    { page, y: top - 40, x: 57, size: 10.5, text: 'A made-up summation for the placeholder.' },
    { page, y: top - 60, x: 57, size: 12, text: 'Edit history' },
    { page, y: top - 80, x: 57, size: 10.5, text: 'Date Action Names' },
    { page, y: top - 95, x: 57, size: 10.5, text: '2020-01-01 Authored Placeholder, A' },
  ];
}

/** A link to a section, over a line. */
const linkTo = (line: Line, landing: { page: number; y: number }): Link => ({
  box: { page: line.page, x1: line.x, y1: line.y - 2, x2: 535, y2: line.y + 10 },
  uri: null,
  landing,
});

/** The first section, then the short entry's lines given, then a second section. */
function layout(entry: readonly [text: string, linked: boolean][]): Layout {
  const lines = section(1, 760, 'R-HSA-90000001', 'Placeholder pathway');
  const links: Link[] = [];
  entry.forEach(([text, linked], i) => {
    const line: Line = { page: 1, y: 640 - i * 15, x: 93, size: 10.5, text };
    lines.push(line);
    if (linked) links.push(linkTo(line, { page: 2, y: 774 }));
  });
  lines.push(...section(2, 760, 'R-HSA-90000002', 'Placeholder reaction'));
  return { pages: [0, 1, 2].map(() => ({ width: 595, height: 842 })), lines, links, figures: [] };
}

const edits = (l: Layout) =>
  reduce(l)
    .sections.find((s) => s.stId === 'R-HSA-90000001')
    ?.parts.find((p) => p.part === 'edits')?.items;

describe("short entries as release 98's book lays them out (T040)", () => {
  const alone = layout([]);
  test('without an entry: one edit, the table header not among them', () => {
    assert.equal(edits(alone)?.length, 1);
  });

  test('an entry on one line: counted, not read into the edit history', () => {
    const l = layout([['Placeholder reaction R-HSA-90000002', true]]);
    assert.equal(reduce(l).shortEntries, 1);
    assert.deepEqual(edits(l), edits(alone));
  });

  test('its identifier wrapped alone to the next line, outside the link: the same', () => {
    const l = layout([
      ['Placeholder reaction named at such length that it fills its line', true],
      ['R-HSA-90000002', false],
    ]);
    assert.equal(reduce(l).shortEntries, 1);
    assert.deepEqual(edits(l), edits(alone));
  });

  test('its identifier broken at its hyphen, its end alone on the next line: the same', () => {
    const l = layout([
      ['Placeholder reaction named at such length that it fills R-', true],
      ['HSA-90000002', false],
    ]);
    assert.equal(reduce(l).shortEntries, 1);
    assert.deepEqual(edits(l), edits(alone));
  });

  test('its name wrapped over two linked lines, the identifier after the second: the same', () => {
    const l = layout([
      ['Placeholder reaction named at such length that it', true],
      ['runs on to a second line R-HSA-90000002', true],
    ]);
    assert.equal(reduce(l).shortEntries, 1);
    assert.deepEqual(edits(l), edits(alone));
  });

  test('an identifier alone with no linked line before it is no entry', () => {
    const l = layout([['R-HSA-90000002', false]]);
    assert.equal(reduce(l).shortEntries, 0);
  });
});
