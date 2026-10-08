// Keeps the menu bar's "⋯" panel inside the viewport, with the toolbar's placement rule.

import { ref, watch, type Ref } from 'vue';
import { toolbarPanelPlacement } from '../toolbar/toolbar-overflow';

/** The clamp for an open panel, in the trigger parent's coordinates. */
export interface MenuPanelStyle {
  readonly left: string;
  readonly right: 'auto';
  readonly maxInlineSize: string;
}

/**
 * The inline style that clamps an open panel to the viewport, or null while it is closed.
 * The panel is positioned against the trigger's parent, so `left` is in its coordinates.
 */
export function useMenuPanelPlacement(
  active: () => boolean,
  triggerRef: Ref<HTMLElement | null>,
  panelRef: Ref<HTMLElement | null>
): Ref<MenuPanelStyle | null> {
  const style = ref<MenuPanelStyle | null>(null);
  const place = (): void => {
    const trigger = triggerRef.value;
    const panel = panelRef.value;
    const root = trigger?.parentElement;
    const view = trigger?.ownerDocument.defaultView;
    if (!trigger || !panel || !root || !view) return;
    const rect = trigger.getBoundingClientRect();
    const next = toolbarPanelPlacement({
      triggerLeft: rect.left,
      triggerRight: rect.right,
      panelWidth: panel.offsetWidth,
      viewportWidth: view.innerWidth,
    });
    style.value = {
      left: `${next.left - root.getBoundingClientRect().left}px`,
      right: 'auto',
      maxInlineSize: `${next.maxWidth}px`,
    };
  };
  watch(
    active,
    (isActive, _, onCleanup) => {
      if (!isActive) {
        style.value = null;
        return;
      }
      place();
      const view = triggerRef.value?.ownerDocument.defaultView;
      view?.addEventListener('resize', place);
      onCleanup(() => view?.removeEventListener('resize', place));
    },
    { flush: 'post' }
  );
  return style;
}
