import { repositionInlineDrawingsForBaseline } from './drawing-layout.ts';
import type { PendingLine } from './pending-line.ts';
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
        drawing.y + drawing.height + (drawing.runPositionPt ?? 0)
      );
  repositionPendingDrawings(line);
  for (const drawing of line.drawings)
    line.baseline = Math.max(
      line.baseline,
      drawing.y + drawing.height + (drawing.runPositionPt ?? 0)
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
