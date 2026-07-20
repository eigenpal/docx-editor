import { useEffect, useRef, useState } from 'react';
import { getPageScrollInfo } from '@docx-editor.dev/core/flow-model';
import type { PagedEditorRef } from '../PagedEditor';
import { DEFAULT_PAGE_GAP, VIEWPORT_PADDING_TOP } from '../internals/styles';

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
  zoom,
}: {
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  pagedEditorRef: React.RefObject<PagedEditorRef | null>;
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
      const layout = pagedEditorRef.current?.getLayout();
      if (!layout || layout.pages.length === 0) return;

      const { currentPage, totalPages } = getPageScrollInfo({
        layout,
        scrollTop: scrollContainerEl.scrollTop,
        viewportHeight: scrollContainerEl.clientHeight,
        zoom,
        pageGap: DEFAULT_PAGE_GAP,
        paddingTop: VIEWPORT_PADDING_TOP,
      });

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
  }, [scrollContainerEl, pagedEditorRef, zoom]);

  return { scrollPageInfo, setScrollPageInfo };
}
