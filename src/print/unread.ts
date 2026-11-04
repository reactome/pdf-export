// Errors from reading a PDF with pdf.js (spec 001 T035). pdf.js's messages quote the file
// (`Bad filter name "…"`), and the PDFs read hold people's names (FR-013), so an error from
// reading one is said by its kind and code alone, never its message.

/** An error as it may be printed: its kind and code, never its message, which may quote a file. */
export const errorKind = (error: unknown): string => {
  if (!(error instanceof Error)) return 'error';
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && /^[A-Z_]+$/.test(code) ? `${error.name} ${code}` : error.name;
};

/**
 * A PDF pdf.js could not read. Its message names the file, where it is given, and pdf.js's
 * error by its kind (`kind`) alone; pdf.js's own error is its `cause`, never printed.
 */
export class UnreadPdf extends Error {
  override name = 'UnreadPdf';
  /** pdf.js's error's kind and code. */
  readonly kind: string;

  constructor(cause: unknown, path?: string) {
    const kind = errorKind(cause);
    super(path === undefined ? `A PDF not read (${kind})` : `${path} not read (${kind})`, {
      cause,
    });
    this.kind = kind;
  }
}
