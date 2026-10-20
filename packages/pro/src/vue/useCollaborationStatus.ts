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
import type { CollaborationSession } from '../collaboration/types.ts';
import { useCollaborationSession } from './useCollaborationSession.ts';

/** Reactive collaboration status for Vue hosts. @public */
export interface UseCollaborationStatusReturn {
  /** Current lifecycle state, or `inactive` when no session is attached. */
  readonly status: Readonly<Ref<CollaborationStatus | 'inactive'>>;
  /** Why the session holds `status`, or `undefined` when nothing is wrong. */
  readonly reason: Readonly<Ref<CollaborationFailure | undefined>>;
  /** The most recent `error` reason. Kept after the session recovers. */
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
   * `destroyed`, or an `error` that is not `recovering`. The replica refused an update and
   * kept the copy it had, so it is now editing a document the others do not have. The way
   * out is `rejoin`, not time — which is why this is separate from "not live" rather than
   * folded into it.
   */
  readonly diverged: ComputedRef<boolean>;
  /**
   * The session is in `error` but heals by itself on the next clean update: show a passing
   * notice, not a rejoin action.
   */
  readonly recovering: Readonly<Ref<boolean>>;
  /**
   * Edits wait for the room: an update arrived that depends on one still on its way. The
   * editor refuses edits until it arrives or the wait times out.
   */
  readonly waiting: Readonly<Ref<boolean>>;
  /**
   * How many failures the session has recorded. It changes with each new failure, also when
   * `lastFailure` repeats the same code, so a host can tell a user each time an edit is
   * refused.
   */
  readonly failureCount: Readonly<Ref<number>>;
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
  const recovering = shallowRef(false);
  const failureCount = shallowRef(0);
  const waiting = shallowRef(false);
  watch(
    () => (session === undefined ? fromContext.session.value : toValue(session)),
    (next, _previous, onCleanup) => {
      const apply = (): void => {
        if (!next) {
          status.value = 'inactive';
          reason.value = undefined;
          lastFailure.value = undefined;
          attached.value = false;
          recovering.value = false;
          failureCount.value = 0;
          waiting.value = false;
          return;
        }
        const snapshot = next.statusSnapshot();
        status.value = snapshot.status;
        reason.value = snapshot.reason;
        lastFailure.value = snapshot.lastFailure;
        recovering.value = snapshot.status === 'error' && snapshot.recovering === true;
        failureCount.value = snapshot.failureCount ?? 0;
        waiting.value = snapshot.waiting === true;
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
    recovering: readonly(recovering),
    failureCount: readonly(failureCount),
    waiting: readonly(waiting),
    live: computed(() => status.value === 'ready'),
    diverged: computed(
      () => status.value === 'destroyed' || (status.value === 'error' && !recovering.value)
    ),
  };
}
