import { useCallback } from 'react';
import type { PagedEditorRef } from '../PagedEditor';
import type { InlineHeaderFooterEditorRef } from '../../InlineHeaderFooterEditor';

/**
 * Bundles the four "active editor" routing helpers — every callback
 * that needs to dispatch into PM checks whether the inline header/footer
 * editor is open and forwards to that view instead of the body's
 * PagedEditor. Keeps the routing rule in one place so callers don't
 * have to repeat the `hfEditPosition && hfEditorRef.current ? hf : body`
 * check.
 */
export function useActiveEditor({
  hfEditPosition,
  hfEditorRef,
  pagedEditorRef,
}: {
  hfEditPosition: 'header' | 'footer' | null;
  hfEditorRef: React.RefObject<InlineHeaderFooterEditorRef | null>;
  pagedEditorRef: React.RefObject<PagedEditorRef | null>;
}) {
  const getActiveEditorView = useCallback(() => {
    if (hfEditPosition && hfEditorRef.current) {
      return hfEditorRef.current.getView();
    }
    return pagedEditorRef.current?.getView();
  }, [hfEditPosition, hfEditorRef, pagedEditorRef]);

  const focusActiveEditor = useCallback(() => {
    if (hfEditPosition && hfEditorRef.current) {
      hfEditorRef.current.focus();
    } else {
      pagedEditorRef.current?.focus();
    }
  }, [hfEditPosition, hfEditorRef, pagedEditorRef]);

  const undoActiveEditor = useCallback(() => {
    if (hfEditPosition && hfEditorRef.current) {
      hfEditorRef.current.undo();
    } else {
      pagedEditorRef.current?.undo();
    }
  }, [hfEditPosition, hfEditorRef, pagedEditorRef]);

  const redoActiveEditor = useCallback(() => {
    if (hfEditPosition && hfEditorRef.current) {
      hfEditorRef.current.redo();
    } else {
      pagedEditorRef.current?.redo();
    }
  }, [hfEditPosition, hfEditorRef, pagedEditorRef]);

  return { getActiveEditorView, focusActiveEditor, undoActiveEditor, redoActiveEditor };
}
