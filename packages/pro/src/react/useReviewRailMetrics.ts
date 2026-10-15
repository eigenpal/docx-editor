/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The public read of the review rail's geometry. The Vue twin is
// `../vue/useReviewRailMetrics.ts`.

import { createContext, useContext, useEffect, useMemo, useState, type RefObject } from 'react';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { useDocxEditor, useEditorState } from '@docx-editor.dev/react';
import { INITIAL_REVIEW_RAIL_METRICS, type ReviewRailMetrics } from '../review/rail-metrics.ts';
import { useRailMetrics } from './use-rail-geometry.ts';

/**
 * The packaged rail's own measurement, provided by `DocxEditorReview` to its children.
 * Separate from the rail's data context so a resize does not re-render every card.
 */
export const ReviewRailMetricsContext = createContext<ReviewRailMetrics | null>(null);

/** Options for {@link useReviewRailMetrics}. @public */
export interface UseReviewRailMetricsOptions {
  /**
   * Re-measure while the scroll container scrolls. Only `compactCardLeft` changes with
   * scrolling, and only when the page is wider than the viewport. Default: `false`.
   */
  readonly trackScroll?: boolean;
}

const selectZoom = (snapshot: EditorSnapshot) => snapshot.zoom;

/**
 * The review column's geometry in CSS pixels: what converts review anchors and stacked
 * positions, which are layout points from the top of the first page, into a card's `top`.
 *
 * Call it without arguments inside `DocxEditorReview`, for example in children of
 * `<DocxEditorReview preset={false}>`, to read the packaged rail's own measurement. Those
 * children render inside the rail element, which already sits at `left`.
 *
 * Pass `railRef` to measure your own column instead. The element must be absolutely
 * positioned inside `DocxEditor.Viewport`, so that its offset parent is the editor's scroll
 * container. The value updates when the zoom, the window size, the page count, or the
 * reserved review gutter changes. It works in a pop-out window or an iframe, because it
 * observes the element's own window.
 *
 * @example Position custom cards
 * ```tsx
 * function MyColumn() {
 *   const railRef = useRef<HTMLDivElement>(null);
 *   const metrics = useReviewRailMetrics(railRef);
 *   const { items } = useReview();
 *   const positions = useStackedReviewPositions(items, heights, { scale: metrics.scale });
 *   return (
 *     <div ref={railRef} style={{ position: 'absolute', top: 0, left: metrics.left ?? 0 }}>
 *       {items.map((item) => (
 *         <MyCard
 *           key={item.key}
 *           item={item}
 *           style={{ top: metrics.top + (positions.get(item.key) ?? 0) * metrics.scale }}
 *         />
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 *
 * @public
 */
export function useReviewRailMetrics(
  railRef?: RefObject<HTMLElement | null> | null,
  options?: UseReviewRailMetricsOptions
): ReviewRailMetrics {
  const provided = useContext(ReviewRailMetricsContext);
  const editor = useDocxEditor();
  const zoom = useEditorState(selectZoom);
  // A ref object does not notify when its element mounts, so check it after every commit
  // and re-bind only when the element itself changed. The updater returns the previous
  // state when nothing changed, so React bails out and the effect cannot loop.
  const [element, setElement] = useState<HTMLElement | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runs after every commit by design
  useEffect(() => {
    const next = railRef?.current ?? null;
    setElement((previous) => (previous === next ? previous : next));
  });
  const elementRef = useMemo(() => ({ current: element }), [element]);
  const measured = useRailMetrics(
    railRef ? editor : null,
    elementRef,
    zoom,
    element !== null,
    options?.trackScroll ?? false
  );
  if (railRef) return element ? measured : INITIAL_REVIEW_RAIL_METRICS;
  return provided ?? INITIAL_REVIEW_RAIL_METRICS;
}
