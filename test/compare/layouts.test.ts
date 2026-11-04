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
      `<p><b>Authored, edited, reviewed and revised by</b></p><p>${doc.cover.names.map(t).join('; ')}</p>`,
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
