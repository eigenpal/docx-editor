/**
 * Header/footer editing: double-click to enter, click out to leave, save, remove.
 *
 * PORTED from the legacy hook of the same name. The workflow is legacy's — double-click
 * the header band to edit it, clicking in the body leaves, and a header the section does
 * not have yet is MATERIALISED on that first double-click so the user can start typing
 * rather than being told there is nothing there.
 *
 * Legacy did the materialising itself: it wrote a new `HeaderFooter` into
 * `package.headers`/`package.footers` and registered the relationship so the serializer
 * would pick it up. That is package surgery, and it belongs in the engine — so
 * `editHeaderFooter` carries the intent and the engine decides whether it is creating or
 * opening one. `exitHeaderFooter` and `removeHeaderFooter` join it.
 *
 * Which region is open comes from `getHeaderFooterState`, a stub returning null, so
 * every path here exits early today: a double-click reports refused, nothing opens, and
 * the body stays the active scope. The workflow is wired so that filling in that one
 * capability plus the three commands lights it up without touching this file.
 */
import { useCallback } from 'react';
import type { Editor } from '@docx-editor.dev/core-contract/contracts/editor';

export function useHeaderFooterEditing({
  editorRef,
  hfEditPosition,
  setHfEditPosition,
  hfEditIsFirstPage,
  setHfEditIsFirstPage,
}: {
  editorRef: React.RefObject<Editor | null>;
  // State and setters live in the caller because the active-editor routing, declared
  // before this hook runs, reads `hfEditPosition`. Legacy's arrangement, kept.
  hfEditPosition: 'header' | 'footer' | null;
  setHfEditPosition: React.Dispatch<React.SetStateAction<'header' | 'footer' | null>>;
  hfEditIsFirstPage: boolean;
  setHfEditIsFirstPage: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  /** Which region the engine says is open, if any. */
  const activeHf = editorRef.current?.getHeaderFooterState() ?? null;

  const handleHeaderFooterDoubleClick = useCallback(
    (position: 'header' | 'footer', firstPage = false) => {
      // No scroll-to-page-1: header/footer content is shared across pages, so the region
      // under the pointer is the one to edit. Legacy's note, and it still holds.
      const result = editorRef.current?.exec({
        type: 'editHeaderFooter',
        position,
        firstPage,
      });
      if (!result?.ok) return;
      setHfEditPosition(position);
      setHfEditIsFirstPage(firstPage);
    },
    [editorRef, setHfEditPosition, setHfEditIsFirstPage]
  );

  /** Clicking in the body leaves header/footer editing. */
  const handleBodyClick = useCallback(() => {
    if (hfEditPosition === null) return;
    editorRef.current?.exec({ type: 'exitHeaderFooter' });
    setHfEditPosition(null);
    setHfEditIsFirstPage(false);
  }, [editorRef, hfEditPosition, setHfEditPosition, setHfEditIsFirstPage]);

  /**
   * Legacy serialized the inline editor's content back into the document here. The
   * engine edits the header story in place through the same command surface as the body,
   * so there is nothing to hand back — leaving IS saving.
   */
  const handleHeaderFooterSave = useCallback(() => {
    handleBodyClick();
  }, [handleBodyClick]);

  const handleRemoveHeaderFooter = useCallback(
    (position: 'header' | 'footer') => {
      const result = editorRef.current?.exec({
        type: 'removeHeaderFooter',
        position,
        firstPage: hfEditIsFirstPage,
      });
      if (!result?.ok) return;
      setHfEditPosition(null);
      setHfEditIsFirstPage(false);
    },
    [editorRef, hfEditIsFirstPage, setHfEditPosition, setHfEditIsFirstPage]
  );

  return {
    activeHf,
    handleHeaderFooterDoubleClick,
    handleHeaderFooterSave,
    handleBodyClick,
    handleRemoveHeaderFooter,
  };
}
