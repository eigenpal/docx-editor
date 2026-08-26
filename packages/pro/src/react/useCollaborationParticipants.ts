/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { useRef, useSyncExternalStore } from 'react';
import type { CollaborationParticipant } from '@docx-editor.dev/core/collaboration';
import type { CollaborationSession } from '../collaboration/session.ts';

const NO_PARTICIPANTS: readonly CollaborationParticipant[] = Object.freeze([]);

function participantsEqual(
  left: readonly CollaborationParticipant[],
  right: readonly CollaborationParticipant[]
): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]!;
    const b = right[index]!;
    if (
      a.actorId !== b.actorId ||
      a.name !== b.name ||
      a.color !== b.color ||
      a.role !== b.role ||
      a.isLocal !== b.isLocal
    ) {
      return false;
    }
  }
  return true;
}

function readParticipants(
  session: CollaborationSession | null,
  cache: { current: readonly CollaborationParticipant[] }
): readonly CollaborationParticipant[] {
  if (!session) {
    cache.current = NO_PARTICIPANTS;
    return NO_PARTICIPANTS;
  }
  // `participants()` builds a fresh array per call, and `useSyncExternalStore` treats a new
  // reference as a change. Cache the last value so an unchanged roster keeps its identity.
  const next = session.participants();
  if (participantsEqual(cache.current, next)) return cache.current;
  cache.current = next;
  return next;
}

/**
 * Reactive participant roster for an externally owned collaboration session.
 *
 * Takes the host-facing {@link CollaborationSession}, which is what the collaboration hooks
 * hand back. Returns the same array reference until the roster actually changes, so a
 * memoized consumer does not re-render on unrelated awareness traffic. An absent session
 * yields a stable empty array.
 *
 * @public
 */
export function useCollaborationParticipants(
  session: CollaborationSession | null
): readonly CollaborationParticipant[] {
  const cache = useRef<readonly CollaborationParticipant[]>(NO_PARTICIPANTS);
  return useSyncExternalStore(
    (notify) => session?.subscribeParticipants(() => notify()) ?? (() => {}),
    () => readParticipants(session, cache),
    () => readParticipants(session, cache)
  );
}
