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
  type CollaborationIdentity,
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
  /**
   * The display identity `autoRoom` asks for.
   *
   * Separate from `autoKey` because renaming yourself must NOT reconnect: the room is the
   * same room. The hook republishes it through `setIdentity` instead, which is what makes
   * updating `room.identity` — the obvious call — do the obvious thing.
   */
  readonly identityOf: (options: TConnect) => CollaborationIdentity;
}

export interface CollaborationRoomState<TConnect, THandle extends CollaborationRoomHandle> {
  readonly room: THandle | null;
  readonly document: Uint8Array | null;
  readonly modules: readonly EditorModule[];
  readonly session: EditorCollaborationSession | null;
  readonly pending: boolean;
  /**
   * Why collaboration is not working: a failed connect, OR a session that failed after one.
   *
   * Folding both into one field is the point. A token that expires on reconnect, a
   * `concurrent-seed`, a digest mismatch — each of those happens AFTER a successful join, and
   * with only the connect failure here they left this null while replication was dead, so the
   * documented `if (error)` guard rendered a healthy editor over a room nobody could reach.
   */
  readonly error: CollaborationFailure | null;
  /**
   * Connect a room. RESOLVES with the failure, or null on success — it does not reject.
   *
   * A rejection here carried nothing the resolved value does not, and it made the ordinary
   * call site wrong by default: `onClick={() => connect(options)}` produced an unhandled
   * rejection on every failed connect, and every caller that did handle it wrote a
   * `try`/`catch` for information it could have read from `error`.
   */
  readonly connect: (options: TConnect) => Promise<CollaborationFailure | null>;
  readonly leave: (nextDocument: Uint8Array) => void;
  /** Leave with `nextDocument`, then connect again. Resolves like {@link connect}. */
  readonly rejoin: (nextDocument: Uint8Array) => Promise<CollaborationFailure | null>;
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
    async (next: TConnect): Promise<CollaborationFailure | null> => {
      const generation = ++generationRef.current;
      // Record the attempt, not the success: rejoin after a FAILED connect must retry
      // with these options rather than refuse with "call connect first".
      lastConnectRef.current = next;
      setPending(true);
      setError(null);
      try {
        const created = await configRef.current.createRoom(next);
        // Superseded by a newer connect or a leave: neither the room nor the failure belongs
        // to anyone any more, so it is not this caller's answer either.
        if (generation !== generationRef.current) {
          created.destroy();
          return null;
        }
        owner.adopt(created);
        publish(created);
        return null;
      } catch (cause) {
        const failure = collaborationFailureOf(cause);
        if (generation !== generationRef.current) return failure;
        setError(failure);
        return failure;
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
    async (nextDocument: Uint8Array): Promise<CollaborationFailure | null> => {
      const last = lastConnectRef.current;
      // Still a THROW, and deliberately: this one is a programming error, not a room that
      // would not open. A caller has asked to rejoin something it never joined.
      if (last === null) {
        throw new Error(
          `${configRef.current.hookName}: rejoin needs a room this hook connected before. Call connect first.`
        );
      }
      leave(nextDocument);
      return connect(configRef.current.rejoinOptionsOf(last));
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

  // A session that fails AFTER the join reports through its own status, not through the
  // connect promise — so without this the hook's `error` stayed null while the replica had
  // stopped replicating. `destroyed` is not folded in: leave and unmount reach it on purpose.
  const liveSession = room?.session ?? null;
  useEffect(() => {
    if (!liveSession) return undefined;
    const apply = (): void => {
      const snapshot = liveSession.statusSnapshot();
      if (snapshot.status !== 'error') return;
      setError(snapshot.reason ?? snapshot.lastFailure ?? { code: 'transport' });
    };
    apply();
    return liveSession.subscribeStatus(() => apply());
  }, [liveSession]);

  // Renaming yourself is not reconnecting. `roomKeyOf` deliberately leaves identity out, so
  // this republishes it in place — and a replica that freezes identity for its lifetime omits
  // `setIdentity`, in which case there is nothing to republish.
  const identity = configRef.current.autoRoom
    ? configRef.current.identityOf(configRef.current.autoRoom)
    : null;
  const identityKey = identity ? `${identity.name}\u0000${identity.color ?? ''}` : '';
  const identityRef = useRef(identity);
  identityRef.current = identity;
  useEffect(() => {
    const next = identityRef.current;
    if (!liveSession || !next) return;
    const withIdentity = liveSession as {
      setIdentity?: (update: { name?: string; color?: string }) => void;
    };
    withIdentity.setIdentity?.({
      name: next.name,
      ...(next.color !== undefined ? { color: next.color } : {}),
    });
  }, [identityKey, liveSession]);

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
