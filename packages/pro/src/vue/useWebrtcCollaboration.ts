/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import {
  getCurrentInstance,
  onMounted,
  onUnmounted,
  readonly,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter,
  type Ref,
} from 'vue';
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
   * Connect this room when the composable starts. Omit it and call
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
  readonly document: Readonly<Ref<Uint8Array | null>>;
  readonly modules: Readonly<Ref<readonly EditorModule[]>>;
  readonly session: Readonly<Ref<EditorCollaborationSession | null>>;
  readonly pending: Readonly<Ref<boolean>>;
  readonly error: Readonly<Ref<Error | null>>;
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

function modulesFor(
  hostModules: readonly EditorModule[],
  session: EditorCollaborationSession | null
): readonly EditorModule[] {
  if (!session) return hostModules;
  return Object.freeze([...hostModules, collaborationModule({ session })]);
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
  const owner = webrtcRoomOwnerFor<UseWebrtcCollaborationRoomHandle>(
    `vue:${String(instance?.uid ?? 'anonymous')}`
  );
  const held = owner.current();
  const document = shallowRef<Uint8Array | null>(held?.document ?? null);
  const session = shallowRef<EditorCollaborationSession | null>(held?.session ?? null);
  const pending = shallowRef(Boolean(toValue(options)?.room) && held === null);
  const error = shallowRef<Error | null>(null);
  const modules = shallowRef<readonly EditorModule[]>(
    modulesFor(toValue(options)?.modules ?? EMPTY_MODULES, held?.session ?? null)
  );

  let generation = 0;
  let createRoom = toValue(options)?.createRoom ?? defaultCreateRoom;

  const publish = (room: UseWebrtcCollaborationRoomHandle | null): void => {
    document.value = room?.document ?? null;
    session.value = room?.session ?? null;
    modules.value = modulesFor(toValue(options)?.modules ?? EMPTY_MODULES, room?.session ?? null);
  };

  const connect = async (next: UseWebrtcCollaborationConnectOptions): Promise<void> => {
    const token = ++generation;
    pending.value = true;
    error.value = null;
    try {
      const room = await createRoom(next);
      if (token !== generation) {
        room.destroy();
        return;
      }
      owner.adopt(room);
      publish(room);
    } catch (cause) {
      if (token !== generation) return;
      const nextError = cause instanceof Error ? cause : new Error(String(cause));
      error.value = nextError;
      throw nextError;
    } finally {
      if (token === generation) pending.value = false;
    }
  };

  const leave = (nextDocument?: Uint8Array): void => {
    generation += 1;
    owner.leave();
    session.value = null;
    document.value = nextDocument ?? null;
    pending.value = false;
    error.value = null;
    modules.value = toValue(options)?.modules ?? EMPTY_MODULES;
  };

  watch(
    () => toValue(options)?.createRoom ?? defaultCreateRoom,
    (next) => {
      createRoom = next;
    },
    { immediate: true }
  );

  watch(
    () => toValue(options)?.modules ?? EMPTY_MODULES,
    (hostModules) => {
      modules.value = modulesFor(hostModules, session.value);
    }
  );

  watch(
    () => roomKeyOf(toValue(options)?.room),
    (key) => {
      const room = toValue(options)?.room ?? null;
      if (!key || !room) return;
      if (owner.current()) {
        publish(owner.current());
        return;
      }
      pending.value = true;
      // `connect` rejects so that an awaiting caller can branch on the failure. This path has
      // no caller, and the failure already reaches the host through `error`, so swallow it
      // rather than raise an unhandled rejection for a room the host already renders as failed.
      void connect(room).catch(() => {});
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

  return {
    document: readonly(document),
    modules: readonly(modules),
    session: readonly(session),
    pending: readonly(pending),
    error: readonly(error),
    connect,
    leave,
  };
}
