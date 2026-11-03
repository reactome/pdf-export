// The book's file names (spec 001 T024, data-model Book): each PDF is named as today's, its
// top-level pathway's name and `.pdf`. A name a file system cannot hold (one holding `/` or
// NUL, or over 255 bytes with `.pdf`), or two names equal ignoring case, which a file system
// that ignores case would write as one file, is a fault `bad-file-name <stId>`.

/** The longest file name, in bytes, that common file systems hold. */
export const MAX_NAME_BYTES = 255;

/** A top-level pathway, as its PDF is named. */
export interface Named {
  stId: string;
  name: string;
}

/** A PDF's file name: its pathway's name and `.pdf`. */
export const fileName = (name: string): string => `${name}.pdf`;

/** The faults in the book's file names, in the pathways' order; each stable id once. */
export function checkFileNames(pathways: readonly Named[]): string[] {
  const bad = new Set<string>();
  const byFolded = new Map<string, string[]>();
  for (const { stId, name } of pathways) {
    const file = fileName(name);
    if (file.includes('/') || file.includes('\0') || Buffer.byteLength(file) > MAX_NAME_BYTES) {
      bad.add(stId);
    }
    const folded = file.toLowerCase();
    byFolded.set(folded, [...(byFolded.get(folded) ?? []), stId]);
  }
  for (const stIds of byFolded.values()) if (stIds.length > 1) for (const s of stIds) bad.add(s);
  return pathways.filter((p) => bad.has(p.stId)).map((p) => `bad-file-name ${p.stId}`);
}
