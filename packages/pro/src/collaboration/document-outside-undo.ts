/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Document setup, such as a built-in style that the first link adds, publishes outside shared
// undo: the undo manager records nothing from its transaction, so no participant's undo takes
// the setup back while content added since still uses it.

import type * as Y from 'yjs';
/** Run `publish` with `origin` untracked, so the undo manager records no item from it. */
export function publishOutsideUndo<T>(
  undoManager: Y.UndoManager,
  origin: unknown,
  publish: () => T
): T {
  // No `stopCapturing()`: setup, or a repair a peer's change caused, must not split the
  // undo step the user is in the middle of.
  const tracked = undoManager.trackedOrigins.delete(origin);
  try {
    return publish();
  } finally {
    if (tracked) undoManager.trackedOrigins.add(origin);
  }
}
