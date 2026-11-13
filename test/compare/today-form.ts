// A report in today's form (spec 002 T019), for the comparison's tests: the parts, headings,
// sentences, tables and number formats today's analysis report prints (reactome/analysis-report,
// read from its real files on the comparison's run), written as HTML and printed by Chromium
// from the same model and made-up details as pdf-export's report. Its look is not today's;
// what the comparison reads is:
//
// - numbered parts (`4. Most significant pathways`), and a contents list naming them at a
//   size between the body's and the parts' headings;
// - the properties as sentences, set at a heading's size;
// - the pathways' table with each cell shaded on its own, a count found and its total as
//   `10 / 536`, thousands parted by commas, ratios to three places or as powers below 0.001,
//   p-values as powers with two-digit exponents, a name's lines centred beside its
//   statistics, and a footnote;
// - words broken at a line's end by a hyphen, and "References" over an empty list;
// - each detail at `1.Name (R-HSA-1)`, its facts ending in a full stop, its references
//   hanging, its edit history's names `Surname I, …` with the header repeated on every page,
//   and its identifiers in tables of several entries a row, under `Input <Resource> Id`;
// - the identifiers not found, several a row.
//
// Every name and identifier is the model's own: placeholders.
import { resourceName } from '../../src/report/layout.ts';
import type { PathwayDetail } from '../../src/report/details.ts';
import type { FoundRow, ReportModel } from '../../src/report/model.ts';
import type { Reference } from '../../src/graph/queries.ts';

const escape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A name as today's prints it: `Placeholder, A` as `Placeholder A`. */
const todayName = (name: string | null): string => (name ?? '').replace(/,\s*/, ' ');

/** A count as today's prints it, thousands parted by commas. */
const count = (n: number): string => n.toLocaleString('en-US');

/** A power with a two-digit exponent: `1.16e-09`. */
const power = (n: number): string =>
  n.toExponential(2).replace(/e([+-])(\d)$/, (_m, sign: string, d: string) => `e${sign}0${d}`);

/** A ratio: to three places, or as a power below 0.001. */
const ratio = (n: number): string => (n !== 0 && Math.abs(n) < 0.001 ? power(n) : n.toFixed(3));

const SENTENCES: Readonly<Record<string, string>> = {
  OVERREPRESENTATION:
    'This is an overrepresentation analysis: A statistical test that determines whether certain pathways are over-represented in the submitted data.',
  EXPRESSION:
    'This is an expression analysis: The numbers are used to produce a scaled coloured overlay over pathway diagrams.',
  SPECIES_COMPARISON:
    'This is a species comparison analysis: It compares human pathways with computationally-predicted pathways in model organisms.',
};

/** Body text enough that the body's size is the paragraphs', as in today's. */
const FILLER =
  'Placeholder text set at the body size, as the introduction of the report is, so that most of the text on its pages is set at that size and the tables and headings are read as smaller and larger than it. '.repeat(
    6
  );

function reference(r: Reference): string {
  const authors = r.authors.map(todayName);
  const names =
    authors.length > 1
      ? `${authors.slice(0, -1).join(', ')} & ${authors.at(-1) ?? ''}`
      : (authors[0] ?? '');
  const year = r.year === null ? '' : ` (${String(r.year)})`;
  const where = [r.journal, r.volume === null ? null : String(r.volume), r.pages].filter(
    (x) => x !== null
  );
  return `${escape(`${names}${year}`)}. ${escape(r.title)}. ${escape(where.join(', '))}.`;
}

/** Entries of one resource's table, several a row, under `Input <Resource> Id` (and any values). */
function entries(resource: string, rows: readonly FoundRow[], columns: readonly string[]): string {
  const group = ['Input', `${resourceName(resource)} Id`, ...columns];
  // three a row, two where there are values
  const per = columns.length > 0 ? 2 : 3;
  const head = Array.from({ length: per }, () =>
    group.map((h) => `<th>${escape(h)}</th>`).join('')
  );
  const body: string[] = [];
  for (let at = 0; at < rows.length; at += per) {
    const cells = rows
      .slice(at, at + per)
      .flatMap((r) => [r.id, r.mapsTo.join(', '), ...r.exp.map(String)])
      .map((c) => `<td>${escape(c)}</td>`)
      .join('');
    body.push(`<tr>${cells}</tr>`);
  }
  return `<table class="ids"><thead><tr>${head.join('')}</tr></thead><tbody>${body.join('')}</tbody></table>`;
}

