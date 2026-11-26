/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The device grid the writer puts painted baselines on, and the baseline rules over it.
import type { SemanticSpanVisit } from '@docx-editor.dev/core/layout';
import type { EmbeddedFace } from './fonts.ts';

/** Grid the reference puts painted baselines on. Paint only; layout never sees it. */
export const PDF_PAINT_GRID_PT = 0.24;

/**
 * A device-unit count with its accumulated representation error removed.
 *
 * Positions reach here as a sum of points that are exact in decimal and not in binary, so a
 * count that is mathematically a whole or half unit can arrive a part in 1e12 away from it.
 * That is invisible everywhere except at a tie, where it silently reverses the tie rule.
 */
export function snapToGrid(units: number): number {
  const snapped = Math.round(units * 2) / 2;
  return Math.abs(units - snapped) < 1e-9 ? snapped : units;
}

/** Nearest device unit; an exact half takes the larger count, the unit farther down the page. */
const roundUnits = (units: number): number => Math.floor(snapToGrid(units) + 0.5);
/** Nearest device unit; an exact half takes the smaller count, the unit toward the page top. */
const roundUnitsTowardTop = (units: number): number => Math.ceil(snapToGrid(units) - 0.5);
const fraction = (units: number): number => units - Math.floor(units);

/** Slack in points under which a line box counts as the face's own single-spaced box. */
const NATURAL_BOX_TOLERANCE_PT = 0.01;
/** Two fractions of a device unit closer than this are one fraction. */
const FRACTION_TOLERANCE = 1e-6;
/**
 * The share of an `exact` line box that layout puts above the baseline (`applyLineSpacing` in
 * core). A line with this split and no slack below is an `exact` line.
 */
const EXACT_LINE_ASCENT_SHARE = 0.8;

/**
 * The device unit a line's baseline is painted on, counted from the page top.
 *
 * The line box comes from layout: `w:spacing` `w:line` and `w:lineRule` set its height, and
 * `w:before` and `w:after` set the space around the paragraph (ECMA-376 §17.3.1.33,
 * CT_Spacing; ST_LineSpacingRule, §17.18.48). The standard does not say how a renderer puts
 * that box on a device grid. Everything below is measured export behavior: reference exports
 * of generated controls over four metric families, sizes from 7pt to 48pt, and the three line
 * rules. It is not a rule of the standard.
 *
 * The reference rounds each PART of a line to whole device units, not the baseline position:
 * the ascent (line top to baseline), the descent, and any slack. The parts must then fit the
 * rounded line. Which part gives way decides the baseline, and it depends on where the line
 * has slack:
 *
 * - **Slack below** (an `auto` multiple above single spacing, or the after-spacing of a
 *   paragraph's last line). The baseline hangs from the top: rounded line top plus rounded
 *   ascent. The slack absorbs a rounding surplus. When the rounded parts fall short of the
 *   rounded frame, the ascent takes the difference, so the baseline is that much lower.
 * - **Slack above only** (space that layout reports above the glyphs, such as `atLeast`
 *   growth, or the before-spacing of a first line). The baseline stands on the bottom: the
 *   rounded descent above the line's device bottom.
 * - **No slack** (a single-spaced line inside a paragraph, or a line with an `exact` pitch).
 *   The rounded descent stands on the device bottom too. When ascent and descent both round
 *   up and the box rounds down, the part with the smaller fraction loses the unit. With equal
 *   fractions the descent loses it.
 *
 * A line's device bottom is its rounded top plus its rounded height, but never below the
 * rounded position of its real bottom edge. That clamp is why a later line of a paragraph can
 * sit one unit above where the first line's offset alone puts it. The line HEIGHT that
 * positions the next line is never rounded: layout keeps exact metrics.
 *
 * A before-space belongs to the first line's frame, so the frame starts at the paragraph top.
 *
 * The ascent is the line's own: `line.baseline`. The descent is what the line box leaves
 * under the baseline, less the slack below. An `exact` line has no slack: its parts are the
 * two shares of the pitch, whatever the face. On any other line whose box is the
 * single-spaced box of `face`, the descent comes from the face's descent-to-ascent ratio
 * instead, because layout stores the box in thousandths of a point and the ratio is exact.
 *
 * A line has ONE baseline. `face` enters only through that refinement, which can move the
 * result by one unit at most, so a caller that paints several faces on one line computes the
 * unit once and reuses it. `TextWriter` does: the first run it paints on a line gives the face.
 *
 * Layout does not publish the line rule. An `exact` line is recognized by its split: no slack
 * below and {@link EXACT_LINE_ASCENT_SHARE} of the box above the baseline. Another line with
 * that same split is treated alike, which costs it one unit at most.
 */
