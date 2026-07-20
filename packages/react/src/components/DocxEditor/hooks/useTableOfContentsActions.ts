import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { updateTableOfContents } from '@docx-editor.dev/core/prosemirror';
import type { PageLayout } from '@docx-editor.dev/core/pagination-model';
import type { PagedEditorRef } from '../PagedEditor';

function readPageLayout(pagedEditorRef: RefObject<PagedEditorRef | null>): PageLayout | null {
  // Runtime getLayout() returns the full PageLayout; the public ref type only
  // exposes page number/size. Cast for TOC page-number resolution.
  return (pagedEditorRef.current?.getLayout() as PageLayout | null | undefined) ?? null;
}

export function useTableOfContentsActions({
  pagedEditorRef,
}: {
  pagedEditorRef: RefObject<PagedEditorRef | null>;
}) {
  const secondPassRequestedRef = useRef(false);
  const secondPassPositionRef = useRef<number | null | undefined>(undefined);
  const secondPassTimerRef = useRef<number | null>(null);

  const runPendingSecondPass = useCallback(() => {
    if (!secondPassRequestedRef.current) return;
    const view = pagedEditorRef.current?.getView();
    const layout = readPageLayout(pagedEditorRef);
    if (!view || !layout) return;
    secondPassRequestedRef.current = false;
    const position = secondPassPositionRef.current;
    secondPassPositionRef.current = undefined;
    updateTableOfContents(view.state, view.dispatch, { layout, position, force: position != null });
  }, [pagedEditorRef]);

  const requestSecondPass = useCallback(
    (position?: number | null) => {
      secondPassRequestedRef.current = true;
      secondPassPositionRef.current = position;
      if (secondPassTimerRef.current != null) {
        window.clearTimeout(secondPassTimerRef.current);
      }
      secondPassTimerRef.current = window.setTimeout(() => {
        secondPassTimerRef.current = null;
        requestAnimationFrame(runPendingSecondPass);
      }, 120);
    },
    [runPendingSecondPass]
  );

  const updateToc = useCallback(
    (position?: number | null) => {
      const view = pagedEditorRef.current?.getView();
      if (!view) return false;
      const updated = updateTableOfContents(view.state, view.dispatch, {
        position,
        layout: readPageLayout(pagedEditorRef),
        force: position != null,
      });
      if (updated) requestSecondPass(position);
      return updated;
    },
    [pagedEditorRef, requestSecondPass]
  );

  const handleInserted = useCallback(() => {
    requestAnimationFrame(() => updateToc());
  }, [updateToc]);

  useEffect(
    () => () => {
      if (secondPassTimerRef.current != null) {
        window.clearTimeout(secondPassTimerRef.current);
      }
    },
    []
  );

  return {
    runPendingTocSecondPass: runPendingSecondPass,
    runTableOfContentsUpdate: updateToc,
    handleTableOfContentsInserted: handleInserted,
  };
}
