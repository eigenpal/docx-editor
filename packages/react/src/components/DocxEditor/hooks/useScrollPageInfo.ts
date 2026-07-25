import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@docx-editor.dev/core-contract/editor';

interface ScrollPageInfo {
  currentPage: number;
  totalPages: number;
  visible: boolean;
}

/**
 * Drives the floating page indicator (the "3 of 12" pill that fades in
 * on scroll). Computes the visible page from the scroll position +
 * layout's per-page heights, then hides itself after 600ms of no
 * scrolling. Re-attaches when the scroll container first mounts, which
 * is after loading completes (the loading state renders a different
 * subtree).
 */
export function useScrollPageInfo({
  scrollContainerRef,
  pagesContainerRef,
  editorRef,
  zoom,
}: {
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  /** The painted page stack. This adapter placed the pages, so it is what knows where they are. */
  pagesContainerRef: React.RefObject<HTMLDivElement | null>;
  editorRef: React.RefObject<Editor | null>;
  zoom: number;
}) {
  const [scrollPageInfo, setScrollPageInfo] = useState<ScrollPageInfo>({
    currentPage: 1,
    totalPages: 1,
    visible: false,
  });
  const scrollFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scrollContainerEl = scrollContainerRef.current;
  useEffect(() => {
    if (!scrollContainerEl) return;

    const handleScroll = () => {
      // Legacy computed the visible page from the layout's per-page heights and the
      // scroll offset. The engine cannot answer this one: its display page boxes are
      // page-local (every page reports y = 0), so the stacking is knowledge this adapter
      // holds — it is what painted them. The count still comes from the engine; only the
      // placement is read back from the DOM.
      //
      // The page under the viewport's vertical MIDPOINT is the one being read, which is
      // what a reader would call the current page when two pages straddle the viewport.
      const totalPages = editorRef.current?.getTotalPages() ?? 0;
      const pagesEl = pagesContainerRef.current;
      if (totalPages === 0 || !pagesEl) return;
      const band = scrollContainerEl.getBoundingClientRect();
      const midpoint = band.top + band.height / 2;
      let currentPage = totalPages;
      const painted = pagesEl.children;
      for (let i = 0; i < painted.length; i += 1) {
        if (midpoint < painted[i]!.getBoundingClientRect().bottom) {
          currentPage = i + 1;
          break;
        }
      }

      setScrollPageInfo({ currentPage, totalPages, visible: true });

      if (scrollFadeTimerRef.current) {
        clearTimeout(scrollFadeTimerRef.current);
      }
      scrollFadeTimerRef.current = setTimeout(() => {
        setScrollPageInfo((prev) => ({ ...prev, visible: false }));
      }, 600);
    };

    scrollContainerEl.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      scrollContainerEl.removeEventListener('scroll', handleScroll);
      if (scrollFadeTimerRef.current) {
        clearTimeout(scrollFadeTimerRef.current);
      }
    };
  }, [scrollContainerEl, pagesContainerRef, editorRef, zoom]);

  return { scrollPageInfo, setScrollPageInfo };
}
