import type { Editor } from '../contracts/editor.ts';
import type { DocxEditorInstance } from './docx-editor.ts';
import { resolveSelectedDrawingRecord } from './docx-editor-images.ts';
import { hostDocumentOf, hostWindowOf, isElementNode } from './host-realm.ts';

/** How long a frame lets a tap through to the text under it, in milliseconds. */
const TAP_PASS_THROUGH_MS = 800;

/**
 * Hands a press on the selected drawing's frame to the text under it.
 *
 * A drawing behind the text paints under it, and its frame covers that text. Where the press
 * lands in a line of text, the text takes it and places the caret, as it does while the
 * drawing is not selected. Elsewhere the frame keeps the press, to move the drawing. Adapters
 * call this first in the frame's `pointerdown` handler.
 *
 * A mouse or pen press goes on to the element under the frame. A touch press is not taken:
 * the frame lets the tap through for its duration, so the browser's own tap reaches the text.
 *
 * @returns True when the text takes the press; the frame then starts no move.
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
  const frame = isElementNode(event.target) ? event.target : null;
  if (!frame) return false;
  if (event.pointerType === 'touch') {
    letTapThrough(frame);
    return true;
  }
  const overlay = frame.closest('.docx-image-selection-overlay') ?? frame;
  const pages = surface.hostElement().querySelector<HTMLElement>(':scope > .docx-pages');
  if (!pages) return false;
  // The element under the frame, so the pointer's own target checks (furniture, note
  // references, control widgets) see the press as if the frame were not there.
  const under =
    hostDocumentOf(frame)
      .elementsFromPoint?.(event.clientX, event.clientY)
      .find((element) => !overlay.contains(element) && pages.contains(element)) ?? pages;
  event.preventDefault();
  event.stopPropagation();
  const PointerEventOfHost = hostWindowOf(under).PointerEvent;
  under.dispatchEvent(
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

/** Let the rest of this tap (its compatibility mouse events and click) pass the frame. */
function letTapThrough(frame: Element): void {
  if (!(frame as HTMLElement).style) return;
  const style = (frame as HTMLElement).style;
  const previous = style.pointerEvents;
  style.pointerEvents = 'none';
  const view = hostWindowOf(frame);
  const restore = () => {
    style.pointerEvents = previous;
    view.removeEventListener('click', restore, true);
  };
  view.addEventListener('click', restore, true);
  view.setTimeout(restore, TAP_PASS_THROUGH_MS);
}
