// FR-012's comparison on layouts other than the sample's (spec 001 T035, from #165's review):
// covers whose title a figure takes in, an analysis part followed by a section the reducer
// cannot read, and a reference laid out unlike the sample's, so the reducer is not tried
// only on its own author's shape. Names are planted in each, and none may be printed.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { compareReduced } from '../../src/compare/compare.ts';
import { Output, type Difference } from '../../src/compare/output.ts';
import { readLayout } from '../../src/compare/read.ts';
import { reduce, type Reduced } from '../../src/compare/reduce.ts';
import { plainText } from '../../src/layout/html.ts';
import { reference as referenceText } from '../../src/layout/section.ts';
import { Printer } from '../../src/print/print.ts';
import { PEOPLE, png, printOurs, sampleAnalysis, sampleDocument } from './samples.ts';

const OTHERS = ['Quixote, Zebulon', 'Marchbanks, Ottoline', 'Fairweather, Ignatius'] as const;
const NAME_PARTS = [...PEOPLE, ...OTHERS]
  .flatMap((name) => name.split(/[\s,]+/))
  .filter((w) => w.length > 2);

function assertNoName(text: string, where: string): void {
  for (const part of NAME_PARTS) assert.ok(!text.includes(part), `a name was printed in ${where}`);
}

const brief = (d: Difference) =>
  [d.part, d.field, d.kind, ...(d.events ?? [])].filter((w) => w !== undefined).join(' ');

const t = plainText;

const page = (
  body: string,
  css = ''
) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
@page { size: A4; margin: 20mm }
body { font-family: sans-serif; font-size: 10pt; margin: 0 }
h1 { font-size: 18pt } h2 { font-size: 14pt }
.front { break-before: page }
${css}
</style></head><body>${body}</body></html>`;

describe('compare on other layouts', { timeout: 300_000 }, () => {
  let printer: Printer;
  const output = new Output();
  const reduced = async (html: string): Promise<Reduced> =>
    reduce(await readLayout(await printer.print(html, false)));
  /** The two sides' differences as printed, and as the tests name them. */
  const compare = (file: string, a: Reduced, b: Reduced) => {
    const found = compareReduced(file, a, b);
    return {
      printed: JSON.stringify(found.map((d) => output.difference(d))),
      brief: found.map(brief),
    };
  };

  before(async () => {
    printer = await Printer.start();
  });
  after(async () => {
    await printer.close();
  });

  test("event-pdf's own form (T040): its arrows, a wrapped location, references unnumbered, its Editions and their names' commas", async () => {
    // As today's book prints a section: its title ending in a link's arrow; `Location:` with
    // the pathways joined by `→`, long enough to wrap to the left edge at a hyphen, before the
    // stable identifier and the type; references unnumbered with a hanging indent, initials
    // ending in a full stop, each ending in the arrow; the events inferred from parted by commas;
    // and the edits headed `Editions`.
    const deep =
      'Alpha signalling pathway → Beta signalling events → Gamma and delta binding → Epsilon mito';
    const theirs = page(
      `<p style="font-size: 28pt">Alpha signalling pathway</p>
<section class="front"><h1>Introduction</h1><p>Release 98.</p></section>
<section class="front"><h2>Zeta bind-<br>ing \u2197</h2>
<p style="margin:0">Location: ${deep}-</p><p style="margin:0">phagy → Theta and iota receptor binding events → Kappa</p><p style="margin:0">→ Zeta binding</p>
<p>Stable identifier: R-HSA-9000002</p><p>Type: binding</p>
<p style="margin:0;line-height:1.5">Inferred from: Zeta (a, b) (Mus musculus), Zeta binding (Rattus norvegicus), Zeta binding (Danio rerio)</p>
<p style="margin:13pt 0 0;line-height:1.15">Zeta binds eta, writ-<br>ten for these tests.</p>
<h3>Literature references</h3>
<p style="margin:0">${t(PEOPLE[0])}. (2001). A title about binding in signal trans-</p>
<p style="margin:0 0 0 15pt">duction. A journal, 1, 2-3. \u2197</p>
<p style="margin:0">${t(PEOPLE[1])}. (2003). Another title. A journal, 4, 5-6. \u2197</p>
<h3>Editions</h3><p>2016-08-15 Authored, ${t(PEOPLE[1])}., ${t(PEOPLE[0])}.</p><p>2017-02-10 Reviewed, ${t(PEOPLE[2])}.</p></section>`,
      'body { width: 380pt }'
    );
    const ours = page(`<p style="font-size: 28pt">Alpha signalling pathway</p>
