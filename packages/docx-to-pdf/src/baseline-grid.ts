/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The device grid the writer puts painted baselines on, and the baseline rules over it.
import type { SemanticSpanVisit } from '@docx-editor.dev/core/layout';
import type { EmbeddedFace } from './fonts.ts';

/** Grid the reference puts painted baselines on. Paint only; layout never sees it. */
export const PDF_PAINT_GRID_PT = 0.24;

/**
 * Where the baseline sits inside its line box, on the device grid.
 *
 * The reference grids the NATURAL font box and the font's own descent independently and lets
 * the baseline fall between them. Times New Roman at 12pt ascends 46.68 units and rounds to
 * 47, while the reference paints 46: a 57-unit box less an 11-unit descent. A four-line
 * control with an 18pt letter inside 11pt text lands on 44, 128, 191 and 247 units this way,
 * all four exact.
 *
 * The descent has to come from the FONT, not from the line box. A line-spacing multiple grows
 * the box below the baseline — at 1.15 an 11pt Calibri line is 64.343 units tall where its
 * natural box is 55.95 — and measuring the descent off that box moves the baseline a unit,
 * which cost two corpus documents when it was tried. On such a line the reference keeps the
 * baseline on the ascent, so a box taller than its natural height falls back to that.
 */
/**
 * A device-unit count with its accumulated representation error removed.
 *
 * Positions reach here as a sum of points that are exact in decimal and not in binary, so a
 * count that is mathematically a whole or half unit can arrive a part in 1e12 away from it.
 * That is invisible everywhere except at a tie, where it silently reverses the tie rule.
 */
/**
 * The baseline the writer paints for a line, in points from the page top, given the line's
 * top from the page, its face and paragraph, and the run's baseline shift. This is the same
 * arithmetic `TextWriter.paint` performs; development tools call it to report what the PDF
 * carries rather than what layout published before the grid.
 */
export function paintedBaselineFromTop(
  lineTop: number,
  line: SemanticSpanVisit['line'],
  face: Pick<EmbeddedFace, 'font'>,
  paragraph: SemanticSpanVisit['paragraph'],
  baselineShiftPt = 0
): number {
  const fromTop = lineTop + griddedBaselineInLine(line, face, paragraph) - baselineShiftPt;
  return Math.ceil(snapToGrid(fromTop / PDF_PAINT_GRID_PT) - 0.5) * PDF_PAINT_GRID_PT;
}

export function snapToGrid(units: number): number {
  const snapped = Math.round(units * 2) / 2;
  return Math.abs(units - snapped) < 1e-9 ? snapped : units;
}

export function griddedBaselineInLine(
  line: SemanticSpanVisit['line'],
  face: Pick<EmbeddedFace, 'font'>,
  paragraph: SemanticSpanVisit['paragraph']
): number {
  const units = (value: number): number => Math.round(value / PDF_PAINT_GRID_PT);
  // Scale the descent off the LINE's own ascent, through the face's descent-to-ascent ratio,
  // rather than off the painted run's size. A line takes its ascent from its tallest run, so
  // deriving the descent from a shorter run on the same line can land its glyphs a unit away
  // from the rest. The ratio is a property of the face, so every run in a family agrees
  // whatever size it is drawn at, and one line keeps one baseline.
  const above = Math.abs(face.font.ascent) + Math.abs(face.font.lineGap);
  const descent = above > 0 ? (Math.abs(face.font.descent) / above) * line.baseline : 0;
  const naturalBox = line.baseline + descent;
  // A line that ends a paragraph WITH after-spacing rounds its ascent instead. Controls
  // rendered by Word put such a last line one device unit below what the box rule gives, at
  // every paragraph length from one line to six. The spacing is what decides it, not the
  // paragraph end: two controls identical but for `w:after` place the SAME line, at the same
  // position, a unit apart, and with `w:after="0"` every line takes the box rule, headers
  // included. The line that carries the paragraph mark is already the one this rule's own
  // fallback catches when the mark makes the box taller than natural.
  const endsParagraph =
    paragraph.paragraphEnd === true &&
    paragraph.spacing.after > 0 &&
    paragraph.lines[paragraph.lines.length - 1] === line;
  if (endsParagraph || !(descent > 0) || line.box.height > naturalBox + 0.01)
    return units(line.baseline) * PDF_PAINT_GRID_PT;
  return (units(naturalBox) - units(descent)) * PDF_PAINT_GRID_PT;
}
