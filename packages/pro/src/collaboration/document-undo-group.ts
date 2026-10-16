/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Host undo groups: one explicit undo step for one logical operation of a session.
//
// Without a group, the shared undo manager merges local writes by time, so two operations
// that land close together become one step and one long operation becomes several. A group
// replaces the clock for its lifetime: its first write starts a new step, every later write
// joins that step, and the first write after the group starts another.
//
// Groups are for replicas no person edits through, such as a server agent's. An editor shows
// undo state to its user and has its own history groups, so a session that an editor
// attached refuses a group instead of showing an undo that silently does nothing.
import type { HistoryGroupCapture } from './document/history-group-capture.ts';

/**
 * Why `beginUndoGroup` refused.
 *
 * - `undo-group-already-open`: this session already has an open group. Groups do not nest
 *   and two operations cannot share one session's group. End the open group first, or give
 *   each concurrent operation its own session.
 * - `editor-attached`: an editor that people edit through is attached to this session. Use
 *   the editor's own `beginHistoryGroup()` there.
 * - `collaboration-session-destroyed`: the session was destroyed.
 * @public
 */
export type CollaborationUndoGroupErrorCode =
  | 'undo-group-already-open'
  | 'editor-attached'
  | 'collaboration-session-destroyed';

/**
 * Thrown by `beginUndoGroup` when the session cannot open a group. Branch on `code`.
 * @public
 */
export class CollaborationUndoGroupError extends Error {
  constructor(
    /** Stable refusal code. */
    readonly code: CollaborationUndoGroupErrorCode
  ) {
    super(code);
    this.name = 'CollaborationUndoGroupError';
  }
}

/**
 * One open undo group of a collaboration session.
 *
 * Every local write the session publishes while the group is open becomes part of one undo
 * step, however long the group stays open. `end()` closes the step, so the next write
 * starts a new one, however soon it follows.
 * @public
 */
export interface CollaborationUndoGroup {
  /** `closed` after `end()`, after the session is destroyed, or after an editor attaches. */
  readonly state: 'open' | 'closed';
  /**
   * Publish committed local writes into the group, then close it. Reverts nothing. Safe to
   * call more than once, and after the session is destroyed.
   *
   * Commands a runtime still queues are not committed yet. Call `end()` after
   * `runtime.run()` resolves, so its last `context.sync()` lands inside the group.
   */
  end(): void;
}

/** The session's one open group, if any. */
export class UndoGroups {
  private current: object | null = null;

  constructor(
    private readonly capture: HistoryGroupCapture,
    /** Publish queued local journals, so they land on the right side of a boundary. */
    private readonly flush: () => void
  ) {}

  /** Whether a group is open: undo and redo refuse while it is. */
  get isOpen(): boolean {
    return this.current !== null;
  }

  begin(destroyed: () => boolean, editorAttached: boolean): CollaborationUndoGroup {
    if (destroyed()) throw new CollaborationUndoGroupError('collaboration-session-destroyed');
    if (editorAttached) throw new CollaborationUndoGroupError('editor-attached');
    if (this.current !== null) throw new CollaborationUndoGroupError('undo-group-already-open');
    // A journal still queued belongs to the writes before the group, not to its first step.
    this.flush();
    // The flush runs host code (a status listener can destroy the room), so check again.
    if (destroyed()) throw new CollaborationUndoGroupError('collaboration-session-destroyed');
    const token = {};
    this.current = token;
    this.capture.pin(Symbol('collaboration-undo-group'));
    const groups = this;
    return Object.freeze({
      get state(): 'open' | 'closed' {
        return groups.current === token ? 'open' : 'closed';
      },
      end(): void {
        if (groups.current !== token) return;
        // Writes the operation made and the port still queues are part of the group.
        groups.flush();
        // A flush that destroys the session (a status listener can) already closed it.
        if (groups.current !== token) return;
        groups.current = null;
        groups.capture.unpin();
      },
    });
  }

  /** Session teardown or an editor's attach: an open group closes without another flush. */
  close(): void {
    if (this.current === null) return;
    this.current = null;
    this.capture.unpin();
  }
}
