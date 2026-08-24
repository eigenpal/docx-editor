import { useMemo, useSyncExternalStore } from 'react';
import type {
  CollaborationStatus,
  EditorCollaborationSession,
} from '@docx-editor.dev/core/collaboration';

/** Status returned by {@link useCollaborationStatus}. @public */
export interface UseCollaborationStatusReturn {
  readonly status: CollaborationStatus | 'inactive';
}

/** Reactive status for an externally owned collaboration session. @public */
export function useCollaborationStatus(
  session: EditorCollaborationSession | null
): UseCollaborationStatusReturn {
  const status = useSyncExternalStore(
    (notify) => session?.subscribeStatus(() => notify()) ?? (() => {}),
    () => session?.status() ?? 'inactive',
    () => session?.status() ?? 'inactive'
  );
  return useMemo(() => ({ status }), [status]);
}
