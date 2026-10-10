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
import {
  isCollaborationFailureCode,
  type CollaborationIdentity,
} from '@docx-editor.dev/core/collaboration';
import {
  createDocumentCollaboration,
  type DocumentCollaborationHandle,
} from './document-session.ts';
import { isRoomGenerationClose, roomGenerationMessage } from './room-generation.ts';
import { validateRoomId } from './room-id.ts';
import { CollaborationSchemaError } from './errors.ts';
import { HOCUSPOCUS_PROVIDER_FOR_TESTS } from './hocuspocus-test-provider.ts';
import type { CollaborationBootstrap } from './types.ts';

export { createCollaborationRoomId, validateRoomId } from './room-id.ts';

/** Wait this long for the server's initial sync before the join gives up. */
const DEFAULT_SYNCED_TIMEOUT_MS = 30_000;

/** Options for the owned Hocuspocus collaboration convenience wrapper. @public */
export interface CreateHocuspocusCollaborationOptions {
  /** Hocuspocus server WebSocket URL, for example `wss://collab.example.test`. */
  readonly url: string;
  /** Room name on the server, also the document id. Make one with `createCollaborationRoomId`. */
  readonly roomId: string;
  /**
   * Authentication token the provider sends in its auth handshake. The server queues all
   * traffic until that message arrives, so the provider always sends one; omit this and it
   * sends an empty token. Pass a callback and the provider re-evaluates it on every
   * reconnect, which is how expiring JWTs renew.
   */
  readonly token?: string | (() => string | Promise<string>);
  /** The local participant. Recorded as the author of this replica's changes. */
  readonly identity: CollaborationIdentity;
  /** Whether to seed the room, join it, or let the peers decide. */
  readonly bootstrap: CollaborationBootstrap;
  /**
   * Bound on the wait for the server's initial sync in the `join` and `create-or-join`
   * flows. Default 30000 ms. On expiry the factory destroys everything it owns and
   * rejects with the failure code `initialization-timeout`.
   */
  readonly syncedTimeoutMs?: number;
  /**
   * Admit local edits while the transport is `disconnected`. Buffered updates merge on
   * reconnect. On by default; pass `false` to pause editing while disconnected. See
   * {@link CreateDocumentCollaborationOptions.offlineEditing}.
   */
  readonly offlineEditing?: boolean;
}

/** Owned Hocuspocus provider and provider-neutral collaboration resources. @public */
export interface HocuspocusCollaborationRoom extends DocumentCollaborationHandle {
  /** The room's Yjs document. `destroy()` destroys it. */
  readonly ydoc: Y.Doc;
  /** The connected provider. `destroy()` destroys it. */
  readonly provider: HocuspocusProvider;
}

/** The provider surface this factory owns. Kept minimal so tests can inject a fake. */
interface OwnedHocuspocusProvider {
  readonly isSynced: boolean;
  on(event: string, fn: (...args: never[]) => void): unknown;
  off(event: string, fn: (...args: never[]) => void): unknown;
  /** Send a stateless message; on `open` it arrives before the provider's first sync. */
  sendStateless?(payload: string): void;
  destroy(): void;
}

interface HocuspocusProviderInit {
  readonly url: string;
  readonly name: string;
  readonly document: Y.Doc;
  readonly awareness: Awareness;
  readonly token?: string | (() => string | Promise<string>);
}

type HocuspocusProviderFactory = (init: HocuspocusProviderInit) => OwnedHocuspocusProvider;

const defaultProviderFactory: HocuspocusProviderFactory = (init) =>
  // The provider connects on construction and performs the mandatory auth handshake
  // itself. Never hand-roll the websocket protocol: the server queues every message
  // until an Auth message arrives.
  new HocuspocusProvider({
    url: init.url,
    name: init.name,
    document: init.document,
    awareness: init.awareness,
    // The provider accepts `string | (() => string) | (() => Promise<string>)` and awaits
    // callback results, so a callback typed to return either shape is passed verbatim.
    ...(init.token !== undefined ? { token: init.token as string | (() => Promise<string>) } : {}),
  });

/**
 * Resolve when the provider reports its initial sync, or reject after `timeoutMs`.
 *
 * A joiner that never syncs would otherwise wait forever on a room the server does not
 * hold. The same bounded-wait rule the bootstrap paths already use applies here, with the
 * same failure code. A server that rejects the auth token never syncs either, so
 * `authenticationFailed` rejects immediately. Preserve known collaboration failure codes
 * so a version refusal cannot be mistaken for an expired credential. Other reasons keep
 * `initialization-aborted` and diagnostic detail instead of burning the whole timeout.
 */
