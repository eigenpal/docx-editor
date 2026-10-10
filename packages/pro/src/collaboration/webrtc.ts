/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Peer-to-peer convenience wrapper: one owned `y-webrtc` room over the
 * full-document collaboration replica.
 *
 * @packageDocumentation
 * @public
 */

import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { WebrtcProvider } from 'y-webrtc';
import { trackUnsyncedChanges } from './webrtc-unsynced.ts';
import type { CollaborationIdentity } from '@docx-editor.dev/core/collaboration';
import {
  createDocumentCollaboration,
  type DocumentCollaborationHandle,
} from './document-session.ts';
import { installChunkedFraming, type ChunkablePeer } from './webrtc-chunking.ts';
import { createLinkHealth, linkHealthStatus, type LinkHealth } from './webrtc-link-health.ts';
import { validateRoomId } from './room-id.ts';
import type { CollaborationBootstrap } from './types.ts';

/**
 * Public demo signaling endpoints. Use these endpoints for demos only.
 *
 * Production deployments must pass their own `signaling` URLs and TURN
 * servers. WebRTC peers cannot connect across many networks without TURN.
 * @public
 */
export const DEMO_SIGNALING_ENDPOINTS = Object.freeze(['wss://turn.0docker.com/ws']);

let warnedDemoSignalingFallback = false;

/**
 * Warn once per process when a room silently falls back to the demo signaling endpoints.
 *
 * Passing `signaling: DEMO_SIGNALING_ENDPOINTS` is a deliberate choice and never warns —
 * only an omitted `signaling` does.
 *
 * @internal
 */
export function warnOnDemoSignalingFallback(signaling: readonly string[] | undefined): void {
  if (signaling !== undefined) return;
  if (warnedDemoSignalingFallback) return;
  warnedDemoSignalingFallback = true;
  console.warn(
    '[docx-editor] createWebrtcCollaboration was called without `signaling`, so it uses the ' +
      'public demo endpoints. They are shared, unauthenticated, and can go away. Pass your ' +
      'own `signaling` URLs (and TURN `iceServers`) in production, or pass ' +
      '`signaling: DEMO_SIGNALING_ENDPOINTS` explicitly to accept the demo endpoints.'
  );
}

/** Test-only reset for the once-per-process demo signaling warning. @internal */
export function resetDemoSignalingWarningForTests(): void {
  warnedDemoSignalingFallback = false;
}

/** Options for the owned WebRTC collaboration convenience wrapper. @public */
export interface CreateWebrtcCollaborationOptions {
  /** The room to join: a `createCollaborationRoomId` value every participant shares. */
  readonly roomId: string;
  /** Who this participant is, as peers see them. */
  readonly identity: CollaborationIdentity;
  /** Create the room from a document, or join one that peers already hold. */
  readonly bootstrap: CollaborationBootstrap;
  /**
   * Admit local edits while the transport is `disconnected`. Buffered updates merge on
   * reconnect. On by default; pass `false` to pause editing while disconnected. See
   * {@link CreateDocumentCollaborationOptions.offlineEditing}.
   */
  readonly offlineEditing?: boolean;
  /** Signaling server URLs that introduce peers to each other. */
  readonly signaling?: readonly string[];
  /** STUN and TURN servers for the peer connections. Use TURN across restrictive networks. */
  readonly iceServers?: readonly RTCIceServer[];
  /**
   * Signaling encryption secret for `y-webrtc`.
   *
   * Do not pass the room id. That value is in shareable join URLs and is the
   * signaling topic, so the signaling host already has it. Put a secret in the
   * URL fragment as `#collab=...` — fragments are not sent to the server — and
   * pass the same value here, or omit both and accept plaintext signaling.
   */
  readonly password?: string;
}

/** Owned WebRTC provider and provider-neutral collaboration resources. @public */
export interface WebrtcCollaborationHandle extends DocumentCollaborationHandle {
  /** The room's shared Yjs document, owned by this handle. */
  readonly ydoc: Y.Doc;
  /** The owned `y-webrtc` provider. `destroy()` destroys it. */
  readonly provider: WebrtcProvider;
  /**
   * Local changes no peer has received: made while no peer was connected, and not synced
   * since. A WebRTC room has no server, so these changes exist only in this browser.
   */
  unsyncedChanges(): number;
  /** Call `listener` when `unsyncedChanges()` changes. Returns the unsubscribe function. */
  subscribeUnsyncedChanges(listener: () => void): () => void;
}

export { createCollaborationRoomId, validateRoomId } from './room-id.ts';

const ROOM_SECRET_PATTERN = /^[A-Za-z0-9_-]{24,256}$/;

const COLLAB_FRAGMENT_PREFIX = '#collab=';

/**
 * Resolve the `y-webrtc` signaling password.
 *
 * The room id is public (query string and signaling topic), so it is never the
 * default key. An explicit `password` wins. Otherwise a `#collab=` URL fragment
 * is used: the fragment never reaches the signaling host, and two peers who
 * opened the same link share it.
 *
 * Residual: a host that passes neither value gets no encryption. Anyone who
 * has the full link, including the fragment, can decrypt — that is join
 * access, not a separate authorization check. A secret that never appears in
 * the URL at all cannot be agreed from the link alone.
 *
 * @internal
 */
export function resolveWebrtcRoomPassword(options: {
  readonly password?: string;
  readonly href?: string;
}): string | undefined {
  const explicit = options.password?.trim() ?? '';
  if (explicit.length > 0) return explicit;
  return passwordFromUrlFragment(options.href);
}

