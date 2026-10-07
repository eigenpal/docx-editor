// Placing and aligning one cell line in its line box.
//
// Shared by cell placement and row geometry reuse, so a reused line goes through exactly the
// arithmetic a fresh placement would.

import type { OoxmlProperty } from '@docx-editor.dev/core/store';
import type { InlineDrawingRecord } from './drawing-layout.ts';
import { alignLineWithPictures } from './line-picture-alignment.ts';
import {
  alignSpans,
  boxLineSetsLikeLastLine,
  lineAlignOffset,
  type Alignment,
} from './paragraph-alignment.ts';
import type { PendingLine } from './pending-line.ts';
import type { TextMeasurer } from './semantic-records.ts';
import type { StyleCascadeTable } from './style-cascade.ts';

/** What a paragraph's lines share when they are aligned. */
export interface CellLineAlignment {
  readonly measurer: TextMeasurer;
  readonly styleCascade: StyleCascadeTable | undefined;
  readonly props: readonly OoxmlProperty[];
  readonly alignment: Alignment;
  readonly rtl: boolean;
  readonly inTableCell: boolean;
}

/** Place `pendingLine`'s spans at `penX` and `y`, then align them with the line's pictures. */
export function alignCellLine(
  pendingLine: PendingLine,
  paragraphId: string,
  penX: number,
  y: number,
  placedDrawings: readonly InlineDrawingRecord[],
  lineIndent: number,
  lineAvailableWidth: number,
  isLastLine: boolean,
  shared: CellLineAlignment
): ReturnType<typeof alignLineWithPictures> {
  const { alignment } = shared;
  const placedSpans = pendingLine.spans.map((span) => ({
    ...span,
    range: { ...span.range, paragraphId },
    box: { ...span.box, x: span.box.x + penX, y },
  }));
  return alignLineWithPictures(
    placedSpans,
    placedDrawings,
    shared.rtl,
    (spans) =>
      alignSpans(
        spans,
        shared.measurer,
        lineIndent,
        lineAvailableWidth,
        alignment,
        boxLineSetsLikeLastLine(shared.props, pendingLine, isLastLine, shared.styleCascade),
        alignment === 'center' || alignment === 'right' ? pendingLine.width : undefined,
        shared.rtl,
        shared.inTableCell,
        pendingLine.spaceShrink === true
      ),
    (aligned) =>
      lineAlignOffset(placedSpans, aligned, alignment, lineAvailableWidth, pendingLine.width)
  );
}
