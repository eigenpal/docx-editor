import { useCallback, useEffect, useRef, useState } from 'react';
import { collectHeadings, type HeadingInfo } from '@eigenpal/docx-editor-core/utils';
import type { PagedEditorRef } from '../PagedEditor';

/**
 * Owns the document outline panel: visibility, headings, and chrome
 * measurements that position it (toolbar height + horizontal scroll
 * offset of the editor).
 */
export function useOutlineSidebar({
  showOutlineProp,
  pagedEditorRef,
  scrollContainerRef,
  isLoading,
}: {
  showOutlineProp: boolean;
  pagedEditorRef: React.RefObject<PagedEditorRef | null>;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  isLoading: boolean;
}) {
  const [showOutline, setShowOutline] = useState(showOutlineProp);
  const showOutlineRef = useRef(false);
  showOutlineRef.current = showOutline;
  const [outlineHeadings, setHeadingInfos] = useState<HeadingInfo[]>([]);

  // Sync outline visibility when prop changes
  useEffect(() => {
    setShowOutline(showOutlineProp);
    if (showOutlineProp) {
      const view = pagedEditorRef.current?.getView();
      if (view) setHeadingInfos(collectHeadings(view.state.doc));
    }
  }, [showOutlineProp, pagedEditorRef]);

  // Toolbar height — drives vertical positioning of the outline panel/button.
  // ResizeObserver tracks the toolbar wrapper so panel placement keeps up with
  // toolbar reflow (responsive breakpoints, font/icon-size changes).
  const toolbarRoRef = useRef<ResizeObserver | null>(null);
  const toolbarWrapperRef = useRef<HTMLDivElement | null>(null);
  const [toolbarHeight, setToolbarHeight] = useState(0);

  const toolbarRefCallback = useCallback((el: HTMLDivElement | null) => {
    toolbarWrapperRef.current = el;
    if (toolbarRoRef.current) {
      toolbarRoRef.current.disconnect();
      toolbarRoRef.current = null;
    }
    if (!el) {
      setToolbarHeight(0);
      return;
    }
    setToolbarHeight(el.offsetHeight);
    const ro = new ResizeObserver(() => {
      setToolbarHeight(el.offsetHeight);
    });
    ro.observe(el);
    toolbarRoRef.current = ro;
  }, []);

  useEffect(() => {
    return () => {
      toolbarRoRef.current?.disconnect();
    };
  }, []);

  // Horizontal scroll offset of the editor scroll container. Used to slide the
  // outline panel and toggle button with the doc instead of leaving them pinned
  // to the viewport. Scroll updates are coalesced to one per frame — scroll
  // events fire faster than React can re-render the whole editor tree.
  // Re-runs after isLoading flips because the scroll container only mounts once
  // the doc is ready.
  const [editorScrollLeft, setEditorScrollLeft] = useState(0);
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      setEditorScrollLeft(el.scrollLeft);
    };
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };
    update();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [isLoading, scrollContainerRef]);

  return {
    showOutline,
    setShowOutline,
    showOutlineRef,
    outlineHeadings,
    setHeadingInfos,
    toolbarHeight,
    toolbarRefCallback,
    editorScrollLeft,
  };
}
