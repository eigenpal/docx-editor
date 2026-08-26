/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { getCurrentInstance, readonly, toValue, type MaybeRefOrGetter, type Ref } from 'vue';
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
 * Test-only room factory. Not re-exported from `@docx-editor.dev/pro/vue`.
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
   * Host modules. The composable adds `collaborationModule` when a room is ready.
   * A host collaboration contribution is a configuration error and throws.
   */
  readonly modules?: readonly EditorModule[];
  /**
   * Connect this room when the composable starts. Omit it and call
   * {@link UseDocumentCollaborationReturn.connect} after the host has a `ydoc` and a room.
   */
  readonly room?: UseDocumentCollaborationConnectOptions | null;
}

/** Values {@link useDocumentCollaboration} returns. @public */
export interface UseDocumentCollaborationReturn {
  readonly document: Readonly<Ref<Uint8Array | null>>;
  readonly modules: Readonly<Ref<readonly EditorModule[]>>;
  readonly session: Readonly<Ref<CollaborationSession | null>>;
  readonly pending: Readonly<Ref<boolean>>;
  readonly error: Readonly<Ref<CollaborationFailure | null>>;
  readonly connect: (options: UseDocumentCollaborationConnectOptions) => Promise<void>;
  /**
   * Destroy the session and carry on editing locally.
   *
   * The current bytes live in the editor, not in this composable, so the argument is
   * required: pass `await editor.save()` to keep what the room typed. The consumer still
   * owns `ydoc` and its provider; the composable destroys only the session it created.
   */
  readonly leave: (nextDocument: Uint8Array) => void;
}

async function defaultCreateRoom(
  options: UseDocumentCollaborationConnectOptions
): Promise<CollaborationRoomHandle> {
  const { createDocumentCollaboration } = await import('../collaboration/document-session.ts');
  return createDocumentCollaboration(options);
}

function createRoomOf(
  options: UseDocumentCollaborationOptions | null | undefined
): DocumentCreateRoom {
  return (
    (options as InjectedDocumentCollaborationOptions | null | undefined)?.[
      DOCUMENT_CREATE_ROOM_FOR_TESTS
    ] ?? defaultCreateRoom
  );
}

function roomKeyOf(room: UseDocumentCollaborationConnectOptions | null | undefined): string {
  if (!room) return '';
  return `${room.documentId}:${room.bootstrap.kind}:${room.identity.actorId}`;
}

/**
 * Own a provider-agnostic collaboration session for a Vue host.
 *
 * The consumer creates the `ydoc`, the awareness, and whatever provider replicates them
 * (WebSocket, WebRTC, offline persistence); this composable owns only the document session
 * over them, with the same remount-safe lifecycle as `useWebrtcCollaboration`. It imports
 * no network provider.
 *
 * @public
 */
export function useDocumentCollaboration(
  options?: MaybeRefOrGetter<UseDocumentCollaborationOptions | null>
): UseDocumentCollaborationReturn {
  const instance = getCurrentInstance();
  const state = useCollaborationRoom<
    UseDocumentCollaborationConnectOptions,
    CollaborationRoomHandle
  >({
    ownerKey: `vue-document:${String(instance?.uid ?? 'anonymous')}`,
    hookName: 'useDocumentCollaboration',
    createRoomOf: () => createRoomOf(toValue(options)),
    hostModulesOf: () => toValue(options)?.modules ?? EMPTY_MODULES,
    autoRoomOf: () => toValue(options)?.room ?? null,
    autoKeyOf: () => roomKeyOf(toValue(options)?.room),
    rejoinOptionsOf: (last) => last,
  });

  return {
    document: readonly(state.document),
    modules: readonly(state.modules),
    session: readonly(state.session),
    pending: readonly(state.pending),
    error: readonly(state.error),
    connect: state.connect,
    leave: state.leave,
  };
}
