/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { useId, useMemo } from 'react';
import type { CollaborationFailure } from '@docx-editor.dev/core/collaboration';
import type { EditorModule } from '@docx-editor.dev/core/editor';
import type { CollaborationSession } from '../collaboration/session.ts';
import type { CreateDocumentCollaborationOptions } from '../collaboration/document-session.ts';
import {
  EMPTY_MODULES,
  useCollaborationRoom,
  type CollaborationRoomHandle,
} from './collaboration-room.ts';

/**
 * Arguments for {@link UseDocumentCollaborationReturn.connect}: the
 * `createDocumentCollaboration` options. The consumer owns `ydoc`, `awareness`, and
 * whatever provider replicates them.
 *
 * @public
 */
export type UseDocumentCollaborationConnectOptions = CreateDocumentCollaborationOptions;

type DocumentCreateRoom = (
  options: UseDocumentCollaborationConnectOptions
) => Promise<CollaborationRoomHandle>;

/**
 * Test-only room factory. Not re-exported from `@docx-editor.dev/pro/react`.
 *
 * @internal
 */
export const DOCUMENT_CREATE_ROOM_FOR_TESTS: unique symbol = Symbol(
  'useDocumentCollaboration.createRoom'
);

interface InjectedDocumentCollaborationOptions extends UseDocumentCollaborationOptions {
  readonly [DOCUMENT_CREATE_ROOM_FOR_TESTS]?: DocumentCreateRoom;
}

/** Input for {@link useDocumentCollaboration}. @public */
export interface UseDocumentCollaborationOptions {
  /**
   * Host modules. The hook adds `collaborationModule` when a room is ready.
   * A host collaboration contribution is a configuration error and throws.
   */
  readonly modules?: readonly EditorModule[];
  /**
   * Connect this room on mount. Omit it and call
   * {@link UseDocumentCollaborationReturn.connect} after the host has a `ydoc` and a room.
   */
  readonly room?: UseDocumentCollaborationConnectOptions | null;
}

/** Values {@link useDocumentCollaboration} returns. @public */
export interface UseDocumentCollaborationReturn {
  readonly document: Uint8Array | null;
  readonly modules: readonly EditorModule[];
  readonly session: CollaborationSession | null;
  readonly pending: boolean;
  readonly error: CollaborationFailure | null;
  readonly connect: (options: UseDocumentCollaborationConnectOptions) => Promise<void>;
  /**
   * Destroy the session and carry on editing locally.
   *
   * The current bytes live in the editor, not in this hook, so the argument is required:
   * pass `await editor.save()` to keep what the room typed. The consumer still owns `ydoc`
   * and its provider; the hook destroys only the session it created.
   */
  readonly leave: (nextDocument: Uint8Array) => void;
}

async function defaultCreateRoom(
  options: UseDocumentCollaborationConnectOptions
): Promise<CollaborationRoomHandle> {
  const { createDocumentCollaboration } = await import('../collaboration/document-session.ts');
  return createDocumentCollaboration(options);
}

function createRoomOf(options: UseDocumentCollaborationOptions): DocumentCreateRoom {
  return (
    (options as InjectedDocumentCollaborationOptions)[DOCUMENT_CREATE_ROOM_FOR_TESTS] ??
    defaultCreateRoom
  );
}

function roomKeyOf(room: UseDocumentCollaborationConnectOptions | null | undefined): string {
  if (!room) return '';
  return `${room.documentId}:${room.bootstrap.kind}:${room.identity.actorId}`;
}

/**
 * Own a provider-agnostic collaboration session for a React host.
 *
 * The consumer creates the `ydoc`, the awareness, and whatever provider replicates them
 * (WebSocket, WebRTC, offline persistence); this hook owns only the document session over
 * them, with the same StrictMode-safe lifecycle as `useWebrtcCollaboration`. It imports no
 * network provider.
 *
 * @public
 */
export function useDocumentCollaboration(
  options: UseDocumentCollaborationOptions = {}
): UseDocumentCollaborationReturn {
  const id = useId();
  const state = useCollaborationRoom<
    UseDocumentCollaborationConnectOptions,
    CollaborationRoomHandle
  >({
    ownerKey: `react-document:${id}`,
    hookName: 'useDocumentCollaboration',
    createRoom: createRoomOf(options),
    hostModules: options.modules ?? EMPTY_MODULES,
    autoRoom: options.room ?? null,
    autoKey: roomKeyOf(options.room ?? null),
    rejoinOptionsOf: (last) => last,
  });

  return useMemo(
    () => ({
      document: state.document,
      modules: state.modules,
      session: state.session,
      pending: state.pending,
      error: state.error,
      connect: state.connect,
      leave: state.leave,
    }),
    [state]
  );
}
