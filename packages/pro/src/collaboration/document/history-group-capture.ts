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
//
// A host undo group pins one group over every local journal, whatever group the journal
// names, until it is unpinned. A refused or thrown frame does not end a pinned group: the
// item that holds the group's earlier writes stays the one later writes join.
import type { HistoryGroup } from '@docx-editor.dev/core/store';
import type * as Y from 'yjs';
import {
  registerUndoHistoryPosition,
  reportHistoryGroup,
} from '@docx-editor.dev/core/collaboration/replication';
import { markGroupStep } from './history-undone.ts';

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
  /** The host undo group every local journal joins while it is open. */
  private pinned: HistoryGroup | undefined;

  constructor(
    private readonly undoManager: Y.UndoManager,
    owner?: object
  ) {
    const noteItem = (event: { stackItem: StackItem; type: 'undo' | 'redo' }): void => {
      if (this.capturing && event.type === 'undo') {
        this.gestureItem = event.stackItem;
        this.captured = true;
        if (this.pinned !== undefined) markGroupStep(event.stackItem);
      }
    };
    undoManager.on('stack-item-added', noteItem);
    undoManager.on('stack-item-updated', noteItem);
    if (owner) bindHistoryPosition(owner, undoManager, () => this.reset());
  }

  /**
   * Run one local journal's shared transaction as a frame of `group` (or of no gesture).
   *
   * The manager is prepared first, and the item the transaction lands on is remembered as
   * the gesture's — so the next frame merges only into THAT item, never into whatever an
   * unrelated local write may have pushed in between.
   */
  capture<T>(journalGroup: HistoryGroup | undefined, run: () => T): T {
    const group = this.pinned ?? journalGroup;
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
        reportHistoryGroup(journalGroup, this.gestureItem === priorItem ? 'extended' : 'started');
      return result;
    } catch (error) {
      // The frame never landed: forget it, as a refusal does, or the next frame would merge
      // into an item that does not hold it.
      this.refused();
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

  /**
   * A local journal was refused or threw. That ends an editor gesture. A pinned group stays:
   * its earlier writes are still in the item it collects, and the merge check above admits a
   * later write only while that item is on top of the stack.
   */
  refused(): void {
    if (this.pinned === undefined) this.reset();
  }

  /** Open a host undo group. Its first write starts a new item, however recent the last one. */
  pin(group: HistoryGroup): void {
    this.undoManager.stopCapturing();
    this.reset();
    this.pinned = group;
  }

  /** Close the host undo group. The next local write starts a new item. */
  unpin(): void {
    this.pinned = undefined;
    this.reset();
    this.undoManager.stopCapturing();
  }
}

/** Undo and redo create new CRDT stack items; keep their logical identities stable. */
function bindHistoryPosition(owner: object, manager: Y.UndoManager, reset: () => void): void {
  const tokens = new WeakMap<StackItem, object>();
  const token = (item: StackItem): object => {
    let value = tokens.get(item);
    if (!value) tokens.set(item, (value = {}));
    return value;
  };
  manager.on('stack-item-popped', ({ stackItem, type }) => {
    const counterpart = (type === 'undo' ? manager.redoStack : manager.undoStack).at(-1);
    if (counterpart) tokens.set(counterpart, token(stackItem));
  });
  registerUndoHistoryPosition(owner, {
    current: () => {
      const top = manager.undoStack.at(-1);
      return top ? token(top) : null;
    },
    split: () => {
      reset();
      manager.stopCapturing();
      manager.clear(false, true);
    },
  });
}
