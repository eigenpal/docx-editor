import type { DrawingSelectionIntent } from './paginated-surface.ts';
import type { PaginatedSurface } from './paginated-surface.ts';
import type { createTextboxEditing } from './surface-textbox-editing.ts';
import { resolveSelectedDrawingRecord } from './docx-editor-images.ts';
import { textboxDrawingOnPage } from '../layout/textbox-drawing-records.ts';
import { isElementNode, isInputEvent, isKeyboardEvent, isPointerEvent } from './host-realm.ts';
import { MULTI_CLICK_MS, MULTI_CLICK_SLOP_PX } from './surface-multi-click.ts';

const NON_DESELECTING_KEYS = new Set([
  'Shift',
  'Control',
  'Alt',
  'Meta',
  'CapsLock',
  'NumLock',
  'ScrollLock',
  'ContextMenu',
]);

/**
 * Presses a text box took: the pointer must not read them as presses on the header or footer
 * under the box, because the box is found by geometry when its story paints inert.
 */
const textboxPresses = new WeakSet<Event>();

/** Whether the text box gesture already took this press. */
export function pressTakenByTextbox(event: Event): boolean {
  return textboxPresses.has(event);
}

/** Capture object selection before the text keymap receives the same gesture. */
export function createDrawingGestures(deps: {
  surface: PaginatedSurface;
  textbox(): ReturnType<typeof createTextboxEditing> | null;
  intent(): DrawingSelectionIntent;
  setIntent(intent: DrawingSelectionIntent): void;
}) {
  /** The last press, for telling a double press: a pointer press carries no click count. */
  let lastPress: { time: number; x: number; y: number } | null = null;
  const pressOf = (event: Event) => {
    if (!isPointerEvent(event)) return undefined;
    const { clientX: x, clientY: y } = event;
    // Wall-clock time, as the pointer counts clicks: event time stamps are not one clock.
    const time = Date.now();
    const since = lastPress === null ? -1 : time - lastPress.time;
    const double =
      lastPress !== null &&
      since >= 0 &&
      since <= MULTI_CLICK_MS &&
      Math.abs(x - lastPress.x) <= MULTI_CLICK_SLOP_PX &&
      Math.abs(y - lastPress.y) <= MULTI_CLICK_SLOP_PX;
    lastPress = double ? null : { time, x, y };
    return { clientX: x, clientY: y, double };
  };
  /** Select a drawing as an object, as a press on its border does. */
  const selectObject = (drawingNodeId: string, paragraphId: string): boolean => {
    if (!deps.surface.selectDrawing(drawingNodeId, paragraphId)) return false;
    deps.setIntent({ kind: 'pointer', drawingNodeId });
    return true;
  };
  return {
    onDrawingPointerGesture(event: Event): void {
      if (isPointerEvent(event) && event.button !== 0) return;
      // Viewing selects no object, exactly as it places no caret.
      if (deps.surface.editingMode() === 'view') return;
      const element = isElementNode(event.target) ? event.target : null;
      const editingTextbox = deps.textbox()?.preparePointer(element, pressOf(event));
      if (editingTextbox) textboxPresses.add(event);
      // A header or footer box whose text takes no caret is selected as an object instead, so
      // the press shows which box it reached rather than opening its story somewhere else.
      const refused = editingTextbox ? null : deps.textbox()?.takeRefusedPress();
      if (refused && selectObject(refused.drawingNodeId, refused.hostParagraphId)) {
        textboxPresses.add(event);
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      const drawingId =
        !editingTextbox &&
        element
          ?.closest<HTMLElement>('[data-drawing-node-id]')
          ?.getAttribute('data-drawing-node-id');
      if (drawingId && element?.closest('.docx-drawing-textbox')) {
        // Body boxes only: a header or footer box selects through its own story scope.
        let drawing;
        for (const page of deps.surface.layout().pages) {
          drawing = textboxDrawingOnPage(page, drawingId);
          if (drawing) break;
        }
        // A textbox can extend outside the body column. Its border selects its anchor,
        // even when ordinary text hit testing would land on a nearby body paragraph.
        if (drawing && selectObject(drawingId, drawing.paragraphId)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
      }
      deps.setIntent(drawingId ? { kind: 'pointer', drawingNodeId: drawingId } : { kind: 'none' });
    },
    onDrawingKeyGesture(event: Event): void {
      if (isKeyboardEvent(event) && NON_DESELECTING_KEYS.has(event.key)) return;
      const textbox = deps.textbox();
      const editing = textbox?.active();
      // Escape leaves the box with the box selected as an object, so Delete or a drag acts on
      // it next; a second Escape then leaves the header or footer the box is in.
      if (isKeyboardEvent(event) && event.key === 'Escape' && editing) {
        textbox!.exit();
        selectObject(editing.drawingNodeId, editing.hostParagraphId);
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      // Enter on a selected text box enters its text, the keyboard way into a box.
      const plainEnter =
        isKeyboardEvent(event) &&
        event.key === 'Enter' &&
        !event.shiftKey &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey;
      const selected = deps.intent();
      if (
        plainEnter &&
        !editing &&
        selected.kind === 'pointer' &&
        textbox?.enterDrawing(selected.drawingNodeId)
      ) {
        deps.setIntent({ kind: 'none' });
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      const deleteKey =
        (isKeyboardEvent(event) &&
          (event.key === 'Delete' || event.key === 'Backspace') &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey) ||
        (isInputEvent(event) &&
          (event.inputType === 'deleteContentBackward' ||
            event.inputType === 'deleteContentForward'));
      if (deleteKey && deps.intent().kind === 'pointer') {
        const target = resolveSelectedDrawingRecord(deps.surface);
        if (target !== null) {
          event.preventDefault();
          event.stopImmediatePropagation();
          deps.setIntent({ kind: 'none' });
          deps.surface.deleteImage(target.drawingNodeId);
          return;
        }
      }
      deps.setIntent({ kind: 'none' });
    },
  };
}
