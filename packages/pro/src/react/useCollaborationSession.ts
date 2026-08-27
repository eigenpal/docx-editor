/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { useDocxEditor, useEditorState } from '@docx-editor.dev/react';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import type { CollaborationSession } from '../collaboration/session.ts';

/** Module-level so the selector identity is stable across renders. */
const selectCollaborationStatus = (state: EditorSnapshot): string => state.collaborationStatus;

/**
 * The live collaboration session of the editor above this component, or null.
 *
 * The editor already holds the session a `collaborationModule` contributed, so presence
 * chrome reads it from here instead of being handed it: every part and hook in this package
 * takes `session` as an OPTIONAL prop and falls back to this. A host that has one Root and
 * one room never passes it at all.
 *
 * Pass it explicitly when a component sits outside the Root that owns the room, or when one
 * page renders two.
 *
 * @public
 */
export function useCollaborationSession(): CollaborationSession | null {
  const editor = useDocxEditor();
  // Subscribed, not read once. The Root creates its editor before the surface exists, so the
  // session is absent on the first render and appears without any prop changing — a plain
  // read would pin `null` for the life of the component.
  useEditorState(selectCollaborationStatus);
  // The engine contract is a superset of the host-facing one, so the narrowing is safe and
  // keeps `setIdentity` and the provider seams off the type a host reads.
  return (editor?.collaborationSession() as CollaborationSession | null | undefined) ?? null;
}
