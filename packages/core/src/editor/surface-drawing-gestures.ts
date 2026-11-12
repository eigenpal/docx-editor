import type { DrawingSelectionIntent } from './paginated-surface.ts';
import type { PaginatedSurface } from './paginated-surface.ts';
import type { createTextboxEditing } from './surface-textbox-editing.ts';
import { resolveSelectedDrawingRecord, selectedImageStateOf } from './docx-editor-images.ts';
import { textboxDrawingOnPage } from '../layout/textbox-drawing-records.ts';
import { isElementNode, isInputEvent, isKeyboardEvent, isPointerEvent } from './host-realm.ts';
import { MULTI_CLICK_MS, MULTI_CLICK_SLOP_PX } from './surface-multi-click.ts';

/** Ctrl or Command with C or X, and Ctrl or Shift with Insert or Delete: copy and cut. */
function isClipboardChord(event: KeyboardEvent): boolean {
  if (event.altKey) return false;
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && (key === 'c' || key === 'x'))
    return true;
  return (
    (event.ctrlKey && key === 'insert') || (event.shiftKey && !event.ctrlKey && key === 'delete')
  );
}

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
  /**
   * Move the open header or footer's edit to another page that shows it, as a press on that
   * page's band does: no scroll, so the page under the pointer stays put.
   */
  enterStoryPage(pageIndex: number): void;
  /** The body drawing behind the text a press at a client point reaches, if any. */
  behindDrawingAt(
    clientX: number,
    clientY: number
  ): {
    readonly drawingNodeId: string;
    readonly paragraphId: string;
    /** The page the drawing is on, for a drawing of an open header or footer. */
    readonly pageIndex?: number;
  } | null;
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
  const pointOf = (event: PointerEvent) => deps.surface.pointAt(event.clientX, event.clientY);
  /**
   * An open header or footer repeats on every page it heads. A press on its drawing on another
   * page moves the edit to that page, as a press on that page's band does, so the frame shows
   * where the press landed. A drawing that does not select (select-locked) moves nothing.
   */
  const followPage = (drawingNodeId: string, paragraphId: string, pageIndex?: number) => {
    if (deps.surface.activeScope().kind !== 'headerFooter' || pageIndex === undefined) return;
    if (pageIndex === deps.surface.currentPage('caret') - 1) return;
    // `selectDrawing` takes a locked drawing too; the lock applies in the selected state.
    if (!deps.surface.selectDrawing(drawingNodeId, paragraphId)) return;
    if (!selectedImageStateOf(deps.surface)) return;
    deps.enterStoryPage(pageIndex);
  };
  /** The behind-text drawing a press reaches where no text lies under it, if any. */
  const behindDrawingAt = (event: Event) =>
    isPointerEvent(event) && !event.shiftKey
      ? deps.behindDrawingAt(event.clientX, event.clientY)
      : null;
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
      // A drawing behind the text paints under it, so the press reaches the text layer. Where
      // no glyph lies under the press, the drawing takes it, as hit testing decides.
      // One the selection model refuses (hidden, select-locked) leaves the press to the text.
      const behind = !editingTextbox && !drawingId ? behindDrawingAt(event) : null;
      if (behind) followPage(behind.drawingNodeId, behind.paragraphId, behind.pageIndex);
      if (behind && selectObject(behind.drawingNodeId, behind.paragraphId)) {
        if (selectedImageStateOf(deps.surface)) {
          deps.surface.focus();
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
      }
      // The painted box of a shape is wider than what it paints: a press beside a line, or
      // inside a shape with no fill, is on the text, as hit testing decides.
      const point = drawingId && isPointerEvent(event) ? pointOf(event) : null;
      const reached = !point || point.hit.drawing?.drawingNodeId === drawingId;
      if (drawingId && reached && point?.hit.drawing) {
        followPage(drawingId, point.hit.drawing.paragraphId, point.hit.pageIndex);
      }
      deps.setIntent(
        drawingId && reached ? { kind: 'pointer', drawingNodeId: drawingId } : { kind: 'none' }
      );
    },
    onDrawingKeyGesture(event: Event): void {
      if (isKeyboardEvent(event) && NON_DESELECTING_KEYS.has(event.key)) return;
      // Copy and cut act on the selected object: the clipboard event that follows the chord
      // needs the object still selected to copy or cut it.
      if (isKeyboardEvent(event) && isClipboardChord(event)) return;
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
