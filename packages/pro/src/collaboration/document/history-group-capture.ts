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

type StackItem = Y.UndoManager['undoStack'][number];

/** The group of the last local journal applied, and what the next one does about it. */
export class HistoryGroupCapture {
  private previous: HistoryGroup | undefined;
  /**
   * The undo item the open gesture's frames have been merging into, or `undefined` when
   * the gesture has not put one on the stack yet. Re-arming the window is only right while
   * THAT item is on top: a frame whose shared transaction changed nothing tracked pushes no
   * item, and re-arming after it would merge the next frame into whatever the user did
   * before the gesture began.
   */
  private gestureItem: StackItem | undefined;

  constructor(private readonly undoManager: Y.UndoManager) {
    const noteItem = (event: { stackItem: StackItem; type: 'undo' | 'redo' }): void => {
      if (event.type === 'undo' && this.previous !== undefined) this.gestureItem = event.stackItem;
    };
    undoManager.on('stack-item-added', noteItem);
    undoManager.on('stack-item-updated', noteItem);
  }

  /** Prepare the undo manager for a local journal carrying `group`. */
  apply(group: HistoryGroup | undefined): void {
    const previous = this.previous;
    this.previous = group;
    const stack = this.undoManager.undoStack;
    if (group === previous && group !== undefined && stack[stack.length - 1] === this.gestureItem) {
      // `lastChange` is the manager's own clock for the merge rule; a frame of an open
      // gesture is always "just now", whatever the wall clock says.
      this.undoManager.lastChange = Date.now();
      return;
    }
    if (group !== previous || group !== undefined) this.undoManager.stopCapturing();
    this.gestureItem = undefined;
  }

  /** Forget the open gesture: undo, redo and a refused journal are boundaries. */
  reset(): void {
    this.previous = undefined;
    this.gestureItem = undefined;
  }
}
