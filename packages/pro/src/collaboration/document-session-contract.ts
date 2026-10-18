/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type {
  CollaborationFailureCode,
  EditorCollaborationSession,
} from '@docx-editor.dev/core/collaboration';
import type { CollaborationIdentityUpdate } from './types.ts';
import type { CollaborationResourceUsage } from './resource-usage.ts';
import type { CollaborationUndoGroup } from './document-undo-group.ts';

/**
 * Full-document collaboration session: the engine-facing seam, the transport status a
 * provider sets, and a live display-identity update.
 * @public
 */
export interface DocumentCollaborationSession extends EditorCollaborationSession {
  /**
   * Provider convenience seam. Low-level consumers normally leave the session ready.
   *
   * `reason` is a typed code so a host can branch on it: pass `'transport-disconnected'` for
   * a socket that will retry itself and `'authentication-failed'` for a credential the server
   * rejected, because those need opposite responses. The provider's own phrasing goes in
   * `detail`.
   */
  setTransportStatus(
    status: 'ready' | 'disconnected' | 'error',
    reason?: CollaborationFailureCode,
    detail?: string
  ): void;
  /**
   * Update the display identity for the rest of this session and republish presence.
   *
   * `name` revalidates with the construction rules (trimmed, 1 to 256 characters) and an
   * invalid value throws. `color` longer than 64 characters throws; a color
   * `safeParticipantColor` refuses is dropped, so peers fall back to the accent color.
   * `actorId` and `role` are immutable — the update type cannot name them, and any extra
   * runtime property is ignored.
   */
  setIdentity(update: CollaborationIdentityUpdate): void;

  /**
   * One reading of the room's replicated size against this replica's hard limits.
   *
   * A room only grows — deletion is a tombstone — and the limits that bound hostile
   * amplification turn terminal when crossed. Watch this to archive and re-room before that
   * happens. The tombstone count walks the node map once per call, so read it on your own
   * schedule rather than per keystroke.
   */
  resourceUsage(): CollaborationResourceUsage;

  /**
   * Open an explicit undo group: every local write this session publishes until `end()` is
   * one undo step. For a server or headless replica, such as an agent's.
   *
   * Without a group, local writes that land within 500 ms of each other share one undo step.
   * A group replaces that timing rule. Its first write starts a new step, however soon it
   * follows the previous write. Its later writes join that step, however long the group
   * stays open. The first write after `end()` starts a new step.
   *
   * Each boundary publishes the writes that are already committed. A runtime commits its
   * queued commands only at `context.sync()`, so call `end()` after `runtime.run()` resolves,
   * not inside the callback before its last sync.
   *
   * - Undo and redo refuse while the group is open: `undo()` and `redo()` return false, and
   *   `canUndo()` and `canRedo()` report false. {@link DocumentCollaborationSession.undoGroupOpen}
   *   tells this refusal apart from an empty history. End the group first.
   * - A refused write does not end the group. Later writes join the same step as the
   *   earlier ones. To revert the whole operation, end the group and call `undo()` once.
   * - Only local writes join the group. Other participants' edits stay out of it, and an
   *   undo of the group keeps them. It can also remove text that others typed in a
   *   paragraph the group inserted (#1398). When they removed everything the group wrote,
   *   its undo changes nothing and never reverts an older step.
   * - An undo of an ungrouped step never reverts a group's step below it. Ungrouped history
   *   otherwise undoes as it does without groups. If a peer removed everything that the top
   *   ungrouped step wrote, that `undo()` changes nothing and returns true. Call `undo()`
   *   again to revert the group.
   * - Destroying the session, or attaching an editor to it, closes an open group.
   *
   * @throws CollaborationUndoGroupError with `undo-group-already-open` when this session
   * already has an open group, `editor-attached` when an editor that people edit through is
   * attached (use the editor's `beginHistoryGroup()` there), or
   * `collaboration-session-destroyed` after `destroy()`. Groups do not nest. Give each
   * concurrent operation its own session.
   *
   * @example
   * ```ts
   * const group = session.beginUndoGroup();
   * try {
   *   await runtime.run(async (context) => {
   *     context.document.body.insertParagraph('Task A', 'End');
   *     await context.sync();
   *   });
   * } finally {
   *   group.end();
   * }
   * session.undo(); // reverts Task A only
   * ```
   */
  beginUndoGroup(): CollaborationUndoGroup;

  /** Whether an undo group from {@link DocumentCollaborationSession.beginUndoGroup} is open. */
  readonly undoGroupOpen: boolean;
}
