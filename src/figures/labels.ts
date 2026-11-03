// The figures' labels and FR-017 (spec 001 T022): a figure's SVG has the substitutions made
// in the text of its labels, and in a PDF made on request any other character no font draws
// replaced by U+FFFD and logged in the PDF's one log, shared with its texts. Only the text
// content changes, never an element, an id or an attribute, so the drawing is unchanged.
// T024 adds the book's mode, in which such a character is a fault, after T014's id prefixing.
import { markupText, onRequestMarkupText, type CharacterLog } from '../layout/characters.ts';
import { coveredCodePoints } from '../layout/fonts.ts';

/** A figure's SVG with its labels as a PDF made on request prints them. */
export function labelsOnRequest(svg: string, log: CharacterLog): string {
  const covered = coveredCodePoints();
  return markupText(svg, (text) => onRequestMarkupText(text, log, covered));
}
