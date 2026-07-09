import { useCallback, useEffect, useRef, type RefObject } from 'react';
import {
  hasTableOfContentsNeedingUpdate,
  updateTableOfContents,
} from '@eigenpal/docx-editor-core/prosemirror';
import type { Translations } from '@eigenpal/docx-editor-i18n';
import type { PagedEditorRef } from '../PagedEditor';

const DEFAULT_TOC_PROMPT =
  'This document contains a table of contents thats out of date. Regenerate it now?';

export function useTableOfContentsActions({
  isLoading,
  hasDocument,
  readOnly,
  i18n,
  pagedEditorRef,
}: {
  isLoading: boolean;
  hasDocument: boolean;
  readOnly: boolean;
  i18n: Translations | undefined;
  pagedEditorRef: RefObject<PagedEditorRef | null>;
}) {
  const promptedRef = useRef(false);
  const secondPassRequestedRef = useRef(false);
  const secondPassTimerRef = useRef<number | null>(null);

  const runPendingSecondPass = useCallback(() => {
    if (!secondPassRequestedRef.current) return;
    const view = pagedEditorRef.current?.getView();
    const layout = pagedEditorRef.current?.getLayout();
    if (!view || !layout) return;
    secondPassRequestedRef.current = false;
    updateTableOfContents(view.state, view.dispatch, { layout });
  }, [pagedEditorRef]);

  const requestSecondPass = useCallback(() => {
    secondPassRequestedRef.current = true;
    if (secondPassTimerRef.current != null) {
      window.clearTimeout(secondPassTimerRef.current);
    }
    secondPassTimerRef.current = window.setTimeout(() => {
      secondPassTimerRef.current = null;
      requestAnimationFrame(runPendingSecondPass);
    }, 120);
  }, [runPendingSecondPass]);

  const updateToc = useCallback(
    (position?: number | null) => {
      const view = pagedEditorRef.current?.getView();
      if (!view) return false;
      const updated = updateTableOfContents(view.state, view.dispatch, {
        position,
        layout: pagedEditorRef.current?.getLayout() ?? null,
      });
      if (updated) requestSecondPass();
      return updated;
    },
    [pagedEditorRef, requestSecondPass]
  );

  const handleInserted = useCallback(() => {
    promptedRef.current = true;
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

  useEffect(() => {
    if (isLoading || !hasDocument || readOnly) return;
    const view = pagedEditorRef.current?.getView();
    if (!view) return;
    if (!hasTableOfContentsNeedingUpdate(view.state.doc)) {
      promptedRef.current = false;
      return;
    }
    if (promptedRef.current) return;

    let innerRaf = 0;
    const outerRaf = requestAnimationFrame(() => {
      innerRaf = requestAnimationFrame(() => {
        const liveView = pagedEditorRef.current?.getView();
        if (!liveView || !hasTableOfContentsNeedingUpdate(liveView.state.doc)) return;
        promptedRef.current = true;
        if (window.confirm(i18n?.toc?.updatePrompt ?? DEFAULT_TOC_PROMPT)) {
          updateToc();
        }
      });
    });
    return () => {
      cancelAnimationFrame(outerRaf);
      cancelAnimationFrame(innerRaf);
    };
  }, [hasDocument, i18n, isLoading, pagedEditorRef, readOnly, updateToc]);

  return {
    runPendingTocSecondPass: runPendingSecondPass,
    runTableOfContentsUpdate: updateToc,
    handleTableOfContentsInserted: handleInserted,
  };
}
