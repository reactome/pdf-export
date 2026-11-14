// Today's analysis report as its real files break its lines (spec 002 T028), read from a
// layout written here line by line: where Chromium would not break a line as today's does,
// the line breaks are set by hand. Every name is a placeholder.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Layout, Line } from '../../src/compare/read.ts';
import type { ReducedSection } from '../../src/compare/reduce.ts';
import { reduceReport } from '../../src/compare/report.ts';

const SUMMATION =
  'A made-up summation, set at the body size, long enough that most of the text is set at that size.';

/** A layout of today's form: its cover, then its details' part holding the lines given. */
function layout(detail: readonly (readonly [size: number, text: string])[]): Layout {
  const lines: Line[] = [{ page: 0, y: 760, x: 85, size: 24, text: 'Pathway Analysis Report' }];
  const add = (size: number, text: string): void => {
    lines.push({ page: 1, y: 780 - lines.length * 14, x: 85, size, text });
  };
  add(16, '5. Pathways details');
  for (const [size, text] of detail) add(size, text);
  add(10, SUMMATION);
  add(10, SUMMATION);
  add(16, '6. Identifiers found');
  return { pages: [0, 1].map(() => ({ width: 595, height: 842 })), lines, links: [], figures: [] };
}

/** The one section's parts, each as its items. */
function parts(l: Layout): { stId: string; parts: Record<string, string[]> } {
  const sections: ReducedSection[] = reduceReport(l).reduced.sections;
  assert.equal(sections.length, 1);
  const [section] = sections;
  assert.ok(section);
  return {
    stId: section.stId,
    parts: Object.fromEntries(section.parts.map((p) => [p.part, p.items])),
  };
}

const COMPARTMENTS: [number, string] = [
  10,
  'Cellular compartments: placeholder compartment, plasma membrane.',
];

describe("today's report as its real files break its lines (T028)", () => {
  test("a heading's stable identifier broken after its bracket or its R-: the same name", () => {
    const whole = parts(
      layout([[12, '1.Placeholder pathway named at length (R-HSA-90000001)'], COMPARTMENTS])
    );
    assert.equal(whole.stId, 'R-HSA-90000001');
    for (const [first, second] of [
      ['1.Placeholder pathway named at length (R-', 'HSA-90000001)'],
      ['1.Placeholder pathway named at length (', 'R-HSA-90000001)'],
    ] as const) {
      assert.deepEqual(
        parts(layout([[12, first], [12, second], COMPARTMENTS])),
        whole,
        `${first} | ${second}`
      );
    }
  });

  test('a fact wrapped to the left edge before its full stop: the fact, not the summation', () => {
    const heading: [number, string] = [12, '1.Placeholder pathway (R-HSA-90000001)'];
    const whole = parts(layout([heading, COMPARTMENTS]));
    assert.deepEqual(whole.parts['compartments'], ['placeholdercompartment', 'plasmamembrane']);
    const wrapped = parts(
      layout([
        heading,
        [10, 'Cellular compartments: placeholder compartment, plasma'],
        [10, 'membrane.'],
      ])
    );
    assert.deepEqual(wrapped, whole);
    // a fact that ends on its line leaves the next line to the summation, as before
    assert.deepEqual(whole.parts['summation']?.length, 1);
  });
});
