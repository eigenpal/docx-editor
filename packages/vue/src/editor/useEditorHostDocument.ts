// The document the editor is mounted in, for chrome that listens or measures outside its own
// element.

import { shallowRef, watch, type ShallowRef } from 'vue';
import { editorHostDocument } from '@docx-editor.dev/core/editor';
import { useDocxEditor } from './context';

/** What {@link useEditorHostDocument} returns: a read-only ref to the host document. @public */
export type UseEditorHostDocumentReturn = Readonly<ShallowRef<Document | null>>;

/**
 * The document the editor's pages are mounted in: a pop-out window's or an iframe's when the
 * host attached the editor there, otherwise the page's own. `null` during server rendering.
 *
 * Custom chrome that adds document listeners, reads focus, or injects a `<style>` uses this
 * instead of the global `document`, which belongs to the window the script runs in. The value
 * changes when the editor moves to another window, so watchers keyed on it re-bind.
 * Its `defaultView` is the editor's window, for timers, viewport size and the clipboard.
 *
 * @example
 * ```ts
 * const hostDocument = useEditorHostDocument();
 * watch(hostDocument, (doc, _previous, onCleanup) => {
 *   if (!doc) return;
 *   doc.addEventListener('keydown', onShortcut);
 *   onCleanup(() => doc.removeEventListener('keydown', onShortcut));
 * }, { immediate: true });
 * ```
 *
 * @public
 */
export function useEditorHostDocument(): UseEditorHostDocumentReturn {
  const editorRef = useDocxEditor();
  const current = shallowRef<Document | null>(null);
  const read = (): void => {
    const editor = editorRef.value;
    current.value = editor
      ? editorHostDocument(editor)
      : typeof globalThis.document === 'undefined'
        ? null
        : globalThis.document;
  };
  watch(
    () => editorRef.value,
    (editor, _previous, onCleanup) => {
      read();
      if (!editor) return;
      onCleanup(editor.on('hostChange', read));
    },
    { immediate: true, flush: 'post' }
  );
  return current;
}
