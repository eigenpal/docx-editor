/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Shared room-owning machinery for the Vue collaboration composables.
 *
 * `useWebrtcCollaboration` and `useDocumentCollaboration` differ only in how a room is
 * created and keyed. Everything else — the remount-safe owner lifecycle, connect
 * generations, the leave contract, rejoin, and module composition — lives here once, so
 * the two composables cannot drift.
 */
import { onMounted, onUnmounted, shallowRef, watch, type ShallowRef } from 'vue';
import {
  isCollaborationFailureCode,
  type CollaborationFailure,
  type EditorCollaborationSession,
} from '@docx-editor.dev/core/collaboration';
import type { EditorModule } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration/collaboration-module.ts';
import { webrtcRoomOwnerFor } from './webrtc-room-owner.ts';

/** What every owned collaboration room hands the composables. */
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
  /** Public composable name, used in thrown messages. */
  readonly hookName: string;
  readonly createRoomOf: () => (options: TConnect) => Promise<THandle>;
  readonly hostModulesOf: () => readonly EditorModule[];
  readonly autoRoomOf: () => TConnect | null;
  /** Identity key of the auto room; a change retriggers the auto connect. */
  readonly autoKeyOf: () => string;
  /** Build the options a rejoin connects with from the last attempted options. */
  readonly rejoinOptionsOf: (last: TConnect) => TConnect;
}

export interface CollaborationRoomState<TConnect, THandle extends CollaborationRoomHandle> {
  readonly room: ShallowRef<THandle | null>;
  readonly document: ShallowRef<Uint8Array | null>;
  readonly modules: ShallowRef<readonly EditorModule[]>;
  readonly session: ShallowRef<EditorCollaborationSession | null>;
  readonly pending: ShallowRef<boolean>;
  readonly error: ShallowRef<CollaborationFailure | null>;
  readonly connect: (options: TConnect) => Promise<void>;
  readonly leave: (nextDocument: Uint8Array) => void;
  readonly rejoin: (nextDocument: Uint8Array) => Promise<void>;
}

export function useCollaborationRoom<TConnect, THandle extends CollaborationRoomHandle>(
  config: CollaborationRoomConfig<TConnect, THandle>
): CollaborationRoomState<TConnect, THandle> {
  const owner = webrtcRoomOwnerFor<THandle>(config.ownerKey);
  const held = owner.current();
  const modulesFor = (
    hostModules: readonly EditorModule[],
    session: EditorCollaborationSession | null
  ): readonly EditorModule[] => {
    assertHostModulesHaveNoCollaboration(config.hookName, hostModules);
    if (!session) return hostModules;
    return Object.freeze([...hostModules, collaborationModule({ session })]);
  };

  // Annotated: `shallowRef` overload inference on a generic union otherwise widens the type.
  const room: ShallowRef<THandle | null> = shallowRef<THandle | null>(null);
  room.value = held;
  const document = shallowRef<Uint8Array | null>(held?.document ?? null);
  const session = shallowRef<EditorCollaborationSession | null>(held?.session ?? null);
  const pending = shallowRef(config.autoRoomOf() !== null && held === null);
  const error = shallowRef<CollaborationFailure | null>(null);
  const modules = shallowRef<readonly EditorModule[]>(
    modulesFor(config.hostModulesOf(), held?.session ?? null)
  );

  let generation = 0;
  let lastConnect: TConnect | null = null;
  let createRoom = config.createRoomOf();

  const publish = (next: THandle | null): void => {
    room.value = next;
    document.value = next?.document ?? null;
    session.value = next?.session ?? null;
    modules.value = modulesFor(config.hostModulesOf(), next?.session ?? null);
  };

  const connect = async (next: TConnect): Promise<void> => {
    const token = ++generation;
    // Record the attempt, not the success: rejoin after a FAILED connect must retry
    // with these options rather than refuse with "call connect first".
    lastConnect = next;
    pending.value = true;
    error.value = null;
    try {
      const created = await createRoom(next);
      if (token !== generation) {
        created.destroy();
        return;
      }
      owner.adopt(created);
      publish(created);
    } catch (cause) {
      if (token !== generation) return;
      const failure = collaborationFailureOf(cause);
      error.value = failure;
      throwCollaborationFailure(failure);
    } finally {
      if (token === generation) pending.value = false;
    }
  };

  const leave = (nextDocument: Uint8Array): void => {
    requireLeaveBytes(config.hookName, nextDocument);
    generation += 1;
    owner.leave();
    room.value = null;
    session.value = null;
    document.value = nextDocument;
    pending.value = false;
    error.value = null;
    modules.value = modulesFor(config.hostModulesOf(), null);
  };

  const rejoin = async (nextDocument: Uint8Array): Promise<void> => {
    const last = lastConnect;
    if (last === null) {
      throw new Error(
        `${config.hookName}: rejoin needs a room this composable connected before. Call connect first.`
      );
    }
    leave(nextDocument);
    await connect(config.rejoinOptionsOf(last));
  };

  watch(
    () => config.createRoomOf(),
    (next) => {
      createRoom = next;
    },
    { immediate: true }
  );

  watch(
    () => config.hostModulesOf(),
    (hostModules) => {
      modules.value = modulesFor(hostModules, session.value);
    }
  );

  watch(
    () => config.autoKeyOf(),
    (key) => {
      const next = config.autoRoomOf();
      if (!key || !next) return;
      if (owner.current()) {
        publish(owner.current());
        return;
      }
      pending.value = true;
      // `connect` rejects so that an awaiting caller can branch on the failure. This path has
      // no caller, and the failure already reaches the host through `error`, so swallow it
      // rather than raise an unhandled rejection for a room the host already renders as failed.
      void connect(next).catch(() => {});
    },
    { immediate: true }
  );

  onMounted(() => {
    owner.reclaimOwner();
    const current = owner.current();
    if (current) publish(current);
  });
  onUnmounted(() => {
    generation += 1;
    owner.disposeOwner();
  });

  return { room, document, modules, session, pending, error, connect, leave, rejoin };
}
