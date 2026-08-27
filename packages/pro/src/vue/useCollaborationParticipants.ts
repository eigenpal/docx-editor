/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { readonly, shallowRef, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue';
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

/** Reactive participant roster for Vue hosts. @public */
export interface UseCollaborationParticipantsReturn {
  readonly participants: Readonly<Ref<readonly CollaborationParticipant[]>>;
}

/**
 * Subscribe to the participant roster of an externally owned collaboration session.
 *
 * Takes the host-facing {@link CollaborationSession}, which is what the collaboration
 * composables hand back. The ref keeps its array reference until the roster actually
 * changes, so unrelated awareness traffic does not retrigger watchers. An absent session
 * yields a stable empty array.
 *
 * @public
 */
export function useCollaborationParticipants(
  session: MaybeRefOrGetter<CollaborationSession | null>
): UseCollaborationParticipantsReturn {
  const participants = shallowRef<readonly CollaborationParticipant[]>(NO_PARTICIPANTS);
  watch(
    () => toValue(session),
    (next, _previous, onCleanup) => {
      const apply = (): void => {
        // `participants()` builds a fresh array per call; keep the previous reference when
        // the roster did not change so watchers do not fire on unrelated awareness traffic.
        const value = next ? next.participants() : NO_PARTICIPANTS;
        if (!participantsEqual(participants.value, value)) participants.value = value;
      };
      apply();
      if (!next) return;
      onCleanup(next.subscribeParticipants(() => apply()));
    },
    { immediate: true }
  );
  return { participants: readonly(participants) };
}
