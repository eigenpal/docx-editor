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

/**
 * The priority of a declared group: its place in {@link TOOLBAR_COLLAPSE_ORDER}, in steps of
 * 10, so zoom is 10 and history is 90. A host group with a `priority` sorts among these, and
 * a LOWER number leaves the bar first. The steps leave room between two built-in groups.
 */
export function toolbarGroupPriority(
  id: string,
  order: readonly string[] = TOOLBAR_COLLAPSE_ORDER
): number | undefined {
  const index = order.indexOf(id);
  return index === -1 ? undefined : (index + 1) * 10;
}

/**
 * The collapse order actually used: the declared one, with undeclared groups first.
 *
 * `priorities` gives a group an explicit place among the declared ones (see
 * {@link toolbarGroupPriority}), and overrides a declared group's own priority. Groups with
 * neither collapse first, in reverse bar order. Two groups with the same priority collapse
 * in reverse bar order too: the one further along the bar leaves first.
 */
export function collapseOrder(
  groups: readonly string[],
  order: readonly string[] = TOOLBAR_COLLAPSE_ORDER,
  priorities?: ReadonlyMap<string, number>
): readonly string[] {
  const ranked: { id: string; priority: number; position: number }[] = [];
  const undeclared: string[] = [];
  groups.forEach((id, position) => {
    const priority = priorities?.get(id) ?? toolbarGroupPriority(id, order);
    if (priority === undefined || Number.isNaN(priority)) undeclared.push(id);
    else ranked.push({ id, priority, position });
  });
  ranked.sort((a, b) => a.priority - b.priority || b.position - a.position);
  return [...undeclared.reverse(), ...ranked.map((entry) => entry.id)];
}

/** One host group's placement request. */
export interface ToolbarHostGroupPlacement {
  readonly id: string;
  /** The group this one follows. Absent, or unknown, places it after every group. */
  readonly after?: string | undefined;
}

/**
 * Bar order with the host's groups placed.
 *
 * A host group without `after` follows every built-in group, in order of appearance. A group
 * with `after` follows the group it names, after any host groups already placed there, so
 * several groups anchored to one place keep their order of appearance. An anchor may be
 * another host group. An anchor that never resolves (an unknown id, or a cycle) places the
 * group at the end.
 */
export function arrangeToolbarGroups(
  builtIn: readonly string[],
  hosts: readonly ToolbarHostGroupPlacement[]
): readonly string[] {
  const result = [...builtIn];
  // The last id placed after each anchor, so a second group anchored there follows the first.
  const tail = new Map<string, string>();
  let pending = hosts.filter((host) => !builtIn.includes(host.id));
  while (pending.length > 0) {
    const deferred: ToolbarHostGroupPlacement[] = [];
    for (const host of pending) {
      const anchor = host.after;
      if (anchor === undefined || anchor === host.id) {
        result.push(host.id);
        continue;
      }
      if (!result.includes(anchor)) {
        deferred.push(host);
        continue;
      }
      const after = tail.get(anchor) ?? anchor;
      result.splice(result.indexOf(after) + 1, 0, host.id);
      tail.set(anchor, host.id);
    }
    if (deferred.length === pending.length) {
      // Nothing resolved in this pass: the rest name groups that do not exist.
      result.push(...deferred.map((host) => host.id));
      break;
    }
    pending = deferred;
  }
  return result;
}

/** The margin the "⋯" panel keeps from each viewport edge, in px. */
export const TOOLBAR_PANEL_EDGE_MARGIN = 8;

/** Where the "⋯" panel opens, in viewport px. */
export interface ToolbarPanelPlacement {
  /** The panel's left edge. */
  readonly left: number;
  /** The widest the panel may be: the viewport less both margins. */
  readonly maxWidth: number;
  /** Which trigger edge the panel lines up with, or `clamped` when neither fits. */
  readonly anchor: 'start' | 'end' | 'clamped';
}

/**
 * Keep the "⋯" panel inside the viewport.
 *
 * The panel lines up with the trigger's end edge first, which suits a trigger at the end of
 * the bar. When that runs past the left edge (a centered or narrow bar), it lines up with
 * the trigger's start edge instead. When neither fits, it is clamped to the margins.
 */
export function toolbarPanelPlacement(input: {
  readonly triggerLeft: number;
  readonly triggerRight: number;
  readonly panelWidth: number;
  readonly viewportWidth: number;
  readonly margin?: number;
}): ToolbarPanelPlacement {
  const margin = input.margin ?? TOOLBAR_PANEL_EDGE_MARGIN;
  const maxWidth = Math.max(0, input.viewportWidth - margin * 2);
  const width = Math.min(input.panelWidth, maxWidth);
  const min = margin;
  const max = input.viewportWidth - margin - width;
  const end = input.triggerRight - width;
  if (end >= min && end <= max) return { left: end, maxWidth, anchor: 'end' };
  const start = input.triggerLeft;
  if (start >= min && start <= max) return { left: start, maxWidth, anchor: 'start' };
  return { left: Math.max(min, Math.min(end, max)), maxWidth, anchor: 'clamped' };
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