function waitForSynced(provider: OwnedHocuspocusProvider, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (provider.isSynced) {
      resolve();
      return;
    }
    const cleanup = (): void => {
      clearTimeout(timer);
      provider.off('synced', onSynced);
      provider.off('authenticationFailed', onAuthenticationFailed);
    };
    const onSynced = (): void => {
      cleanup();
      resolve();
    };
    const onAuthenticationFailed = (event: { readonly reason: string }): void => {
      cleanup();
      reject(
        new CollaborationSchemaError(
          isCollaborationFailureCode(event.reason) ? event.reason : 'initialization-aborted',
          `authentication failed: ${event.reason}`
        )
      );
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new CollaborationSchemaError('initialization-timeout'));
    }, timeoutMs);
    provider.on('synced', onSynced);
    provider.on('authenticationFailed', onAuthenticationFailed);
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
  // Every connection first names the room generation this replica holds, so a server that
  // compacted the room refuses it before any of its state merges (`room-generation.ts`).
  // The provider emits `open` before it sends its token and starts the sync.
  const connectProvider = (): OwnedHocuspocusProvider => {
    const created = providerFactory({
      url: options.url,
      name: roomId,
      document: ydoc,
      awareness,
      ...(options.token !== undefined ? { token: options.token } : {}),
    });
    created.on('open', () => created.sendStateless?.(roomGenerationMessage(ydoc)));
    return created;
  };
  let provider: OwnedHocuspocusProvider | null = null;
  let handle: DocumentCollaborationHandle | null = null;
  try {
    // Every bootstrap reads the server's state first. 'join' and 'create-or-join' need it, and
    // 'create' needs it too: seeding before the sync could not see a room that already holds
    // a document, and merging a second seed into it doubled every paragraph. Synced first,
    // 'create' refuses such a room with `already-initialized`. The seed is one transaction,
    // so peers never receive half of it.
    provider = connectProvider();
    await waitForSynced(provider, options.syncedTimeoutMs ?? DEFAULT_SYNCED_TIMEOUT_MS);
    // The server's synced state is the whole room, so there is nothing left to probe for: an
    // uninitialized room after the sync is empty. The election still runs, for two clients
    // that race to seed it.
    const bootstrap =
      options.bootstrap.kind === 'create-or-join' && options.bootstrap.probeTimeoutMs === undefined
        ? { ...options.bootstrap, probeTimeoutMs: 0 }
        : options.bootstrap;
    handle = await createDocumentCollaboration({
      ydoc,
      awareness,
      documentId: roomId,
      identity: options.identity,
      bootstrap,
      offlineEditing: options.offlineEditing,
    });
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
      event.status === 'connected' ? undefined : 'transport-disconnected',
      event.status === 'connected' ? undefined : 'websocket disconnected'
    );
  };
  connectedProvider.on('status', onStatus);
  // A token the server later rejects (an expired JWT on reconnect) stops replication for
  // good: surface it as a terminal session error rather than a silent stall.
  const onAuthenticationFailed = (event: { readonly reason: string }): void => {
    session.setTransportStatus(
      'error',
      isCollaborationFailureCode(event.reason) ? event.reason : 'authentication-failed'
    );
  };
  connectedProvider.on('authenticationFailed', onAuthenticationFailed);
  // The server compacted the room into a new generation while this replica was away. Every
  // reconnect would be refused the same way, so the provider stops, and the session reports
  // it: the document stays as it is, and a rejoin continues in the new generation.
  let generationChanged = false;
  const onClose = (event: {
    readonly event?: { readonly code?: number; readonly reason?: string };
  }) => {
    if (generationChanged || !event.event || !isRoomGenerationClose(event.event)) return;
    generationChanged = true;
    session.setTransportStatus('error', 'room-generation-changed');
    connectedProvider.destroy();
  };
  connectedProvider.on('close', onClose);

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
      connectedProvider.off('authenticationFailed', onAuthenticationFailed);
      connectedProvider.off('close', onClose);
      connectedHandle.destroy();
      if (!generationChanged) connectedProvider.destroy();
      awareness.destroy();
      ydoc.destroy();
    },
  });
}
