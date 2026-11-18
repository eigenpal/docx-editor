// Clipboard events that reach focused editor chrome instead of the pages.
//
// The pages layer listens for copy, cut and paste. A selected picture, shape or text box moves
// focus to its selection overlay, so Cmd/Ctrl+C, X and V fire on the overlay and the browser
// ran its own copy there. Adapters bind the overlay here, and the same handlers the pages layer
// uses run its events.

import type { DocxEditorInstance } from './docx-editor-types.ts';
import { createClipboardHandlers } from './surface-input.ts';
import { resolveSelectedDrawingRecord } from './docx-editor-images.ts';

const CLIPBOARD_EVENTS = ['copy', 'cut', 'paste'] as const;

/**
 * Some browsers offer copy, cut and paste on an element that is not editable and holds no
 * selection only when its `before*` event is cancelled.
 */
const ENABLING_EVENTS = ['beforecopy', 'beforecut', 'beforepaste'] as const;

/**
 * Send the `copy`, `cut` and `paste` events of focused editor chrome, such as a drawing
 * selection overlay, to the editor, which runs them as the pages run them. A cut or paste that
 * ends the drawing selection gives the keyboard back to the text, as Delete does.
 *
 * Bind each focusable element that can hold focus while a drawing is selected. The listeners
 * read `editor.surface` at event time, so they follow a remount.
 *
 * @param element - The focusable chrome element.
 * @param editor - The editor that owns the selection.
 * @returns The function that removes the listeners.
 * @public
 */
export function forwardClipboardEvents(
  element: HTMLElement,
  editor: DocxEditorInstance
): () => void {
  const onClipboard = (event: Event): void => {
    const surface = editor.surface;
    if (!surface) return;
    const handlers = createClipboardHandlers(surface);
    const before = resolveSelectedDrawingRecord(surface);
    const clipboardEvent = event as ClipboardEvent;
    if (event.type === 'copy') handlers.onCopy(clipboardEvent);
    else if (event.type === 'cut') handlers.onCut(clipboardEvent);
    else handlers.onPaste(clipboardEvent);
    // The overlay unmounts with the selection; the text takes the keyboard before it does.
    if (before && !resolveSelectedDrawingRecord(surface)) editor.focus();
  };
  const enable = (event: Event): void => event.preventDefault();
  for (const type of CLIPBOARD_EVENTS) element.addEventListener(type, onClipboard);
  for (const type of ENABLING_EVENTS) element.addEventListener(type, enable);
  return () => {
    for (const type of CLIPBOARD_EVENTS) element.removeEventListener(type, onClipboard);
    for (const type of ENABLING_EVENTS) element.removeEventListener(type, enable);
  };
}
