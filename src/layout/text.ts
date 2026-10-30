// The text in the PDFs that is not Reactome's data (spec 001 T016, FR-009). Each piece is
// the website's own current wording, named by its page in WebsiteAngular's content, or is
// written here anew; nothing is copied from event-pdf. Reactome's own papers are in
// references.json, whose authors the release's owners fill in.
import { readFileSync } from 'node:fs';

/** The institutions that run Reactome (content/about/team.mdx, its institution headings). */
export const INSTITUTIONS: readonly string[] = [
  'Ontario Institute for Cancer Research',
  'New York University Langone Medical Center',
  'European Bioinformatics Institute',
  'Oregon Health & Science University',
];

/**
 * The cover's licence statement, as the website's licence page has it
 * (content/about/license.mdx, section 1): data CC0, illustrations and art CC BY 4.0.
 */
export const LICENCE = {
  text:
    'Reactome data are dedicated to the public domain under CC0 1.0. ' +
    'Pathway illustrations, icons and other art are licensed under CC BY 4.0. ' +
    'See Reactome’s licence agreement for the terms.',
  /** The website's page, relative to its address. */
  page: '/about/license',
  links: {
    cc0: 'https://creativecommons.org/publicdomain/zero/1.0/',
    ccBy: 'https://creativecommons.org/licenses/by/4.0/',
  },
} as const;

/** The introduction's opening (content/about/what-is-reactome.mdx, its mission statement). */
export const ABOUT_REACTOME =
  'Reactome is an open-source, open access, manually curated and peer-reviewed pathway ' +
  'database. Our goal is to provide intuitive bioinformatics tools for the visualization, ' +
  'interpretation and analysis of pathway knowledge to support basic and clinical research, ' +
  'genome analysis, modeling, systems biology and education.';

/** What this document holds, written anew: `{pathways}` and `{reactions}` are filled in. */
export const DOCUMENT_HOLDS =
  'This document contains {pathways} pathways and {reactions} reactions.';

/** Written anew: the release line. */
export const RELEASE_LINE = 'Reactome release {release}';

/**
 * Written anew: the cover's note on a single pathway's PDF, pointing at the book, which the
 * website's download page offers.
 */
export const EXCERPT = {
  text: 'This document is an excerpt of The Reactome Book, which holds the release’s human pathways in full.',
  page: '/download-data',
} as const;

/** Written anew: what the cover's names are. */
export const CONTRIBUTORS = 'Authored, edited, reviewed and revised by';

/**
 * The analysis section's explanations (content/documentation/userguide/analysis.mdx: its
 * Analysis Data, Identifier mapping, Results and Species Comparison sections, and
 * Analysis Gene Expression for ReactomeGSA).
 */
export const ANALYSIS = {
  overrepresentation:
    'If your data is a single column of identifiers, they are mapped to pathways and ' +
    'over-representation and pathway-topology analyses are run.',
  expression:
    'Data with a first row of column headers and numeric values are analysed as expression ' +
    'data: identifiers are mapped to pathways and their values shown on the diagrams.',
  speciesComparison:
    "Species Comparison sets a model organism's computationally inferred pathways beside the " +
    'human ones, showing the elements the two species share.',
  gsa:
    'ReactomeGSA performs quantitative pathway analyses (gene set analyses) of the submitted ' +
    'data.',
  interactors:
    'With interactors included, pathways are expanded with molecules that interact with ' +
    'their components, and these are counted apart.',
  entitiesFound:
    'Entities found: the number of curated molecules common to the submitted data and the ' +
    'pathway.',
  pValue: 'Entities p-value: the result of the statistical test for over-representation.',
  fdr: 'Entities FDR: the false discovery rate, the corrected over-representation probability.',
} as const;

export interface OwnReference {
  pubMedId: number;
  title: string;
  journal: string;
  year: number;
  doi: string;
  /** As written on the website's publications page; empty until the release's owners add them. */
  authors: string[];
}

/** Reactome's own papers for the introduction, newest first. */
export function ownReferences(): OwnReference[] {
  const file = JSON.parse(readFileSync(new URL('references.json', import.meta.url), 'utf8')) as {
    references: OwnReference[];
  };
  return [...file.references].sort((a, b) => b.year - a.year);
}

/** A sentence with its {placeholders} filled in. */
export function fill(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in values ? String(values[key]) : whole
  );
}
