// Whether a part renders inside `DocxEditorViewport`, the scroll container.
//
// An overlay positioned against the viewport's wrapper must not live inside the scroller:
// there it scrolls away with the pages. A part below the viewport renders its overlay into the
// viewport's parent element instead, the same place as a sibling of the viewport.

import { computed, inject, type ComputedRef, type InjectionKey, type Ref } from 'vue';

/** True below `DocxEditorViewport`. */
export const InsideViewportContext: InjectionKey<boolean> = Symbol('InsideViewportContext');

/**
 * Where an overlay renders. `inside` is true below the viewport; `host` is then the viewport's
 * parent element, or null until the viewport has mounted.
 */
export function useViewportOverlayHost(viewport: Ref<HTMLElement | null>): {
  readonly inside: boolean;
  readonly host: ComputedRef<HTMLElement | null>;
} {
  const inside = inject(InsideViewportContext, false);
  return {
    inside,
    host: computed(() => (inside ? (viewport.value?.parentElement ?? null) : null)),
  };
}
