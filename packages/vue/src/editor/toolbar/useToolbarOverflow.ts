import { onBeforeUnmount, onMounted, ref, shallowRef, watch, type Ref } from 'vue';
import {
  sameOverflow,
  toolbarOverflowGroups,
  TOOLBAR_OVERFLOW_HYSTERESIS,
  type ToolbarFitInput,
} from './toolbar-overflow';
import {
  collapsibleGroupCost,
  readAvailableWidth,
  readColumnGap,
  readInlineMargins,
  separatorLeadingCost,
  trailingGapCost,
} from './toolbar-measure';

export const GROUP_ATTRIBUTE = 'data-toolbar-group';
export const FIXED_ATTRIBUTE = 'data-toolbar-fixed';
export const MORE_ATTRIBUTE = 'data-toolbar-more';

const ASSUMED_MORE_WIDTH = 34;
const NONE: ReadonlySet<string> = new Set<string>();

export interface UseToolbarOverflowResult {
  readonly attach: (element: HTMLDivElement | null) => void;
  readonly overflow: Ref<ReadonlySet<string>>;
}

export function useToolbarOverflow(
  enabled: Ref<boolean> | (() => boolean),
  groups: Ref<readonly string[]> | (() => readonly string[]),
  order: Ref<readonly string[]> | (() => readonly string[])
): UseToolbarOverflowResult {
  const barRef = shallowRef<HTMLDivElement | null>(null);
  const widths = shallowRef(new Map<string, number>());
  const moreWidth = shallowRef(ASSUMED_MORE_WIDTH);
  const overflow = ref<ReadonlySet<string>>(NONE);
  let frame = 0;
  let observer: ResizeObserver | undefined;

  const isEnabled = () => (typeof enabled === 'function' ? enabled() : enabled.value);
  const getGroups = () => (typeof groups === 'function' ? groups() : groups.value);
  const getOrder = () => (typeof order === 'function' ? order() : order.value);

  const measure = () => {
    const bar = barRef.value;
    if (!bar || !isEnabled()) return;
    const style = getComputedStyle(bar);
    const gap = readColumnGap(style);
    const available = readAvailableWidth(bar, style);
    const separator = bar.querySelector<HTMLElement>('.docx-toolbar__separator');
    let separatorLeading = gap * 2;
    if (separator) {
      const sepStyle = getComputedStyle(separator);
      const margins = readInlineMargins(sepStyle);
      separatorLeading = separatorLeadingCost(
        separator.offsetWidth,
        margins.start,
        margins.end,
        gap
      );
    }

    const widthMap = new Map(widths.value);
    for (const element of bar.querySelectorAll<HTMLElement>(`[${GROUP_ATTRIBUTE}]`)) {
      const id = element.getAttribute(GROUP_ATTRIBUTE);
      if (id && element.offsetWidth > 0) {
        widthMap.set(id, collapsibleGroupCost(element.offsetWidth, separatorLeading));
      }
    }
    widths.value = widthMap;

    let fixed = 0;
    for (const element of bar.querySelectorAll<HTMLElement>(`[${FIXED_ATTRIBUTE}]`)) {
      if (element.offsetWidth > 0) fixed += trailingGapCost(element.offsetWidth, gap);
    }
    const more = bar.querySelector<HTMLElement>(`[${MORE_ATTRIBUTE}]`);
    if (more && more.offsetWidth > 0) {
      moreWidth.value = trailingGapCost(more.offsetWidth, gap);
    }

    const input: ToolbarFitInput = {
      available,
      widths: widthMap,
      groups: getGroups(),
      order: getOrder(),
      fixed,
      more: moreWidth.value,
      previous: overflow.value,
      hysteresis: TOOLBAR_OVERFLOW_HYSTERESIS,
    };
    const next = toolbarOverflowGroups(input);
    if (!sameOverflow(next, overflow.value)) {
      overflow.value = next;
    }
  };

  const attach = (element: HTMLDivElement | null) => {
    barRef.value = element;
  };

  const setupObserver = () => {
    observer?.disconnect();
    if (frame !== 0) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    const bar = barRef.value;
    if (!isEnabled() || !bar || typeof ResizeObserver === 'undefined') return;

    observer = new ResizeObserver(() => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    });
    observer.observe(bar);
    for (const element of bar.querySelectorAll<HTMLElement>(
      `[${GROUP_ATTRIBUTE}], [${FIXED_ATTRIBUTE}]`
    )) {
      observer.observe(element);
    }
  };

  watch(
    [barRef, overflow, () => isEnabled(), () => getGroups().join(','), () => getOrder().join(',')],
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
    if (frame !== 0) cancelAnimationFrame(frame);
    observer?.disconnect();
  });

  return { attach, overflow };
}
