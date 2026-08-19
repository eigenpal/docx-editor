import {
  computed,
  ref,
  shallowRef,
  toValue,
  watch,
  type ComputedRef,
  type MaybeRefOrGetter,
} from 'vue';
import { scopeDispose } from '../scope-dispose';
import type { EditorSnapshot, PageSetup } from '@docx-editor.dev/core/contracts/editor';
import { ZOOM_MAX, ZOOM_MIN } from '@docx-editor.dev/core/editor';
import { twipsToPixels } from '../../lib/units';
import { inject } from 'vue';
import { ReviewRailContext } from '../context';
import { useEditorState } from '../useEditorState';
import {
  NAVIGATION_PANE_WIDTH,
  navigationPaneReservation,
  navigationShift,
} from './navigation-geometry';
import { useNavigationLayoutStore, useNavigationViewportElement } from './navigation-layout';

/** @public */
export type NavigationTab = 'headings' | 'find';

/** @internal */
export interface PaneGeometry {
  readonly pageSetup: PageSetup | null;
  readonly zoom: number;
  readonly reviewPaneOpen: boolean;
  readonly fitting: boolean;
}

/** @internal */
export const selectPaneGeometry = (snapshot: EditorSnapshot): PaneGeometry => {
  const mode = snapshot.zoomMode;
  return {
    pageSetup: snapshot.pageSetup ?? null,
    zoom: snapshot.zoom,
    reviewPaneOpen: snapshot.reviewPaneOpen ?? true,
    fitting:
      mode?.type === 'fit' &&
      snapshot.zoom < (mode.maxZoom ?? ZOOM_MAX) &&
      snapshot.zoom > (mode.minZoom ?? ZOOM_MIN),
  };
};

const samePageGeometry = (a: PaneGeometry, b: PaneGeometry) =>
  a.zoom === b.zoom &&
  a.reviewPaneOpen === b.reviewPaneOpen &&
  a.fitting === b.fitting &&
  a.pageSetup?.pageWidthTwips === b.pageSetup?.pageWidthTwips;

/** @public */
export interface UseNavigationPaneOptions {
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultTab?: NavigationTab;
  tab?: NavigationTab;
  onTabChange?: (tab: NavigationTab) => void;
  paneWidth?: number;
}

/** @public */
export interface UseNavigationPaneResult {
  readonly open: ComputedRef<boolean>;
  readonly setOpen: (open: boolean) => void;
  readonly toggle: () => void;
  readonly tab: ComputedRef<NavigationTab>;
  readonly setTab: (tab: NavigationTab) => void;
  readonly paneWidth: ComputedRef<number>;
  readonly shift: ComputedRef<number>;
}

/** @public */
export function useNavigationPane(
  options: MaybeRefOrGetter<UseNavigationPaneOptions> = {}
): UseNavigationPaneResult {
  const liveOptions = computed(() => toValue(options));
  const uncontrolledOpen = ref(liveOptions.value.defaultOpen ?? false);
  const uncontrolledTab = ref<NavigationTab>(liveOptions.value.defaultTab ?? 'headings');

  watch(
    () => liveOptions.value.defaultOpen,
    (next) => {
      if (next !== undefined) uncontrolledOpen.value = next;
    },
    { immediate: true }
  );
  watch(
    () => liveOptions.value.defaultTab,
    (next) => {
      if (next !== undefined) uncontrolledTab.value = next;
    },
    { immediate: true }
  );

  const openVal = computed(() => liveOptions.value.open ?? uncontrolledOpen.value);
  const tabVal = computed(() => liveOptions.value.tab ?? uncontrolledTab.value);
  const isOpenControlled = computed(() => liveOptions.value.open !== undefined);
  const isTabControlled = computed(() => liveOptions.value.tab !== undefined);
  const paneWidthVal = computed(() => liveOptions.value.paneWidth ?? NAVIGATION_PANE_WIDTH);

  const setOpen = (next: boolean) => {
    if (!isOpenControlled.value) uncontrolledOpen.value = next;
    liveOptions.value.onOpenChange?.(next);
  };
  const toggle = () => setOpen(!openVal.value);
  const setTab = (next: NavigationTab) => {
    if (!isTabControlled.value) uncontrolledTab.value = next;
    liveOptions.value.onTabChange?.(next);
  };

  const store = useNavigationLayoutStore();
  const viewport = useNavigationViewportElement();
  const rail = inject(ReviewRailContext, shallowRef({ mounted: 0, register: () => () => {} }));
  const geometry = useEditorState(selectPaneGeometry, samePageGeometry);
  const viewportWidth = ref(0);
  const inlineEndReservation = ref(0);
  const inlineStartReservation = ref(0);

  scopeDispose(
    watch(
      [viewport, openVal, () => geometry.value.reviewPaneOpen, () => rail.value.mounted],
      () => {
        const el = viewport.value;
        if (!el) {
          viewportWidth.value = 0;
          inlineEndReservation.value = 0;
          inlineStartReservation.value = 0;
          return;
        }
        const measure = () => {
          viewportWidth.value = el.clientWidth;
          const style = getComputedStyle(el);
          const padding = Number.parseFloat(style.paddingInlineEnd);
          inlineEndReservation.value = Number.isFinite(padding) ? padding : 0;
          const strip = Number.parseFloat(style.getPropertyValue('--docx-review-gutter-start'));
          inlineStartReservation.value = Number.isFinite(strip) ? strip : 0;
        };
        measure();
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
      },
      { flush: 'post' }
    )
  );

  const lastPageWidthTwips = ref<number | null>(null);
  watch(
    () => geometry.value.pageSetup,
    (pageSetup) => {
      if (pageSetup) lastPageWidthTwips.value = pageSetup.pageWidthTwips;
    },
    { immediate: true }
  );

  const shift = computed(() => {
    if (!openVal.value) return 0;
    const pageWidthTwips = geometry.value.pageSetup?.pageWidthTwips ?? lastPageWidthTwips.value;
    if (pageWidthTwips === null) return 0;
    return navigationShift({
      viewportWidth: viewportWidth.value,
      pageWidthPx: twipsToPixels(pageWidthTwips) * geometry.value.zoom,
      reservation: navigationPaneReservation(paneWidthVal.value),
      inlineEndReservation: inlineEndReservation.value,
      inlineStartReservation: inlineStartReservation.value,
      docked: geometry.value.fitting,
    });
  });

  scopeDispose(
    watch(
      [() => store, shift],
      () => {
        if (!store) return;
        store.setShift(shift.value);
      },
      { immediate: true, flush: 'post' }
    )
  );
  scopeDispose(() => store?.setShift(0));

  scopeDispose(
    watch(
      [() => store, openVal, paneWidthVal],
      () => {
        store?.setReservation(openVal.value ? navigationPaneReservation(paneWidthVal.value) : 0);
      },
      { immediate: true, flush: 'post' }
    )
  );
  scopeDispose(() => store?.setReservation(0));

  return {
    open: openVal,
    setOpen,
    toggle,
    tab: tabVal,
    setTab,
    paneWidth: paneWidthVal,
    shift,
  };
}
