/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Shared room-owning machinery for the React collaboration hooks.
 *
 * `useWebrtcCollaboration` and `useDocumentCollaboration` differ only in how a room is
 * created and keyed. Everything else — the StrictMode-safe owner lifecycle, connect
 * generations, the leave contract, rejoin, and module composition — lives here once, so
 * the two hooks cannot drift.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  isCollaborationFailureCode,
  type CollaborationFailure,
  type EditorCollaborationSession,
} from '@docx-editor.dev/core/collaboration';
import type { EditorModule } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration/collaboration-module.ts';
import { webrtcRoomOwnerFor } from './webrtc-room-owner.ts';

/** What every owned collaboration room hands the hooks. */
export interface CollaborationRoomHandle {
  readonly document: Uint8Array;
  readonly session: EditorCollaborationSession;
  destroy(): void;
}

export const EMPTY_MODULES: readonly EditorModule[] = Object.freeze([]);

export function assertHostModulesHaveNoCollaboration(
  hookName: string,
  modules: readonly EditorModule[]
): void {
  for (const module of modules) {
    if (module.collaboration) {
      throw new Error(
        `${hookName}: host \`modules\` already include a collaboration contribution. This hook supplies \`collaborationModule({ session })\`. Pass review and custom-node modules only.`
      );
    }
  }
}

export function collaborationFailureOf(cause: unknown): CollaborationFailure {
  if (typeof cause === 'object' && cause !== null && 'code' in cause) {
    const code = (cause as { code: unknown }).code;
    if (typeof code === 'string' && isCollaborationFailureCode(code)) {
      const detail = (cause as { detail?: unknown }).detail;
      return typeof detail === 'string' && detail.length > 0 ? { code, detail } : { code };
    }
  }
  if (cause instanceof Error && cause.message.length > 0) {
    return { code: 'transport', detail: cause.message };
  }
  return { code: 'transport' };
}

function throwCollaborationFailure(failure: CollaborationFailure): never {
  throw Object.assign(new Error(failure.detail ?? failure.code), failure);
}

export function requireLeaveBytes(hookName: string, nextDocument: Uint8Array): void {
  if (!(nextDocument instanceof Uint8Array)) {
    throw new TypeError(
      `${hookName}: leave requires the current document bytes — pass \`await editor.save()\` so the edits made in the room survive locally.`
    );
  }
}

export interface CollaborationRoomConfig<TConnect, THandle extends CollaborationRoomHandle> {
  /** Stable owner id so a remount reclaims the live room. */
  readonly ownerKey: string;
  /** Public hook name, used in thrown messages. */
  readonly hookName: string;
  readonly createRoom: (options: TConnect) => Promise<THandle>;
  readonly hostModules: readonly EditorModule[];
  readonly autoRoom: TConnect | null;
  /** Identity key of `autoRoom`; a change retriggers the auto connect. */
  readonly autoKey: string;
  /** Build the options a rejoin connects with from the last attempted options. */
  readonly rejoinOptionsOf: (last: TConnect) => TConnect;
}

export interface CollaborationRoomState<TConnect, THandle extends CollaborationRoomHandle> {
  readonly room: THandle | null;
  readonly document: Uint8Array | null;
  readonly modules: readonly EditorModule[];
  readonly session: EditorCollaborationSession | null;
  readonly pending: boolean;
  readonly error: CollaborationFailure | null;
  readonly connect: (options: TConnect) => Promise<void>;
  readonly leave: (nextDocument: Uint8Array) => void;
  readonly rejoin: (nextDocument: Uint8Array) => Promise<void>;
}

export function useCollaborationRoom<TConnect, THandle extends CollaborationRoomHandle>(
  config: CollaborationRoomConfig<TConnect, THandle>
): CollaborationRoomState<TConnect, THandle> {
  const owner = webrtcRoomOwnerFor<THandle>(config.ownerKey);
  const configRef = useRef(config);
  configRef.current = config;
  assertHostModulesHaveNoCollaboration(config.hookName, config.hostModules);

  const generationRef = useRef(0);
  const lastConnectRef = useRef<TConnect | null>(null);
  const [room, setRoom] = useState<THandle | null>(() => owner.current());
  const [document, setDocument] = useState<Uint8Array | null>(
    () => owner.current()?.document ?? null
  );
  const [pending, setPending] = useState(
    () => config.autoRoom !== null && owner.current() === null
  );
  const [error, setError] = useState<CollaborationFailure | null>(null);

  const publish = useCallback((next: THandle | null) => {
    setRoom(next);
    setDocument(next?.document ?? null);
  }, []);

  const connect = useCallback(
    async (next: TConnect) => {
      const generation = ++generationRef.current;
      // Record the attempt, not the success: rejoin after a FAILED connect must retry
      // with these options rather than refuse with "call connect first".
      lastConnectRef.current = next;
      setPending(true);
      setError(null);
      try {
        const created = await configRef.current.createRoom(next);
        if (generation !== generationRef.current) {
          created.destroy();
          return;
        }
        owner.adopt(created);
        publish(created);
      } catch (cause) {
        if (generation !== generationRef.current) return;
        const failure = collaborationFailureOf(cause);
        setError(failure);
        throwCollaborationFailure(failure);
      } finally {
        if (generation === generationRef.current) setPending(false);
      }
    },
    [owner, publish]
  );

  const leave = useCallback(
    (nextDocument: Uint8Array) => {
      requireLeaveBytes(configRef.current.hookName, nextDocument);
      generationRef.current += 1;
      owner.leave();
      setRoom(null);
      setDocument(nextDocument);
      setPending(false);
      setError(null);
    },
    [owner]
  );

  const rejoin = useCallback(
    async (nextDocument: Uint8Array) => {
      const last = lastConnectRef.current;
      if (last === null) {
        throw new Error(
          `${configRef.current.hookName}: rejoin needs a room this hook connected before. Call connect first.`
        );
      }
      leave(nextDocument);
      await connect(configRef.current.rejoinOptionsOf(last));
    },
    [connect, leave]
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

  const autoKey = config.autoKey;
  useEffect(() => {
    const next = configRef.current.autoRoom;
    if (!next) return;
    if (owner.current()) return;
    // `connect` rejects so that an awaiting caller can branch on the failure. This path has
    // no caller, and the failure already reaches the host through `error`, so swallow it
    // rather than raise an unhandled rejection for a room the host already renders as failed.
    void connect(next).catch(() => {});
  }, [autoKey, connect, owner]);

  const hostModules = config.hostModules;
  const session = room?.session ?? null;
  const modules = useMemo(() => {
    if (!session) return hostModules;
    return Object.freeze([...hostModules, collaborationModule({ session })]);
  }, [hostModules, session]);

  return useMemo(
    () => ({ room, document, modules, session, pending, error, connect, leave, rejoin }),
    [connect, document, error, leave, modules, pending, rejoin, room, session]
  );
}
