// Errors from reading a PDF with pdf.js (spec 001 T035). pdf.js's messages quote the file
// (`Bad filter name "…"`), and the PDFs read hold people's names (FR-013), so an error from
// reading one is said by its kind and code alone, never its message.
import { errorCode } from '../unknown.ts';

/** An error as it may be printed: its kind and code, never its message, which may quote a file. */
export const errorKind = (error: unknown): string => {
  if (!(error instanceof Error)) return 'error';
  const code = errorCode(error);
  return code !== undefined && /^[A-Z_]+$/.test(code) ? `${error.name} ${code}` : error.name;
};

/**
 * A PDF pdf.js could not read. Its message names the file, where it is given, and pdf.js's
 * error by its kind (`kind`) alone. pdf.js's own error is kept in a private field, read
 * with `pdfError()`, and not as `cause`: Node prints an error's `cause` wherever it prints
 * the error whole (`console.error`, an uncaught error), enumerable or not, and pdf.js's
 * message may quote the file.
 */
export class UnreadPdf extends Error {
  override name = 'UnreadPdf';
  /** pdf.js's error's kind and code. */
  readonly kind: string;
  readonly #error: unknown;

  constructor(error: unknown, path?: string) {
    const kind = errorKind(error);
    super(path === undefined ? `A PDF not read (${kind})` : `${path} not read (${kind})`);
    this.kind = kind;
    this.#error = error;
  }

  /** pdf.js's own error, for a debugger: never to be printed. */
  pdfError(): unknown {
    return this.#error;
  }
}
