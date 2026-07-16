import { useCallback, useEffect, useRef, type RefObject } from 'react';
import {
  findTableOfContentsBlocks,
  hasTableOfContentsNeedingUpdate,
  updateTableOfContents,
} from '@docx-editor.dev/core/prosemirror';
import type { PageLayout } from '@docx-editor.dev/core/pagination-model';
import { en as defaultLocale } from '@docx-editor.dev/i18n';
import type { Translations } from '@docx-editor.dev/i18n';
import type { PagedEditorRef } from '../PagedEditor';

function readPageLayout(pagedEditorRef: RefObject<PagedEditorRef | null>): PageLayout | null {
  // Runtime getLayout() returns the full PageLayout; the public ref type only
  // exposes page number/size. Cast for TOC page-number resolution.
  return (pagedEditorRef.current?.getLayout() as PageLayout | null | undefined) ?? null;
}

export function useTableOfContentsActions({
  isLoading,
  hasDocument,
  promptRecheckKey,
  readOnly,
  i18n,
  pagedEditorRef,
}: {
  isLoading: boolean;
  hasDocument: boolean;
  promptRecheckKey: unknown;
  readOnly: boolean;
  i18n: Translations | undefined;
  pagedEditorRef: RefObject<PagedEditorRef | null>;
}) {
  const promptedRef = useRef(false);
  const promptedSignatureRef = useRef<string | null>(null);
  const secondPassRequestedRef = useRef(false);
  const secondPassTimerRef = useRef<number | null>(null);

  const runPendingSecondPass = useCallback(() => {
    if (!secondPassRequestedRef.current) return;
    const view = pagedEditorRef.current?.getView();
    const layout = readPageLayout(pagedEditorRef);
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
        layout: readPageLayout(pagedEditorRef),
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
      promptedSignatureRef.current = null;
      return;
    }
    const signature = tocPromptSignature(view.state.doc);
    if (signature !== promptedSignatureRef.current) {
      promptedRef.current = false;
      promptedSignatureRef.current = signature;
    }
    if (promptedRef.current) return;

    let innerRaf = 0;
    const outerRaf = requestAnimationFrame(() => {
      innerRaf = requestAnimationFrame(() => {
        const liveView = pagedEditorRef.current?.getView();
        if (!liveView || !hasTableOfContentsNeedingUpdate(liveView.state.doc)) return;
        promptedRef.current = true;
        if (window.confirm(i18n?.toc?.updatePrompt ?? defaultLocale.toc.updatePrompt)) {
          updateToc();
        }
      });
    });
    return () => {
      cancelAnimationFrame(outerRaf);
      cancelAnimationFrame(innerRaf);
    };
  }, [hasDocument, i18n, isLoading, pagedEditorRef, promptRecheckKey, readOnly, updateToc]);

  return {
    runPendingTocSecondPass: runPendingSecondPass,
    runTableOfContentsUpdate: updateToc,
    handleTableOfContentsInserted: handleInserted,
  };
}

function tocPromptSignature(doc: Parameters<typeof findTableOfContentsBlocks>[0]): string {
  return findTableOfContentsBlocks(doc)
    .filter((block) => block.needsUpdate)
    .map((block) =>
      [
        block.pos,
        block.instruction.raw,
        String(block.node.attrs.rawPreserveXml ?? ''),
        String(block.node.attrs.rawPreserveText ?? ''),
      ].join('\u001f')
    )
    .join('\u001e');
}
