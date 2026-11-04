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

/** A PDF of these objects, numbered from 1, with its cross-reference table and trailer. */
function rawPdf(objects: readonly string[], trailer: string): Uint8Array {
  let text = '%PDF-1.7\n';
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(text.length);
    text += `${String(i + 1)} 0 obj\n${object}\nendobj\n`;
  });
  const xref = text.length;
  text += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  text += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  text += `trailer\n${trailer}\nstartxref\n${String(xref)}\n%%EOF\n`;
  return new TextEncoder().encode(text);
}

/**
 * A PDF whose named destinations are a stream filtered by a filter named with the planted
 * word: pdf.js throws on looking a destination up, its message quoting the word.
 */
export function plantedDestinations(): Uint8Array {
  return rawPdf(
    [
      '<< /Type /Catalog /Pages 2 0 R /Dests 3 0 R >>',
      '<< /Type /Pages /Kids [4 0 R] /Count 1 >>',
      `<< /Length 4 /Filter [(${PLANTED})] >>\nstream\nabcd\nendstream`,
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >>',
    ],
    '<< /Size 5 /Root 1 0 R >>'
  );
}
