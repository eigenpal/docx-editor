/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Server-backed convenience wrapper: one owned Hocuspocus room over the
 * full-document collaboration replica.
 *
 * @packageDocumentation
 * @public
 */

import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { HocuspocusProvider } from '@hocuspocus/provider';
import type { CollaborationIdentity } from '@docx-editor.dev/core/collaboration';
import {
  createDocumentCollaboration,
  type DocumentCollaborationHandle,
} from './document-session.ts';
import { validateRoomId } from './room-id.ts';
import { CollaborationSchemaError } from './schema.ts';
import type { CollaborationBootstrap } from './session.ts';

export { createCollaborationRoomId, validateRoomId } from './room-id.ts';

/** Wait this long for the server's initial sync before the join gives up. */
const DEFAULT_SYNCED_TIMEOUT_MS = 30_000;

/** Options for the owned Hocuspocus collaboration convenience wrapper. @public */
export interface CreateHocuspocusCollaborationOptions {
  /** Hocuspocus server WebSocket URL, for example `wss://collab.example.test`. */
  readonly url: string;
  readonly roomId: string;
  /**
   * Authentication token the provider sends in its auth handshake. The server queues all
   * traffic until that message arrives, so the provider always sends one; omit this and it
   * sends an empty token.
   */
  readonly token?: string;
  readonly identity: CollaborationIdentity;
  readonly bootstrap: CollaborationBootstrap;
  /**
   * Bound on the wait for the server's initial sync in the `join` and `create-or-join`
   * flows. Default 30000 ms. On expiry the factory destroys everything it owns and
   * rejects with the failure code `initialization-timeout`.
   */
  readonly syncedTimeoutMs?: number;
  /**
   * Admit local edits while the transport is `disconnected`. Buffered updates merge on
   * reconnect. See {@link CreateDocumentCollaborationOptions.offlineEditing}.
   */
  readonly offlineEditing?: boolean;
}

/** Owned Hocuspocus provider and provider-neutral collaboration resources. @public */
export interface HocuspocusCollaborationRoom extends DocumentCollaborationHandle {
  readonly ydoc: Y.Doc;
  readonly provider: HocuspocusProvider;
}

/** The provider surface this factory owns. Kept minimal so tests can inject a fake. */
interface OwnedHocuspocusProvider {
  readonly isSynced: boolean;
  on(event: string, fn: (...args: never[]) => void): unknown;
  off(event: string, fn: (...args: never[]) => void): unknown;
  destroy(): void;
}

interface HocuspocusProviderInit {
  readonly url: string;
  readonly name: string;
  readonly document: Y.Doc;
  readonly awareness: Awareness;
  readonly token?: string;
}

type HocuspocusProviderFactory = (init: HocuspocusProviderInit) => OwnedHocuspocusProvider;

/**
 * Test-only provider factory. Not re-exported from
 * `@docx-editor.dev/pro/collaboration/hocuspocus`.
 *
 * @internal
 */
export const HOCUSPOCUS_PROVIDER_FOR_TESTS: unique symbol = Symbol(
  'createHocuspocusCollaboration.provider'
);

const defaultProviderFactory: HocuspocusProviderFactory = (init) =>
  // The provider connects on construction and performs the mandatory auth handshake
  // itself. Never hand-roll the websocket protocol: the server queues every message
  // until an Auth message arrives.
  new HocuspocusProvider({
    url: init.url,
    name: init.name,
    document: init.document,
    awareness: init.awareness,
    ...(init.token !== undefined ? { token: init.token } : {}),
  });

/**
 * Resolve when the provider reports its initial sync, or reject after `timeoutMs`.
 *
 * A joiner that never syncs would otherwise wait forever on a room the server does not
 * hold. The same bounded-wait rule the bootstrap paths already use applies here, with the
 * same failure code.
 */
function waitForSynced(provider: OwnedHocuspocusProvider, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (provider.isSynced) {
      resolve();
      return;
    }
    const onSynced = (): void => {
      clearTimeout(timer);
      provider.off('synced', onSynced);
      resolve();
    };
    const timer = setTimeout(() => {
      provider.off('synced', onSynced);
      reject(new CollaborationSchemaError('initialization-timeout'));
    }, timeoutMs);
    provider.on('synced', onSynced);
  });
}

/** Create one owned Hocuspocus room and provider-neutral collaboration session. @public */
export async function createHocuspocusCollaboration(
  options: CreateHocuspocusCollaborationOptions
): Promise<HocuspocusCollaborationRoom> {
  const roomId = validateRoomId(options.roomId);
  const providerFactory =
    (options as { readonly [HOCUSPOCUS_PROVIDER_FOR_TESTS]?: HocuspocusProviderFactory })[
      HOCUSPOCUS_PROVIDER_FOR_TESTS
    ] ?? defaultProviderFactory;
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  const connectProvider = (): OwnedHocuspocusProvider =>
    providerFactory({
      url: options.url,
      name: roomId,
      document: ydoc,
      awareness,
      ...(options.token !== undefined ? { token: options.token } : {}),
    });
  let provider: OwnedHocuspocusProvider | null = null;
  let handle: DocumentCollaborationHandle | null = null;
  try {
    // 'join' reads already-synced shared state and 'create-or-join' probes for it, so both
    // connect the provider and wait for the server's initial sync before the factory runs.
    // 'create' seeds first, so nothing half-seeded is broadcast.
    if (options.bootstrap.kind !== 'create') {
      provider = connectProvider();
      await waitForSynced(provider, options.syncedTimeoutMs ?? DEFAULT_SYNCED_TIMEOUT_MS);
    }
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
    handle?.destroy();
    provider?.destroy();
    awareness.destroy();
    ydoc.destroy();
    throw error;
  }
  const connectedProvider = provider;
  const connectedHandle = handle;

  const session = connectedHandle.session;
  const onStatus = (event: { readonly status: string }): void => {
    session.setTransportStatus(
      event.status === 'connected' ? 'ready' : 'disconnected',
      event.status === 'connected' ? undefined : 'websocket-disconnected'
    );
  };
  connectedProvider.on('status', onStatus);

  let destroyed = false;
  return Object.freeze({
    document: connectedHandle.document,
    session,
    ydoc,
    provider: connectedProvider as HocuspocusProvider,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      connectedProvider.off('status', onStatus);
      connectedHandle.destroy();
      connectedProvider.destroy();
      awareness.destroy();
      ydoc.destroy();
    },
  });
}
