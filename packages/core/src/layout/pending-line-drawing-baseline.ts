import { PAGE_BREAK_CHAR } from '@docx-editor.dev/core/store';
import { repositionInlineDrawingsForBaseline } from './drawing-layout.ts';
import type { PendingLine } from './pending-line.ts';

/** Move each drawing to the final line baseline without changing its extent. */
export function repositionLineDrawings(line: PendingLine): void {
  if (line.drawings.length === 0) return;
  const repositioned = repositionInlineDrawingsForBaseline(line.drawings, line.baseline);
  line.drawings.length = 0;
  for (const drawing of repositioned) line.drawings.push(drawing);
}

/** Keep ignored cell breaks and inline drawings on the same baseline. */
export function syncLineDrawingBaselines(line: PendingLine, pageBreaksIgnored: boolean): void {
  if (line.drawings.length === 0) return;
  if (line.spans.every((span) => pageBreaksIgnored && span.text === PAGE_BREAK_CHAR)) {
    for (const drawing of line.drawings)
      line.baseline = Math.max(line.baseline, drawing.y + drawing.height);
  }
  repositionLineDrawings(line);
  for (const drawing of line.drawings)
    line.baseline = Math.max(line.baseline, drawing.y + drawing.height);
}
