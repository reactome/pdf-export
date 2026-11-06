// Samples for FR-012's comparison's tests (spec 001 T035): one small document, printed
// both by pdf-export's own layout and as a reference in the shape of `event-pdf`'s files
// (the spec's Background and research R2: the contents list after the sections, its parts
// written `Label: value`, its figures as images, the cover's names with U+2060 between
// their characters and no-break spaces between their words). The reference's wording is
// written here; none is today's. Every name is a placeholder (FR-013): real `event-pdf`
// files are never used in tests.
import { crc32, deflateSync } from 'node:zlib';

import type { EventRef, Reference } from '../../src/graph/queries.ts';
import type { FigureSvgs } from '../../src/layout/figure.ts';
import { figureKey } from '../../src/layout/figure.ts';
import { attribute, plainText } from '../../src/layout/html.ts';
import { layoutSingle, pageStyles } from '../../src/layout/document.ts';
import { reference } from '../../src/layout/section.ts';
import { INSTITUTIONS } from '../../src/layout/text.ts';
import type {
  AnalysisProperties,
  Document,
  Figure,
  Found,
  Section,
} from '../../src/model/types.ts';
import type { Printer } from '../../src/print/print.ts';

/** The placeholder people: authors of edits and of references. */
export const PEOPLE = ['Placeholder, A', 'Example, B', 'Sample, C D', 'Dummy, E'] as const;

const SITE = 'https://site.example';

const ref = (dbId: number, stId: string, name: string): EventRef => ({ dbId, stId, name });

const P = ref(1, 'R-HSA-9000001', 'Alpha signalling pathway');
const R1 = ref(2, 'R-HSA-9000002', 'Beta binds gamma');
const S = ref(3, 'R-HSA-9000003', 'Delta subpathway');
const R2 = ref(4, 'R-HSA-9000004', 'Epsilon is phosphorylated');

function literature(dbId: number, title: string, authors: string[]): Reference {
  return {
    dbId,
    kind: 'article',
    title,
    chapterTitle: null,
    journal: 'Journal of Examples',
    volume: 12,
    pages: '1-9',
    year: 2001,
    pubMedId: 1000 + dbId,
    isbn: null,
    url: null,
    publisher: null,
    authors,
    moreAuthors: false,
  };
}

function section(
  event: EventRef,
  kind: 'pathway' | 'reaction',
  depth: number,
  path: EventRef[],
  figure: Figure | null,
  more: Partial<Section> & { category?: string; before?: EventRef[]; after?: EventRef[] } = {}
): Section {
  const { category = null, before = [], after = [], ...rest } = more;
  return {
    anchor: `s-${event.stId}`,
    event: {
      ...event,
      kind,
      schemaClass: kind === 'pathway' ? 'Pathway' : 'Reaction',
      speciesName: 'Homo sapiens',
      category,
      hasDiagram: figure?.kind === 'diagram',
      hasEHLD: false,
      isInferred: false,
      isInDisease: false,
      species: { dbId: 48887, name: 'Homo sapiens' },
      compartments: [{ dbId: 70101, name: 'cytosol' }],
      before,
      after,
    },
    path,
    figure,
    diseases: [],
    inferredFrom: [],
    summations: [`<p>${plainText(event.name)} is a sample event, written for these tests.</p>`],
    references: [literature(event.dbId * 10, `A study of ${event.name}`, [PEOPLE[2], PEOPLE[3]])],
    edits: [
      { date: '2020-01-01', kinds: ['authored'], authors: [PEOPLE[0]] },
      { date: '2021-02-03', kinds: ['reviewed'], authors: [PEOPLE[1]] },
    ],
    depth,
    ...rest,
  };
}

