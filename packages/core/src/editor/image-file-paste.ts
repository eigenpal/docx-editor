// The host image-FILE paste lane, from the painted pages and the drawing selection overlay.
//
// `imageFilePastePlan` decides whether the lane takes a paste and where the picture goes: the
// caret in text, or, while a drawing is selected, the point `drawingPastePoint` gives for a
// picture. `runImageFilePaste` runs the lane for one paste event and returns focus to the
// text after a picture lands at a drawing. Kept apart from `clipboard-file-lane.ts`, the
// stand-down predicates, so the drop lane does not pull in the facade or the chrome.

import { clipboardPasteLandsContent } from './clipboard-file-lane.ts';
import { drawingPastePoint } from './drawing-paste-target.ts';
import { capturePointPosition } from './editor-point-target.ts';
import { refusesPictureBesideDrawing } from './docx-editor-images.ts';
import { resolveSelectedDrawingRecord } from './selected-drawing-record.ts';
import { IMAGE_INSERT_PROBE } from './toolbar-commands.ts';
import { reportCommandResult } from './command-reporting.ts';
import type { EditorPointPosition } from '../contracts/editor-drop.ts';
import type { CanResult } from '../contracts/editor.ts';
import type { DocxEditorInstance } from './docx-editor-types.ts';

function carriesImageFile(transfer: DataTransfer): boolean {
  const items = transfer.items as DataTransferItemList | undefined;
  if (!items) return false;
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (item?.kind === 'file' && item.type.startsWith('image/')) return true;
  }
  return false;
}

/**
 * What a host's image-FILE paste lane does with one paste event.
 *
 * @internal
 */
export interface ImageFilePastePlan {
  /**
   * The `insertImage.at` point. A point is the drawing paste point while a drawing is
   * selected. Undefined inserts at the caret, as `insertImage` does with no point.
   */
  readonly at: EditorPointPosition | undefined;
  /**
   * The editor's refusal of the picture, when the lane takes the paste only to report it:
   * in suggesting mode while a drawing is selected. The lane then reads no file, so a
   * selection change during a read cannot turn the refusal into an insert.
   */
  readonly refusal?: Extract<CanResult, { ok: false }>;
}

/**
 * Whether a host's image-FILE lane takes this paste, and where the picture goes. Null means
 * stand down: no image file, content the engine lands itself (see
 * {@link clipboardPasteLandsContent}), an insert the editor refuses outside the case below,
 * or a document open for viewing. A paste the lane stands down from stays
 * silent, as a refused paste in text does.
 *
 * With the caret in text, the picture lands at the caret. With a drawing selected, it lands
 * where every pasted drawing lands, `drawingPastePoint(surface)`: before the selected
 * drawing's anchor run. That point is captured, and stays valid only while the document keeps
 * the same revision, so a slow file read cannot insert into changed content; an insert into
 * changed content reports its stale-target reason. In suggesting mode the editor refuses a
 * picture while a drawing is selected (`PICTURE_SELECTED_INSERT_REASON`). The lane still takes
 * that paste, and the plan carries the editor's refusal unchanged, so the lane reports it
 * without a file read.
 *
 * @internal
 */
export function imageFilePastePlan(
  editor: Pick<DocxEditorInstance, 'surface' | 'canExecuteImageCommand'>,
  transfer: DataTransfer | null | undefined
): ImageFilePastePlan | null {
  if (!transfer || !carriesImageFile(transfer)) return null;
  if (clipboardPasteLandsContent(transfer)) return null;
  const surface = editor.surface;
  if (!surface) return null;
  // The probe the toolbar's picture insert runs, with no point, so the editor applies its own
  // rules for a picture inserted while a drawing is selected.
  const judged = editor.canExecuteImageCommand(IMAGE_INSERT_PROBE);
  const point = drawingPastePoint(surface);
  if (!judged.ok) {
    return refusesPictureBesideDrawing(surface) ? { at: undefined, refusal: judged } : null;
  }
  return { at: point ? capturePointPosition(surface, point) : undefined };
}

/** The selection overlay, which an insert beside its drawing ends. */
const OVERLAY_SELECTOR = '.docx-image-selection-overlay';

/**
 * Whether the keyboard returns to the text after a picture lands at a drawing: focus is
 * nowhere, on a removed element, or still on the drawing's selection overlay. Focus that the
 * reader moved somewhere else during the file read stays there.
 */
function focusReturnsToText(ownerDocument: Document): boolean {
  const active = ownerDocument.activeElement;
  return (
    !active ||
    active === ownerDocument.body ||
    !active.isConnected ||
    active.closest(OVERLAY_SELECTOR) !== null
  );
}

/** The selected drawing's node id, or null when no drawing is selected. */
function selectedDrawingId(editor: Pick<DocxEditorInstance, 'surface'>): string | null {
  const surface = editor.surface;
  return surface && drawingPastePoint(surface)
    ? (resolveSelectedDrawingRecord(surface)?.drawingNodeId ?? null)
    : null;
}

/**
 * Report a picture insert that threw instead of returning a refusal, so a paste or a drop
 * handler never leaves an unhandled rejection. A refusal is not a failure: the insert shows it.
 *
 * @internal
 */
export function reportImageInsertFailure(error: unknown): void {
  console.error('[docx-editor] The image could not be inserted.', error);
}

/**
 * Run a host's image-FILE paste lane for one paste event, from the pages or from the drawing
 * selection overlay. Null when the lane stands down ({@link imageFilePastePlan}); the event is
 * then left to the engine. Otherwise the event's default is prevented, `insert` reads the file
 * and inserts it, and the returned promise settles after it. `insert` must read the transfer
 * before its first await, while the clipboard is still readable. For a plan that carries a
 * refusal, the lane reads no file: it reports the refusal to the editor's diagnostics and
 * passes the reason to `refuse`, for the host to show.
 *
 * After a picture lands at a selected drawing, the selection ends and the focused overlay
 * unmounts with it, so the text takes the keyboard, as after a paste of a copied drawing. So
 * does a collaborator's removal of the drawing during the read. Any other refused insert, or a
 * failed one, leaves focus where it is. A throw is reported, never rethrown.
 *
 * @internal
 */
export function runImageFilePaste(
  editor: Pick<DocxEditorInstance, 'surface' | 'canExecuteImageCommand' | 'focus'>,
  event: ClipboardEvent,
  insert: (transfer: DataTransfer, at: EditorPointPosition | undefined) => Promise<unknown>,
  refuse: (reason: string) => void
): Promise<void> | null {
  const transfer = event.clipboardData;
  const plan = transfer ? imageFilePastePlan(editor, transfer) : null;
  if (!transfer || !plan) return null;
  event.preventDefault();
  if (plan.refusal !== undefined) {
    reportCommandResult(editor, IMAGE_INSERT_PROBE, plan.refusal);
    refuse(plan.refusal.reason);
    return Promise.resolve();
  }
  const ownerDocument = (event.target as Node | null)?.ownerDocument ?? null;
  const selected = selectedDrawingId(editor);
  return insert(transfer, plan.at).then(() => {
    // The selected drawing changes when the picture lands. The selection also ends when a
    // collaborator removes the drawing during the read, which refuses the insert. Either way
    // the overlay unmounts, so the text takes the keyboard. Any other refusal keeps the same
    // drawing selected, and focus stays where it is.
    const selectionEnded = selectedDrawingId(editor) !== selected;
    if (plan.at && selectionEnded && ownerDocument && focusReturnsToText(ownerDocument)) {
      editor.focus();
    }
  }, reportImageInsertFailure);
}
