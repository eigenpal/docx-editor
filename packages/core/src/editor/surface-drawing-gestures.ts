import type { DrawingSelectionIntent } from './paginated-surface.ts';
import type { PaginatedSurface } from './paginated-surface.ts';
import type { createTextboxEditing } from './surface-textbox-editing.ts';
import { resolveSelectedDrawingRecord } from './docx-editor-images.ts';
import { textboxDrawingOnPage } from '../layout/textbox-drawing-records.ts';
import { isElementNode, isInputEvent, isKeyboardEvent, isPointerEvent } from './host-realm.ts';

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

/** Capture object selection before the text keymap receives the same gesture. */
export function createDrawingGestures(deps: {
  surface: PaginatedSurface;
  textbox(): ReturnType<typeof createTextboxEditing> | null;
  intent(): DrawingSelectionIntent;
  setIntent(intent: DrawingSelectionIntent): void;
}) {
  return {
    onDrawingPointerGesture(event: Event): void {
      if (isPointerEvent(event) && event.button !== 0) return;
      // Viewing selects no object, exactly as it places no caret.
      if (deps.surface.editingMode() === 'view') return;
      const element = isElementNode(event.target) ? event.target : null;
      const editingTextbox = deps.textbox()?.preparePointer(element);
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
        if (drawing && deps.surface.selectDrawing(drawingId, drawing.paragraphId)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
      }
      deps.setIntent(drawingId ? { kind: 'pointer', drawingNodeId: drawingId } : { kind: 'none' });
    },
    onDrawingKeyGesture(event: Event): void {
      if (isKeyboardEvent(event) && NON_DESELECTING_KEYS.has(event.key)) return;
      if (isKeyboardEvent(event) && event.key === 'Escape' && deps.textbox()?.active()) {
        deps.textbox()!.exit();
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
