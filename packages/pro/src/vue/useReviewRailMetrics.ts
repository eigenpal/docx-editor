/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The public read of the review rail's geometry, and the binding the packaged rail measures
// itself with. The React twin is `../react/useReviewRailMetrics.ts`.

import {
  inject,
  shallowRef,
  toValue,
  watch,
  type InjectionKey,
  type MaybeRefOrGetter,
  type Ref,
  type ShallowRef,
} from 'vue';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { useDocxEditor, useEditorState } from '@docx-editor.dev/vue';
import {
  INITIAL_REVIEW_RAIL_METRICS,
  observeReviewRailMetrics,
  sameReviewRailMetrics,
  type RenderScaleSource,
  type ReviewRailMetrics,
} from '../review/rail-metrics.ts';

/**
 * The packaged rail's own measurement, provided by `DocxEditorReview` to its children.
 * Separate from the rail's data context so a resize does not re-render every card.
 * @internal
 */
export const ReviewRailMetricsKey: InjectionKey<Readonly<Ref<ReviewRailMetrics>>> =
  Symbol('ReviewRailMetrics');

/** What {@link bindReviewRailMetrics} measures, read inside a watcher. @internal */
export interface ReviewRailMetricsBinding {
  readonly rail: () => HTMLElement | null;
  readonly editor: () => RenderScaleSource | null;
  readonly trackScroll: () => boolean;
  /** Any reactive value whose change can move the rail without resizing it. */
  readonly remeasure: () => unknown;
  readonly beforeMeasure?: (container: HTMLElement | null) => void;
}

/**
 * Keep a ref current with `measureReviewRailMetrics` while the binding's rail exists. The
 * observers stop with the calling component's scope.
 * @internal
 */
export function bindReviewRailMetrics(
  binding: ReviewRailMetricsBinding
): Readonly<ShallowRef<ReviewRailMetrics>> {
  const metrics = shallowRef<ReviewRailMetrics>(INITIAL_REVIEW_RAIL_METRICS);
  watch(
    [binding.rail, binding.editor, binding.trackScroll, binding.remeasure],
    ([rail, editor, trackScroll], _previous, onCleanup) => {
      if (!rail || !editor) return;
      onCleanup(
        observeReviewRailMetrics(
          rail,
          editor,
          (next) => {
            if (!sameReviewRailMetrics(metrics.value, next)) metrics.value = next;
          },
          { trackScroll, beforeMeasure: binding.beforeMeasure }
        )
      );
    },
    { flush: 'post', immediate: true }
  );
  return metrics;
}

/** Options for {@link useReviewRailMetrics}. @public */
export interface UseReviewRailMetricsOptions {
  /**
   * Re-measure while the scroll container scrolls. Only `compactCardLeft` changes with
   * scrolling, and only when the page is wider than the viewport. Default: `false`.
   */
  readonly trackScroll?: boolean;
}

/** The review column's geometry for Vue hosts. @public */
export interface UseReviewRailMetricsReturn {
  /** The current measurement. See `ReviewRailMetrics` for each value's meaning. */
  readonly metrics: Readonly<Ref<ReviewRailMetrics>>;
}

const selectZoom = (snapshot: EditorSnapshot) => snapshot.zoom;

/**
 * The review column's geometry in CSS pixels: what converts review anchors and stacked
 * positions, which are layout points from the top of the first page, into a card's `top`.
 *
 * Call it without arguments inside `DocxEditorReview`, for example in a component placed in
 * `<DocxEditorReview :preset="false">`, to read the packaged rail's own measurement. Those
 * children render inside the rail element, which already sits at `left`.
 *
 * Pass `railRef` to measure your own column instead. The element must be absolutely
 * positioned inside `DocxEditor.Viewport`, so that its offset parent is the editor's scroll
 * container. The value updates when the zoom, the window size, the page count, or the
 * reserved review gutter changes. It works in a pop-out window or an iframe, because it
 * observes the element's own window.
 *
 * @example Position custom cards
 * ```vue
 * <script setup lang="ts">
 * import { ref } from 'vue';
 * import { useReview, useReviewRailMetrics, useStackedReviewPositions } from '@docx-editor.dev/pro/vue';
 *
 * const railRef = ref<HTMLElement | null>(null);
 * const { metrics } = useReviewRailMetrics(railRef);
 * const { items } = useReview();
 * const positions = useStackedReviewPositions(items, heights, () => ({ scale: metrics.value.scale }));
 * const topOf = (key: string) => metrics.value.top + (positions.value.get(key) ?? 0) * metrics.value.scale;
 * </script>
 * ```
 *
 * @public
 */
export function useReviewRailMetrics(
  railRef?: Ref<HTMLElement | null> | null,
  options?: MaybeRefOrGetter<UseReviewRailMetricsOptions | undefined>
): UseReviewRailMetricsReturn {
  if (!railRef) {
    return { metrics: inject(ReviewRailMetricsKey, shallowRef(INITIAL_REVIEW_RAIL_METRICS)) };
  }
  const editorRef = useDocxEditor();
  const zoom = useEditorState(selectZoom);
  const measured = bindReviewRailMetrics({
    rail: () => railRef.value,
    editor: () => editorRef.value,
    trackScroll: () => toValue(options)?.trackScroll ?? false,
    remeasure: () => zoom.value,
  });
  // An element that unmounts leaves no column to place against.
  const metrics = shallowRef<ReviewRailMetrics>(INITIAL_REVIEW_RAIL_METRICS);
  watch(
    [measured, () => railRef.value],
    ([value, rail]) => {
      metrics.value = rail ? value : INITIAL_REVIEW_RAIL_METRICS;
    },
    { immediate: true, flush: 'sync' }
  );
  return { metrics };
}
