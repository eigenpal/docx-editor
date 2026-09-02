import type { FontSlot, ResolvedRunStyle } from '@docx-editor.dev/core/layout';
import { baselineShiftPtOf, displayText, styleForFontSlot } from '@docx-editor.dev/core/layout';
import { validateColor, validateCoordinate } from './pdf-paint-bounds.ts';

/** Resolved underline or strike decoration for one text span. @public */
export type PdfTextDecoration = 'none' | 'underline' | 'strike' | 'double-strike';

/** Immutable resolved run style carried on a text-span command. @public */
export interface PdfTextStyle {
  readonly fontFamily: string | null;
  readonly fontSizePt: number;
  readonly fontWeight: 'normal' | 'bold';
  readonly italic: boolean;
  readonly color: string | null;
  readonly decoration: PdfTextDecoration;
  readonly baselineShiftPt: number;
}

function decorationOf(style: ResolvedRunStyle): PdfTextDecoration {
  if (style.doubleStrike) return 'double-strike';
  if (style.strike) return 'strike';
  if (style.underline) return 'underline';
  return 'none';
}

function validateFontSizePt(value: number): number {
  const size = validateCoordinate('fontSizePt', value);
  if (size <= 0) {
    throw new Error('Invalid PDF paint value for fontSizePt: must be greater than zero');
  }
  return size;
}

function validateOptionalColor(value: string | null): string | null {
  if (value === null) return null;
  return validateColor(value);
}

/** One run style effect the PDF text command cannot represent exactly. @public */
export interface PdfRunStyleApproximation {
  readonly feature: string;
  readonly reason: string;
}

/** Visible text after Core display casing. `w:caps` becomes uppercase. @public */
export function pdfDisplayText(text: string, style: ResolvedRunStyle): string {
  return displayText(text, style);
}

/**
 * Lists run effects that stay visible in Word but are not encoded in a text-span command.
 * Caps is omitted: the planner applies Core display casing to the painted string.
 * @public
 */
export function pdfRunStyleApproximations(
  style: ResolvedRunStyle
): readonly PdfRunStyleApproximation[] {
  const approximations: PdfRunStyleApproximation[] = [];
  if (style.smallCaps && !style.caps) {
    approximations.push(
      Object.freeze({
        feature: 'small-caps',
        reason: 'Small caps require OpenType smcp glyphs; PDF built-in text cannot select them',
      })
    );
  }
  if (style.characterSpacingPt !== 0) {
    approximations.push(
      Object.freeze({
        feature: 'character-spacing',
        reason: 'Character spacing is not encoded in the PDF text command yet',
      })
    );
  }
  if (style.horizontalScalePercent !== 100) {
    approximations.push(
      Object.freeze({
        feature: 'horizontal-scale',
        reason: 'Horizontal scaling is not encoded in the PDF text command yet',
      })
    );
  }
  if (style.highlight) {
    approximations.push(
      Object.freeze({
        feature: 'highlight',
        reason: 'Character highlight fills are not encoded in the PDF paint slice yet',
      })
    );
  }
  if (style.shading) {
    approximations.push(
      Object.freeze({
        feature: 'shading',
        reason: 'Character shading fills are not encoded in the PDF paint slice yet',
      })
    );
  }
  return approximations;
}

/** Maps Core resolved run style to the PDF paint text-style shape. @public */
export function pdfTextStyleFromResolvedRunStyle(
  style: ResolvedRunStyle,
  fontSlot?: FontSlot
): PdfTextStyle {
  const face = styleForFontSlot(style, fontSlot);
  return Object.freeze({
    fontFamily: face.fontFamily,
    fontSizePt: validateFontSizePt(face.fontSizePt),
    fontWeight: face.bold ? 'bold' : 'normal',
    italic: face.italic,
    color: face.color === null ? null : validateOptionalColor(`#${face.color}`),
    decoration: decorationOf(face),
    baselineShiftPt: validateCoordinate('baselineShiftPt', baselineShiftPtOf(face)),
  });
}
