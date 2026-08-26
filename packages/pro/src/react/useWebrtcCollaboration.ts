/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type {
  CollaborationIdentity,
  EditorCollaborationSession,
} from '@docx-editor.dev/core/collaboration';
import type { EditorModule } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration/collaboration-module.ts';
import { webrtcRoomOwnerFor } from './webrtc-room-owner.ts';

/** Bootstrap for one WebRTC room. @public */
export type UseWebrtcCollaborationBootstrap =
  | { readonly kind: 'create'; readonly document: Uint8Array }
  | { readonly kind: 'join'; readonly timeoutMs?: number; readonly signal?: AbortSignal };

/** Arguments for {@link UseWebrtcCollaborationReturn.connect}. @public */
export interface UseWebrtcCollaborationConnectOptions {
  readonly roomId: string;
  readonly identity: CollaborationIdentity;
  readonly bootstrap: UseWebrtcCollaborationBootstrap;
  readonly signaling?: readonly string[];
  readonly iceServers?: readonly RTCIceServer[];
  readonly password?: string;
}

interface WebrtcRoomHandle {
  readonly document: Uint8Array;
  readonly session: EditorCollaborationSession;
  destroy(): void;
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
  readonly session: EditorCollaborationSession | null;
  readonly pending: boolean;
  readonly error: Error | null;
  readonly connect: (options: UseWebrtcCollaborationConnectOptions) => Promise<void>;
  /**
   * Destroy the room and carry on editing locally.
   *
   * Called with no argument, `document` falls back to the bytes this room STARTED from, so
   * whatever the room typed is lost. The hook cannot do better alone — the current bytes live
   * in the editor, not here. Pass `await editor.save()` to keep the session's edits.
   */
  readonly leave: (nextDocument?: Uint8Array) => void;
}

const EMPTY_MODULES: readonly EditorModule[] = Object.freeze([]);

const HOST_COLLABORATION_CONFLICT =
  'useWebrtcCollaboration: host `modules` already include a collaboration contribution. This hook supplies `collaborationModule({ session })`. Pass review and custom-node modules only.';

function assertHostModulesHaveNoCollaboration(modules: readonly EditorModule[]): void {
  for (const module of modules) {
    if (module.collaboration) throw new Error(HOST_COLLABORATION_CONFLICT);
  }
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
  const owner = webrtcRoomOwnerFor<WebrtcRoomHandle>(`react:${id}`);
  const createRoomRef = useRef(createRoomOf(options));
  createRoomRef.current = createRoomOf(options);
  const hostModules = options.modules ?? EMPTY_MODULES;
  assertHostModulesHaveNoCollaboration(hostModules);
  const autoRoom = options.room ?? null;
  const autoKey = roomKeyOf(autoRoom);
  const autoRoomRef = useRef(autoRoom);
  autoRoomRef.current = autoRoom;

  const generationRef = useRef(0);
  const [document, setDocument] = useState<Uint8Array | null>(
    () => owner.current()?.document ?? null
  );
  const [session, setSession] = useState<EditorCollaborationSession | null>(
    () => owner.current()?.session ?? null
  );
  const [pending, setPending] = useState(() => autoRoom !== null && owner.current() === null);
  const [error, setError] = useState<Error | null>(null);

  const publish = useCallback((room: WebrtcRoomHandle | null) => {
    setDocument(room?.document ?? null);
    setSession(room?.session ?? null);
  }, []);

  const connect = useCallback(
    async (next: UseWebrtcCollaborationConnectOptions) => {
      const generation = ++generationRef.current;
      setPending(true);
      setError(null);
      try {
        const room = await createRoomRef.current(next);
        if (generation !== generationRef.current) {
          room.destroy();
          return;
        }
        owner.adopt(room);
        publish(room);
      } catch (cause) {
        if (generation !== generationRef.current) return;
        const nextError = cause instanceof Error ? cause : new Error(String(cause));
        setError(nextError);
        throw nextError;
      } finally {
        if (generation === generationRef.current) setPending(false);
      }
    },
    [owner, publish]
  );

  const leave = useCallback(
    (nextDocument?: Uint8Array) => {
      generationRef.current += 1;
      const preserved = nextDocument ?? owner.current()?.document ?? document;
      owner.leave();
      setSession(null);
      setDocument(preserved);
      setPending(false);
      setError(null);
    },
    [document, owner]
  );

  useEffect(() => {
    owner.reclaimOwner();
    const held = owner.current();
    if (held) publish(held);
    return () => {
      generationRef.current += 1;
      owner.disposeOwner();
    };
  }, [owner, publish]);

  useEffect(() => {
    const room = autoRoomRef.current;
    if (!room) return;
    if (owner.current()) return;
    // `connect` rejects so that an awaiting caller can branch on the failure. This path has
    // no caller, and the failure already reaches the host through `error`, so swallow it
    // rather than raise an unhandled rejection for a room the host already renders as failed.
    void connect(room).catch(() => {});
  }, [autoKey, connect, owner]);

  const modules = useMemo(() => {
    if (!session) return hostModules;
    return Object.freeze([...hostModules, collaborationModule({ session })]);
  }, [hostModules, session]);

  return useMemo(
    () => ({
      document,
      modules,
      session,
      pending,
      error,
      connect,
      leave,
    }),
    [connect, document, error, leave, modules, pending, session]
  );
}
