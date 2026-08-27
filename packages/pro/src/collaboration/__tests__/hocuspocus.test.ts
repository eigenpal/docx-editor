/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Unit tests for the owned Hocuspocus room factory. The Hocuspocus v4 SERVER cannot run
// under Bun, so these tests never start one: an injected provider factory stands in for
// `new HocuspocusProvider(...)` and the tests drive its events by hand.

import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import {
  createHocuspocusCollaboration,
  HOCUSPOCUS_PROVIDER_FOR_TESTS,
  type CreateHocuspocusCollaborationOptions,
} from '../hocuspocus.ts';
import { collaborationDocx } from './support.ts';

const ROOM_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaa';
const URL = 'wss://collab.example.test';
const IDENTITY = { actorId: 'alex', name: 'Alex' };

interface FakeProviderInit {
  readonly url: string;
  readonly name: string;
  readonly document: Y.Doc;
  readonly awareness: Awareness;
  readonly token?: string | (() => string | Promise<string>);
}

class FakeProvider {
  isSynced = false;
  destroyCount = 0;
  readonly listeners = new Map<string, Set<(payload: unknown) => void>>();
  constructor(readonly init: FakeProviderInit) {}
  on(event: string, fn: (payload: unknown) => void): this {
    const set = this.listeners.get(event) ?? new Set();
    set.add(fn);
    this.listeners.set(event, set);
    return this;
  }
  off(event: string, fn: (payload: unknown) => void): this {
    this.listeners.get(event)?.delete(fn);
    return this;
  }
  emit(event: string, payload: unknown): void {
    for (const fn of [...(this.listeners.get(event) ?? [])]) fn(payload);
  }
  destroy(): void {
    this.destroyCount += 1;
  }
}

function optionsWithFactory(
  options: CreateHocuspocusCollaborationOptions,
  factory: (init: FakeProviderInit) => FakeProvider
): CreateHocuspocusCollaborationOptions {
  const injected = { ...options, [HOCUSPOCUS_PROVIDER_FOR_TESTS]: factory };
  return injected;
}