export function paintedBaselineUnits(
  lineTop: number,
  line: SemanticSpanVisit['line'],
  face: Pick<EmbeddedFace, 'font'>,
  paragraph: SemanticSpanVisit['paragraph']
): number {
  const top = lineTop / PDF_PAINT_GRID_PT;
  const height = line.box.height / PDF_PAINT_GRID_PT;
  const ascent = line.baseline / PDF_PAINT_GRID_PT;
  const trailing = (line.trailingSpacing ?? 0) / PDF_PAINT_GRID_PT;
  const box = roundUnits(height);
  const ascentUnits = roundUnits(ascent);
  const bottom = roundUnits(top + height);

  const exact =
    trailing === 0 &&
    Math.abs(line.baseline - EXACT_LINE_ASCENT_SHARE * line.box.height) <= FRACTION_TOLERANCE;
  // Layout centers the glyphs of an `exact` line and reports the space above them as leading.
  // That space is not slack on the device grid.
  const leading = exact ? 0 : (line.leading ?? 0) / PDF_PAINT_GRID_PT;
  const faceAbove = Math.abs(face.font.ascent) + Math.abs(face.font.lineGap);
  const faceDescent =
    faceAbove > 0 ? (Math.abs(face.font.descent) / faceAbove) * (ascent - leading) : 0;
  const natural =
    !exact &&
    faceDescent > 0 &&
    Math.abs(ascent + faceDescent + trailing - height) <=
      NATURAL_BOX_TOLERANCE_PT / PDF_PAINT_GRID_PT;
  const descent = natural ? faceDescent : height - trailing - ascent;
  // No room under the baseline: keep the authored baseline offset under the bottom clamp.
  if (!(descent > 0)) return Math.min(roundUnitsTowardTop(top) + box, bottom) - (box - ascentUnits);

  const descentUnits = roundUnits(descent);
  const before = spaceBeforeLine(line, paragraph) / PDF_PAINT_GRID_PT;
  const after = spaceAfterLine(line, paragraph) / PDF_PAINT_GRID_PT;
  const slackBelow = trailing + after;
  if (slackBelow > 0) {
    const beforeUnits = roundUnits(before);
    // What the rounded frame leaves the ascent once the other rounded parts are placed.
    const left =
      roundUnits(before + height + after) - beforeUnits - descentUnits - roundUnits(slackBelow);
    return roundUnits(top - before) + beforeUnits + Math.max(ascentUnits, left);
  }
  if (leading + before > 0)
    return Math.min(roundUnits(top - before) + roundUnits(before + height), bottom) - descentUnits;
  const descentGivesWay =
    ascentUnits + descentUnits > box &&
    fraction(snapToGrid(descent)) <= fraction(snapToGrid(ascent)) + FRACTION_TOLERANCE;
  return Math.min(roundUnits(top) + box, bottom) - descentUnits + (descentGivesWay ? 1 : 0);
}

/**
 * The before-spacing (`w:spacing` `w:before`, ECMA-376 §17.3.1.33) that sits above a line, in
 * points: the paragraph's applied value on its first line, when the paragraph box holds it.
 * A fragment that continues a paragraph, or one whose spacing layout dropped, holds none.
 */
function spaceBeforeLine(
  line: SemanticSpanVisit['line'],
  paragraph: SemanticSpanVisit['paragraph']
): number {
  const before = paragraph.spacing.before;
  if (!(before > 0) || paragraph.lines[0] !== line) return 0;
  return line.box.y - paragraph.box.y >= before - NATURAL_BOX_TOLERANCE_PT ? before : 0;
}

/**
 * The after-spacing (`w:spacing` `w:after`, ECMA-376 §17.3.1.33) that sits under a line, in
 * points: the paragraph's applied value on the line that ends the paragraph. The applied
 * value is zero where `w:contextualSpacing` collapsed it.
 */
function spaceAfterLine(
  line: SemanticSpanVisit['line'],
  paragraph: SemanticSpanVisit['paragraph']
): number {
  const after = paragraph.spacing.after;
  if (!(after > 0) || paragraph.paragraphEnd !== true) return 0;
  return paragraph.lines[paragraph.lines.length - 1] === line ? after : 0;
}

/**
 * The baseline of a run in points from the page top, given the unit of its line
 * ({@link paintedBaselineUnits}) and the run's baseline shift in points.
 *
 * A shifted run (superscript, subscript, raised or lowered text) sits a whole number of units
 * from the baseline of its line: the shift is rounded by itself, and an exact half-unit rounds
 * toward the page top. Measured: a run raised 3pt (12.5 units) paints 13 units above the
 * baseline of its line wherever that line falls on the grid.
 */
export function shiftedBaselinePt(lineUnits: number, baselineShiftPt = 0): number {
  return (
    (lineUnits + roundUnitsTowardTop(-baselineShiftPt / PDF_PAINT_GRID_PT)) * PDF_PAINT_GRID_PT
  );
}

/**
 * The baseline of a run in points from the page top, given the line's top from the page, a
 * face and paragraph, and the run's baseline shift. The development tools call this to report
 * what the PDF carries rather than what layout published before the grid.
 */
export function paintedBaselineFromTop(
  lineTop: number,
  line: SemanticSpanVisit['line'],
  face: Pick<EmbeddedFace, 'font'>,
  paragraph: SemanticSpanVisit['paragraph'],
  baselineShiftPt = 0
): number {
  return shiftedBaselinePt(paintedBaselineUnits(lineTop, line, face, paragraph), baselineShiftPt);
}
