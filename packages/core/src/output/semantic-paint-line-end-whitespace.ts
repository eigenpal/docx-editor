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
