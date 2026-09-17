/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// How a history group shapes the shared undo item the next local journal joins.
//
// Y.UndoManager merges a local change into the item on top of its stack when the change
// lands inside `captureTimeout` of the previous one, and starts a new item otherwise or
// after `stopCapturing`. A history group is a stronger statement than the clock: frames of
// ONE gesture merge however long the gesture lasts, so the capture window is re-armed ahead
// of each frame; and a change of group — into one, out of one, or between two — is a
// boundary, so the capture is stopped. Journals with no group keep the clock rule, which
// is what lets a run of keystrokes stay one item.
import type { HistoryGroup } from '@docx-editor.dev/core/store';
import type * as Y from 'yjs';

/** The group of the last local journal applied, and what the next one does about it. */
export class HistoryGroupCapture {
  private previous: HistoryGroup | undefined;

  constructor(private readonly undoManager: () => Y.UndoManager) {}

  /** Prepare the undo manager for a local journal carrying `group`. */
  apply(group: HistoryGroup | undefined): void {
    const previous = this.previous;
    this.previous = group;
    if (group !== previous) {
      this.undoManager().stopCapturing();
    } else if (group !== undefined) {
      // `lastChange` is the manager's own clock for the merge rule; a frame of an open
      // gesture is always "just now", whatever the wall clock says.
      this.undoManager().lastChange = Date.now();
    }
  }

  /** Forget the open gesture: undo, redo and a refused journal are boundaries. */
  reset(): void {
    this.previous = undefined;
  }
}
