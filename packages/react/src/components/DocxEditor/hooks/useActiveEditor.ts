/**
 * The four "active editor" routing helpers.
 *
 * PORTED from the legacy hook of the same name. Legacy existed because there were TWO
 * editor views — the body's and the inline header/footer one — and every callback had to
 * repeat `hfEditPosition && hfEditorRef.current ? hf : body` before dispatching. It kept
 * that rule in one place.
 *
 * The engine has one editor addressed by SCOPE, so the routing rule becomes "which scope
 * is active" and the branch disappears: `focus`, `undo` and `redo` already act on the
 * active scope. `getActiveEditorView` is deliberately NOT ported — it returned a
 * ProseMirror view, which this adapter must not name; `getActiveScope` answers the same
 * question in the engine's own terms.
 *
 * This hook is why the orchestrator no longer repeats
 * `focusActiveEditor: () => editorRef.current?.focus()` at each call site.
 */
import { useCallback } from 'react';
import type { Editor, ViewScope } from '@docx-editor.dev/core-contract/contracts/editor';

export function useActiveEditor({
  hfEditPosition,
  editorRef,
}: {
  /** Which header/footer region is being edited, or null for the body. */
  hfEditPosition: 'header' | 'footer' | null;
  editorRef: React.RefObject<Editor | null>;
}) {
  const getActiveScope = useCallback((): ViewScope => {
    // A header/footer scope is addressed by its relationship id, which the engine hands
    // out when header/footer editing opens. `getHeaderFooterState` is a stub returning
    // null, so there is no rId to name and the body stays the active scope — the honest
    // answer while header/footer editing has no engine support.
    return { kind: 'body' };
  }, []);

  const focusActiveEditor = useCallback(() => {
    editorRef.current?.focus(getActiveScope());
  }, [editorRef, getActiveScope]);

  const undoActiveEditor = useCallback(() => {
    editorRef.current?.exec({ type: 'undo' }, { scope: getActiveScope() });
  }, [editorRef, getActiveScope]);

  const redoActiveEditor = useCallback(() => {
    editorRef.current?.exec({ type: 'redo' }, { scope: getActiveScope() });
  }, [editorRef, getActiveScope]);

  // `hfEditPosition` is accepted so the signature matches legacy's and so the routing
  // rule has somewhere to land the moment header/footer scopes are addressable.
  void hfEditPosition;

  return { getActiveScope, focusActiveEditor, undoActiveEditor, redoActiveEditor };
}
