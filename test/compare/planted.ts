// PDFs with a planted word where pdf.js would quote it (spec 001 T035, from #167's and #168's
// reviews): as an operator it does not know, which it warns of, and as a filter's name, which
// it throws on. The word is a placeholder, standing for a name a real PDF could hold.
import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFOperator,
  PDFString,
  type PDFOperatorNames,
} from '@cantoo/pdf-lib';

export const PLANTED = 'PlaceholderPersonJaneQExample';

/** A PDF whose page's content holds the planted word as an operator pdf.js does not know. */
export async function plantedOperator(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage().pushOperators(PDFOperator.of(PLANTED as unknown as PDFOperatorNames));
  return doc.save();
}

/** A PDF whose page's content is filtered by a filter named with the planted word. */
export async function plantedFilter(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const filters = PDFArray.withContext(doc.context);
  filters.push(PDFString.of(PLANTED));
  const content = doc.context.stream('BT ET', { Filter: filters });
  page.node.set(PDFName.of('Contents'), doc.context.register(content));
  return doc.save({ useObjectStreams: false });
}
