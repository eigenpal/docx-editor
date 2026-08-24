/**
 * Peer-to-peer convenience wrapper for the experimental collaboration proof.
 *
 * @packageDocumentation
 * @public
 */

import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { WebrtcProvider } from 'y-webrtc';
import type { CollaborationIdentity } from '@docx-editor.dev/core/collaboration';
import {
  createYjsCollaboration,
  type YjsCollaborationBootstrap,
  type YjsCollaborationRoom,
  type YjsCollaborationSession,
} from './session.ts';

/** Default public signaling endpoint for the local proof. @public */
export const DEFAULT_SIGNALING_ENDPOINTS = Object.freeze(['wss://turn.0docker.com/ws']);

/** Options for the owned WebRTC collaboration convenience wrapper. @public */
export interface CreateWebrtcCollaborationOptions {
  readonly roomId: string;
  readonly identity: CollaborationIdentity;
  readonly bootstrap: YjsCollaborationBootstrap;
  readonly signaling?: readonly string[];
  readonly iceServers?: readonly RTCIceServer[];
  readonly password?: string;
}

/** Owned WebRTC provider and provider-neutral collaboration resources. @public */
export interface WebrtcCollaborationRoom extends YjsCollaborationRoom {
  readonly ydoc: Y.Doc;
  readonly provider: WebrtcProvider;
}

/** Create a cryptographically strong room identifier. It is not an authorization token. @public */
export function createCollaborationRoomId(): string {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

/** Validate and normalize a room identifier from a host interface. @public */
export function validateRoomId(value: string): string {
  const roomId = value.trim();
  if (!/^[A-Za-z0-9_-]{24,256}$/.test(roomId)) {
    throw new TypeError('roomId must contain 24 to 256 URL-safe characters');
  }
  return roomId;
}

/** Create one owned `y-webrtc` room and provider-neutral collaboration session. @public */
export async function createWebrtcCollaboration(
  options: CreateWebrtcCollaborationOptions
): Promise<WebrtcCollaborationRoom> {
  const roomId = validateRoomId(options.roomId);
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  let provider: WebrtcProvider | null = null;
  const connectProvider = (): WebrtcProvider =>
    new WebrtcProvider(roomId, ydoc, {
      awareness,
      signaling: [...(options.signaling ?? DEFAULT_SIGNALING_ENDPOINTS)],
      password: options.password ?? roomId,
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
  let room: YjsCollaborationRoom;
  try {
    if (options.bootstrap.kind === 'join') provider = connectProvider();
    room = await createYjsCollaboration({
      ydoc,
      awareness,
      documentId: roomId,
      identity: options.identity,
      bootstrap: options.bootstrap,
    });
    if (!provider) provider = connectProvider();
  } catch (error) {
    provider?.destroy();
    awareness.destroy();
    ydoc.destroy();
    throw error;
  }
  if (!provider) {
    room.destroy();
    awareness.destroy();
    ydoc.destroy();
    throw new Error('WebRTC provider did not initialize');
  }
  const connectedProvider = provider;

  const session = room.session as YjsCollaborationSession;
  const onStatus = (event: { readonly connected: boolean }): void => {
    session.setTransportStatus(
      event.connected ? 'ready' : 'disconnected',
      event.connected ? undefined : 'webrtc-disconnected'
    );
  };
  connectedProvider.on('status', onStatus);

  let destroyed = false;
  return Object.freeze({
    document: room.document,
    session,
    ydoc,
    provider: connectedProvider,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      connectedProvider.off('status', onStatus);
      room.destroy();
      connectedProvider.destroy();
      ydoc.destroy();
    },
  });
}
