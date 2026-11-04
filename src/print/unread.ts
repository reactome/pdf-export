// Errors from reading a PDF with pdf.js (spec 001 T035). pdf.js's messages
// quote the file (`Bad filter name "…"`), and the PDFs read hold people's names (FR-013), so
// an error from reading one is said by its kind and code alone, never its message.

/** An error as it may be printed: its kind and code, never its message, which may quote a file. */
export const errorKind = (error: unknown): string => {
  if (!(error instanceof Error)) return 'error';
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && /^[A-Z_]+$/.test(code) ? `${error.name} ${code}` : error.name;
};

/** A PDF pdf.js could not read, said by the kind of pdf.js's error alone. */
export class UnreadPdf extends Error {
  override name = 'UnreadPdf';

  constructor(cause: unknown) {
    super(`A PDF could not be read (${errorKind(cause)})`);
  }
}
