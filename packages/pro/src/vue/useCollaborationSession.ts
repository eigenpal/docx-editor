/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { computed, type ComputedRef } from 'vue';
import { useDocxEditor, useEditorState } from '@docx-editor.dev/vue';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import type { CollaborationSession } from '../collaboration/session.ts';

/** Values {@link useCollaborationSession} returns. @public */
export interface UseCollaborationSessionReturn {
  /** The live collaboration session of the editor above, or null. */
  readonly session: ComputedRef<CollaborationSession | null>;
}

/**
 * The live collaboration session of the editor above this component, or null.
 *
 * The editor already holds the session a `collaborationModule` contributed, so presence
 * chrome reads it from here instead of being handed it: every part and composable in this
 * package takes `session` as an OPTIONAL prop and falls back to this. A host with one Root
 * and one room never passes it at all.
 *
 * Pass it explicitly when a component sits outside the Root that owns the room, or when one
 * page renders two.
 *
 * @public
 */
export function useCollaborationSession(): UseCollaborationSessionReturn {
  const editorRef = useDocxEditor();
  // Tracked, not read once. The Root creates its editor before the surface exists, so the
  // session is absent on the first render and appears without any prop changing — a computed
  // that only read the editor ref would never recompute and would pin `null`.
  const status = useEditorState((snapshot: EditorSnapshot) => snapshot.collaborationStatus);
  return {
    session: computed(() => {
      // Read so the computed DEPENDS on it; the value itself is not what is returned.
      void status.value;
      // The engine contract is a superset of the host-facing one, so the narrowing is safe
      // and keeps `setIdentity` and the provider seams off the type a host reads.
      return (
        (editorRef.value?.collaborationSession() as CollaborationSession | null | undefined) ?? null
      );
    }),
  };
}
