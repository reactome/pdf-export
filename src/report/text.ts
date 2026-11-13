// The report's text that is not the analysis's data (spec 002 FR-209): the website's
// current wording, named by its page in WebsiteAngular's content, or written here anew.
// Nothing is copied from `analysis-report`. Spec 001's texts (src/layout/text.ts) serve
// where they say the same.

/**
 * The report's title, as the website's download names it ("PDF Result", the analysis
 * report): kept as today's title so the comparison (FR-208) can match the cover.
 */
export const REPORT_TITLE = 'Pathway Analysis Report';

/**
 * How long a result is kept (content/documentation/faq/analysis/general/
 * 211-permanent-analysis-results.mdx, its answer).
 */
export const KEPT =
  'Analysis data is available through the token for 7 days after your last usage. ' +
  'Analysis results are deleted when Reactome releases new data, regardless of when you ' +
  'performed your analysis or last accessed your data.';

/** The website's pages the report links to, relative to its address. */
export const PAGES = {
  /** content/documentation/userguide/analysis.mdx */
  guide: '/documentation/userguide/analysis',
  /** content/documentation/userguide/analysis/gsa.mdx */
  gsaGuide: '/documentation/userguide/analysis/gsa',
  /** content/documentation/inferred-events.mdx */
  inferred: '/documentation/inferred-events',
} as const;

/** Written anew: the cover's link to the result. */
export const RESULT_LINK = 'Open this result in the Pathway Browser';

/** Written anew: the properties' notes. */
export const PROPERTIES = {
  guide: 'The user guide explains each type of analysis.',
  gsaGuide: 'ReactomeGSA’s guide explains its methods and results.',
  projection:
    'Identifiers of other species were projected to their human equivalents, as inferred ' +
    'events are made.',
  counts:
    'Identifiers found and pathways hit are counted over every species, after the ' +
    'resource and importable-only filters.',
} as const;

/** Written anew: the overview's caption; `{species}` is filled in. */
export const OVERVIEW_CAPTION =
  'The genome-wide overview of {species}: each of its pathways, coloured by the analysis.';

/** Written anew: the most significant pathways' table's note; `{number}` is filled in. */
export const PATHWAYS_NOTE =
  'The {number} most significant pathways for the species, by their entities’ p-value. ' +
  'Each name links to the pathway’s details below.';
