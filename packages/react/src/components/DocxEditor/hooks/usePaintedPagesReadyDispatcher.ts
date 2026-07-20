import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { PaintedPagesReadyDetail } from '@docx-editor.dev/core/painter-model';

export function usePaintedPagesReadyDispatcher(
  pagesContainerRef: RefObject<HTMLDivElement | null>,
  getPaintGeneration: () => number
): () => void {
  const rafRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    },
    []
  );

  return useCallback(() => {
    const pages = pagesContainerRef.current;
    if (!pages) return;
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    const paintGeneration = getPaintGeneration();
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (
        pagesContainerRef.current !== pages ||
        pages.dataset.paintGeneration !== String(paintGeneration)
      ) {
        return;
      }
      pages.dispatchEvent(
        new CustomEvent<PaintedPagesReadyDetail>('docx-editor-react:painted-pages-ready', {
          detail: { paintGeneration },
        })
      );
    });
  }, [getPaintGeneration, pagesContainerRef]);
}
