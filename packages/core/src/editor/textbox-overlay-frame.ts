// The painted frame of the text box being edited, for the selection overlay.
//
// A body box is a page drawing. A header or footer box repeats on every page its story shows
// on, and is edited on one of them, the page at the caret: its frame comes from that page's
// furniture, placed in the page's content coordinates like a body drawing's.

import type { ViewScope } from '../contracts/editor.ts';
import { furnitureTextboxDrawingsOnPage } from '../layout/furniture-textbox-records.ts';
import {
  findDrawingOverlayFrameInLayout,
  type DrawingOverlayFrame,
} from '../layout/semantic-hit-test.ts';
import type { SemanticLayout } from '../layout/semantic-records.ts';
import type { AnchoredDrawingRecord, InlineDrawingRecord } from '../layout/drawing-layout.ts';

/** The overlay frame of the text box `scope` edits, with the caret on page `caretPage`. */
export function editedTextboxOverlayFrame(
  layout: SemanticLayout,
  scope: Extract<ViewScope, { kind: 'frame' }>,
  caretPage: number
): DrawingOverlayFrame | null {
  if (!scope.owner) return findDrawingOverlayFrameInLayout(layout, scope.drawingNodeId);
  const at = layout.pages[caretPage];
  const pages = at?.index === caretPage ? [at, ...layout.pages] : layout.pages;
  for (const page of pages) {
    const found = furnitureTextboxDrawingsOnPage(page).find(
      (record) => record.drawing.drawingNodeId === scope.drawingNodeId
    );
    if (!found) continue;
    const { drawing, origin } = found;
    const bounds = drawing.paintBounds;
    if (bounds.width <= 0 || bounds.height <= 0) return null;
    return Object.freeze({
      pageIndex: page.index,
      x: origin.x + bounds.x - drawing.x,
      y: origin.y + bounds.y - drawing.y,
      width: bounds.width,
      height: bounds.height,
      record: drawing,
    });
  }
  return null;
}

/**
 * `{ textEditable }` for a text box drawing: false when its text takes no caret (rotated or
 * vertical text, or a story holding a table). Nothing for any other drawing.
 */
export function textboxTextEditable(record: InlineDrawingRecord | AnchoredDrawingRecord): {
  readonly textEditable?: boolean;
} {
  const story = record.textboxStory;
  if (!story) return {};
  return {
    textEditable:
      record.transform.rotationDegrees === 0 &&
      story.contentRotation === undefined &&
      story.fragments.every((fragment) => fragment.kind === 'paragraph'),
  };
}
