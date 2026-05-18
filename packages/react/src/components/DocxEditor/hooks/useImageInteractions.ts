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
      try {
        const node = view.state.doc.nodeAt(pmPos);
        if (!node || node.type.name !== 'image') return;
        const tr = view.state.tr.setNodeMarkup(pmPos, undefined, {
          ...node.attrs,
          width: newWidth,
          height: newHeight,
        });
        view.dispatch(tr);
        hiddenPMRef.current?.setNodeSelection(pmPos);
      } catch {
        // Position may have shifted during resize.
      }
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
      try {
        const node = view.state.doc.nodeAt(pmPos);
        if (!node || node.type.name !== 'image') return;

        const isFloating =
          node.attrs.displayMode === 'float' ||
          (node.attrs.wrapType &&
            ['square', 'tight', 'through'].includes(node.attrs.wrapType as string));

        if (isFloating) {
          // Floating image: update wp:positionH/V offsets so the image lands
          // at the drop point while staying floating.
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
            contentEl = pages[pages.length - 1].querySelector(
              '.layout-page-content'
            ) as HTMLElement;
          }
          if (!contentEl) return;

          const contentRect = contentEl.getBoundingClientRect();
          const dropX = (clientX - contentRect.left) / zoom;
          const dropY = (clientY - contentRect.top) / zoom;
          const hOffsetEmu = pixelsToEmu(dropX);
          const vOffsetEmu = pixelsToEmu(dropY);

          const newPosition = {
            horizontal: { posOffset: hOffsetEmu, relativeTo: 'margin' },
            vertical: { posOffset: vOffsetEmu, relativeTo: 'margin' },
          };

          const tr = view.state.tr.setNodeMarkup(pmPos, undefined, {
            ...node.attrs,
            position: newPosition,
          });
          view.dispatch(tr);
          hiddenPMRef.current?.setNodeSelection(pmPos);
        } else {
          // Inline image: move to the drop text position via delete + insert.
          const dropPos = getPositionFromMouse(clientX, clientY);
          if (dropPos === null) return;
          if (dropPos === pmPos || dropPos === pmPos + 1) return;

          let tr = view.state.tr;
          if (dropPos <= pmPos) {
            tr = tr.delete(pmPos, pmPos + node.nodeSize);
            tr = tr.insert(dropPos, node);
            hiddenPMRef.current?.setNodeSelection(dropPos);
          } else {
            tr = tr.delete(pmPos, pmPos + node.nodeSize);
            const adjusted = dropPos - node.nodeSize;
            tr = tr.insert(Math.min(adjusted, tr.doc.content.size), node);
            hiddenPMRef.current?.setNodeSelection(Math.min(adjusted, tr.doc.content.size - 1));
          }
          view.dispatch(tr);
        }
      } catch {
        // Position may have shifted between the drag's frames.
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
