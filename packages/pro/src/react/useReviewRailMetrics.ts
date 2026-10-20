/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The public read of the review rail's geometry. The Vue twin is
// `../vue/useReviewRailMetrics.ts`.

import { createContext, useContext, useEffect, useMemo, useState, type RefObject } from 'react';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import {
  REVIEW_PANE_GUTTER,
  ReviewRailContext,
  useDocxEditor,
  useEditorState,
  useReviewGutter,
} from '@docx-editor.dev/react';
import {
  INITIAL_REVIEW_RAIL_METRICS,
  isCompactReviewColumn,
  reviewRailPlacementProblem,
  warnReviewRailMetrics,
  type ReviewRailMetrics,
} from '../review/rail-metrics.ts';
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
  /**
   * With a `railRef`, reserve the review gutter beside the page while the column element is
   * mounted, as `DocxEditorReview` does. The viewport then shifts the page left while the
   * pane is open. The reservation does not show the comment controls in the toolbar and the
   * context menu; see `ReviewRailContext` to serve them from your column. Set `false` when a
   * mounted `DocxEditorReview` already reserves the gutter, or when your column overlays the
   * page. Default: `true`.
   */
  readonly reserveGutter?: boolean;
}

/** One string, so an unrelated snapshot change does not re-render the caller. */
const selectRemeasure = (snapshot: EditorSnapshot) =>
  `${snapshot.zoom}|${snapshot.isLoading}|${snapshot.isOpening ?? false}`;
const selectLoaded = (snapshot: EditorSnapshot) =>
  !snapshot.isLoading && !snapshot.isOpening && snapshot.parseError === null;
const selectPaneOpen = (snapshot: EditorSnapshot) => snapshot.reviewPaneOpen ?? true;

/**
 * The review column's geometry in CSS pixels: what converts review anchors and stacked
 * positions, which are layout points from the top of the first page, into a card's `top`.
 *
 * Call it without arguments inside `DocxEditorReview`, for example in children of
 * `<DocxEditorReview preset={false}>`, to read the packaged rail's own measurement. Those
 * children render inside the rail element, which already sits at `left`.
 *
 * Pass `railRef` to measure your own column instead. Attach the ref to an element that
 * the calling component renders, give it `position: absolute`, and render it directly
 * inside `DocxEditor.Viewport` with no positioned element in between: its offset parent
 * must be the scroll container that holds the pages. Development builds warn once when it
 * is not. The column reserves the review gutter unless `reserveGutter` is `false`.
 *
 * While `useReview().paneOpen` is false the viewport reserves only a marker strip, so
 * render no cards then. `compact` is true when the pane is open but too narrow for a column.
 *
 * The value updates when the zoom, the window size, the page count, the document load,
 * content above the pages, or the reserved review gutter changes. It works in a pop-out
 * window or an iframe, because it observes the element's own window.
 *
 * @example Position custom cards
 * ```tsx
 * function MyColumn({ heights }: { heights: ReadonlyMap<string, number> }) {
 *   const railRef = useRef<HTMLDivElement>(null);
 *   const metrics = useReviewRailMetrics(railRef);
 *   const { items } = useReview();
 *   const positions = useStackedReviewPositions(items, heights, { scale: metrics.scale });
 *   return (
 *     <div
 *       ref={railRef}
 *       style={{
 *         position: 'absolute',
 *         top: 0,
 *         left: metrics.left ?? 0,
 *         visibility: metrics.left === null ? 'hidden' : 'visible',
 *       }}
 *     >
 *       {items.map((item) => (
 *         <MyCard
 *           key={item.key}
 *           item={item}
 *           style={{
 *             position: 'absolute',
 *             top: metrics.top + (positions.get(item.key) ?? 0) * metrics.scale,
 *           }}
 *         />
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 *
 * @see {@link https://www.docx-editor.dev/docs/2.x/recipes/custom-review-cards | Custom cards in the review rail}
 * @public
 */
export function useReviewRailMetrics(
  railRef?: RefObject<HTMLElement | null> | null,
  options?: UseReviewRailMetricsOptions
): ReviewRailMetrics {
  const provided = useContext(ReviewRailMetricsContext);
  const registry = useContext(ReviewRailContext);
  const editor = useDocxEditor();
  const remeasure = useEditorState(selectRemeasure);
  const loaded = useEditorState(selectLoaded);
  const paneOpen = useEditorState(selectPaneOpen);
  const gutter = useReviewGutter();
  const refMode = railRef !== undefined && railRef !== null;
  // A ref object does not notify when its element mounts, so check it after every commit
  // and re-bind only when the element itself changed. The updater returns the previous
  // state when nothing changed, so React bails out and the effect cannot loop.
  const [element, setElement] = useState<HTMLElement | null>(null);
  // eslint-disable-next-line react/exhaustive-deps -- runs after every commit by design
  useEffect(() => {
    const next = railRef?.current ?? null;
    setElement((previous) => (previous === next ? previous : next));
  });
  const elementRef = useMemo(() => ({ current: element }), [element]);
  // Only while the element exists: a column rendered conditionally must not leave the page
  // shifted after it is gone.
  const reserve = refMode && element !== null && (options?.reserveGutter ?? true);
  useEffect(() => (reserve ? registry?.reserveGutter?.() : undefined), [registry, reserve]);
  const geometry = useRailMetrics(
    refMode ? editor : null,
    elementRef,
    remeasure,
    element !== null,
    options?.trackScroll ?? false
  );
  // Wrong placement fails silently otherwise: the column renders, at the wrong place.
  useEffect(() => {
    if (!refMode) {
      if (!provided) {
        warnReviewRailMetrics(
          'called without a railRef outside DocxEditorReview, so it returns the initial ' +
            'value. Pass a ref to your column element, or call it inside DocxEditorReview.'
        );
      }
      return;
    }
    if (!element || !loaded) return;
    const problem = reviewRailPlacementProblem(element);
    if (problem) warnReviewRailMetrics(problem);
  }, [refMode, provided, element, loaded]);
  const compact = isCompactReviewColumn(paneOpen, gutter.inlineEnd, REVIEW_PANE_GUTTER);
  const measured = useMemo(() => ({ ...geometry, compact }), [geometry, compact]);
  if (refMode) return element ? measured : INITIAL_REVIEW_RAIL_METRICS;
  return provided ?? INITIAL_REVIEW_RAIL_METRICS;
}
