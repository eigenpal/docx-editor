// The history group of the command being executed, for the surface's write path.
//
// `Editor.exec` takes `historyGroup` as an option, and the surface verb it dispatches to
// (`setRunProperty`, `setParagraphProperty`, ...) commits through `applyOps` several calls
// down without an options parameter of its own. Threading one through every formatting
// verb would touch each of them for a value none of them interprets, so the facade binds
// the group for the synchronous span of the command instead, and the surface's commit
// path reads it.
//
// Bound to ONE owner — the surface whose command it is — and TAKEN by that owner's first
// commit, which clears it. Two things follow. Another editor instance written to from
// inside the span (a change listener that mirrors an edit elsewhere) reads nothing, so a
// gesture token never crosses editors. And host code that runs after the command's own
// write, inside the same span (`onChange`, `onTrackedChange`, a store subscriber), finds
// the group already taken, so its writes are their own undo steps. Bound exactly, not
// inherited: a nested `exec` without a group runs ungrouped, and the type-buffer flush
// runs with the group cleared, because buffered keystrokes that land at the head of a
// grouped command are an edit of their own, not a frame of the gesture.

import type { HistoryGroup } from '@docx-editor.dev/core/store';

let active: { readonly owner: object; readonly group: HistoryGroup } | null = null;

/** Run `run` with `group` (or none) bound to `owner` for every commit inside it. */
export function runWithHistoryGroup<T>(
  owner: object,
  group: HistoryGroup | undefined,
  run: () => T
): T {
  const previous = active;
  active = group === undefined ? null : { owner, group };
  try {
    return run();
  } finally {
    active = previous;
  }
}

/** Take the history group bound to `owner` by the command in flight, or `undefined`. */
export function takeHistoryGroup(owner: object): HistoryGroup | undefined {
  if (active === null || active.owner !== owner) return undefined;
  const { group } = active;
  active = null;
  return group;
}
