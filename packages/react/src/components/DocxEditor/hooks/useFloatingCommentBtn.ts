/**
 * The floating "Add comment" button that hovers beside a non-empty selection at the
 * right edge of the page.
 *
 * PORTED from the legacy hook of the same name, including the reason it watches THREE
 * things — which is the part worth keeping verbatim:
 *
 *  - a `ResizeObserver` on the scroll container, for size changes (sidebar toggle,
 *    loading to ready)
 *  - an explicit `resize` listener, because the observer does NOT fire on a pure window
 *    resize when the container is already at its max width
 *  - an effect on `zoom`, because zoom moves the page edges without changing the
 *    selection, so no selection-change event arrives
 *
 * The position comes from the engine now. Legacy measured painted spans itself
 * (`findSelectionYPosition`); `getSelectionRects` reports the same geometry in content
 * coordinates, and the adapter converts using the page stack it painted — the same
 * conversion the page indicator does.
 */
import { useCallback, useEffect, useRef } from 'react';
import type { Editor } from '@docx-editor.dev/core-contract/editor';

export function useFloatingCommentBtn({
  editorRef,
  scrollContainerRef,
  pagesContainerRef,
  isAddingCommentRef,
  setFloatingCommentBtn,
  readOnly,
  isLoading,
  zoom,
}: {
  editorRef: React.RefObject<Editor | null>;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  pagesContainerRef: React.RefObject<HTMLDivElement | null>;
  isAddingCommentRef: React.RefObject<boolean>;
  setFloatingCommentBtn: React.Dispatch<React.SetStateAction<{ top: number; left: number } | null>>;
  readOnly: boolean;
  isLoading: boolean;
  zoom: number;
}) {
  // Mirrored to a ref so the recompute callback stays stable across renders.
  const readOnlyForFloatingBtnRef = useRef(false);
  readOnlyForFloatingBtnRef.current = readOnly;

  const recomputeFloatingCommentBtn = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (isAddingCommentRef.current || readOnlyForFloatingBtnRef.current) {
      setFloatingCommentBtn(null);
      return;
    }
    // No rects means nothing is selected — the button belongs to a RANGE, not a caret.
    const rects = editor.getSelectionRects();
    if (rects.length === 0) {
      setFloatingCommentBtn(null);
      return;
    }
    const container = scrollContainerRef.current;
    const pagesEl = pagesContainerRef.current;
    if (!container || !pagesEl) return;

    const pagesRect = pagesEl.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    // Content coordinates to a container-relative offset: the page stack's client origin
    // IS content (0, 0), and the stack is scaled by zoom.
    const top = pagesRect.top + rects[0]!.y * zoom - containerRect.top;

    // Legacy anchored the button to the painted page's right edge, falling back to a
    // centre-plus-half-page offset when no page element was found. The engine publishes
    // the page box, so the fallback is not needed.
    const page = editor.getPageGeometry()[0];
    if (!page) return;
    const left = (page.box.x + page.box.width) * zoom + pagesRect.left - containerRect.left;

    setFloatingCommentBtn({ top, left });
  }, [editorRef, scrollContainerRef, pagesContainerRef, isAddingCommentRef, setFloatingCommentBtn, zoom]);

  // Reposition on container resize (sidebar toggle, loading to ready, window resize).
  // Re-runs on the `isLoading` flip because the scroll container only mounts once the
  // document is ready.
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

  // Reposition on zoom — page edges shift without a selection change.
  useEffect(() => {
    recomputeFloatingCommentBtn();
  }, [zoom, recomputeFloatingCommentBtn]);

  return { recomputeFloatingCommentBtn };
}