/** The sample: a pathway at depth 1 with two reactions and a subpathway, with an analysis. */
export function sampleDocument(): Document {
  const diagram: Figure = { kind: 'diagram', stId: P.stId };
  const sections = [
    section(P, 'pathway', 0, [], diagram, {
      references: [
        literature(11, 'A first study', [PEOPLE[2]]),
        literature(12, 'A second study', [PEOPLE[3], PEOPLE[2]]),
      ],
    }),
    section(
      R1,
      'reaction',
      1,
      [P],
      { kind: 'reaction', stId: R1.stId },
      {
        category: 'binding',
        after: [R2],
        inferredFrom: [
          { ...ref(20, 'R-MMU-9000020', 'Beta binds gamma'), speciesName: 'Mus musculus' },
        ],
      }
    ),
    section(
      S,
      'pathway',
      1,
      [P],
      { kind: 'ancestor', stId: P.stId, highlight: [R1.stId] },
      {
        diseases: ['influenza'],
        // a summation whose first word is a part's label, which only labels its part where it comes
        summations: ['<p>Type 2 cells hold the sample subpathway, written for these tests.</p>'],
      }
    ),
    section(
      R2,
      'reaction',
      1,
      [P],
      { kind: 'reaction', stId: R2.stId },
      {
        category: 'transition',
        before: [R1],
      }
    ),
  ];
  for (const s of sections) {
    if (s.event.stId === R2.stId) {
      s.event.compartments = [
        { dbId: 70101, name: 'cytosol' },
        { dbId: 7660, name: 'nucleoplasm' },
      ];
    }
  }
  return {
    kind: 'single',
    release: { version: 98, pathways: 2, reactions: 2 },
    cover: {
      title: P.name,
      release: null,
      figure: diagram,
      excerpt: true,
      names: [PEOPLE[0], PEOPLE[1]],
    },
    places: sections.map((s) => ({ full: true as const, section: s })),
    contents: [
      { title: 'Introduction', target: 'introduction', depth: 0 },
      { title: 'Analysis properties', target: 'analysis', depth: 0 },
      ...sections.map((s) => ({ title: s.event.name, target: s.anchor, depth: s.depth })),
      { title: 'Contents', target: 'contents', depth: 0 },
    ],
  };
}

export function sampleAnalysis(): { properties: AnalysisProperties; found: Map<string, Found> } {
  return {
    properties: {
      token: 'MjAyNjExMDQxMjAwMDBfMQ%3D%3D',
      type: 'OVERREPRESENTATION',
      species: 'Homo sapiens',
      projection: true,
      interactors: false,
      identifiersFound: 3,
      identifiersTotal: 5,
      pathwaysHit: 4,
    },
    found: new Map([
      [
        R1.stId,
        {
          entities: [{ identifier: 'P00001', mapsTo: ['P00001'], resource: 'UniProt' }],
          interactors: [],
        },
      ],
    ]),
  };
}

/** A figure: a few shapes and a label. */
function svg(label: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 260"><rect x="10" y="10" width="120" height="60" fill="#8fc"/><rect x="250" y="160" width="120" height="60" fill="#fc8"/><path d="M130 40 L250 190" stroke="#333" stroke-width="3"/><text x="20" y="45" font-size="12">${plainText(label)}</text></svg>`;
}

/** Each section's figure, and the cover's, as pdf-export's layout reads them. */
export function sampleFigures(doc: Document): FigureSvgs {
  const figures = new Map<string, string>();
  for (const place of doc.places) {
    if (place.full && place.section.figure) {
      figures.set(figureKey(place.section.figure), svg(place.section.event.name));
    }
  }
  if (doc.cover.figure) figures.set(figureKey(doc.cover.figure), svg(doc.cover.title));
  return figures;
}

/** pdf-export's own single-event PDF of a document. */
export async function printOurs(
  printer: Printer,
  doc: Document,
  analysis: ReturnType<typeof sampleAnalysis> | null
): Promise<Uint8Array> {
  const { html } = layoutSingle(doc, {
    site: SITE,
    date: new Date('2026-11-04T12:00:00Z'),
    figures: sampleFigures(doc),
    styles: pageStyles(),
    analysis,
  });
  return printer.single(html);
}

