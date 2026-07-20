import { useCallback, useEffect, useRef } from 'react';
import type { PagedEditorRef } from '../PagedEditor';
import { findSelectionYPosition } from '../internals/pmAnchors';

/**
 * Owns the floating "Add comment" button that hovers next to a
 * non-empty selection on the right edge of the page. Recomputes its
 * position whenever:
 *  - the selection changes (caller invokes `recomputeFloatingCommentBtn`)
 *  - the scroll container resizes (ResizeObserver here)
 *  - the window resizes (`resize` listener here)
 *  - zoom changes (effect on `zoom`)
 *
 * Why both `ResizeObserver` and the explicit `resize` listener: the
 * ResizeObserver covers container-size changes (sidebar toggle,
 * loading→ready transition) but doesn't fire on pure window resize when
 * the container is already at its max-width. The zoom effect handles
 * zoom changes that move page edges without changing PM selection — the
 * PagedEditor's `onSelectionChange` no longer fires on mere overlay
 * redraws after the state-identity dedup in #268.
 *
 * `readOnly` is mirrored to a ref so the recompute callback stays
 * stable across renders.
 */
export function useFloatingCommentBtn({
  pagedEditorRef,
  scrollContainerRef,
  editorContentRef,
  isAddingCommentRef,
  setFloatingCommentBtn,
  readOnly,
  isLoading,
  zoom,
}: {
  pagedEditorRef: React.RefObject<PagedEditorRef | null>;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  editorContentRef: React.RefObject<HTMLDivElement | null>;
  isAddingCommentRef: React.RefObject<boolean>;
  setFloatingCommentBtn: React.Dispatch<React.SetStateAction<{ top: number; left: number } | null>>;
  readOnly: boolean;
  isLoading: boolean;
  zoom: number;
}) {
  const readOnlyForFloatingBtnRef = useRef(false);
  readOnlyForFloatingBtnRef.current = readOnly;

  const recomputeFloatingCommentBtn = useCallback(() => {
    const view = pagedEditorRef.current?.getView();
    if (!view) return;
    if (isAddingCommentRef.current || readOnlyForFloatingBtnRef.current) {
      setFloatingCommentBtn(null);
      return;
    }
    const { from, to } = view.state.selection;
    if (from === to) {
      setFloatingCommentBtn(null);
      return;
    }
    const container = scrollContainerRef.current;
    const parentEl = editorContentRef.current;
    if (!container || !parentEl) return;
    const top = findSelectionYPosition(container, parentEl, from);
    if (top == null) return;
    const pagesEl = container.querySelector('.paged-editor__pages');
    const pageEl = pagesEl?.querySelector('.layout-page') as HTMLElement | null;
    const left = pageEl
      ? pageEl.getBoundingClientRect().right - parentEl.getBoundingClientRect().left
      : parentEl.getBoundingClientRect().width / 2 + 408;
    setFloatingCommentBtn({ top, left });
  }, [
    pagedEditorRef,
    scrollContainerRef,
    editorContentRef,
    isAddingCommentRef,
    setFloatingCommentBtn,
  ]);

  // Reposition on container resize (sidebar toggle, loading→ready, window
  // resize). Re-run on isLoading flip because the scroll container only
  // mounts once the doc is ready.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => recomputeFloatingCommentBtn());
    ro.observe(container);
    const onWinResize = () => recomputeFloatingCommentBtn();
    window.addEventListener('resize', onWinResize);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', onWinResize);
    };
  }, [isLoading, recomputeFloatingCommentBtn, scrollContainerRef]);

  // Reposition on zoom — page edges shift without a PM selection change.
  useEffect(() => {
    recomputeFloatingCommentBtn();
  }, [zoom, recomputeFloatingCommentBtn]);

  return { recomputeFloatingCommentBtn };
}
