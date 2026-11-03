// The figures' labels and FR-017 (spec 001 T022): a figure's SVG has the substitutions made
// in the text of its labels, and in a PDF made on request any other character no font draws
// replaced by U+FFFD and logged in the PDF's one log, shared with its texts. Only the text
// content changes, never an element, an id or an attribute, so the drawing is unchanged.
// In the book's mode (T024) such a character is a fault naming the figure's event; it is
// applied to the SVG after T014's id prefixing, as the figure is inlined.
import {
  markupText,
  onRequestMarkupText,
  type BookCharacters,
  type CharacterLog,
} from '../layout/characters.ts';
import { coveredCodePoints } from '../layout/fonts.ts';

/** A figure's SVG with its labels as a PDF made on request prints them. */
export function labelsOnRequest(svg: string, log: CharacterLog): string {
  const covered = coveredCodePoints();
  return markupText(svg, (text) => onRequestMarkupText(text, log, covered));
}

/**
 * A figure's SVG with its labels as the book prints them: the substitutions made and counted,
 * and any other character no font draws a fault in `characters`, naming `stId`, the event
 * whose section shows the figure. The caller refuses the figure while it has a fault.
 */
export function labelsInBook(svg: string, stId: string, characters: BookCharacters): string {
  return characters.markup(svg, stId);
}
