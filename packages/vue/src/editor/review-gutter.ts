import { ref, shallowRef, watch, type ShallowRef } from 'vue';
import type { EditorSnapshot, PageSetup } from '@docx-editor.dev/core/contracts/editor';
import { ZOOM_MAX } from '@docx-editor.dev/core/editor';
import { twipsToPixels } from '../lib/units';
import { useReviewRailRegistry } from './context';
import { useEditorState } from './useEditorState';
import {
  useNavigationReservation,
  useNavigationViewportElement,
} from './navigation/navigation-layout';
import { scopeDispose } from './scope-dispose';

/** Full reservation for the card column and page-edge gap. @public */
export const REVIEW_PANE_GUTTER = 316;

/** Reservation for markers and the add-comment button. @public */
export const REVIEW_MARKERS_GUTTER = 44;

/** Page-edge clearance required before the full column stands. @public */
export const REVIEW_GUTTER_PAGE_CLEARANCE = 24;

/** Scroll-container reservations on each inline edge. @public */
export interface ReviewGutter {
  readonly inlineStart: number;
  readonly inlineEnd: number;
}

const FULL_COLUMN: ReviewGutter = { inlineStart: 0, inlineEnd: REVIEW_PANE_GUTTER };
const BALANCED_STRIP: ReviewGutter = {
  inlineStart: REVIEW_MARKERS_GUTTER,
  inlineEnd: REVIEW_MARKERS_GUTTER,
};
const NO_GUTTER: ReviewGutter = { inlineStart: 0, inlineEnd: 0 };

/** Inputs for {@link reviewGutter}. @public */
export interface ReviewGutterInput {
  readonly open: boolean;
  readonly viewportWidth: number;
  readonly pageWidthPx: number;
  readonly inlineStartReservation?: number;
  readonly docked?: boolean;
}

/** Returns the inline-edge reservations for the current rail geometry. @public */
export function reviewGutter({
  open,
  viewportWidth,
  pageWidthPx,
  inlineStartReservation = 0,
  docked = false,
}: ReviewGutterInput): ReviewGutter {
  if (!open) return BALANCED_STRIP;
  if (docked) return FULL_COLUMN;
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return FULL_COLUMN;
  if (!Number.isFinite(pageWidthPx) || pageWidthPx <= 0) return FULL_COLUMN;
  const start =
    Number.isFinite(inlineStartReservation) && inlineStartReservation > 0
      ? inlineStartReservation
      : 0;
  const leftover = viewportWidth - start - pageWidthPx - 2 * REVIEW_GUTTER_PAGE_CLEARANCE;
  return leftover >= REVIEW_PANE_GUTTER ? FULL_COLUMN : BALANCED_STRIP;
}

interface GutterGeometry {
  readonly pageSetup: PageSetup | null;
  readonly reviewPaneOpen: boolean;
  readonly entitledZoom: number | null;
}

const selectGutterGeometry = (snapshot: EditorSnapshot): GutterGeometry => {
  const mode = snapshot.zoomMode;
  return {
    pageSetup: snapshot.pageSetup ?? null,
    reviewPaneOpen: snapshot.reviewPaneOpen ?? true,
    entitledZoom:
      mode?.type === 'fit'
        ? mode.maxZoom !== undefined && mode.maxZoom < ZOOM_MAX
          ? mode.maxZoom
          : null
        : snapshot.zoom,
  };
};

const sameGutterGeometry = (a: GutterGeometry, b: GutterGeometry) =>
  a.reviewPaneOpen === b.reviewPaneOpen &&
  a.entitledZoom === b.entitledZoom &&
  a.pageSetup?.pageWidthTwips === b.pageSetup?.pageWidthTwips;

/** Returns the registered viewport width and updates after resize. @public */
export function useViewportClientWidth(): ShallowRef<number | null> {
  const viewport = useNavigationViewportElement();
  const width = shallowRef<number | null>(null);
  const stop = watch(
    viewport,
    (element, _, onCleanup) => {
      if (!element) {
        width.value = null;
        return;
      }
      const sync = () => {
        width.value = element.clientWidth;
      };
      sync();
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(sync);
      observer.observe(element);
      onCleanup(() => observer.disconnect());
    },
    { immediate: true, flush: 'post' }
  );
  scopeDispose(stop);
  return width;
}

/** Returns the live review-rail reservation for the viewport and rulers. @public */
export function useReviewGutter(): ShallowRef<ReviewGutter> {
  const rail = useReviewRailRegistry();
  const geometry = useEditorState(selectGutterGeometry, sameGutterGeometry);
  const viewport = useNavigationViewportElement();
  const navigationReservation = useNavigationReservation();
  const lastPageWidthTwips = ref<number | null>(null);
  const gutter = shallowRef<ReviewGutter>(NO_GUTTER);

  const stop = watch(
    [rail, geometry, viewport, navigationReservation],
    ([registry, current, element, startReservation], _, onCleanup) => {
      if (current.pageSetup) lastPageWidthTwips.value = current.pageSetup.pageWidthTwips;
      const compute = (): ReviewGutter => {
        if ((registry.mounted ?? 0) === 0) return NO_GUTTER;
        const pageWidthTwips = current.pageSetup?.pageWidthTwips ?? lastPageWidthTwips.value;
        return reviewGutter({
          open: current.reviewPaneOpen,
          viewportWidth: element?.clientWidth ?? 0,
          pageWidthPx:
            pageWidthTwips === null || current.entitledZoom === null
              ? 0
              : twipsToPixels(pageWidthTwips) * current.entitledZoom,
          inlineStartReservation: startReservation,
          docked: current.entitledZoom === null,
        });
      };
      const sync = () => {
        const next = compute();
        if (next !== gutter.value) gutter.value = next;
      };
      sync();
      if (!element || typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(sync);
      observer.observe(element);
      onCleanup(() => observer.disconnect());
    },
    { immediate: true, flush: 'post' }
  );
  scopeDispose(stop);
  return gutter;
}
