// Whether a part renders inside `DocxEditorViewport`, the scroll container.
//
// An overlay positioned against the viewport's wrapper must not live inside the scroller:
// there it scrolls away with the pages. A part below the viewport renders its overlay into the
// viewport's parent element instead, the same place as a sibling of the viewport.

import { inject, shallowRef, watch, type InjectionKey, type Ref, type ShallowRef } from 'vue';
import { scopeDispose } from './scope-dispose';

/** True below `DocxEditorViewport`. */
export const InsideViewportContext: InjectionKey<boolean> = Symbol('InsideViewportContext');

/** Where an overlay below the viewport renders, read from the mounted DOM. */
export interface ViewportOverlayTarget {
  /** The viewport's parent element. */
  readonly host: HTMLElement;
  /** Whether `host` or an ancestor already carries the `.docx-editor` scope. */
  readonly scoped: boolean;
}

/**
 * Where an overlay renders. `inside` is true below the viewport. `target` is read after the
 * DOM is updated (a post-flush watch keyed on the viewport element), never during render,
 * and is null until the viewport has mounted. It follows a remount of the viewport; a host
 * that moves the viewport to another parent without remounting it keeps the parent read at
 * mount.
 */
export function useViewportOverlayHost(viewport: Ref<HTMLElement | null>): {
  readonly inside: boolean;
  readonly target: ShallowRef<ViewportOverlayTarget | null>;
} {
  const inside = inject(InsideViewportContext, false);
  const target = shallowRef<ViewportOverlayTarget | null>(null);
  scopeDispose(
    watch(
      viewport,
      (element) => {
        const host = inside ? (element?.parentElement ?? null) : null;
        target.value = host ? { host, scoped: host.closest('.docx-editor') !== null } : null;
      },
      { immediate: true, flush: 'post' }
    )
  );
  return { inside, target };
}