const passwordFromUrlFragment = (href?: string): string | undefined => {
  const source =
    href ??
    (typeof globalThis.location === 'object' && globalThis.location !== null
      ? String(globalThis.location.href ?? '')
      : '');
  if (source.length === 0) return undefined;
  let hash: string;
  try {
    hash = new URL(source).hash;
  } catch {
    return undefined;
  }
  if (!hash.startsWith(COLLAB_FRAGMENT_PREFIX)) return undefined;
  let secret: string;
  try {
    secret = decodeURIComponent(hash.slice(COLLAB_FRAGMENT_PREFIX.length));
  } catch {
    return undefined;
  }
  if (!ROOM_SECRET_PATTERN.test(secret)) return undefined;
  return secret;
};

/**
 * Frame oversize messages on every peer of one provider.
 *
 * A document sync exceeds the single-message ceiling of a data channel, so each
 * `simple-peer` instance needs the chunking shim before its channel opens. The
 * room is created inside a `key` continuation registered by the provider
 * constructor, so a continuation registered here runs once the room exists.
 * Wrapping `webrtcConns.set` then catches every connection at creation, which is
 * always before its channel carries data.
 */
const installChunkedTransport = (
  provider: WebrtcProvider,
  health: Pick<LinkHealth, 'abandoned' | 'delivered'>
): void => {
  void Promise.resolve(provider.key).then(() => {
    const room = provider.room;
    if (!room) return;
    const connections = room.webrtcConns;
    const attach = (peerId: string, connection: { readonly peer: unknown }): void => {
      installChunkedFraming(connection.peer as ChunkablePeer, {
        onAbandonedMessage: () => health.abandoned(peerId),
        onDeliveredMessage: () => health.delivered(peerId),
      });
    };
    for (const [peerId, connection] of connections) attach(peerId, connection);
    const originalSet = connections.set.bind(connections);
    connections.set = (peerId, connection) => {
      attach(peerId, connection);
      return originalSet(peerId, connection);
    };
  });
};

/** Create one owned `y-webrtc` room and provider-neutral collaboration session. @public */
export async function createWebrtcCollaboration(
  options: CreateWebrtcCollaborationOptions
): Promise<WebrtcCollaborationHandle> {
  const roomId = validateRoomId(options.roomId);
  warnOnDemoSignalingFallback(options.signaling);
  const password = resolveWebrtcRoomPassword({ password: options.password });
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  let provider: WebrtcProvider | null = null;
  // Bound once the session exists; a link can only lose a message after the room is up.
  let linkHealth: Pick<LinkHealth, 'abandoned' | 'delivered'> = { abandoned() {}, delivered() {} };
  const connectProvider = (): WebrtcProvider => {
    const created = new WebrtcProvider(roomId, ydoc, {
      awareness,
      signaling: [...(options.signaling ?? DEMO_SIGNALING_ENDPOINTS)],
      ...(password !== undefined ? { password } : {}),
      ...(options.iceServers
        ? {
            peerOpts: {
              config: {
                iceServers: options.iceServers.map((server) => ({ ...server })),
              },
            },
          }
        : {}),
    });
    installChunkedTransport(created, {
      abandoned: (peerId) => linkHealth.abandoned(peerId),
      delivered: (peerId) => linkHealth.delivered(peerId),
    });
    return created;
  };
  let handle: DocumentCollaborationHandle;
  try {
    // 'join' reads already-synced shared state and 'create-or-join' probes for it, so both
    // need the provider connected before the factory runs. 'create' seeds first, so nothing
    // half-seeded is broadcast.
    if (options.bootstrap.kind !== 'create') provider = connectProvider();
    handle = await createDocumentCollaboration({
      ydoc,
      awareness,
      documentId: roomId,
      identity: options.identity,
      bootstrap: options.bootstrap,
      offlineEditing: options.offlineEditing,
    });
    if (!provider) provider = connectProvider();
  } catch (error) {
    provider?.destroy();
    awareness.destroy();
    ydoc.destroy();
    throw error;
  }
  if (!provider) {
    handle.destroy();
    awareness.destroy();
    ydoc.destroy();
    throw new Error('WebRTC provider did not initialize');
  }
  const connectedProvider = provider;

  const session = handle.session;
  // An incomplete chunked message closes only that peer connection (see
  // `webrtc-chunking.ts`). y-webrtc announces again on close, so the peers reconnect and
  // resync; the session stays usable instead of ending on one slow channel. A link that keeps
  // failing is reported, because the room's own status cannot see one peer. The room stays
  // `ready`: the other peers still receive every edit, and with `offlineEditing: false` a
  // `disconnected` status would pause editing for everyone over one link.
  let signalingConnected = true;
  const health = createLinkHealth(linkHealthStatus(session, () => signalingConnected));
  linkHealth = health;
  const onStatus = (event: { readonly connected: boolean }): void => {
    signalingConnected = event.connected;
    if (event.connected) health.reset();
    session.setTransportStatus(
      event.connected ? 'ready' : 'disconnected',
      event.connected ? undefined : 'transport-disconnected',
      event.connected ? undefined : 'webrtc disconnected'
    );
  };
  connectedProvider.on('status', onStatus);
  const unsynced = trackUnsyncedChanges(ydoc, connectedProvider);

  let destroyed = false;
  return Object.freeze({
    document: handle.document,
    session,
    ydoc,
    provider: connectedProvider,
    unsyncedChanges: () => unsynced.count(),
    subscribeUnsyncedChanges: (listener: () => void) => unsynced.subscribe(listener),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      connectedProvider.off('status', onStatus);
      unsynced.destroy();
      health.destroy();
      handle.destroy();
      connectedProvider.destroy();
      awareness.destroy();
      ydoc.destroy();
    },
  });
}
