/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { readonly, shallowRef, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue';
import type {
  CollaborationStatus,
  EditorCollaborationSession,
} from '@docx-editor.dev/core/collaboration';

/** Reactive collaboration status for Vue hosts. @public */
export interface UseCollaborationStatusReturn {
  readonly status: Readonly<Ref<CollaborationStatus | 'inactive'>>;
}

/** Subscribe to an externally owned collaboration session. @public */
export function useCollaborationStatus(
  session: MaybeRefOrGetter<EditorCollaborationSession | null>
): UseCollaborationStatusReturn {
  const status = shallowRef<CollaborationStatus | 'inactive'>('inactive');
  watch(
    () => toValue(session),
    (next, _previous, onCleanup) => {
      status.value = next?.status() ?? 'inactive';
      if (!next) return;
      onCleanup(next.subscribeStatus((value) => (status.value = value)));
    },
    { immediate: true }
  );
  return { status: readonly(status) };
}