<section class="front"><h1>Introduction</h1><p>Release 98.</p></section>
<section class="front"><h2>Zeta binding</h2>
<p>Location: ${deep.replace(/ → /g, ' › ')}phagy › Theta and iota receptor binding events › Kappa › Zeta binding</p>
<p>Stable identifier: R-HSA-9000002</p><p>Type: binding</p>
<p>Inferred from: Zeta (a, b) (Mus musculus); Zeta binding (Rattus norvegicus); Zeta binding (Danio rerio)</p>
<p>Zeta binds eta, written for these tests.</p>
<h3>Literature references</h3>
<p>1. ${t(PEOPLE[0])} (2001). A title about binding in signal transduction. A journal, 1, 2-3.</p>
<p>2. ${t(PEOPLE[1])} (2003). Another title. A journal, 4, 5-6.</p>
<h3>Edit history</h3><p>2016-08-15 Authored, ${t(PEOPLE[1])}; ${t(PEOPLE[0])}</p><p>2017-02-10 Reviewed, ${t(PEOPLE[2])}</p></section>`);
    const parts = (r: Reduced) =>
      Object.fromEntries(
        (r.sections.find((s) => s.stId === 'R-HSA-9000002')?.parts ?? []).map((p) => [
          p.part,
          p.items,
        ])
      );
    const [a, b] = [parts(await reduced(theirs)), parts(await reduced(ours))];
    // folded: white space left out
    assert.deepEqual(a['name'], ['Zetabinding']);
    assert.equal(a['location']?.length, 7);
    // the facts after the wrapped location are read as facts, not as the summation
    assert.deepEqual(a['stId'], ['R-HSA-9000002']);
    assert.deepEqual(a['type'], ['binding']);
    assert.equal(a['references']?.length, 2);
    assert.equal(a['edits']?.length, 2);
    // an inferred-from wrapped at a fact's spacing, the last fact before the summation; its
    // entries parted by commas, as `event-pdf` writes them, and not at a name's own comma
    assert.equal(a['inferredFrom']?.length, 3);
    for (const part of [
      'name',
      'location',
      'stId',
      'type',
      'inferredFrom',
      'summation',
      'references',
      'edits',
    ]) {
      assert.deepEqual(a[part], b[part], part);
    }
  });

  test("event-pdf's form: a summation's line beginning with a fact's word is no fact (T040)", async () => {
    // event-pdf writes every fact with its colon; a summation's line beginning "Disease" was
    // read as the Diseases fact, and the summation's lines before it as the compartments
    const section = (diseaseLine: string) =>
      reduced(
        page(`<p style="font-size: 28pt">Alpha signalling pathway</p>
