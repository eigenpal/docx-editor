import type { Editor } from '../contracts/editor.ts';
import type { DocxEditorInstance } from './docx-editor.ts';
import { resolveSelectedDrawingRecord } from './docx-editor-images.ts';
import { hostWindowOf } from './host-realm.ts';

/**
 * Hands a press on the selected drawing's frame to the text under it.
 *
 * A drawing behind the text paints under it, and its frame covers that text. Where a glyph
 * lies under the press, the text takes it and places the caret, as it does while the drawing
 * is not selected. Where no glyph lies under it, the frame keeps the press, to move the
 * drawing. Adapters call this first in the frame's `pointerdown` handler.
 *
 * @returns True when the text took the press; the frame then starts no move.
 * @public
 */
export function passDrawingFramePressToText(editor: Editor, event: PointerEvent): boolean {
  const surface = (editor as DocxEditorInstance).surface;
  if (!surface || event.button !== 0 || event.shiftKey) return false;
  const record = resolveSelectedDrawingRecord(surface);
  if (!record || record.kind !== 'anchoredDrawing' || !record.behindDocument) return false;
  const point = surface.pointAt(event.clientX, event.clientY);
  // Off the body text, as in a page margin, or where the drawing wins the hit: a move.
  if (!point || point.hit.drawing?.drawingNodeId === record.drawingNodeId) return false;
  const pages = surface.hostElement().querySelector<HTMLElement>(':scope > .docx-pages');
  if (!pages) return false;
  event.preventDefault();
  event.stopPropagation();
  // The same press, on the pages under the frame: the text pointer places the caret from its
  // coordinates and captures the pointer from there.
  const PointerEventOfHost = hostWindowOf(pages).PointerEvent;
  pages.dispatchEvent(
    new PointerEventOfHost('pointerdown', {
      bubbles: true,
      cancelable: true,
      composed: true,
      button: event.button,
      buttons: event.buttons,
      detail: event.detail,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      isPrimary: event.isPrimary,
      clientX: event.clientX,
      clientY: event.clientY,
      screenX: event.screenX,
      screenY: event.screenY,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
    })
  );
  return true;
}
