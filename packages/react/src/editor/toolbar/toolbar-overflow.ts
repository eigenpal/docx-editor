// Which toolbar groups give up their place to the "⋯" menu when the bar runs out of room.
//
// THE BAR IS ONE ROW. Wrapping to a second and third row was the old answer, and on a
// laptop beside an open navigation pane it ate a third of the window before a single line
// of the document was visible. So the row measures itself and moves whole groups into an
// overflow menu instead.
//
// TWO RULES DECIDE WHAT GOES:
//
// - WHOLE GROUPS, never half of one. Half a group leaves a separator standing between
//   nothing and something, and splits capabilities that were put together on purpose.
// - A DECLARED ORDER, not "whatever is last". Registry order is bar order, and its tail is
//   the review controls — the comments toggle and the editing-mode pill, the two things
//   Word keeps at every width. The order below is the collapse policy of THIS arrangement,
//   which is the same layer that merges the four alignment slots into one dropdown; the
//   registry stays free of layout policy.
//
// The fit itself is arithmetic over measured widths, so it is a pure function and tests
// without a DOM.

/**
 * Collapse order: the first id here is the first group to leave the bar.
 *
 * Zoom goes first (a document you cannot format is worse than one you cannot scale), then
 * the small standalone groups, then the paragraph controls, and text formatting and history
 * last. A group the registry has but this list does not is collapsed before all of these,
 * in reverse bar order — a host-added group has no declared standing, and the alternative
 * is a new group that silently never collapses.
 */
export const TOOLBAR_COLLAPSE_ORDER: readonly string[] = [
  'zoom',
  'script',
  'format',
  'list',
  'alignment',
  'styles',
  'font',
  'text',
  'history',
];

/**
 * Groups that never move into the overflow menu.
 *
 * `review` holds the comments toggle and the editing-mode pill. The comments rail is
 * reached through that toggle and nothing else, and a narrow window is exactly where a
 * reader needs it, so burying it one menu deep is the wrong trade.
 */
export const TOOLBAR_PINNED_GROUPS: ReadonlySet<string> = new Set(['review']);

/**
 * Px of surplus a group must find before it comes back OUT of the overflow menu.
 *
 * Without it a value control that widens with its own value (font family going from
 * "Arial" to "Times New Roman") pushes itself out, which frees the width that pulled it
 * back in, forever. One-directional slack breaks the loop.
 */
export const TOOLBAR_OVERFLOW_HYSTERESIS = 24;

/** No group overflows. Shared so an unmeasured toolbar returns a stable identity. */
const NONE: ReadonlySet<string> = new Set<string>();

/** What {@link toolbarOverflowGroups} measures against. */
export interface ToolbarFitInput {
  /** Content width of the bar, in px. `0` or less means "not measured yet". */
  readonly available: number;
  /** Group id -> measured width, separator and gaps included. */
  readonly widths: ReadonlyMap<string, number>;
  /** Collapsible groups, in bar order. */
  readonly groups: readonly string[];
  /** Collapse order; ids missing from it collapse first, in reverse bar order. */
  readonly order: readonly string[];
  /** Width of everything that never collapses: pinned groups, appended children, padding. */
  readonly fixed: number;
  /** Width the "⋯" trigger takes once it is shown. */
  readonly more: number;
  /** The previous answer, for the one-directional slack. */
  readonly previous?: ReadonlySet<string> | undefined;
  readonly hysteresis?: number;
}

/** The collapse order actually used: the declared one, with undeclared groups first. */
export function collapseOrder(
  groups: readonly string[],
  order: readonly string[] = TOOLBAR_COLLAPSE_ORDER
): readonly string[] {
  const declared = order.filter((id) => groups.includes(id));
  const undeclared = groups.filter((id) => !order.includes(id)).reverse();
  return [...undeclared, ...declared];
}

function fit(input: ToolbarFitInput, available: number): ReadonlySet<string> {
  const { widths, groups, order, fixed, more } = input;
  let total = fixed;
  for (const id of groups) total += widths.get(id) ?? 0;
  if (total <= available) return NONE;

  // Showing the trigger costs width of its own, so it joins the total the moment the bar
  // is known not to fit. Ignoring it collapsed one group too few at every threshold.
  total += more;
  const overflow = new Set<string>();
  for (const id of order) {
    if (total <= available) break;
    const width = widths.get(id);
    if (width === undefined || overflow.has(id)) continue;
    overflow.add(id);
    total -= width;
  }
  return overflow;
}

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/** True when two answers describe the same bar, so a re-render can be skipped. */
export const sameOverflow = sameIds;

/**
 * The groups that must leave the bar for the rest of it to fit in one row.
 *
 * An unmeasured bar (`available <= 0`, which is every server render and every jsdom test)
 * overflows nothing: the full toolbar is the honest answer when nothing is known about the
 * space, and it is also what a host that opted out of overflow renders.
 */
export function toolbarOverflowGroups(input: ToolbarFitInput): ReadonlySet<string> {
  if (!(input.available > 0)) return NONE;
  const next = fit(input, input.available);
  const previous = input.previous;
  // Growing the overflow is immediate; shrinking it has to clear the slack, or a control
  // whose width follows its own value oscillates across the threshold.
  if (!previous || previous.size === 0 || next.size >= previous.size) return next;
  const relaxed = fit(input, input.available - (input.hysteresis ?? TOOLBAR_OVERFLOW_HYSTERESIS));
  return sameIds(relaxed, previous) ? previous : relaxed;
}
