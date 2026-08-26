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
import {
  isCollaborationFailureCode,
  type CollaborationFailure,
  type CollaborationIdentity,
  type EditorCollaborationSession,
} from '@docx-editor.dev/core/collaboration';
import type { EditorModule } from '@docx-editor.dev/core/editor';
import type { CollaborationBootstrap, CollaborationSession } from '../collaboration/session.ts';
import { collaborationModule } from '../collaboration/collaboration-module.ts';
import { webrtcRoomOwnerFor } from './webrtc-room-owner.ts';

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

interface WebrtcRoomHandle {
  readonly document: Uint8Array;
  readonly session: EditorCollaborationSession;
  destroy(): void;
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
  readonly pending: Readonly<Ref<boolean>>;
  readonly error: Readonly<Ref<CollaborationFailure | null>>;
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

function collaborationFailureOf(cause: unknown): CollaborationFailure {
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

function modulesFor(
  hostModules: readonly EditorModule[],
  session: EditorCollaborationSession | null
): readonly EditorModule[] {
  assertHostModulesHaveNoCollaboration(hostModules);
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
  const owner = webrtcRoomOwnerFor<WebrtcRoomHandle>(`vue:${String(instance?.uid ?? 'anonymous')}`);
  const held = owner.current();
  const document = shallowRef<Uint8Array | null>(held?.document ?? null);
  const session = shallowRef<EditorCollaborationSession | null>(held?.session ?? null);
  const pending = shallowRef(Boolean(toValue(options)?.room) && held === null);
  const error = shallowRef<CollaborationFailure | null>(null);
  const modules = shallowRef<readonly EditorModule[]>(
    modulesFor(toValue(options)?.modules ?? EMPTY_MODULES, held?.session ?? null)
  );

  let generation = 0;
  let createRoom = createRoomOf(toValue(options));

  const publish = (room: WebrtcRoomHandle | null): void => {
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
      const failure = collaborationFailureOf(cause);
      error.value = failure;
      throwCollaborationFailure(failure);
    } finally {
      if (token === generation) pending.value = false;
    }
  };

  const leave = (nextDocument?: Uint8Array): void => {
    generation += 1;
    const preserved = nextDocument ?? owner.current()?.document ?? document.value;
    owner.leave();
    session.value = null;
    document.value = preserved;
    pending.value = false;
    error.value = null;
    modules.value = toValue(options)?.modules ?? EMPTY_MODULES;
  };

  watch(
    () => createRoomOf(toValue(options)),
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
