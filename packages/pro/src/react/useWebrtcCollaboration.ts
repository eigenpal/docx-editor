/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { useCallback, useId, useMemo, useSyncExternalStore } from 'react';
import type * as Y from 'yjs';
import type { WebrtcProvider } from 'y-webrtc';
import type {
  CollaborationFailure,
  CollaborationIdentity,
} from '@docx-editor.dev/core/collaboration';
import type { EditorModule } from '@docx-editor.dev/core/editor';
import type { CollaborationBootstrap, CollaborationSession } from '../collaboration/types.ts';
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
  /** Room id shared by every peer. Make one with `createCollaborationRoomId`. */
  readonly roomId: string;
  /** The local participant. Recorded as the author of this replica's changes. */
  readonly identity: CollaborationIdentity;
  /** Whether to seed the room, join it, or let the peers decide. */
  readonly bootstrap: UseWebrtcCollaborationBootstrap;
  /**
   * Admit local edits while the transport is `disconnected`. Buffered updates merge on
   * reconnect. On by default; pass `false` to pause editing while disconnected. See
   * {@link CreateDocumentCollaborationOptions.offlineEditing}.
   */
  readonly offlineEditing?: boolean;
  /** Signaling server URLs. Omitted, the room uses the public demo endpoints and warns once. */
  readonly signaling?: readonly string[];
  /** STUN and TURN servers for the peer connections. Pass TURN servers in production. */
  readonly iceServers?: readonly RTCIceServer[];
  /** Signaling encryption key. Every peer passes the same value. */
  readonly password?: string;
}

interface WebrtcRoomHandle extends CollaborationRoomHandle {
  readonly ydoc?: Y.Doc;
  readonly provider?: WebrtcProvider;
  unsyncedChanges?(): number;
  subscribeUnsyncedChanges?(listener: () => void): () => void;
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
   * A different room, server, bootstrap kind, or `actorId` leaves the old room and
   * connects the new one, and `null` leaves. A room opened with `connect` stays.
   */
  readonly room?: UseWebrtcCollaborationConnectOptions | null;
}

/** Values {@link useWebrtcCollaboration} returns. @public */
export interface UseWebrtcCollaborationReturn {
  /** The room's document as `.docx` bytes to mount. Null until the room is ready. */
  readonly document: Uint8Array | null;
  /** Modules to pass to the editor. They include the collaboration module once ready. */
  readonly modules: readonly EditorModule[];
  /** The live session for status and presence. Null while no room is connected. */
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
  /** True while a connect is in progress. */
  readonly pending: boolean;
  /**
   * Local changes no peer has received: made while no peer was connected, and not synced
   * since. A WebRTC room has no server, so these changes exist only in this browser, and
   * closing the page loses them. Warn before the page closes while it is above zero.
   */
  readonly unsyncedChanges: number;
  /** The connect failure or session failure, or null. Check it before `document`. */
  readonly error: CollaborationFailure | null;
  /**
   * Connect a room. RESOLVES with the failure, or null on success — it does not reject.
   *
   * A rejection carried nothing the resolved value does not, and it made the ordinary call
   * site wrong by default: `onClick={() => connect(options)}` produced an unhandled rejection
   * on every failed connect. `error` reports the same failure for renderers.
   */
  readonly connect: (
    options: UseWebrtcCollaborationConnectOptions
  ) => Promise<CollaborationFailure | null>;
  /**
   * Destroy the room and carry on editing locally.
   *
   * The current bytes live in the editor, not in this hook, so the argument is required:
   * pass the bytes `editor.save()` resolves with, as `new Uint8Array(saved)` after a `null`
   * check, to keep what the room typed. The hook remounts the editor from exactly these bytes.
   */
  readonly leave: (nextDocument: Uint8Array) => void;
  /**
   * Recover a session that reached status `error`: leave with `nextDocument`, then connect
   * again to the same room with the same identity, signaling, and password.
   *
   * The reconnect always uses bootstrap `{ kind: 'join' }`, because an active room still
   * exists on the other peers. When no peer holds the room any more, the rejoin resolves with
   * `initialization-timeout` — nothing is lost, because `nextDocument` (your saved bytes)
   * stays mounted locally. A connect that failed also counts as the prior attempt, so
   * rejoin retries it as a joiner.
   */
  readonly rejoin: (nextDocument: Uint8Array) => Promise<CollaborationFailure | null>;
}

/**
 * What a reconnect keys on. NOT the display name or colour — renaming yourself is not
 * changing rooms, and the hook republishes those through `setIdentity` instead.
 *
 * `signaling` IS in it, for the same reason the Hocuspocus twin keys on `url`: endpoints that
 * resolve late, or a failover to a second set, have to move the connection.
 */
function roomKeyOf(room: UseWebrtcCollaborationConnectOptions | null | undefined): string {
  if (!room) return '';
  const signaling = room.signaling ? room.signaling.join(',') : '';
  return `${signaling}:${room.roomId}:${room.bootstrap.kind}:${room.identity.actorId}`;
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
    identityOf: (options) => options.identity,
  });

  const room = state.room;
  const subscribeUnsynced = useCallback(
    (notify: () => void) => room?.subscribeUnsyncedChanges?.(notify) ?? (() => {}),
    [room]
  );
  const unsyncedChanges = useSyncExternalStore(
    subscribeUnsynced,
    () => room?.unsyncedChanges?.() ?? 0,
    () => 0
  );

  return useMemo(
    () => ({
      document: state.document,
      modules: state.modules,
      session: state.session,
      ydoc: state.room?.ydoc ?? null,
      provider: state.room?.provider ?? null,
      pending: state.pending,
      unsyncedChanges,
      error: state.error,
      connect: state.connect,
      leave: state.leave,
      rejoin: state.rejoin,
    }),
    [state, unsyncedChanges]
  );
}
