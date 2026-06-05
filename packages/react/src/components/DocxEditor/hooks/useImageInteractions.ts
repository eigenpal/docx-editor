/**
 * Image-interaction handlers for PagedEditor.
 *
 * Owns the resize / drag callbacks the `ImageSelectionOverlay` invokes.
 * `isImageInteractingRef` is set during a drag or resize so the selection
 * hook can suppress the deferred image-info clear (image stays selected
 * mid-drag instead of dropping out under the mouse).
 *
 * Drag move handling forks on `displayMode === 'float'` (or any of
 * square/tight/through wrap types): floating images get an EMU offset
 * update under wp:positionH/V; inline images get a PM `delete + insert`
 * pair at the drop position.
 */

import { useCallback } from 'react';

import { pixelsToEmu } from '@eigenpal/docx-editor-core/utils';
import {
  isFloatingImage,
  commitImageResize,
  commitImageFloatMove,
  commitImageInlineMove,
} from '@eigenpal/docx-editor-core/prosemirror/imageCommit';

import type { OffscreenEditorHostRef } from '../OffscreenEditorHost';

export interface UseImageInteractionsOptions {
  pagesContainerRef: React.RefObject<HTMLDivElement | null>;
  hiddenPMRef: React.RefObject<OffscreenEditorHostRef | null>;
  zoom: number;
  isImageInteractingRef: React.MutableRefObject<boolean>;
  getPositionFromMouse: (clientX: number, clientY: number) => number | null;
}

export interface UseImageInteractionsReturn {
  handleImageResize: (pmPos: number, newWidth: number, newHeight: number) => void;
  handleImageResizeStart: () => void;
  handleImageResizeEnd: () => void;
  handleImageDragMove: (pmPos: number, clientX: number, clientY: number) => void;
  handleImageDragStart: () => void;
  handleImageDragEnd: () => void;
}

export function useImageInteractions(
  opts: UseImageInteractionsOptions
): UseImageInteractionsReturn {
  const { pagesContainerRef, hiddenPMRef, zoom, isImageInteractingRef, getPositionFromMouse } =
    opts;

  const handleImageResize = useCallback(
    (pmPos: number, newWidth: number, newHeight: number) => {
      const view = hiddenPMRef.current?.getView();
      if (!view) return;
      const sel = commitImageResize(view, pmPos, newWidth, newHeight);
      if (sel !== null) hiddenPMRef.current?.setNodeSelection(sel);
    },
    [hiddenPMRef]
  );

  const handleImageResizeStart = useCallback(() => {
    isImageInteractingRef.current = true;
  }, [isImageInteractingRef]);

  const handleImageResizeEnd = useCallback(() => {
    isImageInteractingRef.current = false;
  }, [isImageInteractingRef]);

  const handleImageDragMove = useCallback(
    (pmPos: number, clientX: number, clientY: number) => {
      const view = hiddenPMRef.current?.getView();
      if (!view) return;
      const node = view.state.doc.nodeAt(pmPos);
      if (!node || node.type.name !== 'image') return;

      if (isFloatingImage(node)) {
        // Floating image: resolve the drop point's `.layout-page-content` and
        // hand core the margin-relative EMU offsets.
        const pages = pagesContainerRef.current?.querySelectorAll('.layout-page');
        if (!pages || pages.length === 0) return;

        let contentEl: HTMLElement | null = null;
        for (const page of pages) {
          const rect = page.getBoundingClientRect();
          if (clientY >= rect.top && clientY <= rect.bottom) {
            contentEl = page.querySelector('.layout-page-content') as HTMLElement;
            break;
          }
        }
        if (!contentEl) {
          // Below all pages — fall back to the last page's content area.
          contentEl = pages[pages.length - 1].querySelector('.layout-page-content') as HTMLElement;
        }
        if (!contentEl) return;

        const contentRect = contentEl.getBoundingClientRect();
        const hOffsetEmu = pixelsToEmu((clientX - contentRect.left) / zoom);
        const vOffsetEmu = pixelsToEmu((clientY - contentRect.top) / zoom);
        const sel = commitImageFloatMove(view, pmPos, hOffsetEmu, vOffsetEmu);
        if (sel !== null) hiddenPMRef.current?.setNodeSelection(sel);
      } else {
        // Inline image: hit-test the drop text position, core does delete+insert.
        const dropPos = getPositionFromMouse(clientX, clientY);
        if (dropPos === null) return;
        const sel = commitImageInlineMove(view, pmPos, dropPos);
        if (sel !== null) hiddenPMRef.current?.setNodeSelection(sel);
      }
    },
    [getPositionFromMouse, zoom, hiddenPMRef, pagesContainerRef]
  );

  const handleImageDragStart = useCallback(() => {
    isImageInteractingRef.current = true;
  }, [isImageInteractingRef]);

  const handleImageDragEnd = useCallback(() => {
    isImageInteractingRef.current = false;
  }, [isImageInteractingRef]);

  return {
    handleImageResize,
    handleImageResizeStart,
    handleImageResizeEnd,
    handleImageDragMove,
    handleImageDragStart,
    handleImageDragEnd,
  };
}
