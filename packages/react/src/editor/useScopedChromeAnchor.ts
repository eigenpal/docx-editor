import { useCallback, useLayoutEffect, useState } from 'react';
import type { CSSProperties, RefCallback } from 'react';

type AnchorPlacement = 'before' | 'after' | 'story-label';

export interface ScopedChromeAnchor {
  readonly ref: RefCallback<HTMLDivElement>;
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
  const [chrome, setChrome] = useState<HTMLDivElement | null>(null);
  const ref = useCallback<RefCallback<HTMLDivElement>>((node) => setChrome(node), []);
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });

  useLayoutEffect(() => {
    const containingViewport = chrome?.closest<HTMLElement>('.docx-editor__scroll-container');
    const viewport =
      containingViewport ??
      chrome?.parentElement?.querySelector<HTMLElement>('.docx-editor__scroll-container');
    if (!chrome || !viewport) return undefined;

    let frame = 0;
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
        setStyle({ visibility: 'hidden' });
        return;
      }

      const viewportRect = viewport.getBoundingClientRect();
      const anchorRect = anchor.getBoundingClientRect();
      const chromeHeight =
        placement === 'story-label' ? Math.max(chrome.offsetHeight, 28) : chrome.offsetHeight;
      const clearance = placement === 'story-label' ? 6 : 4;
      const attachedInsideViewport = containingViewport === viewport;
      // Absolute children resolve against the scroller's padding edge. `getBoundingClientRect`
      // is the border box, so a reserved left/top gutter (`scrollbar-gutter: stable both-edges`
      // sets a non-zero `clientLeft` in Chromium) must be subtracted or the rail sits that
      // many pixels to the right/below the painted story.
      const documentLeft = attachedInsideViewport
        ? anchorRect.left - viewportRect.left - viewport.clientLeft + viewport.scrollLeft
        : anchorRect.left;
      const documentTop = attachedInsideViewport
        ? (placement === 'after'
            ? anchorRect.bottom + 6
            : anchorRect.top - chromeHeight - clearance) -
          viewportRect.top -
          viewport.clientTop +
          viewport.scrollTop
        : placement === 'after'
          ? anchorRect.bottom + 6
          : anchorRect.top - chromeHeight - clearance;
      const viewportEdge = attachedInsideViewport ? viewport.scrollLeft + 8 : 8;

      setStyle({
        position: attachedInsideViewport ? 'absolute' : 'fixed',
        left: placement === 'story-label' ? documentLeft : Math.max(viewportEdge, documentLeft + 8),
        top:
          placement === 'story-label'
            ? documentTop
            : Math.max(attachedInsideViewport ? viewport.scrollTop + 8 : 8, documentTop),
        ...(placement === 'story-label'
          ? { width: Math.max(240, Math.min(anchorRect.width, viewport.clientWidth - 16)) }
          : {
              maxWidth: Math.max(240, Math.min(anchorRect.width - 16, viewport.clientWidth - 16)),
            }),
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
    mutationObserver.observe(viewport, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-docx-hf-active', 'data-docx-note-scope'],
    });
    viewport.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    update();

    return () => {
      if (frame) cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      viewport.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [chrome, findAnchor, placement]);

  return { ref, style };
}
