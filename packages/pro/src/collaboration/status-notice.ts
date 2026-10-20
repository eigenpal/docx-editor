/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * What the collaboration status part tells the user, from the session's status snapshot.
 * Shared by the React and Vue parts so the two say the same thing.
 */
import type {
  CollaborationFailureCode,
  CollaborationStatus,
} from '@docx-editor.dev/core/collaboration';

/**
 * The notice the status part shows, or none while everything is in order.
 *
 * - `connecting`: the session is joining the room.
 * - `offline`: the transport is down and edits continue; they sync on reconnect.
 * - `offlinePaused`: the transport is down and the session refuses edits until reconnect
 *   (`offlineEditing: false`).
 * - `syncing`: the session hit an update it could not apply yet and heals on the next one.
 * - `waiting`: edits wait until an update the room sent can apply.
 * - `stalled`: edits have waited longer than `STALLED_AFTER_MS`; rejoining loads the room.
 * - `editRefused`: the room refused the last edit, and the editor undid it.
 * - `outOfSync`: this copy no longer agrees with the room; rejoining loads the room's copy.
 * - `upgradeRequired`: this client and the room use different collaboration formats, and either
 *   side can be the older one. A rejoin cannot fix it; an upgrade of the older side can.
 * - `newRoomRequired`: the room itself cannot continue (two seeds merged, a damaged blob, or
 *   a resource limit); a rejoin cannot fix it. Save a copy and share it in a new room.
 *
 * @public
 */
export type CollaborationNoticeKind =
  | 'connecting'
  | 'offline'
  | 'offlinePaused'
  | 'syncing'
  | 'waiting'
  | 'stalled'
  | 'editRefused'
  | 'outOfSync'
  | 'upgradeRequired'
  | 'newRoomRequired';

/** How long the part shows that the room refused an edit. */
export const EDIT_REFUSED_NOTICE_MS = 6000;

/** How long edits wait before the part offers to rejoin. */
export const STALLED_AFTER_MS = 10_000;

/** The i18n key of each notice's message. */
export const NOTICE_MESSAGE_KEYS = Object.freeze({
  connecting: 'collaboration.status.connecting',
  offline: 'collaboration.status.offline',
  offlinePaused: 'collaboration.status.offlinePaused',
  syncing: 'collaboration.status.syncing',
  waiting: 'collaboration.status.waiting',
  stalled: 'collaboration.status.stalled',
  editRefused: 'collaboration.status.editRefused',
  outOfSync: 'collaboration.status.outOfSync',
  upgradeRequired: 'collaboration.status.upgradeRequired',
  newRoomRequired: 'collaboration.status.newRoomRequired',
} as const satisfies Record<CollaborationNoticeKind, string>);

/** Failures of the room itself, which a rejoin to the same room meets again. */
const ROOM_FAILURES: ReadonlySet<CollaborationFailureCode> = new Set([
  'concurrent-seed',
  'blob-digest-mismatch',
  'blob-store-full',
  'too-many-nodes',
  'too-many-parts',
  'too-many-relationships',
  'too-many-children',
  'too-many-attributes',
  'tree-too-deep',
]);

/** Failures that mean this client and the room use different formats. */
const FORMAT_MISMATCHES: ReadonlySet<CollaborationFailureCode> = new Set([
  'collaboration-format-mismatch',
  'protocol-version-mismatch',
  'schema-version-mismatch',
]);

export function collaborationNoticeOf(state: {
  readonly status: CollaborationStatus | 'inactive';
  readonly reasonCode: CollaborationFailureCode | undefined;
  readonly recovering: boolean;
  readonly waiting: boolean;
  /** Edits have waited longer than `STALLED_AFTER_MS`. */
  readonly stalled: boolean;
  /** The room refused an edit within `EDIT_REFUSED_NOTICE_MS`. */
  readonly refusedRecently: boolean;
  /** Edits continue while disconnected. */
  readonly offlineEditing: boolean;
}): CollaborationNoticeKind | null {
  switch (state.status) {
    case 'inactive':
    case 'destroyed':
      return null;
    case 'initializing':
      return 'connecting';
    case 'error':
      if (state.reasonCode !== undefined && FORMAT_MISMATCHES.has(state.reasonCode)) {
        return 'upgradeRequired';
      }
      if (state.reasonCode !== undefined && ROOM_FAILURES.has(state.reasonCode)) {
        return 'newRoomRequired';
      }
      return state.recovering ? 'syncing' : 'outOfSync';
    case 'disconnected':
      return state.offlineEditing ? 'offline' : 'offlinePaused';
    case 'ready':
      if (state.waiting) return state.stalled ? 'stalled' : 'waiting';
      return state.refusedRecently ? 'editRefused' : null;
  }
}
