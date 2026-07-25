/**
 * Table-of-contents updates, including the deferred second pass.
 *
 * PORTED from the legacy hook of the same name. The second-pass machinery is legacy's
 * and is kept: inserting or refreshing a TOC changes page numbers, which changes
 * pagination, which changes the page numbers the TOC should show — so legacy runs the
 * update once, waits 120ms plus a frame for layout to settle, and runs it again. The
 * timer, the requested/position refs and the handler names are unchanged.
 *
 * What changes is the dispatch. Legacy called `updateTableOfContents(state, dispatch,
 * { layout, position, force })`, handing in the page layout it had just computed. The
 * engine owns pagination, so `refreshToc` needs no layout argument — and the second pass
 * still matters for exactly the same reason, because the engine repaginates after the
 * first refresh too.
 */
import { useCallback, useEffect, useRef } from 'react';
import type { Editor } from '@docx-editor.dev/core-contract/editor';

export function useTableOfContentsActions({
  editorRef,
}: {
  editorRef: React.RefObject<Editor | null>;
}) {
  const secondPassRequestedRef = useRef(false);
  const secondPassTimerRef = useRef<number | null>(null);

  const runPendingSecondPass = useCallback(() => {
    if (!secondPassRequestedRef.current) return;
    const editor = editorRef.current;
    if (!editor) return;
    secondPassRequestedRef.current = false;
    editor.exec({ type: 'refreshToc' });
  }, [editorRef]);

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

  const updateToc = useCallback((): boolean => {
    const editor = editorRef.current;
    if (!editor) return false;
    const result = editor.exec({ type: 'refreshToc' });
    // Only queue the second pass if the first one actually did something. Refreshing a
    // document with no TOC is refused, and scheduling a repeat of a refused command
    // would just burn a frame every time the menu item is clicked.
    if (result.ok) requestSecondPass();
    return result.ok;
  }, [editorRef, requestSecondPass]);

  const handleInserted = useCallback(() => {
    requestSecondPass();
  }, [requestSecondPass]);

  // A pending timer outliving the component would fire against a destroyed editor.
  useEffect(
    () => () => {
      if (secondPassTimerRef.current != null) window.clearTimeout(secondPassTimerRef.current);
    },
    []
  );

  return {
    runPendingTocSecondPass: runPendingSecondPass,
    runTableOfContentsUpdate: updateToc,
    handleTableOfContentsInserted: handleInserted,
  };
}