<section class="front"><h1>Introduction</h1><p>Release 98.</p></section>
<section class="front"><h2>Eta binding \u2197</h2>
<p>Location: Alpha signalling pathway \u2192 Eta binding</p>
<p>Stable identifier: R-HSA-9000003</p><p>Compartments: cytosol</p>
<p style="margin:13pt 0 0;line-height:1.15">Eta binds theta in the cytosol.<br>${diseaseLine}<br>Written for these tests.</p>
<h3>Editions</h3><p>2016-08-15 Authored, ${t(PEOPLE[1])}.</p></section>`)
      );
    const parts = (r: Reduced) =>
      Object.fromEntries(
        (r.sections.find((s) => s.stId === 'R-HSA-9000003')?.parts ?? []).map((p) => [
          p.part,
          p.items,
        ])
      );
    const a = parts(await section('Disease forms of it are known.'));
    assert.equal(a['diseases'], undefined, 'no Diseases fact');
    assert.deepEqual(a['compartments'], ['cytosol']);
    assert.equal(a['summation']?.length, 1);
  });

  test("event-pdf's form: a fact's label spread letter by letter is its label (T040)", async () => {
    // event-pdf justifies a fact's line by spreading its letters, read as `P r e c e d e d
    // b y :`: the label was not known, and the fact was read as the summation's end
    const r = await reduced(
      page(`<p style="font-size: 28pt">Alpha signalling pathway</p>
<section class="front"><h1>Introduction</h1><p>Release 98.</p></section>
<section class="front"><h2>Iota binding \u2197</h2>
<p>Location: Alpha signalling pathway \u2192 Iota binding</p>
<p>Stable identifier: R-HSA-9000004</p>
<p style="margin:13pt 0 0;line-height:1.15">Iota binds kappa, written for these tests.</p>
<p style="margin:9pt 0 0;letter-spacing:4pt">Preceded by: Kappa binding</p>
<p style="margin:9pt 0 0">Followed by: Lambda binding</p>
<h3>Editions</h3><p>2016-08-15 Authored, ${t(PEOPLE[1])}.</p></section>`)
    );
    const parts = Object.fromEntries(
      (r.sections.find((s) => s.stId === 'R-HSA-9000004')?.parts ?? []).map((p) => [
        p.part,
        p.items,
      ])
    );
    assert.deepEqual(parts['summation'], ['Iotabindskappa,writtenforthesetests.']);
    assert.deepEqual(parts['before'], ['Kappabinding']);
    assert.deepEqual(parts['after'], ['Lambdabinding']);
  });

  test("a summation's list: event-pdf's bullets are text, pdf-export's markers are not (T040)", async () => {
    const summation = async (list: string) =>
      (
        await reduced(
          page(`<p style="font-size: 28pt">Alpha signalling pathway</p>
<section class="front"><h1>Introduction</h1><p>Release 98.</p></section>
<section class="front"><h2>Mu binding</h2>
<p>Location: Alpha signalling pathway → Mu binding</p>
<p>Stable identifier: R-HSA-9000005</p>
${list}
<h3>Editions</h3><p>2016-08-15 Authored, ${t(PEOPLE[1])}.</p></section>`)
        )
      ).sections
        .find((s) => s.stId === 'R-HSA-9000005')
        ?.parts.filter((p) => p.part === 'summation')
        .flatMap((p) => p.items);
    const theirs = await summation(
      '<p style="margin:13pt 0 0;line-height:1.15">Mu binds:<br>• nu, first;<br>• xi, second.</p>'
    );
    const ours = await summation(
      '<p style="margin:13pt 0 0">Mu binds:</p><ul style="margin:0"><li>nu, first;</li><li>xi, second.</li></ul>'
    );
    assert.deepEqual(theirs, ['Mubinds:nu,first;xi,second.']);
    assert.deepEqual(ours, theirs);
  });

  describe('a cover whose title a figure takes in: the title is never printed, the names never', () => {
    const cover = (top: string, names: readonly string[]) =>
      page(`${top}
<p>Authors</p><p>${names.map(t).join('; ')}</p>
<p>${t('Ontario Institute for Cancer Research')}</p><p>4 November 2026</p>
<section class="front"><h1>Introduction</h1><p>Release 98. It holds 2 pathways and 2 reactions.</p></section>`);

    test('a title in a coloured band', async () => {
      const band = `<div style="background: #224466; color: white; padding: 30pt; margin-bottom: 18pt"><p style="font-size: 28pt; margin: 0">Alpha signalling pathway</p></div>`;
      const a = await reduced(cover(band, PEOPLE.slice(0, 2)));
      const b = await reduced(cover(band, OTHERS));
      const { printed, brief: found } = compare('Alpha signalling pathway.pdf', a, b);
      assertNoName(printed, 'the report');
      assert.ok(found.includes('cover names count'), 'the names are compared');
      for (const d of JSON.parse(printed) as Difference[]) {
        if (d.field === 'title') assert.ok(['same', 'differs'].includes(String(d.reference)));
      }
    });

    test('a logo, a 16 pt title and a diagram close together', async () => {
      const close = `<img src="${png(60, 30)}" style="display:block;width:160pt;height:80pt">
<p style="font-size: 16pt; margin: 4pt 0">Alpha signalling pathway</p>
<img src="${png(30, 20)}" style="display:block;width:300pt;height:200pt">`;
      const a = await reduced(cover(close, PEOPLE.slice(0, 3)));
      const b = await reduced(cover(close, OTHERS.slice(0, 2)));
      const { printed } = compare('Alpha signalling pathway.pdf', a, b);
      assertNoName(printed, 'the report');
    });
  });

  describe('an analysis part followed by text that is not its own', () => {
    const analysis = (heading: boolean, label: string, people: readonly string[]) =>
      page(`<p style="font-size: 28pt">Alpha signalling pathway</p>
<section class="front"><h1>Introduction</h1><p>Release 98.</p></section>
<section class="front"><h1>Analysis</h1>
<p>Token: MjAyNjExMDQxMjAwMDBfMQ%3D%3D</p><p>Identifiers found: 3 of 5</p>
${heading ? '<h2>Alpha signalling pathway</h2>' : '<p>Alpha signalling pathway</p>'}
${label ? `<p>${label}</p>` : ''}
<p>Species of ${t(people[0] ?? '')} were studied, written for these tests.</p>
<p>Type ${t(people[1] ?? '')} cells hold the sample, written for these tests.</p>
<p>Projection: ${t(people[2] ?? '')}</p><p>Resource: ${t(people[0] ?? '')}</p></section>`);

    for (const [name, heading, label] of [
      ['a section labelled Identifier:, under its heading', true, 'Identifier: R-HSA-9000001'],
      ['a section labelled Identifier:, with no heading', false, 'Identifier: R-HSA-9000001'],
      ['a section under its heading, with no stable identifier', true, ''],
      ['text with neither a heading nor a stable identifier', false, ''],
    ] as const) {
      test(name, async () => {
        const a = await reduced(analysis(heading, label, PEOPLE.slice(0, 3)));
        const b = await reduced(analysis(heading, label, OTHERS));
        const { printed, brief: found } = compare('x.pdf', a, b);
        assertNoName(printed, 'the report');
        assert.equal(
          a.analysis?.['identifiersTotal'] && 'value' in a.analysis['identifiersTotal']
            ? a.analysis['identifiersTotal'].value
            : null,
          5
        );
        // what is read past the part, or not of its shape, is never a value
        for (const key of ['species', 'type', 'projection', 'resource']) {
          const value = a.analysis?.[key];
          assert.ok(value === undefined || !('value' in value), `${key} kept as a value`);
        }
        assert.ok(found.every((d) => !d.startsWith('analysis token')));
        // the part ends at the section's heading or its stable identifier: nothing after them
        // is read as a property
        if (heading || label) {
          assert.deepEqual(Object.keys(a.analysis ?? {}).sort(), [
            'identifiersFound',
            'identifiersTotal',
            'token',
          ]);
        }
      });
    }
  });

  test('a table with a shaded header and hairline borders is read, not taken as a figure', async () => {
    const rows = Array.from(
      { length: 8 },
      (_, i) => `<tr><td>P0000${String(i)}</td><td>P0000${String(i)}</td><td>UniProt</td></tr>`
    ).join('');
    const read = await reduced(
      page(
        `<p style="font-size: 28pt">Alpha signalling pathway</p>
<section class="front"><h2>Beta binds gamma</h2>
<p>Stable identifier: R-HSA-9000002</p><p>A summation, written for these tests.</p>
<p>Entities found</p>
<table style="border-collapse: collapse; width: 100%"><tr style="background: #dddddd"><th>Identifier</th><th>Maps to</th><th>Resource</th></tr>${rows}</table>
</section>`,
        'td, th { border: 0.5pt solid #888888; padding: 2pt 4pt; text-align: left }'
      )
    );
    assert.equal(read.sections.length, 1);
    const section = read.sections[0];
    assert.equal(section?.figure, 'none');
    assert.equal(section.parts.find((p) => p.part === 'entities')?.items.length, 8);
  });

  test("a diagram whose connector passes through a reaction's small square is one figure", async () => {
    // in points: two 55 x 70 nodes 290 apart, a 3 x 3 square between, edges clipped at it
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400pt" height="70pt" viewBox="0 0 400 70">
<rect x="0" y="0" width="55" height="70" fill="#9ab"/><text x="6" y="38" font-size="9">Left node</text>
<path d="M55 35 H198.5" stroke="#333" stroke-width="0.75" fill="none"/>
<rect x="198.5" y="33.5" width="3" height="3" fill="#333"/>
<path d="M201.5 35 H345" stroke="#333" stroke-width="0.75" fill="none"/>
<rect x="345" y="0" width="55" height="70" fill="#9ab"/><text x="351" y="38" font-size="9">Right node</text></svg>`;
    const read = await reduced(
      page(`<p style="font-size: 28pt">Alpha signalling pathway</p>
<section class="front"><h2>Beta binds gamma</h2>
<p>Stable identifier: R-HSA-9000002</p>
<p>${svg}</p>
<p>A summation, written for these tests.</p>
</section>`)
    );
    assert.equal(read.sections.length, 1);
    const section = read.sections[0];
    assert.equal(section?.figure, 'figure');
    // the nodes' labels are the figure's, not the summation's
    assert.deepEqual(section.parts.find((p) => p.part === 'summation')?.items, [
      'Asummation,writtenforthesetests.',
    ]);
  });

  test('a diagram whose title starts left of its shapes keeps the title as its own', async () => {
    // As the render service draws a pathway's diagram (T040, 21 Nov 2026): its name, small,
    // at the top left, starting a few points left of the nearest node, so a label's first
    // point fell outside the figure's box and the name was read into the summation.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400pt" height="90pt" viewBox="0 0 400 90">
<text x="2" y="8" font-size="6">Gamma pathway title</text>
<rect x="10" y="20" width="55" height="70" fill="#9ab"/>
<path d="M65 55 H345" stroke="#333" stroke-width="0.75" fill="none"/>
<rect x="345" y="0" width="55" height="90" fill="#9ab"/></svg>`;
    const read = await reduced(
      page(`<p style="font-size: 28pt">Alpha signalling pathway</p>
<section class="front"><h2>Beta binds gamma</h2>
<p>Stable identifier: R-HSA-9000002</p>
<p>${svg}</p>
<p>A summation, written for these tests.</p>
</section>`)
    );
    const section = read.sections[0];
    assert.equal(section?.figure, 'figure');
    assert.deepEqual(section.parts.find((p) => p.part === 'summation')?.items, [
      'Asummation,writtenforthesetests.',
    ]);
    // nowhere else either
    assert.ok(!JSON.stringify(read).includes('Gamma'), JSON.stringify(read));
  });

  test("a diagram's label too small to read, just outside its shapes, is the figure's", async () => {
    // As a pathway's diagram draws a node's name at its zoom (T040, 21 Nov 2026): 0.78 pt
    // text 3 pt below the figure's box, read into the summation after it.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400pt" height="90pt" viewBox="0 0 400 90">
<rect x="0" y="0" width="55" height="80" fill="#9ab"/>
<path d="M55 40 H345" stroke="#333" stroke-width="0.75" fill="none"/>
<rect x="345" y="0" width="55" height="80" fill="#9ab"/>
<text x="100" y="84" font-size="0.8">Delta tiny label</text></svg>`;
    const read = await reduced(
      page(`<p style="font-size: 28pt">Alpha signalling pathway</p>
<section class="front"><h2>Beta binds gamma</h2>
<p>Stable identifier: R-HSA-9000002</p>
<p>${svg}</p>
<p>A summation, written for these tests.</p>
</section>`)
    );
    assert.ok(!JSON.stringify(read).includes('Delta'), JSON.stringify(read));
    assert.deepEqual(read.sections[0]?.parts.find((p) => p.part === 'summation')?.items, [
      'Asummation,writtenforthesetests.',
    ]);
  });

  test('a reaction drawn in one row, short and wide with its images, is a figure', async () => {
    // As pdf-export draws a reaction of a few nodes in a row (T040, 22 Nov 2026): 481 by
    // 38 pt with two images, under FIGURE_MIN_PT tall; its labels were read into the fact
    // before it, a compartment's name running on into the nodes' names.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400pt" height="38pt" viewBox="0 0 400 38">
<rect x="0" y="4" width="60" height="30" fill="#9ab"/><text x="6" y="22" font-size="7">Delta node</text>
<image href="${png(1, 1)}" x="150" y="4" width="64" height="30"/>
<path d="M60 19 H340" stroke="#333" stroke-width="0.75" fill="none"/>
<rect x="340" y="4" width="60" height="30" fill="#9ab"/><text x="346" y="22" font-size="7">Delta other</text></svg>`;
    const read = await reduced(
      page(`<p style="font-size: 28pt">Alpha signalling pathway</p>
<section class="front"><h2>Beta binds gamma</h2>
<p>Stable identifier: R-HSA-9000002</p>
<p>Compartments: cytosol</p>
<p>${svg}</p>
<p>A summation, written for these tests.</p>
</section>`)
    );
    assert.ok(!JSON.stringify(read).includes('Delta'), JSON.stringify(read));
    assert.deepEqual(read.sections[0]?.parts.find((p) => p.part === 'compartments')?.items, [
      'cytosol',
    ]);
  });

  test('a reaction drawn in one row of vector nodes, without images, is a figure', async () => {
    // As `event-pdf` draws one (T040, 22 Nov 2026): 467 by 42 pt, its nodes painted paths
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400pt" height="38pt" viewBox="0 0 400 38">
<rect x="0" y="4" width="60" height="30" fill="#9ab"/><text x="6" y="22" font-size="7">Delta node</text>
<rect x="170" y="14" width="10" height="10" fill="#333"/>
<path d="M60 19 H340" stroke="#333" stroke-width="0.75" fill="none"/>
<rect x="340" y="4" width="60" height="30" fill="#9ab"/><text x="346" y="22" font-size="7">Delta other</text></svg>`;
    const read = await reduced(
      page(`<p style="font-size: 28pt">Alpha signalling pathway</p>
<section class="front"><h2>Beta binds gamma</h2>
<p>Stable identifier: R-HSA-9000002</p>
<p>Compartments: cytosol</p>
<p>${svg}</p>
<p>A summation, written for these tests.</p>
</section>`)
    );
    assert.ok(!JSON.stringify(read).includes('Delta'), JSON.stringify(read));
  });

  test("a column of small icons beside entries is no figure: the entries' text is read", async () => {
    // `event-pdf`'s contents set a 9 pt icon before each entry, indented by its depth: a
    // column 29 to 49 pt wide of many images, which a strip of any direction took for a figure,
    // leaving out a short entry whose middle fell inside it (T040, 22 Nov 2026)
    const rows = Array.from(
      { length: 20 },
      (_, i) =>
        `<p style="margin: 0 0 0 ${String((i % 2) * 20)}pt; line-height: 14pt"><img src="${png(1, 1)}" style="width: 9pt; height: 9pt"> Nu${String(i)}</p>`
    ).join('');
    const read = await readLayout(
      await printer.print(
        page(`<p style="font-size: 28pt">Alpha signalling pathway</p>${rows}`),
        false
      )
    );
    assert.equal(read.figures.length, 0, JSON.stringify(read.figures));
    assert.equal(read.lines.filter((l) => /^\s*Nu\d+/.test(l.text)).length, 20);
  });

  test('a short shaded band without an image is no figure: its text is read', async () => {
    // FIGURE_STRIP_PT is for a cluster holding an image: a band 400 by 30 pt, as a table's
    // shaded header or a note's box, keeps its text
    const read = await reduced(
      page(`<p style="font-size: 28pt">Alpha signalling pathway</p>
<section class="front"><h2>Beta binds gamma</h2>
<p>Stable identifier: R-HSA-9000002</p>
<div style="width: 400pt; height: 30pt; background: #9ab"><p style="margin: 0; padding: 8pt">Epsilon in a band, written for these tests.</p></div>
</section>`)
    );
    assert.ok(JSON.stringify(read).includes('Epsiloninaband'), JSON.stringify(read));
  });

  test("a summation's line that begins with a fact's words is the summation's, in pdf-export's layout", async () => {
    // pdf-export prints a fact's label as a piece of its own (<dt>), without a colon. Prose
    // that wraps to begin "followed by …" or "inferred from …" was read as that fact, and the
    // lines before it as the fact above's wrap (T040, 21 Nov 2026: R-HSA-376176, R-HSA-210747).
    const doc = sampleDocument();
    const target = doc.places
      .flatMap((p) => (p.full ? [p.section] : []))
      .find((s) => s.event.after.length === 0);
    assert.ok(target, 'the sample has a section with no events after it');
    target.summations = [
      '<p>The receptors hold five domains<br>followed by three repeats in each.<br>Its kinetics are inferred from the properties of networks in mouse.<br>inferred from the properties of networks in mouse, too.</p>',
    ];
    const read = reduce(await readLayout(await printOurs(printer, doc, sampleAnalysis())));
    const section = read.sections.find((s) => s.stId === target.event.stId);
    const parts = Object.fromEntries((section?.parts ?? []).map((p) => [p.part, p.items.join('')]));
    assert.equal(parts['after'], undefined, JSON.stringify(parts));
    assert.equal(parts['inferredFrom'], undefined, JSON.stringify(parts));
    assert.match(parts['summation'] ?? '', /^Thereceptorsholdfivedomainsfollowedbythreerepeats/);
    assert.match(parts['summation'] ?? '', /mouse,too\.$/);
    assert.equal(parts['compartments'], 'cytosol');
  });

  test('a reference laid out unlike the sample: facts in a table, contents first, vector figures, numbered references in brackets', async () => {
    const doc = sampleDocument();
    const props = sampleAnalysis();
    const ours = reduce(await readLayout(await printOurs(printer, doc, props)));
    const sections = doc.places.flatMap((p) => (p.full ? [p.section] : []));
    const svg = (label: string) =>
      `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="160" viewBox="0 0 300 160"><circle cx="60" cy="60" r="40" fill="#9ab"/><path d="M100 60 H160" stroke="#333" stroke-width="1"/><rect x="160" y="40" width="110" height="80" fill="#ba9"/><text x="168" y="85" font-size="9">${t(label)}</text></svg>`;
    const row = (label: string, value: string) => `<tr><th>${t(label)}:</th><td>${value}</td></tr>`;
    const body = [
      `<p style="font-size: 26pt; font-weight: bold">${t(doc.cover.title)}</p>`,
      `<p>${svg('cover')}</p>`,
      `<p><b>Authored, edited, reviewed and revised by</b></p><p>${doc.cover.names.map((n) => (n === null ? '' : t(n))).join('; ')}</p>`,
      '<p>European Bioinformatics Institute</p><p>An excerpt of the book.</p>',
      '<section class="front"><h1 id="introduction">Introduction</h1><p>Reactome release 98, holding 2 pathways and 2 reactions.</p></section>',
      `<section class="front"><h1 id="analysis">Analysis properties</h1><table>${[
        row('Token', props.properties.token),
        row('Type', props.properties.type),
        row('Species', props.properties.species),
        row('Projected to human', 'yes'),
        row('Interactors included', 'no'),
        row('Identifiers found', '3 of 5'),
        row('Pathways hit', '4'),
      ].join('')}</table></section>`,
      `<section class="front"><h1 id="contents">Contents</h1><table style="width: 100%">${(
        doc.contents ?? []
      )
        .map(
          (c, i) =>
            `<tr><td><a href="#${c.target}">${t(c.title)}</a></td><td style="text-align: right">${String(i + 3)}</td></tr>`
        )
        .join('')}</table></section>`,
      ...sections.map((s) => {
        const e = s.event;
        const facts = [
          s.path.length > 0
            ? row(
                'Location',
                s.path.map((p) => `<a href="#s-${p.stId}">${t(p.name)}</a>`).join(' » ')
              )
            : '',
          row('Stable identifier', t(e.stId)),
          e.kind === 'reaction' && e.category ? row('Type', t(e.category)) : '',
          row('Compartments', e.compartments.map((c) => t(c.name)).join(', ')),
          s.diseases.length > 0 ? row('Diseases', s.diseases.map(t).join(', ')) : '',
          s.inferredFrom.length > 0
            ? row(
                'Inferred from',
                s.inferredFrom.map((i) => `${t(i.name)} (${t(i.speciesName)})`).join('; ')
              )
            : '',
        ].join('');
        const found = props.found.get(e.stId);
        return `<section style="break-before: page"><h2 id="${s.anchor}" style="font-size: 15pt">${t(e.name)}</h2>
<table>${facts}</table>
${s.figure ? `<p style="text-align: center">${svg(e.name)}</p>` : ''}
${s.summations.join('\n')}
${e.kind === 'reaction' && e.before.length > 0 ? `<p>Preceded by: ${e.before.map((b) => t(b.name)).join('; ')}</p>` : ''}
${e.kind === 'reaction' && e.after.length > 0 ? `<p>Followed by: ${e.after.map((b) => t(b.name)).join('; ')}</p>` : ''}
<p><b>References</b></p>${s.references.map((r, i) => `<p style="margin-left: 8pt">[${String(i + 1)}] ${referenceText(r)}</p>`).join('')}
<p><b>Edit history</b></p>${s.edits.map((r) => `<p>${t(r.date)} ${t(r.kinds.map((k) => k.charAt(0).toUpperCase() + k.slice(1)).join(', '))} ${t(r.authors.join('; '))}</p>`).join('')}
${found ? `<p><b>Entities found</b></p>${found.entities.map((f) => `<p>${t(f.identifier)} ${t(f.mapsTo.join(', '))} ${t(f.resource)}</p>`).join('')}` : ''}
</section>`;
      }),
    ];
    const other = reduce(
      await readLayout(
        await printer.print(
          page(
            body.join('\n'),
            'th { text-align: left; font-weight: normal; padding-right: 10pt } @page { @bottom-right { content: counter(page) } }'
          ),
          false
        )
      )
    );
    const { printed, brief: found } = compare('x.pdf', other, ours);
    assertNoName(printed, 'the report');
    // the same content, read alike: the figures' kinds, which this layout's figures carry no
    // link to say, match any kind; its analysis has no resource, as pdf-export's has none
    assert.deepEqual(found, []);
  });
});
