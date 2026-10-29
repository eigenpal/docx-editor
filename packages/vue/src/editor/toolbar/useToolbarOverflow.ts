// The toolbar's own measurement: how wide each control is, and how much room the bar has.
// The reading (`readToolbarRow`) and the fit (`toolbarOverflowItems`) live in core, so the
// React and Vue bars collapse the same controls at the same widths.

import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch, type Ref } from 'vue';
import {
  hostWindowOf,
  readToolbarRow,
  sameItemOverflow,
  TOOLBAR_OVERFLOW_HYSTERESIS,
  TOOLBAR_ITEM_ATTRIBUTE,
  toolbarGroupsKey,
  toolbarItemKey,
  toolbarOverflowItems,
  type HostWindow,
  type ToolbarFitGroup,
  type ToolbarItemOverflow,
  type ToolbarRowMemory,
} from '@docx-editor.dev/core/editor';

export const GROUP_ATTRIBUTE = 'data-toolbar-group';
/** Marks one control of a collapsible group; the value is the control id. */
export const ITEM_ATTRIBUTE = TOOLBAR_ITEM_ATTRIBUTE;
export const FIXED_ATTRIBUTE = 'data-toolbar-fixed';
export const MORE_ATTRIBUTE = 'data-toolbar-more';

const ASSUMED_MORE_WIDTH = 34;
const NONE: ToolbarItemOverflow = new Map<string, number>();

export interface UseToolbarOverflowResult {
  readonly attach: (element: HTMLElement | null) => void;
  /** Group id -> how many controls, from the end of the group, render in the "⋯" menu. */
  readonly overflow: Ref<ToolbarItemOverflow>;
}

export function useToolbarOverflow(
  enabled: Ref<boolean> | (() => boolean),
  groups: Ref<readonly ToolbarFitGroup[]> | (() => readonly ToolbarFitGroup[]),
  order: Ref<readonly string[]> | (() => readonly string[])
): UseToolbarOverflowResult {
  const barRef = shallowRef<HTMLElement | null>(null);
  // Widths SURVIVE a control leaving the bar. See `ToolbarRowMemory`.
  const memory: ToolbarRowMemory = {
    itemWidths: new Map(),
    groupBases: new Map(),
    groupGaps: new Map(),
    more: ASSUMED_MORE_WIDTH,
  };
  const overflow = ref<ToolbarItemOverflow>(NONE);
  let frame = 0;
  let observer: ResizeObserver | undefined;
  /** The window that issued `frame`, so a bar that moved windows still cancels it. */
  let frameWindow: HostWindow | null = null;

  const isEnabled = () => (typeof enabled === 'function' ? enabled() : enabled.value);
  const getGroups = () => (typeof groups === 'function' ? groups() : groups.value);
  const getOrder = () => (typeof order === 'function' ? order() : order.value);

  // The controls the previous answer counted from. A count from the end names other controls
  // once a group gains or loses one, so the slack only applies to the same controls.
  let answeredKey = '';
  const measure = () => {
    const bar = barRef.value;
    if (!bar || !isEnabled()) return;
    const reading = readToolbarRow(bar, memory, toolbarItemKey);
    // The arithmetic charges every group a few px of gap and separator it may not use, so on
    // a bar sized to its content it can call a bar that fits too narrow. Collapsing one
    // control then shrinks that bar and the next measurement collapses another, until every
    // control is in "⋯". So the first collapse waits for a control that really runs past the
    // bar's box. Without layout to read (null), the arithmetic decides alone.
    const fits = overflow.value.size === 0 && reading.overflowing === false;
    const key = toolbarGroupsKey(getGroups());
    const same = answeredKey === key;
    answeredKey = key;
    const next = fits
      ? NONE
      : toolbarOverflowItems({
          ...reading,
          groups: getGroups(),
          order: getOrder(),
          itemWidths: memory.itemWidths,
          groupBases: memory.groupBases,
          groupGaps: memory.groupGaps,
          ...(same ? { previous: overflow.value } : {}),
          hysteresis: TOOLBAR_OVERFLOW_HYSTERESIS,
        });
    if (!sameItemOverflow(next, overflow.value)) {
      overflow.value = next;
    }
  };

  const attach = (element: HTMLElement | null) => {
    barRef.value = element;
  };

  const setupObserver = () => {
    observer?.disconnect();
    if (frame !== 0) {
      frameWindow?.cancelAnimationFrame(frame);
      frame = 0;
    }
    const bar = barRef.value;
    // The bar's own window: a toolbar rendered in a pop-out window is observed and measured
    // there, and its frames keep running while the opener is hidden.
    const win = bar ? hostWindowOf(bar) : null;
    if (!isEnabled() || !bar || !win || typeof win.ResizeObserver === 'undefined') return;

    observer = new win.ResizeObserver(() => {
      if (frame !== 0) return;
      frameWindow = win;
      frame = win.requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    });
    observer.observe(bar);
    // The parent too: a bar as wide as its content does not resize when the room around
    // it grows, so only the parent reports the space a collapsed control can come back into.
    if (bar.parentElement) observer.observe(bar.parentElement);
    for (const element of bar.querySelectorAll<HTMLElement>(
      `[${GROUP_ATTRIBUTE}], [${FIXED_ATTRIBUTE}]`
    )) {
      observer.observe(element);
    }
  };

  watch(
    [
      barRef,
      overflow,
      () => isEnabled(),
      () => toolbarGroupsKey(getGroups()),
      () => getOrder().join(','),
    ],
    () => {
      if (!isEnabled()) {
        if (overflow.value.size > 0) overflow.value = NONE;
        observer?.disconnect();
        return;
      }
      measure();
      setupObserver();
    },
    { flush: 'post' }
  );

  onMounted(() => {
    if (isEnabled()) measure();
  });

  onBeforeUnmount(() => {
    if (frame !== 0) frameWindow?.cancelAnimationFrame(frame);
    observer?.disconnect();
  });

  return { attach, overflow };
}

/**
 * The same measurement for a bar whose groups leave whole (the menu bar): each group is one
 * control, and the answer is the set of group ids in the "⋯" menu.
 */
export function useToolbarGroupOverflow(
  enabled: Ref<boolean> | (() => boolean),
  groups: Ref<readonly string[]> | (() => readonly string[]),
  order: Ref<readonly string[]> | (() => readonly string[])
): {
  readonly attach: (element: HTMLElement | null) => void;
  readonly overflow: Readonly<Ref<ReadonlySet<string>>>;
} {
  const getGroups = () => (typeof groups === 'function' ? groups() : groups.value);
  const { attach, overflow } = useToolbarOverflow(
    enabled,
    () => getGroups().map((id) => ({ id, items: [id] })),
    order
  );
  return { attach, overflow: computed(() => new Set(overflow.value.keys())) };
}
