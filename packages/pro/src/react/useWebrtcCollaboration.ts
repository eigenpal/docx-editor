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

/** Room handle the hook can own. Tests pass a stub. @public */
export interface UseWebrtcCollaborationRoomHandle {
  readonly document: Uint8Array;
  readonly session: EditorCollaborationSession;
  destroy(): void;
}

/** Input for {@link useWebrtcCollaboration}. @public */
export interface UseWebrtcCollaborationOptions {
  /** Host modules. The hook appends `collaborationModule` when a room is ready. */
  readonly modules?: readonly EditorModule[];
  /**
   * Connect this room on mount. Omit it and call
   * {@link UseWebrtcCollaborationReturn.connect} after the user chooses a room.
   */
  readonly room?: UseWebrtcCollaborationConnectOptions | null;
  /** Defaults to `createWebrtcCollaboration`. Pass a stub in tests. */
  readonly createRoom?: (
    options: UseWebrtcCollaborationConnectOptions
  ) => Promise<UseWebrtcCollaborationRoomHandle>;
}

/** Values {@link useWebrtcCollaboration} returns. @public */
export interface UseWebrtcCollaborationReturn {
  readonly document: Uint8Array | null;
  readonly modules: readonly EditorModule[];
  readonly session: EditorCollaborationSession | null;
  readonly pending: boolean;
  readonly error: Error | null;
  readonly connect: (options: UseWebrtcCollaborationConnectOptions) => Promise<void>;
  readonly leave: (nextDocument?: Uint8Array) => void;
}

const EMPTY_MODULES: readonly EditorModule[] = Object.freeze([]);

function roomKeyOf(room: UseWebrtcCollaborationConnectOptions | null | undefined): string {
  if (!room) return '';
  return `${room.roomId}:${room.bootstrap.kind}:${room.identity.actorId}`;
}

async function defaultCreateRoom(
  options: UseWebrtcCollaborationConnectOptions
): Promise<UseWebrtcCollaborationRoomHandle> {
  const { createWebrtcCollaboration } = await import('../collaboration/webrtc.ts');
  return createWebrtcCollaboration(options);
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
  const owner = webrtcRoomOwnerFor<UseWebrtcCollaborationRoomHandle>(`react:${id}`);
  const createRoomRef = useRef(options.createRoom ?? defaultCreateRoom);
  createRoomRef.current = options.createRoom ?? defaultCreateRoom;
  const hostModules = options.modules ?? EMPTY_MODULES;
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

  const publish = useCallback((room: UseWebrtcCollaborationRoomHandle | null) => {
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
      owner.leave();
      setSession(null);
      setDocument(nextDocument ?? null);
      setPending(false);
      setError(null);
    },
    [owner]
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
