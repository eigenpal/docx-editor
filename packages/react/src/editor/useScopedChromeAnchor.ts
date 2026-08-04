import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';

type AnchorPlacement = 'before' | 'after';

export interface ScopedChromeAnchor {
  readonly ref: RefObject<HTMLDivElement | null>;
  readonly style: CSSProperties;
}

/**
 * Attach contextual chrome to a painted story instead of the top of the editor viewport.
 *
 * The engine owns and may replace everything inside the paginated surface, so React cannot
 * portal controls into a header, footer, or note node. This hook keeps the controls as a
 * sibling overlay and derives only their screen placement from the current painted host.
 */
export function useScopedChromeAnchor(
  findAnchor: (viewport: HTMLElement) => HTMLElement | null,
  placement: AnchorPlacement
): ScopedChromeAnchor {
  const ref = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<CSSProperties>({
    position: 'absolute',
    left: 8,
    top: 8,
    visibility: 'visible',
  });

  useLayoutEffect(() => {
    const chrome = ref.current;
    const containingViewport = chrome?.closest<HTMLElement>('.docx-editor__scroll-container');
    const viewport =
      containingViewport ??
      chrome?.parentElement?.querySelector<HTMLElement>('.docx-editor__scroll-container');
    const surface = viewport?.querySelector<HTMLElement>('.docx-paginated-surface');
    if (!chrome || !viewport || !surface) return undefined;

    let frame = 0;
    let missingAnchorRetries = 0;
    let disposed = false;
    let observedAnchor: HTMLElement | null = null;
    const resizeObserver = new ResizeObserver(() => schedule());

    const update = () => {
      frame = 0;
      const anchor = findAnchor(viewport);
      if (anchor !== observedAnchor) {
        resizeObserver.disconnect();
        resizeObserver.observe(viewport);
        resizeObserver.observe(chrome);
        if (anchor) resizeObserver.observe(anchor);
        observedAnchor = anchor;
      }
      if (!anchor || !anchor.isConnected) {
        if (missingAnchorRetries < 2) {
          missingAnchorRetries += 1;
          queueMicrotask(() => {
            if (!disposed) update();
          });
        }
        return;
      }
      missingAnchorRetries = 0;

      const viewportRect = viewport.getBoundingClientRect();
      const anchorRect = anchor.getBoundingClientRect();
      const chromeHeight = chrome.offsetHeight;
      const attachedInsideViewport = containingViewport === viewport;
      const documentLeft = attachedInsideViewport
        ? anchorRect.left - viewportRect.left + viewport.scrollLeft
        : anchorRect.left;
      const documentTop = attachedInsideViewport
        ? (placement === 'after' ? anchorRect.bottom + 6 : anchorRect.top - chromeHeight - 6) -
          viewportRect.top +
          viewport.scrollTop
        : placement === 'after'
          ? anchorRect.bottom + 6
          : anchorRect.top - chromeHeight - 6;

      setStyle({
        position: attachedInsideViewport ? 'absolute' : 'fixed',
        left: Math.max(attachedInsideViewport ? viewport.scrollLeft + 8 : 8, documentLeft + 8),
        top: Math.max(8, documentTop),
        maxWidth: Math.max(240, Math.min(anchorRect.width - 16, viewport.clientWidth - 16)),
        visibility: 'visible',
      });
    };

    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(update);
    };

    resizeObserver.observe(viewport);
    resizeObserver.observe(chrome);
    const mutationObserver = new MutationObserver(schedule);
    mutationObserver.observe(surface, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-docx-hf-active', 'data-docx-note-scope'],
    });
    viewport.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    update();

    return () => {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      viewport.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [findAnchor, placement]);

  return { ref, style };
}
