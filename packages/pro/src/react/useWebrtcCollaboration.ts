/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { useId, useMemo } from 'react';
import type * as Y from 'yjs';
import type { WebrtcProvider } from 'y-webrtc';
import type {
  CollaborationFailure,
  CollaborationIdentity,
} from '@docx-editor.dev/core/collaboration';
import type { EditorModule } from '@docx-editor.dev/core/editor';
import type { CollaborationBootstrap, CollaborationSession } from '../collaboration/session.ts';
import {
  EMPTY_MODULES,
  useCollaborationRoom,
  type CollaborationRoomHandle,
} from './collaboration-room.ts';

export type { CollaborationSession };

/** Bootstrap for one WebRTC room. @public */
export type UseWebrtcCollaborationBootstrap = CollaborationBootstrap;

/** Arguments for {@link UseWebrtcCollaborationReturn.connect}. @public */
export interface UseWebrtcCollaborationConnectOptions {
  readonly roomId: string;
  readonly identity: CollaborationIdentity;
  readonly bootstrap: UseWebrtcCollaborationBootstrap;
  /**
   * Admit local edits while the transport is `disconnected`. Buffered updates merge on
   * reconnect. See {@link CreateDocumentCollaborationOptions.offlineEditing}.
   */
  readonly offlineEditing?: boolean;
  readonly signaling?: readonly string[];
  readonly iceServers?: readonly RTCIceServer[];
  readonly password?: string;
}

interface WebrtcRoomHandle extends CollaborationRoomHandle {
  readonly ydoc?: Y.Doc;
  readonly provider?: WebrtcProvider;
}

type WebrtcCreateRoom = (
  options: UseWebrtcCollaborationConnectOptions
) => Promise<WebrtcRoomHandle>;

/**
 * Test-only room factory. Not re-exported from `@docx-editor.dev/pro/react/webrtc`.
 *
 * @internal
 */
export const WEBRTC_CREATE_ROOM_FOR_TESTS: unique symbol = Symbol(
  'useWebrtcCollaboration.createRoom'
);

interface InjectedWebrtcCollaborationOptions extends UseWebrtcCollaborationOptions {
  readonly [WEBRTC_CREATE_ROOM_FOR_TESTS]?: WebrtcCreateRoom;
}

/** Input for {@link useWebrtcCollaboration}. @public */
export interface UseWebrtcCollaborationOptions {
  /**
   * Host modules. The hook adds `collaborationModule` when a room is ready.
   * A host collaboration contribution is a configuration error and throws.
   */
  readonly modules?: readonly EditorModule[];
  /**
   * Connect this room on mount. Omit it and call
   * {@link UseWebrtcCollaborationReturn.connect} after the user chooses a room.
   */
  readonly room?: UseWebrtcCollaborationConnectOptions | null;
}

/** Values {@link useWebrtcCollaboration} returns. @public */
export interface UseWebrtcCollaborationReturn {
  readonly document: Uint8Array | null;
  readonly modules: readonly EditorModule[];
  readonly session: CollaborationSession | null;
  /**
   * The room's shared Yjs document, owned by the hook. Null while no room is connected.
   *
   * Read-only escape hatch: observe it or wire additional providers, but leave teardown to
   * the hook.
   */
  readonly ydoc: Y.Doc | null;
  /**
   * The owned `y-webrtc` provider. Null while no room is connected.
   *
   * Read-only escape hatch for transport-level access (`disconnect()`/`connect()`, peer
   * introspection). The hook destroys it on leave and unmount.
   */
  readonly provider: WebrtcProvider | null;
  readonly pending: boolean;
  readonly error: CollaborationFailure | null;
  readonly connect: (options: UseWebrtcCollaborationConnectOptions) => Promise<void>;
  /**
   * Destroy the room and carry on editing locally.
   *
   * The current bytes live in the editor, not in this hook, so the argument is required:
   * pass `await editor.save()` to keep what the room typed. The hook remounts the editor
   * from exactly these bytes.
   */
  readonly leave: (nextDocument: Uint8Array) => void;
  /**
   * Recover a session that reached status `error`: leave with `nextDocument`, then connect
   * again to the same room with the same identity, signaling, and password.
   *
   * The reconnect always uses bootstrap `{ kind: 'join' }`, because an active room still
   * exists on the other peers. When no peer holds the room any more, the join rejects with
   * `initialization-timeout` — nothing is lost, because `nextDocument` (your saved bytes)
   * stays mounted locally. A connect that failed also counts as the prior attempt, so
   * rejoin retries it as a joiner.
   */
  readonly rejoin: (nextDocument: Uint8Array) => Promise<void>;
}

function roomKeyOf(room: UseWebrtcCollaborationConnectOptions | null | undefined): string {
  if (!room) return '';
  return `${room.roomId}:${room.bootstrap.kind}:${room.identity.actorId}`;
}

async function defaultCreateRoom(
  options: UseWebrtcCollaborationConnectOptions
): Promise<WebrtcRoomHandle> {
  const { createWebrtcCollaboration } = await import('../collaboration/webrtc.ts');
  return createWebrtcCollaboration(options);
}

function createRoomOf(options: UseWebrtcCollaborationOptions): WebrtcCreateRoom {
  return (
    (options as InjectedWebrtcCollaborationOptions)[WEBRTC_CREATE_ROOM_FOR_TESTS] ??
    defaultCreateRoom
  );
}

/**
 * Own a WebRTC collaboration room for a React host.
 *
 * The default Pro React entry does not import this hook. Import it from
 * `@docx-editor.dev/pro/react/webrtc` so a review-only bundle does not load
 * a network provider.
 *
 * @public
 */
export function useWebrtcCollaboration(
  options: UseWebrtcCollaborationOptions = {}
): UseWebrtcCollaborationReturn {
  const id = useId();
  const state = useCollaborationRoom<UseWebrtcCollaborationConnectOptions, WebrtcRoomHandle>({
    // The hook name is part of the key: `useId` is already unique per call site, but a
    // shared prefix would let two different hooks collide if that ever changed.
    ownerKey: `react-webrtc:${id}`,
    hookName: 'useWebrtcCollaboration',
    createRoom: createRoomOf(options),
    hostModules: options.modules ?? EMPTY_MODULES,
    autoRoom: options.room ?? null,
    autoKey: roomKeyOf(options.room ?? null),
    rejoinOptionsOf: (last) => ({ ...last, bootstrap: { kind: 'join' } }),
  });

  return useMemo(
    () => ({
      document: state.document,
      modules: state.modules,
      session: state.session,
      ydoc: state.room?.ydoc ?? null,
      provider: state.room?.provider ?? null,
      pending: state.pending,
      error: state.error,
      connect: state.connect,
      leave: state.leave,
      rejoin: state.rejoin,
    }),
    [state]
  );
}