const STYLE = `
@page { size: A4; margin: 25mm 30mm; }
body { font-family: sans-serif; font-size: 10pt; line-height: 1.4; }
h1 { font-size: 24pt; } .name { font-size: 12pt; }
h2 { font-size: 16pt; break-before: page; font-weight: normal; }
.toc p, h3, .h3 { font-size: 12pt; margin: 6pt 0; font-weight: normal; }
.bullets p { font-size: 12pt; }
table { border-collapse: separate; border-spacing: 1pt; margin: 4pt 0; }
th { font-size: 9pt; font-weight: normal; background: #dde; padding: 2pt; }
td { font-size: 8pt; background: #eef; padding: 2pt 4pt; vertical-align: middle; }
table.ids th, table.ids td { white-space: nowrap; }
table.pathways td.n { width: 72pt; }
.refs p { padding-left: 15pt; text-indent: -15pt; margin: 2pt 0; }
.foot { font-size: 8pt; }
.page { break-before: page; }
`;

/** Today's form of a report: its HTML, for Chromium to print. */
export function todayReportHtml(
  m: ReportModel,
  details: ReadonlyMap<number, PathwayDetail>,
  { release, site }: { release: number; site: string }
): string {
  const link = `${site}/PathwayBrowser/#/ANALYSIS=${m.token}`;
  const cover = `<h1>Pathway Analysis Report</h1>
<p class="name">${escape(m.summary.name)}</p>
<p>This report contains the pathway analysis results for the submitted sample '${escape(m.summary.name)}'. Analysis was performed against Reactome version ${String(release)} on 13/11/2026. The web link to these results is:</p>
<p><a href="${escape(link)}">${escape(link)}</a></p>`;
  const toc = `<div class="toc page"><p style="font-size:16pt">Table of Contents</p>
${['Introduction', 'Properties', 'Genome-wide overview', 'Most significant pathways', 'Pathways details', 'Identifiers found', 'Identifiers not found'].map((t, i) => `<p>${String(i + 1)}.${t}</p>`).join('\n')}</div>`;
  const resource = m.resource === 'TOTAL' ? 'all resources' : resourceName(m.resource);
  const bullets = [
    SENTENCES[m.summary.type] ?? '',
    `${String(m.identifiersFound)} out of ${String(m.identifiersTotal)} identifiers in the sample were found in Reactome, where ${String(m.pathwaysHit)} pathways were hit by at least one of them.`,
    m.summary.projection
      ? 'All non-human identifiers have been converted to their human equivalent.'
      : '',
    m.summary.interactors
      ? 'IntAct interactors were included to increase the analysis background.'
      : '',
    `This report is filtered to show only results for species '${m.species.name}' and resource '${resource}'.`,
    `The unique ID for this analysis (token) is ${m.token}. This ID is valid for at least 7 days in Reactome's server.`,
  ].filter((b) => b !== '');
  const properties = `<h2>2. Properties</h2><div class="bullets">${bullets.map((b) => `<p>&bull; ${escape(b)}</p>`).join('\n')}</div>`;
  const rows = m.pathways
    .map((p) => {
      const { entities: e, reactions: r } = p.statistics;
      const cells = [
        `${count(e.found)} / ${count(e.total)}`,
        ratio(e.ratio),
        power(e.pValue),
        power(e.fdr),
        `${count(r.found)} / ${count(r.total)}`,
        ratio(r.ratio),
      ];
      return `<tr><td class="n">${escape(p.name)}</td>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
    })
    .join('');
  const pathways = `<h2>4. Most significant pathways</h2>
<p>The following table shows the ${String(m.pathways.length)} most relevant pathways sorted by p-value.</p>
<table class="pathways"><thead><tr><th rowspan="2">Pathway name</th><th colspan="4">Entities</th><th colspan="2">Reactions</th></tr>
<tr><th>found</th><th>ratio</th><th>p-value</th><th>FDR*</th><th>found</th><th>ratio</th></tr></thead><tbody>${rows}</tbody></table>
<p class="foot">* False Discovery Rate</p>`;
  const detailOf = (n: number): string => {
    const p = m.pathways[n];
    if (!p) return '';
    const d = details.get(p.dbId);
    const out = [`<h3>${String(n + 1)}.${escape(p.name)} (${p.stId})</h3>`];
    if (d) {
      const s = d.section;
      if (s.event.compartments.length > 0) {
        out.push(
          `<p>Cellular compartments: ${escape(s.event.compartments.map((c) => c.name).join(', '))}.</p>`
        );
      }
      if (s.diseases.length > 0) out.push(`<p>Diseases: ${escape(s.diseases.join(', '))}.</p>`);
      // a figure's label outside its shapes, as small as pdf-export's can be
      out.push('<p style="font-size: 4pt">Placeholder label</p>');
      // its words broken at the line's end by a hyphen, as today's does
      out.push(
        ...s.summations.map(
          (html) =>
            `<p>${escape(html.replace(/<[^>]*>/g, '')).replace(/summation/g, 'sum-<br>mation')}</p>`
        )
      );
      out.push('<p class="h3">References</p>');
      out.push(
        `<div class="refs">${s.references.map((r) => `<p>${reference(r)}</p>`).join('')}</div>`
      );
      if (d.history.length > 0) {
        const history = d.history
          .map((row) => {
            const names = row.names.map(todayName).join(', ');
            return `<tr><td>${row.date}</td><td>${row.action}</td><td>${escape(row.etAl ? `${names} et al.` : names)}</td></tr>`;
          })
          .join('');
        out.push(
          `<p class="h3">Edit history</p><table><thead><tr><th>Date</th><th>Action</th><th>Author</th></tr></thead><tbody>${history}</tbody></table>`
        );
      }
    }
    const tables = p.entities.filter((t) => t.rows.length > 0);
    if (tables.length > 0) {
      const found = tables.reduce((n, t) => n + t.rows.length, 0);
      const mapped = new Set(tables.flatMap((t) => t.rows.flatMap((r) => r.mapsTo))).size;
      out.push(
        `<p class="h3">${String(found)} submitted entities found in this pathway, mapping to ${String(mapped)} Reactome entities</p>`,
        ...tables.map((t) => entries(t.resource, t.rows, m.columns))
      );
    }
    return out.join('\n');
  };
  const found = m.found.filter((f) => f.rows.length > 0);
  const notFound: string[] = [];
  for (let at = 0; at < m.notFound.length; at += 2) {
    const cells = m.notFound
      .slice(at, at + 2)
      .flatMap((n) => [n.id, ...n.exp.map(String)])
      .map((c) => `<td>${escape(c)}</td>`)
      .join('');
    notFound.push(`<tr>${cells}</tr>`);
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body>
${cover}
${toc}
<h2>1. Introduction</h2><p>${FILLER}</p><p>${FILLER}</p>
${properties}
<h2>3. Genome-wide overview</h2><p>This figure shows a genome-wide overview of the results of your pathway analysis.</p>
${pathways}
<h2>5. Pathways details</h2><p>For every pathway of the most significant pathways, we present its diagram, as well as a short summary, its bibliography and the list of inputs found in it.</p>
${m.pathways.map((_p, n) => detailOf(n)).join('\n')}
<h2>6. Identifiers found</h2><p>Below is a list of the input identifiers that have been found or mapped to an equivalent element in Reactome, classified by resource.</p>
<p class="h3">${String(m.identifiersFound)} of the submitted entities were found, mapping to ${String(found.reduce((n, f) => n + f.entities, 0))} Reactome entities</p>
${found.map((f) => entries(f.resource, f.rows, m.columns)).join('\n')}
<h2>7. Identifiers not found</h2><p>These ${String(m.notFound.length)} identifiers were not found neither mapped to any entity in Reactome.</p>
<table><tbody>${notFound.join('')}</tbody></table>
</body></html>`;
}
