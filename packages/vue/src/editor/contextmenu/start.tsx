// `ContextMenu.Start`: host rows placed above the packaged rows.
//
// The menu hoists Start by reading its slot children, so only a Start it can SEE moves: a
// direct child, or one inside Fragments. A Start that a host component returns is invisible
// to that read and renders where the component sits, after the default rows. The menu wraps
// each region in `StartPlacementRegion`, so such a Start can warn in development instead of
// landing at the bottom silently.

import { defineComponent, h, inject, provide, type InjectionKey, type PropType } from 'vue';
import { isDevelopment } from '../../lib/is-development';
import { flattenChildren } from '../../lib/flattenChildren';
import { MenuSeparator } from '../menu/parts';
import { warnPackagedRowInStart, warnStartNotDirectChild } from '../menu/menu-warnings';

/**
 * Where the menu renders a child: hoisted above the default rows, appended after them, or
 * verbatim in written order (`preset={false}`).
 */
type StartPlacement = 'hoisted' | 'appended' | 'verbatim';

const START_PLACEMENT: InjectionKey<StartPlacement> = Symbol('docx-context-menu-start-placement');

/** Renders its slot and tells any `ContextMenu.Start` inside it which region it is in. */
export const StartPlacementRegion = defineComponent({
  name: 'ContextMenuStartPlacementRegion',
  props: {
    placement: { type: String as PropType<StartPlacement>, required: true },
  },
  setup(props, { slots }) {
    provide(START_PLACEMENT, props.placement);
    return () => slots.default?.();
  },
});

/**
 * Host rows that render above the packaged rows instead of after them.
 *
 * Use it for rows about the item under the pointer, such as spelling suggestions for the
 * word that was right-clicked. Read that item with `useContextMenuTarget()`. A menu opened
 * from the keyboard has no target: `useContextMenuAnchor()` reports `trigger: 'keyboard'`,
 * and `editor.getSelectionRange()` reads the caret instead. It must be a direct child of
 * `DocxEditor.ContextMenu`; a component that returns it renders at the end.
 *
 * @public
 */
export const ContextMenuStart = Object.assign(
  defineComponent({
    name: 'ContextMenuStart',
    setup(_, { slots }) {
      if (inject(START_PLACEMENT, null) === 'appended') warnStartNotDirectChild();
      return () => [...(slots.default?.() ?? []), h(MenuSeparator)];
    },
  }),
  { docxRowPlacement: 'start' as const }
);

/** Whether a child asked to render ABOVE the default set. */
export function startPlacedChild(child: unknown): boolean {
  if (child == null || typeof child !== 'object' || !('type' in child)) return false;
  const type = (child as { type: unknown }).type as { docxRowPlacement?: unknown };
  if (typeof type !== 'function' && typeof type !== 'object') return false;
  return type?.docxRowPlacement === 'start';
}

/** Warn about packaged rows inside `Start`, which render again in their default place. */
export function warnPackagedRowsIn(
  startRows: readonly unknown[],
  rowOfChild: (child: unknown) => string | null
): void {
  if (!isDevelopment()) return;
  for (const start of startRows) {
    const slots = (start as { children?: unknown }).children as
      { default?: () => unknown } | unknown[] | null;
    const inner = flattenChildren(Array.isArray(slots) ? slots : slots?.default?.());
    warnPackagedRowsIn(inner.filter(startPlacedChild), rowOfChild);
    for (const child of inner) {
      const id = rowOfChild(child);
      if (id !== null) warnPackagedRowInStart(id);
    }
  }
}
