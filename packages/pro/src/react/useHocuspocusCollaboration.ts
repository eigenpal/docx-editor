/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { useId, useMemo } from 'react';
import type * as Y from 'yjs';
import type { HocuspocusProvider } from '@hocuspocus/provider';
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

/** Bootstrap for one Hocuspocus room. @public */
export type UseHocuspocusCollaborationBootstrap = CollaborationBootstrap;

/** Arguments for {@link UseHocuspocusCollaborationReturn.connect}. @public */
export interface UseHocuspocusCollaborationConnectOptions {
  /** Hocuspocus server WebSocket URL, for example `wss://collab.example.test`. */
  readonly url: string;
  readonly roomId: string;
  /** Authentication token the provider sends in its auth handshake. */
  readonly token?: string;
  readonly identity: CollaborationIdentity;
  readonly bootstrap: UseHocuspocusCollaborationBootstrap;
  /** Bound on the wait for the server's initial sync. Default 30000 ms. */
  readonly syncedTimeoutMs?: number;
}

interface HocuspocusRoomHandle extends CollaborationRoomHandle {
  readonly ydoc?: Y.Doc;
  readonly provider?: HocuspocusProvider;
}

type HocuspocusCreateRoom = (
  options: UseHocuspocusCollaborationConnectOptions
) => Promise<HocuspocusRoomHandle>;

/**
 * Test-only room factory. Not re-exported from `@docx-editor.dev/pro/react/hocuspocus`.
 *
 * @internal
 */
export const HOCUSPOCUS_CREATE_ROOM_FOR_TESTS: unique symbol = Symbol(
  'useHocuspocusCollaboration.createRoom'
);

interface InjectedHocuspocusCollaborationOptions extends UseHocuspocusCollaborationOptions {
  readonly [HOCUSPOCUS_CREATE_ROOM_FOR_TESTS]?: HocuspocusCreateRoom;
}

/** Input for {@link useHocuspocusCollaboration}. @public */
export interface UseHocuspocusCollaborationOptions {
  /**
   * Host modules. The hook adds `collaborationModule` when a room is ready.
   * A host collaboration contribution is a configuration error and throws.
   */
  readonly modules?: readonly EditorModule[];
  /**
   * Connect this room on mount. Omit it and call
   * {@link UseHocuspocusCollaborationReturn.connect} after the user chooses a room.
   */
  readonly room?: UseHocuspocusCollaborationConnectOptions | null;
}

/** Values {@link useHocuspocusCollaboration} returns. @public */
export interface UseHocuspocusCollaborationReturn {
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
   * The owned `@hocuspocus/provider` instance. Null while no room is connected.
   *
   * Read-only escape hatch for transport-level access (`disconnect()`/`connect()`,
   * server events). The hook destroys it on leave and unmount.
   */
  readonly provider: HocuspocusProvider | null;
  readonly pending: boolean;
  readonly error: CollaborationFailure | null;
  readonly connect: (options: UseHocuspocusCollaborationConnectOptions) => Promise<void>;
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
   * again to the same room with the same identity, url, and token.
   *
   * The reconnect always uses bootstrap `{ kind: 'join' }`, because the server still holds
   * the room. When the server no longer holds it, the join rejects with
   * `initialization-timeout` — nothing is lost, because `nextDocument` (your saved bytes)
   * stays mounted locally. A connect that failed also counts as the prior attempt, so
   * rejoin retries it as a joiner.
   */
  readonly rejoin: (nextDocument: Uint8Array) => Promise<void>;
}

function roomKeyOf(room: UseHocuspocusCollaborationConnectOptions | null | undefined): string {
  if (!room) return '';
  return `${room.roomId}:${room.bootstrap.kind}:${room.identity.actorId}`;
}

async function defaultCreateRoom(
  options: UseHocuspocusCollaborationConnectOptions
): Promise<HocuspocusRoomHandle> {
  const { createHocuspocusCollaboration } = await import('../collaboration/hocuspocus.ts');
  return createHocuspocusCollaboration(options);
}

function createRoomOf(options: UseHocuspocusCollaborationOptions): HocuspocusCreateRoom {
  return (
    (options as InjectedHocuspocusCollaborationOptions)[HOCUSPOCUS_CREATE_ROOM_FOR_TESTS] ??
    defaultCreateRoom
  );
}

/**
 * Own a Hocuspocus collaboration room for a React host.
 *
 * The default Pro React entry does not import this hook. Import it from
 * `@docx-editor.dev/pro/react/hocuspocus` so a review-only bundle does not load
 * a network provider.
 *
 * @public
 */
export function useHocuspocusCollaboration(
  options: UseHocuspocusCollaborationOptions = {}
): UseHocuspocusCollaborationReturn {
  const id = useId();
  const state = useCollaborationRoom<
    UseHocuspocusCollaborationConnectOptions,
    HocuspocusRoomHandle
  >({
    ownerKey: `react:${id}`,
    hookName: 'useHocuspocusCollaboration',
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
