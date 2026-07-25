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
  editorRef,
  zoom,
}: {
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
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
      // scroll offset. The engine resolves it against the same scroll container it was
      // handed, so this asks rather than re-derives. Page numbers are 0-based there and
      // 1-based in the pill.
      const editor = editorRef.current;
      const totalPages = editor?.getTotalPages() ?? 0;
      if (!editor || totalPages === 0) return;

      setScrollPageInfo({ currentPage: editor.getCurrentPage('viewport') + 1, totalPages, visible: true });

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
  }, [scrollContainerEl, editorRef, zoom]);

  return { scrollPageInfo, setScrollPageInfo };
}
