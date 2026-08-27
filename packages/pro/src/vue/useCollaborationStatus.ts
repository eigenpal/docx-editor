/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import {
  computed,
  readonly,
  shallowRef,
  toValue,
  watch,
  type ComputedRef,
  type MaybeRefOrGetter,
  type Ref,
} from 'vue';
import type {
  CollaborationFailure,
  CollaborationStatus,
} from '@docx-editor.dev/core/collaboration';
import type { CollaborationSession } from '../collaboration/session.ts';
import { useCollaborationSession } from './useCollaborationSession.ts';

/** Reactive collaboration status for Vue hosts. @public */
export interface UseCollaborationStatusReturn {
  readonly status: Readonly<Ref<CollaborationStatus | 'inactive'>>;
  readonly reason: Readonly<Ref<CollaborationFailure | undefined>>;
  readonly lastFailure: Readonly<Ref<CollaborationFailure | undefined>>;
  /**
   * Edits made now reach the room.
   *
   * False while joining, while the transport is down, and after a terminal failure. A host
   * that shows nothing else should show this, because the alternative is a user typing into
   * a replica nobody receives.
   */
  readonly live: ComputedRef<boolean>;
  /**
   * This replica no longer agrees with the room, and waiting will not fix it.
   *
   * `error` and `destroyed`. The replica refused an update and kept the copy it had, so it is
   * now editing a document the others do not have. The way out is `rejoin`, not time — which
   * is why this is separate from "not live" rather than folded into it.
   */
  readonly diverged: ComputedRef<boolean>;
  /**
   * An editor has attached its document port to this replica.
   *
   * False with a live session means the host did not remount the editor when the session
   * appeared — pass `:key="session.sessionId"` — so `collaborationModule` never attached and
   * nothing replicates, whatever `status` says.
   */
  readonly attached: Readonly<Ref<boolean>>;
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
  session?: MaybeRefOrGetter<CollaborationSession | null>
): UseCollaborationStatusReturn {
  const fromContext = useCollaborationSession();
  const status = shallowRef<CollaborationStatus | 'inactive'>('inactive');
  const reason = shallowRef<CollaborationFailure | undefined>(undefined);
  const lastFailure = shallowRef<CollaborationFailure | undefined>(undefined);
  const attached = shallowRef(false);
  watch(
    () => (session === undefined ? fromContext.session.value : toValue(session)),
    (next, _previous, onCleanup) => {
      const apply = (): void => {
        if (!next) {
          status.value = 'inactive';
          reason.value = undefined;
          lastFailure.value = undefined;
          attached.value = false;
          return;
        }
        const snapshot = next.statusSnapshot();
        status.value = snapshot.status;
        reason.value = snapshot.reason;
        lastFailure.value = snapshot.lastFailure;
        // The host-facing session type hides `attached`; the engine session always carries it.
        attached.value = (next as { attached?: boolean }).attached ?? false;
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
    attached: readonly(attached),
    live: computed(() => status.value === 'ready'),
    diverged: computed(() => status.value === 'error' || status.value === 'destroyed'),
  };
}
