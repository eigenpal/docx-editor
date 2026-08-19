/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The rail's geometry, measured from the DOM it hangs beside: where the rail sits
// (`useRailMetrics`) and which vertical band of the scroller is on screen
// (`useRailWindow`). Split out of `DocxEditorReview.tsx`, which is at its max-lines cap —
// these two hooks are the DOM-measurement half of the rail and share nothing with its
// composition logic.

import { useEffect, useState } from 'react';

/** Where the rail is, in the coordinates of its positioning container. */
export interface RailMetrics {
  /** Layout points to CSS pixels, from the engine. */
  readonly scale: number;
  /** The painted surface's own top offset, so chrome above the pages does not shift cards. */
  readonly top: number;
  /** Left edge, one gutter right of the sheet; null until there is a surface to measure. */
  readonly left: number | null;
  /**
   * Rail-local `left` that puts a compact card's RIGHT edge just inside the viewport's,
   * so the one floating card is fully visible instead of cut where the column would have
   * been. Null until there is a surface and a scroller to measure.
   */
  readonly compactCardLeft: number | null;
}

const INITIAL_METRICS: RailMetrics = { scale: 96 / 72, top: 0, left: null, compactCardLeft: null };

/** Space between the page edge and the cards. */
const RAIL_GUTTER = 16;

/** A compact card is one column-card wide — the width `.docx-review` gives the open rail. */
export const COMPACT_CARD_WIDTH = 300;
/** Air between a compact card's right edge and the viewport's. */
const COMPACT_CARD_INSET = 12;

/**
 * How far outside the visible scroll window a card still mounts, in pixels.
 *
 * Enough that a normal scroll or a pane toggle never shows an empty gutter, small enough
 * that a document with two hundred comments mounts a handful of cards rather than all of
 * them. Rendering every card was the toggle's lag: two hundred cards' worth of DOM, plus a
 * `top` transition on each, in one frame.
 */
const RAIL_OVERSCAN = 600;

/** The one engine read the measurement needs. */
interface RenderScaleSource {
  getRenderScale(): number;
}

/**
 * Where the rail sits, measured from the PAINTED SURFACE rather than from the viewport.
 *
 * Both halves matter. Vertically, the surface's own offset inside the scroll container is
 * whatever chrome the host put above the pages — without it every card is drawn that far
 * too high. Horizontally, the page is centred in a viewport that is usually much wider, so
 * a rail pinned to the right edge floats away from the page it annotates; it belongs one
 * gutter to the right of the sheet, and it moves with the sheet when the window resizes or
 * the zoom changes.
 *
 * Client rects, not `offsetLeft`/`offsetTop`: those are relative to each element's own
 * `offsetParent`, and a host that positions its page wrapper makes the surface report
 * `offsetLeft: 0` — landing the rail a page-width left, on top of the document. `scrollTop`
 * and `clientTop` put the rects back into the same space the offsets used to describe.
 *
 * `remeasure` re-runs the binding whenever the queue could have moved: a new page above an
 * anchor changes where its card belongs, and zoom changes every anchor at once. `mounted`
 * must be false while the rail element does not exist (document absent, `hidden`), so a
 * binding pass that ran against the null ref runs again once there is a rail to measure.
 */
export function useRailMetrics(
  editor: RenderScaleSource | null,
  railRef: React.RefObject<HTMLElement | null>,
  remeasure: unknown,
  mounted: boolean
): RailMetrics {
  const [metrics, setMetrics] = useState<RailMetrics>(INITIAL_METRICS);
  useEffect(() => {
    const rail = railRef.current;
    if (!editor || !rail) return undefined;
    const parent = rail.offsetParent as HTMLElement | null;
    const surface = parent?.querySelector<HTMLElement>('.docx-paginated-surface') ?? null;
    const sync = (): void => {
      setMetrics((previous) => {
        const box = surface && parent ? surface.getBoundingClientRect() : null;
        const frame = box && parent ? parent.getBoundingClientRect() : null;
        const left =
          box && frame && parent
            ? box.right - frame.left - parent.clientLeft + parent.scrollLeft + RAIL_GUTTER
            : null;
        const next: RailMetrics = {
          // The engine's own points-to-pixels factor, zoom included. Deriving it here from
          // `getZoom()` alone dropped the 96/72 and put every card at three quarters height.
          scale: editor.getRenderScale(),
          top:
            box && frame && parent ? box.top - frame.top - parent.clientTop + parent.scrollTop : 0,
          left,
          // The viewport's right edge in rail-local coordinates, minus a card and its
          // inset: where the compact floating card starts so nothing of it is cut off.
          compactCardLeft:
            left === null || !parent
              ? null
              : parent.scrollLeft +
                parent.clientWidth -
                left -
                COMPACT_CARD_WIDTH -
                COMPACT_CARD_INSET,
        };
        return previous.scale === next.scale &&
          previous.top === next.top &&
          previous.left === next.left &&
          previous.compactCardLeft === next.compactCardLeft
          ? previous
          : next;
      });
    };
    sync();
    const observer = new ResizeObserver(sync);
    if (parent) observer.observe(parent);
    if (surface) observer.observe(surface);
    return () => observer.disconnect();
  }, [editor, railRef, remeasure, mounted]);
  return metrics;
}

/**
 * The visible band of the scroller, in the rail's own coordinates. Passive listener,
 * coalesced into a frame: the handler runs on every wheel tick and must do nothing but
 * record two numbers. Null until there is a scroller to measure.
 *
 * `mounted` for the same reason as `useRailMetrics`: no rail element exists while the
 * document is absent or the rail is hidden, and the binding must re-run once one does.
 */
export function useRailWindow(
  editor: unknown,
  railRef: React.RefObject<HTMLElement | null>,
  mounted: boolean
): { top: number; bottom: number } | null {
  const [window_, setWindow] = useState<{ top: number; bottom: number } | null>(null);
  useEffect(() => {
    const rail = railRef.current;
    const scroller = rail?.offsetParent as HTMLElement | null;
    if (!scroller) return undefined;
    let frame = 0;
    const sync = (): void => {
      frame = 0;
      setWindow((previous) => {
        const top = scroller.scrollTop - RAIL_OVERSCAN;
        const bottom = scroller.scrollTop + scroller.clientHeight + RAIL_OVERSCAN;
        return previous && previous.top === top && previous.bottom === bottom
          ? previous
          : { top, bottom };
      });
    };
    // While the reader scrolls, the slots' `top` transition is suppressed (a DOM attribute
    // so no React work happens at scroll frequency). Restacks DURING a scroll come from
    // cards entering the window and correcting an estimated height to a measured one; each
    // correction shifts every card below it, and ANIMATING those shifts while the page
    // itself moves read as a second, faster scroll layered over the document.
    let settle = 0;
    const onScroll = (): void => {
      if (frame === 0) frame = requestAnimationFrame(sync);
      rail?.setAttribute('data-scrolling', '');
      window.clearTimeout(settle);
      settle = window.setTimeout(() => rail?.removeAttribute('data-scrolling'), 150);
    };
    sync();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    const observer = new ResizeObserver(onScroll);
    observer.observe(scroller);
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      window.clearTimeout(settle);
      scroller.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, [editor, railRef, mounted]);
  return window_;
}
