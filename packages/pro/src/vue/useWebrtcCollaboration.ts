/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import {
  computed,
  getCurrentInstance,
  readonly,
  toValue,
  type MaybeRefOrGetter,
  type Ref,
} from 'vue';
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
 * Test-only room factory. Not re-exported from `@docx-editor.dev/pro/vue/webrtc`.
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
   * Connect this room when the composable starts. Omit it and call
   * {@link UseWebrtcCollaborationReturn.connect} after the user chooses a room.
   */
  readonly room?: UseWebrtcCollaborationConnectOptions | null;
}

/** Values {@link useWebrtcCollaboration} returns. @public */
export interface UseWebrtcCollaborationReturn {
  readonly document: Readonly<Ref<Uint8Array | null>>;
  readonly modules: Readonly<Ref<readonly EditorModule[]>>;
  readonly session: Readonly<Ref<CollaborationSession | null>>;
  /**
   * The room's shared Yjs document, owned by the composable. Null while no room is
   * connected.
   *
   * Read-only escape hatch: observe it or wire additional providers, but leave teardown to
   * the composable.
   */
  readonly ydoc: Readonly<Ref<Y.Doc | null>>;
  /**
   * The owned `y-webrtc` provider. Null while no room is connected.
   *
   * Read-only escape hatch for transport-level access (`disconnect()`/`connect()`, peer
   * introspection). The composable destroys it on leave and unmount.
   */
  readonly provider: Readonly<Ref<WebrtcProvider | null>>;
  readonly pending: Readonly<Ref<boolean>>;
  readonly error: Readonly<Ref<CollaborationFailure | null>>;
  readonly connect: (options: UseWebrtcCollaborationConnectOptions) => Promise<void>;
  /**
   * Destroy the room and carry on editing locally.
   *
   * The current bytes live in the editor, not in this composable, so the argument is
   * required: pass `await editor.save()` to keep what the room typed. The host remounts the
   * editor from exactly these bytes.
   */
  readonly leave: (nextDocument: Uint8Array) => void;
  /**
   * Recover a session that reached status `error`: leave with `nextDocument`, then connect
   * again to the same room with the same identity, signaling, and password.
   *
   * The reconnect always uses bootstrap `{ kind: 'join' }`, because an active room still
   * exists on the other peers. When no peer holds the room any more, the join rejects with
   * `initialization-timeout` — nothing is lost, because `nextDocument` (your saved bytes)
   * stays mounted locally.
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

function createRoomOf(options: UseWebrtcCollaborationOptions | null | undefined): WebrtcCreateRoom {
  return (
    (options as InjectedWebrtcCollaborationOptions | null | undefined)?.[
      WEBRTC_CREATE_ROOM_FOR_TESTS
    ] ?? defaultCreateRoom
  );
}

/**
 * Own a WebRTC collaboration room for a Vue host.
 *
 * The default Pro Vue entry does not import this composable. Import it from
 * `@docx-editor.dev/pro/vue/webrtc` so a review-only bundle does not load
 * a network provider.
 *
 * @public
 */
export function useWebrtcCollaboration(
  options?: MaybeRefOrGetter<UseWebrtcCollaborationOptions | null>
): UseWebrtcCollaborationReturn {
  const instance = getCurrentInstance();
  const state = useCollaborationRoom<UseWebrtcCollaborationConnectOptions, WebrtcRoomHandle>({
    ownerKey: `vue:${String(instance?.uid ?? 'anonymous')}`,
    hookName: 'useWebrtcCollaboration',
    createRoomOf: () => createRoomOf(toValue(options)),
    hostModulesOf: () => toValue(options)?.modules ?? EMPTY_MODULES,
    autoRoomOf: () => toValue(options)?.room ?? null,
    autoKeyOf: () => roomKeyOf(toValue(options)?.room),
    rejoinOptionsOf: (last) => ({ ...last, bootstrap: { kind: 'join' } }),
  });

  return {
    document: readonly(state.document),
    modules: readonly(state.modules),
    session: readonly(state.session),
    ydoc: computed(() => state.room.value?.ydoc ?? null),
    provider: computed(() => state.room.value?.provider ?? null),
    pending: readonly(state.pending),
    error: readonly(state.error),
    connect: state.connect,
    leave: state.leave,
    rejoin: state.rejoin,
  };
}
