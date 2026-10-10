/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type {
  CollaborationFailureCode,
  CollaborationIdentity,
  CollaborationParticipant,
  CollaborationRemoteSelection,
  CollaborationStatus,
  CollaborationStatusSnapshot,
} from '@docx-editor.dev/core/collaboration';

/**
 * Create or join bootstrap for one collaboration replica.
 *
 * The document and WebRTC factories share this union.
 *
 * `create-or-join` removes the out-of-band decision about which peer creates a room.
 * The replica probes for an initialized room and joins it when one appears. Otherwise it
 * runs a short awareness election and only the winning candidate seeds from `document`.
 * A room that two peers seeded concurrently reports the terminal failure code
 * `concurrent-seed` on every replica.
 * @public
 */
export type CollaborationBootstrap =
  | { readonly kind: 'create'; readonly document: Uint8Array }
  | { readonly kind: 'join'; readonly timeoutMs?: number; readonly signal?: AbortSignal }
  | {
      readonly kind: 'create-or-join';
      readonly document: Uint8Array;
      /**
       * Wait for an existing initialized room before the seed election. Default 4000 ms, or
       * 0 with Hocuspocus, where the server sync already delivered the whole room.
       */
      readonly probeTimeoutMs?: number;
      /** Seed election window after an empty probe. Default 1500 ms. */
      readonly electionWindowMs?: number;
      /** Join wait after this replica loses the seed election. Default 30000 ms. */
      readonly timeoutMs?: number;
      /** Abort the join. The factory rejects with `initialization-aborted`. */
      readonly signal?: AbortSignal;
    };

/**
 * Display-identity fields a live session can update.
 *
 * `actorId` and `role` are attribution and stay immutable for the session lifetime, so this
 * type cannot name them.
 * @public
 */
export interface CollaborationIdentityUpdate {
  /** New display name, 1 to 256 characters after trimming. */
  readonly name?: string;
  /** New presence color, at most 64 characters. */
  readonly color?: string;
}

/**
 * Host-facing collaboration session.
 *
 * A host reads identity, status, presence, and undo. The editor attaches
 * {@link EditorCollaborationSession} internally and never through this type.
 * @public
 */
export interface CollaborationSession {
  /** The room's document id. */
  readonly documentId: string;
  /** Unique identity for this attachment lifetime. */
  readonly sessionId: string;
  /** The validated local identity. */
  readonly identity: CollaborationIdentity;
  /**
   * Update the display name and color mid-session, when the replica supports it.
   *
   * Full-document sessions implement this and republish presence at once. A replica that
   * freezes identity for its lifetime omits it.
   */
  setIdentity?(update: CollaborationIdentityUpdate): void;
  /**
   * Whether edits continue while the transport is down (`disconnected`). Set by the
   * `offlineEditing` option; absent means true.
   */
  readonly offlineEditing?: boolean;
  /** Current lifecycle state. */
  status(): CollaborationStatus;
  /**
   * Cached status, current reason, and last failure.
   *
   * Same reference until any of those values change.
   */
  statusSnapshot(): CollaborationStatusSnapshot;
  /** Call `listener` on each status or reason change. Returns the unsubscribe function. */
  subscribeStatus(
    listener: (
      status: CollaborationStatus,
      reason?: CollaborationFailureCode,
      detail?: string
    ) => void
  ): () => void;
  /** Whether the shared undo history holds a local step to undo. */
  canUndo(): boolean;
  /** Whether the shared undo history holds a local step to redo. */
  canRedo(): boolean;
  /** Undo this participant's last step; others' edits stay. Returns false when refused. */
  undo(): boolean;
  /** Redo this participant's last undone step. Returns false when refused. */
  redo(): boolean;
  /** Participants in presence, this replica included. Capped at 256. */
  participants(): readonly CollaborationParticipant[];
  /** Call `listener` when the participant list changes. Returns the unsubscribe function. */
  subscribeParticipants(
    listener: (participants: readonly CollaborationParticipant[]) => void
  ): () => void;
  /** Other participants' selections, resolved into this replica's addresses. */
  remoteSelections(): readonly CollaborationRemoteSelection[];
  /** Call `listener` when a remote selection changes. Returns the unsubscribe function. */
  subscribeRemoteSelections(
    listener: (selections: readonly CollaborationRemoteSelection[]) => void
  ): () => void;
}

/**
 * Owned collaboration replica: document bytes, session, and teardown.
 *
 * A host reads
 * {@link CollaborationSession}; the engine session remains assignable.
 * @public
 */
export interface CollaborationHandle<TSession extends CollaborationSession> {
  /** The room's document as `.docx` bytes. Mount the editor with them. */
  readonly document: Uint8Array;
  /** The live session. Pass it to `collaborationModule`. */
  readonly session: TSession;
  /** Stop the replica and release its listeners. The session becomes `destroyed`. */
  destroy(): void;
}
