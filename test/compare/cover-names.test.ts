// The cover's names as the real files of release 98 write them (T040), read from layouts
// written here line by line: `event-pdf`'s with no label, each name ending in a full stop and
// parted by commas, and both books' running on to the next page where they are many. Every
// name is a placeholder.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Layout, Line } from '../../src/compare/read.ts';
import { hashNames, reduce } from '../../src/compare/reduce.ts';
import { CONTRIBUTORS, INSTITUTIONS } from '../../src/layout/text.ts';

const NAMES = [
  'Dummy, E',
  'Example, B',
  'Placeholder HS, 3rd',
  'Placeholder, A',
  'Sample, C D',
  'Sample-Example, F',
] as const;

/** A layout: the cover's pages, each its lines as size and text, then the introduction. */
function layout(cover: readonly (readonly (readonly [size: number, text: string])[])[]): Layout {
  const lines: Line[] = [];
  cover.forEach((page, p) => {
    page.forEach(([size, text], i) => lines.push({ page: p, y: 760 - i * 15, x: 85, size, text }));
  });
  const intro = cover.length;
  lines.push({ page: intro, y: 770, x: 75, size: 14, text: 'Introduction' });
  for (let i = 0; i < 4; i++) {
    lines.push({ page: intro, y: 745 - i * 12, x: 75, size: 10, text: 'Made-up text.' });
  }
  return {
    pages: [...cover, []].map(() => ({ width: 595, height: 842 })),
    lines,
    links: [],
    figures: [],
  };
}

const names = (l: Layout) => reduce(l).cover.names;

/** `event-pdf`'s cover: the title, the names with no label, the institutions, the date. */
const TODAY_TAIL: [number, string][] = [
  [10, `${INSTITUTIONS.join(', ')}.`],
  [10, 'The contents of this document may be freely copied, as stated under Creative Commons.'],
  [10, '19/10/2026'],
];

/** pdf-export's cover: the title, the release, the label, the names, the institutions. */
const OURS_TAIL: [number, string][] = [
  ...INSTITUTIONS.map((i): [number, string] => [10.5, i]),
  [9, 'Reactome data are dedicated to the public domain under CC0 1.0.'],
  [9, '20 November 2026'],
];

describe("the cover's names as release 98's files write them (T040)", () => {
  test("event-pdf's: no label, each name with a full stop, parted by commas", () => {
    const read = names(
      layout([
        [
          [24, 'Placeholder pathway'],
          [10, 'Dummy, E., Example, B., Placeholder HS, 3rd., Placeholder, A., Sample, C'],
          [10, 'D., Sample-'],
          [10, 'Example, F.'],
          ...TODAY_TAIL,
        ],
      ])
    );
    assert.deepEqual(read, hashNames(NAMES));
  });

  test("pdf-export's: a name with a digit in it is a name, not the cover's date", () => {
    const read = names(
      layout([
        [
          [24, 'Placeholder pathway'],
          [16.5, 'Reactome release 98'],
          [10.5, CONTRIBUTORS],
          [9, 'Dummy, E; Example, B; Placeholder HS,'],
          [9, '3rd; Placeholder, A; Sample, C D; Sample-Example, F'],
          ...OURS_TAIL,
        ],
      ])
    );
    assert.deepEqual(read, hashNames(NAMES));
  });

  test('names that run on to the next page: read to their end, on either form', () => {
    const today = names(
      layout([
        [
          [24, 'Placeholder pathway'],
          [10, 'Dummy, E., Example, B., Placeholder HS, 3rd.,'],
        ],
        [[10, 'Placeholder, A., Sample, C D., Sample-Example, F.'], ...TODAY_TAIL],
      ])
    );
    assert.deepEqual(today, hashNames(NAMES));
    const ours = names(
      layout([
        [
          [24, 'Placeholder pathway'],
          [16.5, 'Reactome release 98'],
          [10.5, CONTRIBUTORS],
          [9, 'Dummy, E; Example, B; Placeholder HS, 3rd;'],
        ],
        [[9, 'Placeholder, A; Sample, C D; Sample-Example, F'], ...OURS_TAIL],
      ])
    );
    assert.deepEqual(ours, hashNames(NAMES));
  });

  test("a cover that ends on its page: the next page's text is not its names", () => {
    const read = names(
      layout([[[24, 'Placeholder pathway'], [10, 'Dummy, E., Example, B.'], ...TODAY_TAIL]])
    );
    assert.deepEqual(read, hashNames(['Dummy, E', 'Example, B']));
  });
});
