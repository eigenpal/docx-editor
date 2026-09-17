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
import { reportHistoryGroup } from '@docx-editor.dev/core/collaboration/replication';

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
  /** Set while a grouped journal's own transaction runs: only ITS item is the gesture's. */
  private capturing = false;
  private captured = false;

  constructor(private readonly undoManager: Y.UndoManager) {
    const noteItem = (event: { stackItem: StackItem; type: 'undo' | 'redo' }): void => {
      if (this.capturing && event.type === 'undo') {
        this.gestureItem = event.stackItem;
        this.captured = true;
      }
    };
    undoManager.on('stack-item-added', noteItem);
    undoManager.on('stack-item-updated', noteItem);
  }

  /**
   * Run one local journal's shared transaction as a frame of `group` (or of no gesture).
   *
   * The manager is prepared first, and the item the transaction lands on is remembered as
   * the gesture's — so the next frame merges only into THAT item, never into whatever an
   * unrelated local write may have pushed in between.
   */
  capture<T>(group: HistoryGroup | undefined, run: () => T): T {
    const previous = this.previous;
    this.previous = group;
    const stack = this.undoManager.undoStack;
    const window = this.undoManager.captureTimeout;
    if (group === previous && group !== undefined && stack[stack.length - 1] === this.gestureItem) {
      // The merge rule is `now - lastChange < captureTimeout`, measured when the transaction
      // ENDS. A frame of an open gesture merges whatever the clock says and however long its
      // body runs, so the window is opened wide for exactly this transaction.
      this.undoManager.lastChange = Date.now();
      this.undoManager.captureTimeout = Number.POSITIVE_INFINITY;
    } else {
      if (group !== previous || group !== undefined) this.undoManager.stopCapturing();
      this.gestureItem = undefined;
    }
    const priorItem = this.gestureItem;
    this.captured = false;
    this.capturing = group !== undefined;
    try {
      const result = run();
      if (this.captured)
        reportHistoryGroup(group, this.gestureItem === priorItem ? 'extended' : 'started');
      return result;
    } catch (error) {
      // The frame never landed: forget it, as a refusal does, or the next frame would merge
      // into an item that does not hold it.
      this.reset();
      throw error;
    } finally {
      this.capturing = false;
      this.undoManager.captureTimeout = window;
    }
  }

  /** Forget the open gesture: undo, redo and a refused journal are boundaries. */
  reset(): void {
    this.previous = undefined;
    this.gestureItem = undefined;
  }
}
