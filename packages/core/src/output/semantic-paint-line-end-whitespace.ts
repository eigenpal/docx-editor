import type { StyleSpanRecord } from '../layout/semantic-records.ts';

/**
 * Keep clipped fill geometry outside glyph scaling. The expanded vertical clip preserves
 * underline ink while the zero horizontal inset stops authored spaces at the published edge.
 */
export function prepareTextPaintHost(
  document: Document,
  element: HTMLElement,
  span: StyleSpanRecord,
  scale: number
): HTMLElement {
  if (span.glyphOffsetPt !== undefined) {
    // Keep native text selection and caret advances in the published box. Relative
    // positioning would move those DOM ranges into the preceding character. Draw
    // only the ink at its offset, using the inherited colour (including revisions).
    const horizontalScale = span.style.horizontalScalePercent / 100;
    const advance = span.box.width * scale;
    element.style.width = `${advance / horizontalScale}px`;
    if (horizontalScale !== 1) {
      // The transform scales the band, while width + margin reserve its final advance.
      element.style.marginRight = `${advance - advance / horizontalScale}px`;
    }
    const glyph = document.createElement('span');
    glyph.dataset.docxGlyphOffset = '';
    // Measurement scales the glyph advance before adding tracking. CSS scales both,
    // so convert tracking back to the glyph's local coordinates first.
    if (horizontalScale !== 1)
      glyph.style.letterSpacing = `${(span.style.characterSpacingPt * scale) / horizontalScale}px`;
    if (span.glyphOffsetPt) {
      glyph.dataset.docxShiftedInk = '';
      // Keep the shadow in forced-colour modes, but inherit their accessible ink
      // colour from the parent instead of retaining an authored document colour.
      glyph.style.setProperty('forced-color-adjust', 'preserve-parent-color');
      glyph.style.setProperty('-webkit-text-fill-color', 'transparent');
      const inkOffset = `${(span.glyphOffsetPt * scale) / horizontalScale}px`;
      glyph.style.setProperty('--docx-glyph-ink-offset', inkOffset);
      if (element.style.color && element.style.color !== 'inherit')
        glyph.style.setProperty('--docx-glyph-ink-color', element.style.color);
      glyph.style.textShadow = `${inkOffset} 0 currentColor`;
    }
    element.append(glyph);
    return glyph;
  }
  const clippedLineEndWhitespace = span.lineEndWhitespace === true;
  if (span.style.horizontalScalePercent !== 100 || span.text === '\t' || clippedLineEndWhitespace) {
    element.style.width = `${span.box.width * scale}px`;
  }
  if (!clippedLineEndWhitespace) return element;
  element.style.clipPath = 'inset(-1em 0)';
  if (span.style.horizontalScalePercent === 100) return element;

  const glyph = document.createElement('span');
  glyph.dataset.docxClippedFill = '';
  glyph.style.display = 'inline-block';
  glyph.style.transform = element.style.transform;
  glyph.style.transformOrigin = element.style.transformOrigin;
  glyph.style.textDecorationLine = element.style.textDecorationLine;
  glyph.style.textDecorationStyle = element.style.textDecorationStyle;
  glyph.style.textDecorationColor = element.style.textDecorationColor;
  glyph.style.textDecorationThickness = element.style.textDecorationThickness;
  element.style.removeProperty('transform');
  element.style.removeProperty('transform-origin');
  element.style.removeProperty('text-decoration-line');
  element.style.removeProperty('text-decoration-style');
  element.style.removeProperty('text-decoration-color');
  element.style.removeProperty('text-decoration-thickness');
  element.append(glyph);
  return glyph;
}
