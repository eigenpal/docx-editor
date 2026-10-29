// Shared by both adapters: which toolbar CONTROLS give up their place to the "⋯" menu.
//
// The fit in `toolbar-fit.ts` moves whole groups. On a narrow bar that leaves a gap as wide
// as the group that just left, because the next group in line rarely needs all of it. So
// the bar collapses one control at a time instead:
//
// - The collapse ORDER still picks the group: the first group in the order shrinks first.
// - Inside that group, controls leave from the END of the group, one per step, so what stays
//   is a prefix of the group and the bar keeps its reading order.
// - The next group starts to shrink only when the previous one is empty. At most one group
//   is partly in the bar.
// - A group that loses its last control also frees its separator slot, so no separator is
//   left standing next to nothing.
//
// The fit is arithmetic over measured widths, so it is a pure function and tests without a
// DOM.

import { TOOLBAR_OVERFLOW_HYSTERESIS } from './toolbar-fit.ts';

/**
 * One collapsible group, as the item fit sees it.
 *
 * @internal
 */
export interface ToolbarFitGroup {
  /** The group id, as the collapse order names it. */
  readonly id: string;
  /** The group's control ids, in bar order. Controls leave from the end. */
  readonly items: readonly string[];
}

/**
 * Group id -> how many controls, counted from the END of the group, are in the "⋯" menu. A
 * group that is not in the map is complete in the bar. A count equal to the group's length
 * means the whole group is in the menu.
 *
 * @internal
 */
export type ToolbarItemOverflow = ReadonlyMap<string, number>;

/**
 * What {@link toolbarOverflowItems} measures against. Widths are in px.
 *
 * @internal
 */
export interface ToolbarItemFitInput {
  /** Content width of the bar. `0` or less means "not measured yet". */
  readonly available: number;
  /** Collapsible groups, in bar order. */
  readonly groups: readonly ToolbarFitGroup[];
  /** Collapse order of group ids; groups missing from it never collapse. */
  readonly order: readonly string[];
  /** {@link toolbarItemKey} -> the control's measured width. A missing width counts as 0. */
  readonly itemWidths: ReadonlyMap<string, number>;
  /**
   * Group id -> what showing the group at all costs: its separator slot and its own padding.
   * A missing entry counts as 0.
   */
  readonly groupBases: ReadonlyMap<string, number>;
  /** The flex gap between two controls of one group. */
  readonly gap: number;
  /** Width of everything that never collapses: pinned groups, appended children. */
  readonly fixed: number;
  /** Width the "⋯" trigger takes once it is shown. */
  readonly more: number;
  /** The previous answer, for the one-directional slack. */
  readonly previous?: ToolbarItemOverflow | undefined;
  /** Surplus a control needs before it comes back from the menu, in px. */
  readonly hysteresis?: number;
}

/** Nothing overflows. Shared so an unmeasured toolbar returns a stable identity. */
const NONE: ToolbarItemOverflow = new Map<string, number>();

/**
 * The key one control's width is stored under.
 *
 * @internal
 */
export function toolbarItemKey(groupId: string, itemId: string): string {
  return `${groupId}\u0000${itemId}`;
}

/** What a group costs with its first `shown` controls in the bar. */
function groupCost(input: ToolbarItemFitInput, group: ToolbarFitGroup, shown: number): number {
  if (shown <= 0) return 0;
  let total = input.groupBases.get(group.id) ?? 0;
  for (let index = 0; index < shown && index < group.items.length; index += 1) {
    total += input.itemWidths.get(toolbarItemKey(group.id, group.items[index]!)) ?? 0;
    if (index > 0) total += input.gap;
  }
  return total;
}

function fit(input: ToolbarItemFitInput, available: number): ToolbarItemOverflow {
  let total = input.fixed;
  for (const group of input.groups) total += groupCost(input, group, group.items.length);
  if (total <= available) return NONE;

  // The trigger costs width of its own once the bar is known not to fit.
  total += input.more;
  const byId = new Map(input.groups.map((group) => [group.id, group]));
  const hidden = new Map<string, number>();
  for (const id of input.order) {
    if (total <= available) break;
    const group = byId.get(id);
    if (!group || hidden.has(id)) continue;
    const count = group.items.length;
    for (let shown = count - 1; shown >= 0; shown -= 1) {
      total -= groupCost(input, group, shown + 1) - groupCost(input, group, shown);
      hidden.set(id, count - shown);
      if (total <= available) break;
    }
  }
  return hidden;
}

function hiddenTotal(overflow: ToolbarItemOverflow): number {
  let total = 0;
  for (const count of overflow.values()) total += count;
  return total;
}

/**
 * True when two answers describe the same bar, so a re-render can be skipped.
 *
 * @internal
 */
export function sameItemOverflow(a: ToolbarItemOverflow, b: ToolbarItemOverflow): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [id, count] of a) if (b.get(id) !== count) return false;
  return true;
}

/**
 * How many of a group's controls the bar shows under an answer.
 *
 * @internal
 */
export function toolbarShownCount(
  overflow: ToolbarItemOverflow,
  groupId: string,
  itemCount: number
): number {
  return Math.max(0, itemCount - (overflow.get(groupId) ?? 0));
}

/**
 * The controls that must leave the bar for the rest of it to fit in one row.
 *
 * An unmeasured bar (`available <= 0`, which is every server render and every jsdom test)
 * overflows nothing: the full toolbar is the honest answer when nothing is known about the
 * space.
 *
 * @internal
 */
export function toolbarOverflowItems(input: ToolbarItemFitInput): ToolbarItemOverflow {
  if (!(input.available > 0)) return NONE;
  const next = fit(input, input.available);
  const previous = input.previous;
  // Growing the overflow is immediate; shrinking it has to clear the slack, or a control
  // whose width follows its own value oscillates across the threshold.
  if (!previous || previous.size === 0 || hiddenTotal(next) >= hiddenTotal(previous)) {
    return next;
  }
  const relaxed = fit(input, input.available - (input.hysteresis ?? TOOLBAR_OVERFLOW_HYSTERESIS));
  return sameItemOverflow(relaxed, previous) ? previous : relaxed;
}
