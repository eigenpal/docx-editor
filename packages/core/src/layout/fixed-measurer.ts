// Deterministic monospace measurer for tests and headless layout.

import { type ResolvedRunStyle } from './run-style.ts';
import type { TextMeasurer } from './semantic-records.ts';

/**
 * A deterministic measurer for tests and headless use.
 *
 * Monospace by construction: every character is the same width and every line the same
 * height, scaled by `w:sz` when present. Real shaping is the HarfBuzz path; this exists so
 * layout behaviour can be asserted without a font stack deciding the answer.
 */
export function createFixedMeasurer(charWidth = 6, lineHeight = 14): TextMeasurer {
  // 11pt is the size the base width and height describe; everything else scales from it.
  const scale = (style: ResolvedRunStyle): number => style.fontSizePt / 11;
  return {
    measure: (text, style) => {
      // Advance, then horizontal scaling, then character spacing — the order Word applies
      // them, and the order that makes `w:spacing` an absolute per-character addition
      // rather than something the scale multiplies.
      const advance = text.length * charWidth * scale(style);
      const scaled = advance * (style.horizontalScalePercent / 100);
      return scaled + text.length * style.characterSpacingPt;
    },
    lineMetrics: (style) => {
      // Super/subscript draw smaller, so they need less line height than their nominal size.
      const shrink = style.verticalAlign === 'baseline' ? 1 : 0.75;
      const height = lineHeight * scale(style) * shrink;
      return { height, baseline: height * 0.8 };
    },
  };
}