describe('createHocuspocusCollaboration', () => {
  test('refuses an invalid room id before touching the network', async () => {
    let constructed = 0;
    await expect(
      createHocuspocusCollaboration(
        optionsWithFactory(
          { url: URL, roomId: 'short', identity: IDENTITY, bootstrap: { kind: 'join' } },
          (init) => {
            constructed += 1;
            return new FakeProvider(init);
          }
        )
      )
    ).rejects.toThrow(/24 to 256 URL-safe characters/);
    expect(constructed).toBe(0);
  });

  test('a join that never syncs rejects with initialization-timeout and destroys everything', async () => {
    let provider: FakeProvider | undefined;
    let awarenessDestroyed = false;
    const promise = createHocuspocusCollaboration(
      optionsWithFactory(
        {
          url: URL,
          roomId: ROOM_ID,
          identity: IDENTITY,
          bootstrap: { kind: 'join' },
          syncedTimeoutMs: 10,
        },
        (init) => {
          provider = new FakeProvider(init);
          init.awareness.on('destroy', () => {
            awarenessDestroyed = true;
          });
          return provider;
        }
      )
    );
    await expect(promise).rejects.toMatchObject({ code: 'initialization-timeout' });
    expect(provider?.destroyCount).toBe(1);
    expect(provider?.init.document.isDestroyed).toBe(true);
    expect(awarenessDestroyed).toBe(true);
  });

  test('a rejected token fails fast with initialization-aborted and destroys everything', async () => {
    // The timeout is far larger than the test: the auth rejection must short-circuit it.
    let provider: FakeProvider | undefined;
    const promise = createHocuspocusCollaboration(
      optionsWithFactory(
        {
          url: URL,
          roomId: ROOM_ID,
          token: 'expired-token',
          identity: IDENTITY,
          bootstrap: { kind: 'join' },
          syncedTimeoutMs: 60_000,
        },
        (init) => {
          provider = new FakeProvider(init);
          setTimeout(
            () => provider!.emit('authenticationFailed', { reason: 'permission-denied' }),
            1
          );
          return provider;
        }
      )
    );
    await expect(promise).rejects.toMatchObject({
      code: 'initialization-aborted',
      detail: 'authentication failed: permission-denied',
    });
    expect(provider?.destroyCount).toBe(1);
    expect(provider?.init.document.isDestroyed).toBe(true);
  });

  test('an authenticationFailed after the join flips the session to error', async () => {
    let provider: FakeProvider | undefined;
    const room = await createHocuspocusCollaboration(
      optionsWithFactory(
        {
          url: URL,
          roomId: ROOM_ID,
          identity: IDENTITY,
          bootstrap: { kind: 'create', document: collaborationDocx() },
        },
        (init) => {
          provider = new FakeProvider(init);
          return provider;
        }
      )
    );
    provider?.emit('authenticationFailed', { reason: 'token expired' });
    expect(room.session.status()).toBe('error');
    expect(room.session.statusSnapshot().reason).toMatchObject({
      code: 'transport',
      detail: 'authentication-failed',
    });
    room.destroy();
    // A destroyed room no longer listens: a late auth event must not throw or resurrect it.
    provider?.emit('authenticationFailed', { reason: 'token expired' });
    expect(room.session.status()).toBe('destroyed');
  });

  test('a function token reaches the provider untouched', async () => {
    const token = (): string => 'renewed-jwt';
    let provider: FakeProvider | undefined;
    const room = await createHocuspocusCollaboration(
      optionsWithFactory(
        {
          url: URL,
          roomId: ROOM_ID,
          token,
          identity: IDENTITY,
          bootstrap: { kind: 'create', document: collaborationDocx() },
        },
        (init) => {
          provider = new FakeProvider(init);
          return provider;
        }
      )
    );
    expect(provider?.init.token).toBe(token);
    room.destroy();
  });

  test('create seeds the shared document before the provider connects', async () => {
    let seededBytesAtConnect = -1;
    let provider: FakeProvider | undefined;
    const room = await createHocuspocusCollaboration(
      optionsWithFactory(
        {
          url: URL,
          roomId: ROOM_ID,
          token: 'server-token',
          identity: IDENTITY,
          bootstrap: { kind: 'create', document: collaborationDocx() },
        },
        (init) => {
          seededBytesAtConnect = Y.encodeStateAsUpdate(init.document).byteLength;
          provider = new FakeProvider(init);
          return provider;
        }
      )
    );
    // The provider was constructed AFTER the seed, so the first broadcast is a complete
    // document rather than something half-seeded.
    expect(seededBytesAtConnect).toBeGreaterThan(100);
    expect(provider?.init.name).toBe(ROOM_ID);
    expect(provider?.init.token).toBe('server-token');
    expect(room.document.byteLength).toBeGreaterThan(0);
    expect(room.session.documentId).toBe(ROOM_ID);
    room.destroy();
    room.destroy();
    expect(provider?.destroyCount).toBe(1);
    expect(room.ydoc.isDestroyed).toBe(true);
  });

  test('status events map to transport status on the session', async () => {
    let provider: FakeProvider | undefined;
    const room = await createHocuspocusCollaboration(
      optionsWithFactory(
        {
          url: URL,
          roomId: ROOM_ID,
          identity: IDENTITY,
          bootstrap: { kind: 'create', document: collaborationDocx() },
        },
        (init) => {
          provider = new FakeProvider(init);
          return provider;
        }
      )
    );
    provider?.emit('status', { status: 'disconnected' });
    expect(room.session.status()).toBe('disconnected');
    expect(room.session.statusSnapshot().reason).toMatchObject({
      code: 'transport',
      detail: 'websocket-disconnected',
    });
    provider?.emit('status', { status: 'connected' });
    expect(room.session.status()).toBe('ready');
    room.destroy();
    // A destroyed room no longer listens: a late transport event must not resurrect it.
    provider?.emit('status', { status: 'connected' });
    expect(room.session.status()).toBe('destroyed');
  });

  test('join connects first, waits for the synced event, then reads the shared state', async () => {
    // Seed a room the way a creator would, and capture its shared state.
    const creator = await createHocuspocusCollaboration(
      optionsWithFactory(
        {
          url: URL,
          roomId: ROOM_ID,
          identity: IDENTITY,
          bootstrap: { kind: 'create', document: collaborationDocx() },
        },
        (init) => new FakeProvider(init)
      )
    );
    const sharedState = Y.encodeStateAsUpdate(creator.ydoc);

    // The joining provider "syncs" asynchronously, after the factory returned: the
    // bounded wait must hold the join until the event fires.
    let joiner: FakeProvider | undefined;
    const room = await createHocuspocusCollaboration(
      optionsWithFactory(
        { url: URL, roomId: ROOM_ID, identity: IDENTITY, bootstrap: { kind: 'join' } },
        (init) => {
          joiner = new FakeProvider(init);
          setTimeout(() => {
            Y.applyUpdate(init.document, sharedState);
            joiner!.isSynced = true;
            joiner!.emit('synced', { state: true });
          }, 5);
          return joiner;
        }
      )
    );
    expect(room.session.documentId).toBe(ROOM_ID);
    expect(room.document.byteLength).toBeGreaterThan(0);
    room.destroy();
    creator.destroy();
  });
});