/** A PNG of one colour, as `event-pdf`'s raster figures stand in. */
export function png(width: number, height: number): string {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x9c)]);
  const pixels = deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
  const file = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', pixels),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${file.toString('base64')}`;
}

/** A name as the reference's cover writes it: U+2060 between its characters, no-break spaces between its words. */
export const joined = (name: string): string =>
  Array.from(name.replace(/ /g, '\u00a0')).join('\u2060');

export interface ReferenceOptions {
  analysis?: ReturnType<typeof sampleAnalysis> | null;
  /** The cover's names, if not the document's. */
  names?: readonly (string | null)[];
  /** The release line's number and the counts, if not the document's. */
  release?: number;
  /** Sections drawn with no figure, by stable identifier. */
  noFigure?: readonly string[];
  /** The contents list's entries, if not the document's. */
  contents?: { title: string; target: string }[];
  /** The analysis's properties as written, if not those given. */
  properties?: [string, string][];
}

/** A reference PDF in `event-pdf`'s shape, of a document. */
export async function printReference(
  printer: Printer,
  doc: Document,
  options: ReferenceOptions = {}
): Promise<Uint8Array> {
  const t = (s: string) => plainText(s);
  const a = (href: string, s: string) => `<a href="${attribute(href)}">${t(s)}</a>`;
  const names = options.names ?? doc.cover.names;
  const parts: string[] = [];
  // the cover: a raster logo, the title, a raster diagram, the names, then the rest
  parts.push(`<div class="cover">
<img src="${png(60, 30)}" style="width:160pt;height:80pt">
<h1 class="title">${t(doc.cover.title)}</h1>
${doc.cover.figure ? `<img src="${png(30, 20)}" style="width:300pt;height:200pt">` : ''}
<p class="label">Authors and editors</p>
<p class="names">${names.map((n) => (n === null ? '' : joined(n))).join('; ')}</p>
<p>${INSTITUTIONS.map(t).join('<br>')}</p>
<p>Shared under a Creative Commons licence.</p>
<p>4 November 2026</p>
${doc.cover.excerpt ? '<p>An excerpt of the whole book.</p>' : ''}
</div>`);
  const { release } = doc;
  parts.push(`<section class="front"><h1 id="introduction">Introduction</h1>
<p>Sample introduction text, written for these tests.</p>
<p>Release ${String(options.release ?? release.version)}. It holds ${String(release.pathways)} pathways and ${String(release.reactions)} reactions.</p></section>`);
  const analysis = options.analysis ?? null;
  if (analysis) {
    const p = analysis.properties;
    const rows: [string, string][] = options.properties ?? [
      ['Token', p.token],
      ['Analysis type', p.type],
      ['Species', p.species],
      ['Projection', String(p.projection)],
      ['Interactors', String(p.interactors)],
      ['Identifiers found', `${String(p.identifiersFound)} of ${String(p.identifiersTotal)}`],
      ['Pathways found', String(p.pathwaysHit)],
      ['Resource', 'TOTAL'],
    ];
    parts.push(`<section class="front"><h1 id="analysis">Analysis properties</h1>
${rows.map(([k, v]) => `<p>${t(k)}: ${t(v)}</p>`).join('\n')}
<p>Explanatory text on the analysis, written for these tests.</p></section>`);
  }
  const sections: string[] = [];
  for (const place of doc.places) {
    if (!place.full) continue;
    const s = place.section;
    const e = s.event;
    const lines: string[] = [];
    lines.push(
      `<h2 id="${attribute(s.anchor)}">${a(`${SITE}/content/detail/${e.stId}`, e.name)}</h2>`
    );
    if (s.path.length > 0) {
      lines.push(`<p>Location: ${s.path.map((p) => a(`#s-${p.stId}`, p.name)).join(' &gt; ')}</p>`);
    }
    lines.push(`<p>Stable Identifier: ${t(e.stId)}</p>`);
    if (e.kind === 'reaction' && e.category) lines.push(`<p>Type: ${t(e.category)}</p>`);
    if (e.compartments.length > 0) {
      lines.push(`<p>Compartment: ${e.compartments.map((c) => t(c.name)).join(', ')}</p>`);
    }
    if (s.diseases.length > 0) lines.push(`<p>Disease: ${s.diseases.map(t).join(', ')}</p>`);
    if (s.inferredFrom.length > 0) {
      lines.push(
        `<p>Inferred from: ${s.inferredFrom.map((i) => `${t(i.name)} (${t(i.speciesName)})`).join('; ')}</p>`
      );
    }
    if (s.figure && !options.noFigure?.includes(e.stId)) {
      lines.push(`<p><img src="${png(40, 30)}" style="width:320pt;height:180pt"></p>`);
    }
    lines.push(...s.summations);
    if (e.kind === 'reaction') {
      if (e.before.length > 0) {
        lines.push(
          `<p>Preceding events: ${e.before.map((b) => a(`#s-${b.stId}`, b.name)).join('; ')}</p>`
        );
      }
      if (e.after.length > 0) {
        lines.push(
          `<p>Following events: ${e.after.map((b) => a(`#s-${b.stId}`, b.name)).join('; ')}</p>`
        );
      }
    }
    if (s.references.length > 0) {
      lines.push(
        `<h3>Literature References</h3><ol>${s.references.map((r) => `<li>${reference(r)}</li>`).join('')}</ol>`
      );
    }
    if (s.edits.length > 0) {
      lines.push(
        `<h3>Edit history</h3><table><tr><th>Date</th><th>Action</th><th>Author</th></tr>${s.edits
          .map(
            (row) =>
              `<tr><td>${t(row.date)}</td><td>${t(row.kinds.map((k) => k.charAt(0).toUpperCase() + k.slice(1)).join(', '))}</td><td>${t(row.authors.join('; '))}</td></tr>`
          )
          .join('')}</table>`
      );
    }
    const found = analysis?.found.get(e.stId);
    if (found && found.entities.length > 0) {
      lines.push(
        `<h3>Entities found</h3><table><tr><th>Input</th><th>Identifiers</th><th>Resource</th></tr>${found.entities
          .map(
            (r) =>
              `<tr><td>${t(r.identifier)}</td><td>${t(r.mapsTo.join(', '))}</td><td>${t(r.resource)}</td></tr>`
          )
          .join('')}</table>`
      );
    }
    sections.push(`<section class="event">${lines.join('\n')}</section>`);
  }
  parts.push(...sections);
  const entries =
    options.contents ?? (doc.contents ?? []).map((c) => ({ title: c.title, target: c.target }));
  if (entries.length > 0) {
    parts.push(`<section class="front"><h1 id="contents">Table of contents</h1>
${entries.map((c, i) => `<p class="entry">${a(`#${c.target}`, c.title)} ........ ${String(i + 2)}</p>`).join('\n')}</section>`);
  }
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
@page { size: A4; margin: 20mm; @top-center { content: "Reactome"; font-size: 8pt } @bottom-center { content: counter(page); font-size: 8pt } }
body { font-family: sans-serif; font-size: 10pt; margin: 0 }
h1 { font-size: 18pt } h2 { font-size: 14pt } h3 { font-size: 12pt }
a { color: #1a5e8a; text-decoration: none }
.cover { break-after: page; text-align: center } .cover .title { font-size: 28pt }
.front { break-before: page } .event { margin-top: 12pt }
table { border-collapse: collapse } td, th { padding: 2pt 6pt 2pt 0; text-align: left; border-bottom: 0.5pt solid #999 }
</style></head><body>
${parts.join('\n')}
</body></html>`;
  return printer.print(html, false);
}

export { P, R1, R2, S };
