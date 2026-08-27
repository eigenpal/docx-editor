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
import type { CollaborationSession } from '../collaboration/session.ts';

/** Status returned by {@link useCollaborationStatus}. @public */
export interface UseCollaborationStatusReturn {
  readonly status: CollaborationStatus | 'inactive';
  readonly reason: CollaborationFailure | undefined;
  readonly lastFailure: CollaborationFailure | undefined;
}

const INACTIVE: UseCollaborationStatusReturn = Object.freeze({
  status: 'inactive',
  reason: undefined,
  lastFailure: undefined,
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
  right: CollaborationStatusSnapshot | UseCollaborationStatusReturn
): boolean {
  return (
    left.status === right.status &&
    failuresEqual(left.reason, right.reason) &&
    failuresEqual(left.lastFailure, right.lastFailure)
  );
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
  if (sameSnapshot(cache.current, next)) return cache.current;
  const snapshot: UseCollaborationStatusReturn = Object.freeze({
    status: next.status,
    reason: next.reason,
    lastFailure: next.lastFailure,
  });
  cache.current = snapshot;
  return snapshot;
}

/**
 * Reactive status for an externally owned collaboration session.
 *
 * Takes the host-facing {@link CollaborationSession}, which is what
 * `useWebrtcCollaboration` hands back. The engine session satisfies that type too, so a host
 * holding either one can pass it here.
 *
 * @public
 */
export function useCollaborationStatus(
  session: CollaborationSession | null
): UseCollaborationStatusReturn {
  const cache = useRef(INACTIVE);
  return useSyncExternalStore(
    (notify) => session?.subscribeStatus(() => notify()) ?? (() => {}),
    () => readSnapshot(session, cache),
    () => readSnapshot(session, cache)
  );
}
