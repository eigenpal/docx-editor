/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { readonly, shallowRef, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue';
import type {
  CollaborationFailure,
  CollaborationStatus,
} from '@docx-editor.dev/core/collaboration';
import type { CollaborationSession } from '../collaboration/session.ts';

/** Reactive collaboration status for Vue hosts. @public */
export interface UseCollaborationStatusReturn {
  readonly status: Readonly<Ref<CollaborationStatus | 'inactive'>>;
  readonly reason: Readonly<Ref<CollaborationFailure | undefined>>;
  readonly lastFailure: Readonly<Ref<CollaborationFailure | undefined>>;
}

/**
 * Subscribe to an externally owned collaboration session.
 *
 * Takes the host-facing {@link CollaborationSession}, which is what
 * `useWebrtcCollaboration` hands back. The engine session satisfies that type too, so a host
 * holding either one can pass it here.
 *
 * @public
 */
export function useCollaborationStatus(
  session: MaybeRefOrGetter<CollaborationSession | null>
): UseCollaborationStatusReturn {
  const status = shallowRef<CollaborationStatus | 'inactive'>('inactive');
  const reason = shallowRef<CollaborationFailure | undefined>(undefined);
  const lastFailure = shallowRef<CollaborationFailure | undefined>(undefined);
  watch(
    () => toValue(session),
    (next, _previous, onCleanup) => {
      const apply = (): void => {
        if (!next) {
          status.value = 'inactive';
          reason.value = undefined;
          lastFailure.value = undefined;
          return;
        }
        const snapshot = next.statusSnapshot();
        status.value = snapshot.status;
        reason.value = snapshot.reason;
        lastFailure.value = snapshot.lastFailure;
      };
      apply();
      if (!next) return;
      onCleanup(next.subscribeStatus(() => apply()));
    },
    { immediate: true }
  );
  return {
    status: readonly(status),
    reason: readonly(reason),
    lastFailure: readonly(lastFailure),
  };
}
