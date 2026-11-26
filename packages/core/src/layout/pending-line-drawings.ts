import {
  inlineDrawingBottom,
  repositionInlineDrawingsForBaseline,
} from './inline-drawing-baseline.ts';
import { growLineMetrics, isHeightlessWhitespace, type PendingLine } from './pending-line.ts';
import type { InlineDrawingVerticalLayout } from './drawing-layout.ts';
import { PAGE_BREAK_CHAR } from '@docx-editor.dev/core/store';

/** Reposition drawings without replacing the pending line's owned drawing array. */
export function repositionPendingDrawings(line: PendingLine): void {
  if (!line.drawings.length) return;
  const repositioned = repositionInlineDrawingsForBaseline(line.drawings, line.baseline);
  line.drawings.length = 0;
  for (const drawing of repositioned) line.drawings.push(drawing);
}

/** Synchronize the glyph baseline before paragraph line spacing changes the line box. */
export function syncPendingDrawingBaselines(line: PendingLine, pageBreaksIgnored: boolean): void {
  if (!line.drawings.length) return;
  if (line.spans.every((span) => pageBreaksIgnored && span.text === PAGE_BREAK_CHAR))
    for (const drawing of line.drawings)
      line.baseline = Math.max(
        line.baseline,
        inlineDrawingBottom(drawing) + (drawing.runPositionPt ?? 0)
      );
  repositionPendingDrawings(line);
  for (const drawing of line.drawings)
    line.baseline = Math.max(
      line.baseline,
      inlineDrawingBottom(drawing) + (drawing.runPositionPt ?? 0)
    );
}

/**
 * The band an inline drawing of `contribution` height occupies once its run's `w:position`
 * moves it.
 *
 * A raised drawing reaches `runPositionPt` higher above the baseline; a lowered one reaches as
 * far below it. Float clearance measures this band, so it matches the placed drawing.
 */
export function positionedDrawingExtent(
  contribution: number,
  runPositionPt: number
): { readonly height: number; readonly baseline: number } {
  if (!runPositionPt) return { height: contribution, baseline: contribution };
  const above = Math.max(0, contribution + runPositionPt);
  return { height: above + Math.max(0, -runPositionPt), baseline: above };
}

/**
 * Grow a line for an inline object placed on it: a DrawingML object (`wp:inline`, CT_Inline,
 * ECMA-376 20.4.2.8), or an embedded object (`w:object`, CT_Object, 17.3.3.19).
 *
 * The object affects the line height "like a character glyph of similar size": it sits on the
 * baseline and has no descent of its own. A line that holds text therefore keeps the descent
 * of that text, as it does when a taller glyph joins the line. A line that holds no text
 * takes the box of its objects, without a text descent. `layout` of an object that its run's
 * `w:position` moves (CT_SignedHpsMeasure, 17.3.2.24) already holds the descent of its run.
 *
 * `underlineDescent` is the largest run descent of the line's inline objects whose run is
 * underlined (`w:u`, CT_Underline, 17.3.2.40), or zero. The underline of a run is drawn below
 * the baseline, so the line holds that descent even when it holds no text, in any object order.
 */
export function growPendingLineForDrawing(
  line: Pick<PendingLine, 'height' | 'baseline' | 'spans'>,
  layout: InlineDrawingVerticalLayout,
  positioned: boolean,
  underlineDescent: number
): void {
  if (positioned) {
    growLineMetrics(line, { height: layout.lineHeight, baseline: layout.baseline });
  } else if (line.height === 0) {
    line.height = layout.lineHeight;
    line.baseline = layout.baseline;
  } else {
    const holdsText = line.spans.some(
      (span) => span.text !== PAGE_BREAK_CHAR && !isHeightlessWhitespace(span.text)
    );
    const descent = holdsText ? line.height - line.baseline : 0;
    line.baseline = Math.max(line.baseline, layout.baseline);
    line.height = Math.max(line.height, layout.lineHeight, line.baseline + descent);
  }
  line.height = Math.max(line.height, line.baseline + underlineDescent);
}
