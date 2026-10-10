import { ref, watch, type CSSProperties, type ShallowRef } from 'vue';
import type { DocxEditorRefCallback } from '../docx-editor-ref-callback';
import { formatPx } from '../lib/units';
import { scopeDispose } from './scope-dispose';
import { absolutePointInScroller } from './scroller-geometry';

type AnchorPlacement = 'before' | 'after' | 'story-label';

/** @public */
export interface ScopedChromeAnchor {
  readonly ref: DocxEditorRefCallback<HTMLDivElement>;
  readonly style: ShallowRef<CSSProperties>;
}

/**
 * Attach contextual chrome to a painted story instead of the top of the editor viewport.
 *
 * @public
 */
export function useScopedChromeAnchor(
  findAnchor: (viewport: HTMLElement) => HTMLElement | null,
  placement: AnchorPlacement
): ScopedChromeAnchor {
  const chrome = ref<HTMLDivElement | null>(null);
  const style = ref<CSSProperties>({ visibility: 'hidden' });

  const setRef = (node: HTMLDivElement | null) => {
    chrome.value = node;
  };

  watch(
    [chrome, () => findAnchor, () => placement],
    ([currentChrome], _, onCleanup) => {
      const containingViewport = currentChrome?.closest<HTMLElement>(
        '.docx-editor__scroll-container'
      );
      const viewport =
        containingViewport ??
        currentChrome?.parentElement?.querySelector<HTMLElement>('.docx-editor__scroll-container');
      if (!currentChrome || !viewport) return;

      let frame = 0;
      let observedAnchor: HTMLElement | null = null;
      const resizeObserver = new ResizeObserver(() => schedule());

      const update = () => {
        frame = 0;
        const anchor = findAnchor(viewport);
        if (anchor !== observedAnchor) {
          resizeObserver.disconnect();
          resizeObserver.observe(viewport);
          resizeObserver.observe(currentChrome);
          if (anchor) resizeObserver.observe(anchor);
          observedAnchor = anchor;
        }
        if (!anchor || !anchor.isConnected) {
          style.value = { visibility: 'hidden' };
          return;
        }

        const anchorRect = anchor.getBoundingClientRect();
        const chromeHeight =
          placement === 'story-label'
            ? Math.max(currentChrome.offsetHeight, 28)
            : currentChrome.offsetHeight;
        const clearance = placement === 'story-label' ? 6 : 4;
        const attachedInsideViewport = containingViewport === viewport;
        const anchorTop =
          placement === 'after' ? anchorRect.bottom + 6 : anchorRect.top - chromeHeight - clearance;
        const documentPoint = attachedInsideViewport
          ? absolutePointInScroller(viewport, anchorRect.left, anchorTop)
          : { left: anchorRect.left, top: anchorTop };
        const documentLeft = documentPoint.left;
        const documentTop = documentPoint.top;
        const viewportEdge = attachedInsideViewport ? viewport.scrollLeft + 8 : 8;

        style.value = {
          position: attachedInsideViewport ? 'absolute' : 'fixed',
          left: formatPx(
            placement === 'story-label' ? documentLeft : Math.max(viewportEdge, documentLeft + 8)
          ),
          top: formatPx(
            placement === 'story-label'
              ? documentTop
              : Math.max(attachedInsideViewport ? viewport.scrollTop + 8 : 8, documentTop)
          ),
          ...(placement === 'story-label'
            ? {
                width: formatPx(
                  Math.max(240, Math.min(anchorRect.width, viewport.clientWidth - 16))
                ),
              }
            : {
                maxWidth: formatPx(
                  Math.max(240, Math.min(anchorRect.width - 16, viewport.clientWidth - 16))
                ),
              }),
          visibility: 'visible',
        };
      };

      const schedule = () => {
        if (frame) return;
        frame = requestAnimationFrame(update);
      };

      resizeObserver.observe(viewport);
      resizeObserver.observe(currentChrome);
      const mutationObserver = new MutationObserver(schedule);
      mutationObserver.observe(viewport, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['data-docx-hf-active', 'data-docx-note-scope'],
      });
      viewport.addEventListener('scroll', schedule, { passive: true });
      window.addEventListener('resize', schedule);
      update();

      onCleanup(() => {
        if (frame) cancelAnimationFrame(frame);
        resizeObserver.disconnect();
        mutationObserver.disconnect();
        viewport.removeEventListener('scroll', schedule);
        window.removeEventListener('resize', schedule);
      });
    },
    { flush: 'post' }
  );

  scopeDispose(() => {
    style.value = { visibility: 'hidden' };
  });

  return { ref: setRef, style };
}
