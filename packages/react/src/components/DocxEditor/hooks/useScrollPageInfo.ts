import { useEffect, useRef, useState } from 'react';
import type { PagedEditorRef } from '../PagedEditor';

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
  pagedEditorRef,
}: {
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  pagedEditorRef: React.RefObject<PagedEditorRef | null>;
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
      const layout = pagedEditorRef.current?.getLayout();
      if (!layout || layout.pages.length === 0) return;

      const scrollTop = scrollContainerEl.scrollTop;
      const totalPages = layout.pages.length;
      const pageGap = 24; // DEFAULT_PAGE_GAP from PagedEditor
      const paddingTop = 24; // top padding in paged-editor__pages

      const viewportCenter = scrollTop + scrollContainerEl.clientHeight / 2;
      let accumulatedY = paddingTop;
      let currentPage = 1;

      for (let i = 0; i < layout.pages.length; i++) {
        const pageHeight = layout.pages[i].size.h;
        const pageEnd = accumulatedY + pageHeight;
        if (viewportCenter < pageEnd) {
          currentPage = i + 1;
          break;
        }
        accumulatedY = pageEnd + pageGap;
        currentPage = i + 2;
      }
      currentPage = Math.min(currentPage, totalPages);

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
  }, [scrollContainerEl, pagedEditorRef]);

  return { scrollPageInfo, setScrollPageInfo };
}
