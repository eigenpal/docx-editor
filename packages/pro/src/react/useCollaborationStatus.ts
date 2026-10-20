/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { useRef, useSyncExternalStore } from 'react';
import type {
  CollaborationFailure,
  CollaborationStatus,
  CollaborationStatusSnapshot,
} from '@docx-editor.dev/core/collaboration';
import type { CollaborationSession } from '../collaboration/types.ts';
import { useCollaborationSession } from './useCollaborationSession.ts';

/** Status returned by {@link useCollaborationStatus}. @public */
export interface UseCollaborationStatusReturn {
  /** Current lifecycle state, or `inactive` when no session is attached. */
  readonly status: CollaborationStatus | 'inactive';
  /** Why the session holds `status`, or `undefined` when nothing is wrong. */
  readonly reason: CollaborationFailure | undefined;
  /** The most recent `error` reason. Kept after the session recovers. */
  readonly lastFailure: CollaborationFailure | undefined;
  /**
   * Edits made now reach the room.
   *
   * False while joining, while the transport is down, and after a terminal failure. A host
   * that shows nothing else should show this, because the alternative is a user typing into
   * a replica nobody receives.
   */
  readonly live: boolean;
  /**
   * This replica no longer agrees with the room, and waiting will not fix it.
   *
   * `destroyed`, or an `error` that is not `recovering`. The replica refused an update and
   * kept the copy it had, so it is now editing a document the others do not have. The way
   * out is {@link UseHocuspocusCollaborationReturn.rejoin}, not time — which is why this is
   * separate from "not live" rather than folded into it.
   */
  readonly diverged: boolean;
  /**
   * The session is in `error` but heals by itself on the next clean update: show a passing
   * notice, not a rejoin action.
   */
  readonly recovering: boolean;
  /**
   * Edits wait for the room: an update arrived that depends on one still on its way. The
   * editor refuses edits until it arrives or the wait times out.
   */
  readonly waiting: boolean;
  /**
   * How many failures the session has recorded. It changes with each new failure, also when
   * `lastFailure` repeats the same code, so a host can tell a user each time an edit is
   * refused.
   */
  readonly failureCount: number;
  /**
   * An editor has attached its document port to this replica.
   *
   * False with a live session means the host did not remount the editor when the session
   * appeared — pass `key={session.sessionId}` — so `collaborationModule` never attached and
   * nothing replicates, whatever `status` says.
   */
  readonly attached: boolean;
}

const INACTIVE: UseCollaborationStatusReturn = Object.freeze({
  status: 'inactive',
  reason: undefined,
  lastFailure: undefined,
  live: false,
  diverged: false,
  recovering: false,
  waiting: false,
  failureCount: 0,
  attached: false,
});

function failuresEqual(
  left: CollaborationFailure | undefined,
  right: CollaborationFailure | undefined
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.code === right.code && left.detail === right.detail;
}

function sameSnapshot(
  left: UseCollaborationStatusReturn,
  right: CollaborationStatusSnapshot
): boolean {
  return (
    left.status === right.status &&
    failuresEqual(left.reason, right.reason) &&
    failuresEqual(left.lastFailure, right.lastFailure) &&
    left.failureCount === (right.failureCount ?? 0) &&
    left.recovering === (right.recovering ?? false) &&
    left.waiting === (right.waiting ?? false)
  );
}

/** The host-facing session type hides `attached`; the engine session always carries it. */
function attachedOf(session: CollaborationSession): boolean {
  return (session as { attached?: boolean }).attached ?? false;
}

function readSnapshot(
  session: CollaborationSession | null,
  cache: { current: UseCollaborationStatusReturn }
): UseCollaborationStatusReturn {
  if (!session) {
    cache.current = INACTIVE;
    return INACTIVE;
  }
  const next = session.statusSnapshot();
  const attached = attachedOf(session);
  // Attachment moves WITHOUT the status moving — a session is `ready` before any editor
  // attaches to it, and stays `ready` if none ever does — so it is compared separately or
  // the cache reports "unchanged" over the one transition this field exists to show.
  if (sameSnapshot(cache.current, next) && cache.current.attached === attached) {
    return cache.current;
  }
  const snapshot: UseCollaborationStatusReturn = Object.freeze({
    status: next.status,
    reason: next.reason,
    lastFailure: next.lastFailure,
    live: next.status === 'ready',
    diverged: next.status === 'destroyed' || (next.status === 'error' && next.recovering !== true),
    recovering: next.status === 'error' && next.recovering === true,
    waiting: next.waiting === true,
    failureCount: next.failureCount ?? 0,
    attached,
  });
  cache.current = snapshot;
  return snapshot;
}

/**
 * Reactive status for the collaboration session, with `live` and `diverged` derived.
 *
 * Omit `session` and it reads the one the editor above holds. Pass it explicitly for a
 * session this Root does not own.
 *
 * @public
 */
export function useCollaborationStatus(
  session?: CollaborationSession | null
): UseCollaborationStatusReturn {
  const fromContext = useCollaborationSession();
  const active = session === undefined ? fromContext : session;
  const cache = useRef(INACTIVE);
  return useSyncExternalStore(
    (notify) => active?.subscribeStatus(() => notify()) ?? (() => {}),
    () => readSnapshot(active, cache),
    () => readSnapshot(active, cache)
  );
}
