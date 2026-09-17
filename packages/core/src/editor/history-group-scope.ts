// The history group of the command being executed, for the surface's write path.
//
// `Editor.exec` takes `historyGroup` as an option, and the surface verb it dispatches to
// (`setRunProperty`, `setParagraphProperty`, ...) commits through `applyOps` several calls
// down without an options parameter of its own. Threading one through every formatting
// verb would touch each of them for a value none of them interprets, so the facade binds
// the group for the synchronous span of the command instead, and the ONE write path reads
// it. Same shape as `runWithTransactionActor`, and for the same reason.
//
// Bound exactly, not inherited: a nested `exec` without a group runs ungrouped, and the
// type-buffer flush runs with the group cleared, because buffered keystrokes that land at
// the head of a grouped command are an edit of their own, not a frame of the gesture.

import type { HistoryGroup } from '@docx-editor.dev/core/store';

let active: HistoryGroup | undefined;

/** Run `run` with `group` (or none) as the history group every write inside it carries. */
export function runWithHistoryGroup<T>(group: HistoryGroup | undefined, run: () => T): T {
  const previous = active;
  active = group;
  try {
    return run();
  } finally {
    active = previous;
  }
}

/** The history group bound by the command in flight, or `undefined` outside one. */
export function activeHistoryGroup(): HistoryGroup | undefined {
  return active;
}
