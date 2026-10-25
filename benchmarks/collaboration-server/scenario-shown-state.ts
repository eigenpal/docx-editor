// What a replica's strict check depends on, so a check whose inputs have not changed can be
// skipped. The check compares the editor's tree, and the session's indexes and identity map,
// against a fresh build of the replica's shared state. A fresh build is a pure read of that
// state, its binary parts included (they live in a map of the same document). The indexes change
// only in Yjs observers, which run inside transactions that change the state, and the identity
// map only on local edits, which give the editor a new tree. So a replica whose shared state
// (state vector and delete set) and tree are both unchanged since it last passed passes again. A
// future path that changed the indexes or the identity map without either would need to join
// this key.

import * as Y from 'yjs';

/** A replica's shared state and tree, as a strict check last read them. */
export interface ShownState {
  readonly shared: Y.Snapshot;
  readonly tree: unknown;
}

export function shownStateOf(ydoc: Y.Doc, tree: unknown): ShownState {
  return { shared: Y.snapshot(ydoc), tree };
}

/** Whether a strict check that passed on `passed` would pass on `now` too. */
export function sameShownState(passed: ShownState, now: ShownState): boolean {
  return passed.tree === now.tree && Y.equalSnapshots(passed.shared, now.shared);
}
