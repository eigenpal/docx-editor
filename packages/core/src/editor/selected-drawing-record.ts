// Which drawing the caret selects: the record of the inline or floating drawing that a pointer
// press or a host selection write chose, at the collapsed caret on its anchor. Image commands,
// paste lanes and overlays all ask this one question.

import { lineAtPosition } from '../layout/index.ts';
import { lineAtIndexedPosition, paragraphLinesFor } from '../layout/paragraph-lines.ts';
import type { AnchoredDrawingRecord, InlineDrawingRecord } from '../layout/drawing-layout.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';

/** The layout record of a selected drawing, inline or floating. */
export type SelectedDrawingRecord = InlineDrawingRecord | AnchoredDrawingRecord;

/**
 * Whether a record answers to this caret, and to the drawing the caller named.
 *
 * One paragraph can anchor several drawings, and they occupy ADJACENT offsets, so the offset
 * alone is ambiguous: the second box's anchor offset is also the first box's `start + 1`.
 * A named drawing therefore decides the tie, or the scan returns whichever came first and the
 * caller can never address the rest.
 */
function drawingAnswersTo(
  drawing: Pick<InlineDrawingRecord, 'drawingNodeId' | 'start' | 'accessibility'>,
  offset: number,
  wanted: string | null
): boolean {
  // A hidden record (an MC wrap footprint) holds layout space only; nothing can select it.
  if (drawing.accessibility.hidden) return false;
  if (wanted !== null && drawing.drawingNodeId !== wanted) return false;
  return drawing.start === offset || drawing.start + 1 === offset;
}

function inlineDrawingAtOffset(
  line: ReturnType<typeof lineAtPosition>,
  paragraphId: string,
  offset: number,
  wanted: string | null
): InlineDrawingRecord | null {
  if (!line) return null;
  for (const drawing of line.drawings ?? []) {
    // The PARAGRAPH as well as the offset. A resolved display mode draws two paragraphs on
    // the join line and both count from zero, so an offset alone selected the other half's
    // image — and every later command addressed that one.
    if (drawing.paragraphId !== paragraphId) continue;
    if (drawingAnswersTo(drawing, offset, wanted)) return drawing;
  }
  return null;
}

/**
 * The named inline drawing when it starts the next line. A drawing that does not fit after the
 * text wraps, and its anchor offset is also the end of the line before it, which the offset
 * lookup finds first.
 */
function namedDrawingOnOtherLine(
  surface: PaginatedSurface,
  paragraphId: string,
  offset: number,
  wanted: string | null
): InlineDrawingRecord | null {
  if (!wanted) return null;
  for (const placed of paragraphLinesFor(surface.layout(), paragraphId)) {
    const found = inlineDrawingAtOffset(placed.line, paragraphId, offset, wanted);
    if (found) return found;
  }
  return null;
}

function anchoredDrawingAtSelection(
  surface: PaginatedSurface,
  paragraphId: string,
  offset: number,
  wanted: string | null
): AnchoredDrawingRecord | null {
  const layout = surface.layout();
  for (const page of layout.pages) {
    for (const drawing of page.anchoredDrawings ?? []) {
      if (drawing.anchorParagraphId !== paragraphId) continue;
      if (drawingAnswersTo(drawing, offset, wanted)) return drawing;
    }
    for (const story of [page.header, page.footer]) {
      if (!story) continue;
      for (const drawing of story.anchoredDrawings ?? []) {
        if (drawing.anchorParagraphId !== paragraphId) continue;
        if (drawingAnswersTo(drawing, offset, wanted)) return drawing;
      }
    }
  }
  return null;
}

export function resolveSelectedDrawingRecord(
  surface: PaginatedSurface | null
): SelectedDrawingRecord | null {
  if (!surface) return null;
  // The rule: a caret at a drawing's anchor offset is a TEXT caret unless something
  // selected the object — a pointer press on the painted drawing, or an explicit host
  // selection write. The mount-time caret routinely coincides with a drawing anchored at
  // offset zero, and typing lands the caret at anchor+1; neither means "selected".
  const intent = surface.drawingSelectionIntent();
  if (intent.kind === 'none') return null;
  const { anchor, head } = surface.state().selection;
  if (anchor.paragraphId !== head.paragraphId || anchor.offset !== head.offset) return null;
  const line = lineAtIndexedPosition(surface.layout(), anchor.paragraphId, anchor.offset);
  // A press names its drawing, so a stale press can never claim a DIFFERENT drawing the caret
  // later visits (a find jump that lands at another anchor), and a paragraph anchoring several
  // drawings resolves to the named one rather than to the first.
  const wanted = intent.kind === 'pointer' ? intent.drawingNodeId : null;
  return (
    inlineDrawingAtOffset(line, anchor.paragraphId, anchor.offset, wanted) ??
    namedDrawingOnOtherLine(surface, anchor.paragraphId, anchor.offset, wanted) ??
    anchoredDrawingAtSelection(surface, anchor.paragraphId, anchor.offset, wanted)
  );
}
