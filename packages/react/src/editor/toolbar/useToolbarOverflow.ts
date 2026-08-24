// The toolbar's own measurement: how wide each group is, and how much room the bar has.
//
// MEASURED, NOT BREAKPOINTED. A media query knows the window's width and nothing about the
// bar: the same 1200px window holds a different toolbar with a navigation pane open, at
// 150% zoom, in German, or with a host that appended two buttons of its own. The bar reads
// its own children instead, so all four cases land on the same rule.
//
// MEASUREMENT IS FREE HERE. Everything is read inside a ResizeObserver callback, which the
// browser delivers after layout has already been computed — so nothing in this file
// forces a reflow. The one exception is the mount pass, which reads once against the fully
// rendered bar to learn every group's width; that is also what makes a group that has been
// in the overflow menu since the first frame still have a known width to come back on.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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

/** Marks a collapsible group wrapper; the value is the group id. */
export const GROUP_ATTRIBUTE = 'data-toolbar-group';
/** Marks anything that stays in the bar at every width (pinned groups, host children). */
export const FIXED_ATTRIBUTE = 'data-toolbar-fixed';
/** Marks the "⋯" trigger. */
export const MORE_ATTRIBUTE = 'data-toolbar-more';

/** Assumed trigger width before one has ever been rendered: the icon-button size. */
const ASSUMED_MORE_WIDTH = 34;

const NONE: ReadonlySet<string> = new Set<string>();

export interface UseToolbarOverflowResult {
  /** Attach to the bar element. */
  readonly attach: (element: HTMLFieldSetElement | null) => void;
  /** Group ids that must render in the "⋯" menu instead of the bar. */
  readonly overflow: ReadonlySet<string>;
}

/**
 * Measures the bar and answers which groups have to move into the overflow menu.
 *
 * `enabled` false is inert: no observer, no reads, and an empty answer, which renders the
 * complete bar exactly as it did before overflow existed.
 */
export function useToolbarOverflow(
  enabled: boolean,
  groups: readonly string[],
  order: readonly string[]
): UseToolbarOverflowResult {
  const barRef = useRef<HTMLFieldSetElement | null>(null);
  // Widths SURVIVE a group leaving the bar. A group in the overflow menu renders nothing to
  // measure, and forgetting its width would mean never knowing whether it could come back.
  const widths = useRef(new Map<string, number>());
  const moreWidth = useRef(ASSUMED_MORE_WIDTH);
  const [overflow, setOverflow] = useState<ReadonlySet<string>>(NONE);
  const overflowRef = useRef(overflow);
  overflowRef.current = overflow;

  // Latest inputs, read inside the measure callback without re-creating it (and with it the
  // observer) whenever a parent re-renders with a fresh array literal.
  const inputs = useRef({ groups, order });
  inputs.current = { groups, order };

  const measure = useCallback(() => {
    const bar = barRef.current;
    if (!bar || !enabled) return;
    const style = getComputedStyle(bar);
    const gap = readColumnGap(style);
    const available = readAvailableWidth(bar, style);
    // Every collapsible group is costed WITH a leading separator slot — width, inline
    // margins, and flex gaps — including the first one, which does not have a separator.
    // That overstates the row by one separator and makes the bar collapse a few px early,
    // the safe direction, since the other one clips.
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

    for (const element of bar.querySelectorAll<HTMLElement>(`[${GROUP_ATTRIBUTE}]`)) {
      const id = element.getAttribute(GROUP_ATTRIBUTE);
      // A group mid-transition can measure zero; keeping the last real width beats
      // recording a zero that would make it look free forever.
      if (id && element.offsetWidth > 0) {
        widths.current.set(id, collapsibleGroupCost(element.offsetWidth, separatorLeading));
      }
    }
    let fixed = 0;
    for (const element of bar.querySelectorAll<HTMLElement>(`[${FIXED_ATTRIBUTE}]`)) {
      if (element.offsetWidth > 0) fixed += trailingGapCost(element.offsetWidth, gap);
    }
    const more = bar.querySelector<HTMLElement>(`[${MORE_ATTRIBUTE}]`);
    if (more && more.offsetWidth > 0) {
      // More follows flex content; it is not preceded by a separator rule.
      moreWidth.current = trailingGapCost(more.offsetWidth, gap);
    }

    const input: ToolbarFitInput = {
      available,
      widths: widths.current,
      groups: inputs.current.groups,
      order: inputs.current.order,
      fixed,
      more: moreWidth.current,
      previous: overflowRef.current,
      hysteresis: TOOLBAR_OVERFLOW_HYSTERESIS,
    };
    const next = toolbarOverflowGroups(input);
    if (!sameOverflow(next, overflowRef.current)) {
      overflowRef.current = next;
      setOverflow(next);
    }
  }, [enabled]);

  const attach = useCallback((element: HTMLFieldSetElement | null) => {
    barRef.current = element;
  }, []);

  // The mount pass, against the complete bar: the only forced read in the file, and the one
  // that gives every group a width before any of them can be hidden. In a layout effect so
  // the collapsed bar is what the browser paints — measuring after paint shows the user one
  // frame of the three-row toolbar this exists to remove.
  useLayoutEffect(() => {
    if (!enabled) {
      if (overflowRef.current.size > 0) {
        overflowRef.current = NONE;
        setOverflow(NONE);
      }
      return;
    }
    measure();
  }, [enabled, measure]);

  // Width changes come from two directions and both are observed: the bar's own box (window
  // resize, a navigation pane opening) and each group's content (a longer font name, a
  // locale with longer labels, a host restyling a control).
  useEffect(() => {
    const bar = barRef.current;
    if (!enabled || !bar || typeof ResizeObserver === 'undefined') return undefined;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      // Coalesced: a window drag delivers a callback per frame per observed element, and
      // the answer only ever depends on the final geometry of the frame.
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
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      observer.disconnect();
    };
    // Re-observes when the composition changes: a group that just came back into the bar is
    // a new element, and an unobserved one stops reporting the growth that would push it out
    // again. `overflow` in the deps is what makes that re-attachment happen.
  }, [enabled, measure, overflow]);

  return { attach, overflow };
}
