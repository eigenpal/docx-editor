/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The public read of the review rail's geometry, and the binding the packaged rail measures
// itself with. The React twin is `../react/useReviewRailMetrics.ts`.

import {
  computed,
  inject,
  onScopeDispose,
  shallowRef,
  toValue,
  watch,
  type InjectionKey,
  type MaybeRefOrGetter,
  type Ref,
  type ShallowRef,
} from 'vue';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import {
  REVIEW_PANE_GUTTER,
  ReviewRailContext,
  useDocxEditor,
  useEditorState,
  useReviewGutter,
} from '@docx-editor.dev/vue';
import {
  INITIAL_REVIEW_RAIL_METRICS,
  isCompactReviewColumn,
  observeReviewRailMetrics,
  reviewRailPlacementProblem,
  sameReviewRailMetrics,
  warnReviewRailMetrics,
  type RenderScaleSource,
  type ReviewRailGeometry,
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
): Readonly<ShallowRef<ReviewRailGeometry>> {
  const metrics = shallowRef<ReviewRailGeometry>(INITIAL_REVIEW_RAIL_METRICS);
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

/** The review column's geometry for Vue hosts. @public */
export interface UseReviewRailMetricsReturn {
  /** The current measurement. See `ReviewRailMetrics` for each value's meaning. */
  readonly metrics: Readonly<Ref<ReviewRailMetrics>>;
}

const selectRemeasure = (snapshot: EditorSnapshot) =>
  `${snapshot.zoom}|${snapshot.isLoading}|${snapshot.isOpening ?? false}`;
const selectLoaded = (snapshot: EditorSnapshot) =>
  !snapshot.isLoading && !snapshot.isOpening && snapshot.parseError === null;
const selectPaneOpen = (snapshot: EditorSnapshot) => snapshot.reviewPaneOpen ?? true;

/**
 * The review column's geometry in CSS pixels: what converts review anchors and stacked
 * positions, which are layout points from the top of the first page, into a card's `top`.
 *
 * Call it without arguments inside `DocxEditorReview`, for example in a component placed in
 * `<DocxEditorReview :preset="false">`, to read the packaged rail's own measurement. Those
 * children render inside the rail element, which already sits at `left`.
 *
 * Pass `railRef`, a template ref or a getter, to measure your own column instead. Give the
 * element `position: absolute` and render it directly inside `DocxEditor.Viewport` with no
 * positioned element in between: its offset parent must be the scroll container that holds
 * the pages. Development builds warn once when it is not. The column reserves the review
 * gutter unless `reserveGutter` is `false`.
 *
 * While `useReview().paneOpen` is false the viewport reserves only a marker strip, so
 * render no cards then. `compact` is true when the pane is open but too narrow for a column.
 *
 * The value updates when the zoom, the window size, the page count, the document load,
 * content above the pages, or the reserved review gutter changes. It works in a pop-out
 * window or an iframe, because it observes the element's own window.
 *
 * @example Position custom cards
 * ```vue
 * <script setup lang="ts">
 * import { ref } from 'vue';
 * import {
 *   useReview,
 *   useReviewRailMetrics,
 *   useStackedReviewPositions,
 * } from '@docx-editor.dev/pro/vue';
 *
 * const props = defineProps<{ heights: ReadonlyMap<string, number> }>();
 * const railRef = ref<HTMLElement | null>(null);
 * const { metrics } = useReviewRailMetrics(railRef);
 * const { items } = useReview();
 * const positions = useStackedReviewPositions(items, () => props.heights, () => ({
 *   scale: metrics.value.scale,
 * }));
 * const topOf = (key: string) =>
 *   metrics.value.top + (positions.value.get(key) ?? 0) * metrics.value.scale;
 * </script>
 *
 * <template>
 *   <div
 *     ref="railRef"
 *     :style="{
 *       position: 'absolute',
 *       top: '0px',
 *       left: `${metrics.left ?? 0}px`,
 *       visibility: metrics.left === null ? 'hidden' : 'visible',
 *     }"
 *   >
 *     <MyCard
 *       v-for="item in items"
 *       :key="item.key"
 *       :item="item"
 *       :style="{ position: 'absolute', top: `${topOf(item.key)}px` }"
 *     />
 *   </div>
 * </template>
 * ```
 *
 * @see {@link https://www.docx-editor.dev/docs/2.x/recipes/custom-review-cards | Custom cards in the review rail}
 * @public
 */
export function useReviewRailMetrics(
  railRef?: MaybeRefOrGetter<HTMLElement | null> | null,
  options?: MaybeRefOrGetter<UseReviewRailMetricsOptions | undefined>
): UseReviewRailMetricsReturn {
  const provided = inject(ReviewRailMetricsKey, null);
  if (railRef === undefined || railRef === null) {
    if (!provided) {
      warnReviewRailMetrics(
        'called without a railRef outside DocxEditorReview, so it returns the initial ' +
          'value. Pass a ref to your column element, or call it inside DocxEditorReview.'
      );
    }
    return { metrics: provided ?? shallowRef(INITIAL_REVIEW_RAIL_METRICS) };
  }
  const element = computed(() => toValue(railRef) ?? null);
  const editorRef = useDocxEditor();
  const remeasure = useEditorState(selectRemeasure);
  const loaded = useEditorState(selectLoaded);
  const paneOpen = useEditorState(selectPaneOpen);
  const gutter = useReviewGutter();
  const registry = inject(ReviewRailContext, null);

  // Keyed on the option and the element alone: reserving replaces the registry's value (its
  // count changes), so watching that value too re-reserved on every reservation. Only while
  // the element exists, so a column rendered conditionally does not leave the page shifted.
  let unregister: (() => void) | undefined;
  watch(
    () => element.value !== null && (toValue(options)?.reserveGutter ?? true),
    (reserve) => {
      unregister?.();
      unregister = reserve ? registry?.value.reserveGutter?.() : undefined;
    },
    { immediate: true }
  );
  onScopeDispose(() => unregister?.());

  const geometry = bindReviewRailMetrics({
    rail: () => element.value,
    editor: () => editorRef.value,
    trackScroll: () => toValue(options)?.trackScroll ?? false,
    remeasure: () => remeasure.value,
  });
  watch(
    [element, loaded],
    ([rail, ready]) => {
      if (!rail || !ready) return;
      const problem = reviewRailPlacementProblem(rail);
      if (problem) warnReviewRailMetrics(problem);
    },
    { flush: 'post', immediate: true }
  );
  const metrics = computed<ReviewRailMetrics>(() =>
    element.value
      ? {
          ...geometry.value,
          compact: isCompactReviewColumn(
            paneOpen.value,
            gutter.value.inlineEnd,
            REVIEW_PANE_GUTTER
          ),
        }
      : INITIAL_REVIEW_RAIL_METRICS
  );
  return { metrics };
}
