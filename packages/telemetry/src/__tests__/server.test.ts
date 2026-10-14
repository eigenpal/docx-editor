/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/telemetry/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, setSystemTime, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { Hocuspocus } from '@hocuspocus/server';
import {
  requireBearerToken,
  serveMetrics,
  withCollaborationTelemetry,
} from '../hocuspocus/index.ts';
import { prometheusRegistry } from '../prometheus/index.ts';
import { hmacRoomLabel, roomTelemetry } from '../server/index.ts';

const ROOM = 'matter-4471-acme-settlement';

/** A person joins: their awareness state reaches the server's awareness. */
function join(awareness: Awareness, name: string): void {
  const peer = new Awareness(new Y.Doc());
  peer.setLocalState({ user: { name } });
  applyAwarenessUpdate(awareness, encodeAwarenessUpdate(peer, [peer.clientID]), 'remote');
}

function sharedEdit(doc: Y.Doc, text: string): void {
  doc.getText('t').insert(0, text);
}

describe('roomTelemetry', () => {
  test('counts rooms, connections, people, memory, and refusals, with no room name', async () => {
    const metrics = prometheusRegistry();
    const rooms = roomTelemetry({ exporters: [metrics], sampleInterval: false });
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    awareness.setLocalState(null);

    const room = rooms.open(doc, { name: ROOM, awareness });
    await room.time('load', async () => undefined);
    room.connected();
    room.connected();
    room.connected();
    // Two awareness states (one person, two tabs) and a third connection not yet announced.
    join(awareness, 'Ada');
    join(awareness, 'Ada');
    sharedEdit(doc, 'Confidential terms');
    rooms.rejected(
      Object.assign(new Error('bad token for jane@client.com'), { reason: 'unauthorized' })
    );
    rooms.rejected(new Error(`free text naming ${ROOM}`));
    rooms.refused({ reason: 'room-generation-changed' });
    rooms.sample();

    const text = metrics.metrics();
    expect(text).toContain('docx_editor_collab_rooms_active 1');
    expect(text).toContain('docx_editor_collab_connections_active 3');
    expect(text).toContain('docx_editor_collab_participants_active 2');
    expect(text).toContain('docx_editor_collab_room_participants_max 2');
    expect(text).toContain(
      'docx_editor_collab_admission_rejections_total{reason="unauthorized"} 1'
    );
    expect(text).toContain('docx_editor_collab_admission_rejections_total{reason="other"} 1');
    expect(text).toContain(
      'docx_editor_collab_message_refusals_total{reason="room-generation-changed"} 1'
    );
    expect(text).toContain('docx_editor_collab_room_memory_bytes_count{kind="state"} 1');
    expect(text).toContain(
      'docx_editor_collab_room_load_duration_seconds_count{outcome="success"} 1'
    );
    expect(text).toMatch(/docx_editor_collab_updates_total 1\n/);
    expect(text).not.toContain(ROOM);
    expect(text).not.toContain('Confidential');
    expect(text).not.toContain('jane@client.com');

    const [stats] = rooms.list();
    expect(stats).toMatchObject({ room: 'room-1', participants: 2, connections: 3 });
    expect(stats!.stateBytes).toBeGreaterThan(0);
    expect(stats!.pendingBytes).toBeGreaterThan(0);

    await room.time('store', async () => undefined);
    expect(rooms.list()[0]!.pendingBytes).toBe(0);

    room.close();
    rooms.sample();
    expect(metrics.metrics()).toContain('docx_editor_collab_rooms_active 0');
    await rooms.shutdown();
  });

  test("Hocuspocus's own refusals and case variants have stable reasons", () => {
    const metrics = prometheusRegistry();
    const rooms = roomTelemetry({ exporters: [metrics], sampleInterval: false });
    rooms.rejected({ code: 4401, reason: 'Unauthorized' });
    rooms.rejected({ code: 4403, reason: 'Forbidden' });
    rooms.rejected({ code: 4401 });
    rooms.rejected({ reason: 'matter-4471' });
    rooms.rejected(new Error('Unauthorized'));
    rooms.rejected(new Error('Account suspended for jane@client.com'));
    rooms.rejected(undefined);
    const text = metrics.metrics();
    expect(text).toContain(
      'docx_editor_collab_admission_rejections_total{reason="unauthorized"} 3'
    );
    expect(text).toContain('docx_editor_collab_admission_rejections_total{reason="forbidden"} 1');
    // Free text that is not a known reason is `other`; a bare throw is Hocuspocus's own answer.
    expect(text).toContain('docx_editor_collab_admission_rejections_total{reason="other"} 2');
    expect(text).toContain(
      'docx_editor_collab_admission_rejections_total{reason="permission-denied"} 1'
    );
    expect(text).not.toContain('matter-4471');
    expect(text).not.toContain('jane@client.com');
  });

  test("updates replicated from another instance are not counted as this room's writes", () => {
    const metrics = prometheusRegistry();
    const rooms = roomTelemetry({ exporters: [metrics], sampleInterval: false });
    const doc = new Y.Doc();
    rooms.open(doc, { name: ROOM });
    doc.transact(() => doc.getText('t').insert(0, 'from redis'), { source: 'redis' });
    doc.transact(() => doc.getText('t').insert(0, 'local'), {
      source: 'local',
      skipStoreHooks: true,
    });
    doc.transact(() => doc.getText('t').insert(0, 'client'), { source: 'connection' });
    expect(rooms.list()[0]!.pendingBytes).toBeGreaterThan(0);
    expect(metrics.metrics()).toMatch(/docx_editor_collab_updates_total 1\n/);
  });

  test('updates from another instance refresh room memory and idle time', () => {
    const metrics = prometheusRegistry();
    const rooms = roomTelemetry({ exporters: [metrics], sampleInterval: false });
    const doc = new Y.Doc();
    rooms.open(doc, { name: ROOM });
    rooms.sample();
    const before = rooms.list()[0]!;
    setSystemTime(new Date(Date.now() + 60_000));
    try {
      doc.transact(() => doc.getText('t').insert(0, 'x'.repeat(5_000)), { source: 'redis' });
      rooms.sample();
      const after = rooms.list()[0]!;
      expect(after.stateBytes!).toBeGreaterThan(before.stateBytes! + 4_000);
      expect(after.idleSeconds).toBe(0);
      // Still not this server's write: nothing waits to be stored, and nothing counts.
      expect(after.pendingBytes).toBe(0);
      expect(metrics.metrics()).toContain('docx_editor_collab_updates_total 0\n');
    } finally {
      setSystemTime();
    }
  });

  test('the state a load applies through the handle is not counted as edits', async () => {
    const metrics = prometheusRegistry();
    const rooms = roomTelemetry({ exporters: [metrics], sampleInterval: false });
    const saved = new Y.Doc();
    saved.getText('t').insert(0, 'x'.repeat(5_000));
    const doc = new Y.Doc();
    const room = rooms.open(doc, { name: ROOM });
    await room.time('load', async () => Y.applyUpdate(doc, Y.encodeStateAsUpdate(saved)));
    expect(rooms.list()[0]!.pendingBytes).toBe(0);
    expect(metrics.metrics()).toContain('docx_editor_collab_updates_total 0\n');
    doc.getText('t').insert(0, 'edit');
    expect(rooms.list()[0]!.pendingBytes).toBeGreaterThan(0);
    await rooms.shutdown();
  });

  test('a new server reads zero rooms before its first sample', async () => {
    const metrics = prometheusRegistry();
    const rooms = roomTelemetry({ exporters: [metrics] });
    const text = metrics.metrics();
    expect(text).toContain('docx_editor_collab_rooms_active 0');
    expect(text).toContain('docx_editor_collab_connections_active 0');
    expect(text).toContain('docx_editor_collab_participants_active 0');
    await rooms.shutdown();
  });

  test('known counters start at zero, so a scraper counts the first refusal and failed store', async () => {
    const metrics = prometheusRegistry();
    const rooms = roomTelemetry({ exporters: [metrics], reasons: ['quota-exceeded'] });
    const before = metrics.metrics();
    for (const series of [
      'docx_editor_collab_admission_rejections_total{reason="unauthorized"} 0',
      'docx_editor_collab_admission_rejections_total{reason="quota-exceeded"} 0',
      'docx_editor_collab_admission_rejections_total{reason="other"} 0',
      'docx_editor_collab_message_refusals_total{reason="other"} 0',
      'docx_editor_collab_message_refusals_total{reason="room-generation-changed"} 0',
      'docx_editor_collab_admission_rejections_total{reason="protocol-version-mismatch"} 0',
      'docx_editor_collab_room_store_duration_seconds_count{outcome="failure"} 0',
      'docx_editor_collab_room_load_duration_seconds_count{outcome="success"} 0',
      'docx_editor_collab_migrations_total{outcome="failed"} 0',
      'docx_editor_collab_updates_total 0',
    ])
      expect(before).toContain(series);
    // A declared histogram has no observation in it.
    expect(before).toContain(
      'docx_editor_collab_room_store_duration_seconds_sum{outcome="failure"} 0'
    );

    rooms.rejected({ reason: 'unauthorized' });
    expect(metrics.metrics()).toContain(
      'docx_editor_collab_admission_rejections_total{reason="unauthorized"} 1'
    );
    rooms.refused({ reason: 'room-generation-changed' });
    expect(metrics.metrics()).toContain(
      'docx_editor_collab_message_refusals_total{reason="room-generation-changed"} 1'
    );
    await rooms.shutdown();
  });

  test('the fullest room follows people live, as the people total does', async () => {
    const metrics = prometheusRegistry();
    const rooms = roomTelemetry({ exporters: [metrics], sampleInterval: false });
    const room = rooms.open(new Y.Doc(), { name: ROOM });
    room.connected();
    room.connected();
    // No sample was taken: both totals move with the connections.
    expect(metrics.metrics()).toContain('docx_editor_collab_participants_active 2');
    expect(metrics.metrics()).toContain('docx_editor_collab_room_participants_max 2');
    room.disconnected();
    expect(metrics.metrics()).toContain('docx_editor_collab_room_participants_max 1');
    await rooms.shutdown();
  });

  test('a custom reason matches without case', () => {
    const metrics = prometheusRegistry();
    const rooms = roomTelemetry({
      exporters: [metrics],
      sampleInterval: false,
      reasons: ['quotaExceeded'],
    });
    rooms.rejected({ reason: 'quotaExceeded' });
    expect(metrics.metrics()).toContain(
      'docx_editor_collab_admission_rejections_total{reason="quotaexceeded"} 1'
    );
  });

  test('a reasonOf that throws counts other and never replaces the refusal', () => {
    const metrics = prometheusRegistry();
    const rooms = roomTelemetry({
      exporters: [metrics],
      sampleInterval: false,
      reasonOf: () => {
        throw new Error('bug in host reader');
      },
    });
    expect(() => rooms.rejected(new Error('denied'))).not.toThrow();
    expect(metrics.metrics()).toContain(
      'docx_editor_collab_admission_rejections_total{reason="other"} 1'
    );
  });

  test('a failed load is timed as a failure and rethrown', async () => {
    const metrics = prometheusRegistry();
    const rooms = roomTelemetry({ exporters: [metrics], sampleInterval: false });
    await expect(
      rooms.time('load', async () => {
        throw new Error('disk unavailable');
      })
    ).rejects.toThrow('disk unavailable');
    expect(metrics.metrics()).toContain(
      'docx_editor_collab_room_load_duration_seconds_count{outcome="failure"} 1'
    );
  });

  test('hmacRoomLabel is stable and hides the name', () => {
    const label = hmacRoomLabel('server-secret');
    expect(label(ROOM)).toBe(label(ROOM));
    expect(label(ROOM)).toMatch(/^room-[0-9a-f]{16}$/);
    expect(label(ROOM)).not.toContain('matter');
    expect(hmacRoomLabel('other-secret')(ROOM)).not.toBe(label(ROOM));
    expect(() => hmacRoomLabel(undefined)).toThrow('non-empty secret');
  });
});

describe('withCollaborationTelemetry', () => {
  /** A document as Hocuspocus hands it to hooks: a Y.Doc with its awareness. */
  function hocusDocument(): Y.Doc & { awareness: Awareness } {
    const document = new Y.Doc() as Y.Doc & { awareness: Awareness };
    document.awareness = new Awareness(document);
    return document;
  }

  /** A class-based extension, as storage extensions usually are: `this` must still work. */
  class StorageExtension {
    readonly reason = 'forbidden';
    delayMs = 20;
    failNext = false;
    async onAuthenticate({ token }: { token: string }) {
      if (token === 'blocked') throw Object.assign(new Error('blocked'), { reason: this.reason });
    }
    async onLoadDocument() {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      if (this.failNext) throw new Error('storage unavailable');
    }
  }

  test('times the whole chain, sees refusals from hooks and extensions, and keeps behavior', async () => {
    const metrics = prometheusRegistry();
    const storage = new StorageExtension();
    const calls: string[] = [];
    const { config, rooms } = withCollaborationTelemetry(
      {
        extensions: [storage as never],
        async onAuthenticate({ token }: { token: string }) {
          calls.push('auth');
          if (token === 'bad') throw Object.assign(new Error('denied'), { reason: 'unauthorized' });
          return { user: 'u1' };
        },
        async beforeHandleMessage() {
          throw Object.assign(new Error('stale'), { reason: 'room-generation-changed' });
        },
        async onStoreDocument() {
          calls.push('store');
        },
      } as never,
      { exporters: [metrics], sampleInterval: false }
    );
    const server = new Hocuspocus(config);
    const document = hocusDocument();
    const at = { documentName: ROOM, document, socketId: 's1' };

    await server.hooks('onAuthenticate', { token: 'ok' } as never);
    await expect(server.hooks('onAuthenticate', { token: 'bad' } as never)).rejects.toThrow(
      'denied'
    );
    await expect(server.hooks('onAuthenticate', { token: 'blocked' } as never)).rejects.toThrow(
      'blocked'
    );
    await server.hooks('onLoadDocument', at as never);
    await server.hooks('afterLoadDocument', at as never);
    await server.hooks('connected', at as never);
    await server.hooks('connected', { ...at, socketId: 's2' } as never);
    await expect(server.hooks('beforeHandleMessage', at as never)).rejects.toThrow('stale');
    await server.hooks('onStoreDocument', at as never);
    await server.hooks('afterStoreDocument', at as never);
    // A connection refused at admission never connected, so its disconnect is not subtracted.
    await server.hooks('onDisconnect', { ...at, socketId: 'never-connected' } as never);
    await server.hooks('onDisconnect', at as never);
    storage.failNext = true;
    await expect(
      server.hooks('onLoadDocument', { ...at, documentName: 'other-room-000000000000000' } as never)
    ).rejects.toThrow('storage unavailable');
    rooms.sample();

    expect(calls).toEqual(['auth', 'auth', 'store']);
    const text = metrics.metrics();
    expect(text).toContain('docx_editor_collab_rooms_active 1');
    expect(text).toContain('docx_editor_collab_connections_active 1');
    expect(text).toContain(
      'docx_editor_collab_admission_rejections_total{reason="unauthorized"} 1'
    );
    expect(text).toContain('docx_editor_collab_admission_rejections_total{reason="forbidden"} 1');
    expect(text).toContain(
      'docx_editor_collab_message_refusals_total{reason="room-generation-changed"} 1'
    );
    expect(text).toContain(
      'docx_editor_collab_room_load_duration_seconds_count{outcome="success"} 1'
    );
    expect(text).toContain(
      'docx_editor_collab_room_load_duration_seconds_count{outcome="failure"} 1'
    );
    // The storage extension's 20 ms is inside the measured load, not after it.
    expect(text).toContain(
      'docx_editor_collab_room_load_duration_seconds_bucket{outcome="success",le="0.01"} 0'
    );
    expect(text).toContain(
      'docx_editor_collab_room_store_duration_seconds_count{outcome="success"} 1'
    );
    expect(text).not.toContain(ROOM);

    await server.hooks('afterUnloadDocument', at as never);
    rooms.sample();
    expect(metrics.metrics()).toContain('docx_editor_collab_rooms_active 0');
    await rooms.shutdown();
  });

  test('extension state on `this` survives, and refusals from onConnect and reasonOf count', async () => {
    const metrics = prometheusRegistry();
    class RedisLike {
      instance: unknown;
      stored = false;
      async onConfigure({ instance }: { instance: unknown }) {
        this.instance = instance;
      }
      async onStoreDocument() {
        // Reads state another hook wrote on `this`: it must be the same object.
        if (!this.instance) throw new Error('lost this');
        this.stored = true;
      }
    }
    const redis = new RedisLike();
    const { config, rooms } = withCollaborationTelemetry(
      {
        extensions: [redis as never],
        async onConnect() {
          throw Object.assign(new Error('nope'), { reason: 'permission-denied' });
        },
        async onAuthenticate() {
          throw new Error('Account suspended for jane@client.com');
        },
      } as never,
      {
        exporters: [metrics],
        reasons: ['suspended'],
        sampleInterval: false,
        reasonOf: (error) =>
          String((error as Error).message).startsWith('Account suspended')
            ? 'suspended'
            : undefined,
      }
    );
    const server = new Hocuspocus(config);
    await server.hooks('onConfigure', { instance: server } as never);
    const at = { documentName: ROOM, document: hocusDocument(), socketId: 's1' };
    await server.hooks('onLoadDocument', at as never);
    await server.hooks('afterLoadDocument', at as never);
    await server.hooks('onStoreDocument', at as never);
    await server.hooks('afterStoreDocument', at as never);
    expect(redis.stored).toBe(true);
    await expect(server.hooks('onConnect', at as never)).rejects.toThrow('nope');
    await expect(server.hooks('onAuthenticate', at as never)).rejects.toThrow('suspended');
    const text = metrics.metrics();
    expect(text).toContain(
      'docx_editor_collab_admission_rejections_total{reason="permission-denied"} 1'
    );
    expect(text).toContain('docx_editor_collab_admission_rejections_total{reason="suspended"} 1');
    expect(text).not.toContain('jane@client.com');
    expect(text).toContain(
      'docx_editor_collab_room_store_duration_seconds_count{outcome="success"} 1'
    );
    await rooms.shutdown();
  });

  test('a later afterLoadDocument failure leaves no phantom room', async () => {
    const metrics = prometheusRegistry();
    const { config, rooms } = withCollaborationTelemetry(
      {
        async afterLoadDocument() {
          throw new Error('post-load check failed');
        },
      } as never,
      { exporters: [metrics], sampleInterval: false }
    );
    const server = new Hocuspocus(config);
    const at = { documentName: ROOM, document: hocusDocument(), socketId: 's1' };
    await server.hooks('onLoadDocument', at as never);
    await expect(server.hooks('afterLoadDocument', at as never)).rejects.toThrow('post-load');
    rooms.sample();
    expect(rooms.list()).toEqual([]);
    expect(metrics.metrics()).toContain('docx_editor_collab_rooms_active 0');
    expect(metrics.metrics()).toContain(
      'docx_editor_collab_room_load_duration_seconds_count{outcome="failure"} 1'
    );
    await rooms.shutdown();
  });

  test('a skip in afterLoadDocument fails the load and leaves no room, as in Hocuspocus', async () => {
    const metrics = prometheusRegistry();
    class SkipFurtherHooksError extends Error {
      override name = 'SkipFurtherHooksError';
    }
    const { config, rooms } = withCollaborationTelemetry(
      {
        async afterLoadDocument() {
          throw new SkipFurtherHooksError();
        },
      } as never,
      { exporters: [metrics], sampleInterval: false }
    );
    const server = new Hocuspocus(config);
    const at = { documentName: ROOM, document: hocusDocument(), socketId: 's1' };
    await server.hooks('onLoadDocument', at as never);
    await server.hooks('afterLoadDocument', at as never).catch(() => {});
    rooms.sample();
    expect(rooms.list()).toEqual([]);
    expect(metrics.metrics()).toContain(
      'docx_editor_collab_room_load_duration_seconds_count{outcome="failure"} 1'
    );
    await rooms.shutdown();
  });

  test('a room whose awareness throws is skipped, never the server', async () => {
    const metrics = prometheusRegistry();
    const rooms = roomTelemetry({ exporters: [metrics], sampleInterval: false });
    const awareness = {
      on() {},
      off() {},
      getStates() {
        throw new Error('host awareness bug');
      },
    };
    rooms.open(new Y.Doc(), { name: ROOM, awareness: awareness as never });
    rooms.open(new Y.Doc(), { name: 'other' });
    expect(() => rooms.sample()).not.toThrow();
    expect(metrics.metrics()).toContain('docx_editor_collab_rooms_active 2');
    await rooms.shutdown();
  });

  test('a room opened by a direct connection is tracked, with its first updates', async () => {
    const metrics = prometheusRegistry();
    const { config, rooms } = withCollaborationTelemetry(
      { extensions: [new StorageExtension() as never] } as never,
      { exporters: [metrics], sampleInterval: false }
    );
    const server = new Hocuspocus(config);
    const document = hocusDocument();
    const at = { documentName: ROOM, document };
    await server.hooks('onLoadDocument', at as never);
    await server.hooks('afterLoadDocument', at as never);
    // A server-side writer edits the room without any client connecting.
    document.getText('t').insert(0, 'agent edit');
    rooms.sample();
    expect(rooms.list()).toEqual([expect.objectContaining({ room: 'room-1', connections: 0 })]);
    const text = metrics.metrics();
    expect(text).toContain('docx_editor_collab_rooms_active 1');
    expect(text).toContain(
      'docx_editor_collab_room_load_duration_seconds_count{outcome="success"} 1'
    );
    expect(text).not.toMatch(/outcome="failure"\} [1-9]/);
    expect(text).toMatch(/docx_editor_collab_updates_total 1\n/);
    await rooms.shutdown();
  });

  test('a skip in onStoreDocument is not a store here: neither timed nor cleared', async () => {
    const metrics = prometheusRegistry();
    class SkipFurtherHooksError extends Error {
      override name = 'SkipFurtherHooksError';
    }
    const { config, rooms } = withCollaborationTelemetry(
      {
        async onStoreDocument() {
          // Another instance holds the store lock.
          throw new SkipFurtherHooksError();
        },
      } as never,
      { exporters: [metrics], sampleInterval: false }
    );
    const server = new Hocuspocus(config);
    const document = hocusDocument();
    const at = { documentName: ROOM, document };
    await server.hooks('onLoadDocument', at as never);
    await server.hooks('afterLoadDocument', at as never);
    document.getText('t').insert(0, 'edit');
    await server.hooks('onStoreDocument', at as never).catch(() => {});
    expect(metrics.metrics()).not.toMatch(
      /docx_editor_collab_room_store_duration_seconds_count\{[^}]*\} [1-9]/
    );
    expect(rooms.list()[0]!.pendingBytes).toBeGreaterThan(0);
    await rooms.shutdown();
  });

  test('a skip in afterStoreDocument is a finished store, as in Hocuspocus', async () => {
    const metrics = prometheusRegistry();
    class SkipFurtherHooksError extends Error {
      override name = 'SkipFurtherHooksError';
    }
    const { config, rooms } = withCollaborationTelemetry(
      {
        async afterStoreDocument() {
          throw new SkipFurtherHooksError();
        },
      } as never,
      { exporters: [metrics], sampleInterval: false }
    );
    const server = new Hocuspocus(config);
    const at = { documentName: ROOM, document: hocusDocument() };
    await server.hooks('onLoadDocument', at as never);
    await server.hooks('afterLoadDocument', at as never);
    await server.hooks('onStoreDocument', at as never);
    await server.hooks('afterStoreDocument', at as never).catch(() => {});
    const text = metrics.metrics();
    expect(text).toContain(
      'docx_editor_collab_room_store_duration_seconds_count{outcome="success"} 1'
    );
    expect(text).not.toMatch(/outcome="failure"\} [1-9]/);
    await rooms.shutdown();
  });

  test('a store succeeds only when every afterStoreDocument hook did', async () => {
    const metrics = prometheusRegistry();
    let failAfterStore = false;
    const { config, rooms } = withCollaborationTelemetry(
      {
        async afterStoreDocument() {
          if (failAfterStore) throw new Error('replication failed');
        },
      } as never,
      { exporters: [metrics], sampleInterval: false }
    );
    const server = new Hocuspocus(config);
    const at = { documentName: ROOM, document: hocusDocument() };
    await server.hooks('onLoadDocument', at as never);
    await server.hooks('afterLoadDocument', at as never);
    await server.hooks('onStoreDocument', at as never);
    await server.hooks('afterStoreDocument', at as never);
    failAfterStore = true;
    await server.hooks('onStoreDocument', at as never);
    await expect(server.hooks('afterStoreDocument', at as never)).rejects.toThrow('replication');
    const text = metrics.metrics();
    expect(text).toContain(
      'docx_editor_collab_room_store_duration_seconds_count{outcome="success"} 1'
    );
    expect(text).toContain(
      'docx_editor_collab_room_store_duration_seconds_count{outcome="failure"} 1'
    );
    await rooms.shutdown();
  });

  test('a load that fails inside Hocuspocus is recorded when the room unloads', async () => {
    const metrics = prometheusRegistry();
    const { config, rooms } = withCollaborationTelemetry(
      {},
      { exporters: [metrics], sampleInterval: false }
    );
    const server = new Hocuspocus(config);
    const at = { documentName: ROOM, document: hocusDocument(), socketId: 's1' };
    await server.hooks('onLoadDocument', at as never);
    // Hocuspocus failed applying the stored state and unloads; afterLoadDocument never ran.
    await server.hooks('afterUnloadDocument', { documentName: ROOM } as never);
    expect(metrics.metrics()).toContain(
      'docx_editor_collab_room_load_duration_seconds_count{outcome="failure"} 1'
    );
    await rooms.shutdown();
  });

  test('a frozen extension still works and is observed', async () => {
    const metrics = prometheusRegistry();
    const frozen = Object.freeze({
      async onAuthenticate() {
        throw Object.assign(new Error('nope'), { reason: 'forbidden' });
      },
      async onChange() {},
    });
    const { config, rooms } = withCollaborationTelemetry(
      { extensions: [frozen as never] } as never,
      {
        exporters: [metrics],
        sampleInterval: false,
      }
    );
    const server = new Hocuspocus(config);
    await expect(server.hooks('onAuthenticate', {} as never)).rejects.toThrow('nope');
    await server.hooks('onChange', {} as never);
    expect(metrics.metrics()).toContain(
      'docx_editor_collab_admission_rejections_total{reason="forbidden"} 1'
    );
    await rooms.shutdown();
  });

  test('frozen extension hooks keep their original private instance state', async () => {
    class FrozenExtension {
      #changes = 0;
      readonly onAuthenticate = async () => {};
      async onChange() {
        this.#changes += 1;
      }
      get changes() {
        return this.#changes;
      }
    }
    const extension = Object.freeze(new FrozenExtension());
    const { config, rooms } = withCollaborationTelemetry(
      { extensions: [extension] },
      { exporters: [], sampleInterval: false }
    );
    try {
      const server = new Hocuspocus(config);
      await server.hooks('onAuthenticate', {} as never);
      await server.hooks('onChange', {} as never);
      expect(extension.changes).toBe(1);
    } finally {
      await rooms.shutdown();
    }
  });

  test('non-configurable extension accessors preserve hook order and receiver', async () => {
    const order: string[] = [];
    const extension = {
      async onAuthenticate() {
        order.push('first');
      },
    };
    Object.defineProperty(extension, 'priority', {
      get() {
        expect(this).toBe(extension);
        return 100;
      },
    });
    const { config, rooms } = withCollaborationTelemetry(
      {
        extensions: [
          {
            priority: 50,
            async onAuthenticate() {
              order.push('second');
            },
          },
          extension,
        ],
      },
      { exporters: [], sampleInterval: false }
    );
    try {
      const server = new Hocuspocus(config);
      await server.hooks('onAuthenticate', {} as never);
      expect(order).toEqual(['first', 'second']);
    } finally {
      await rooms.shutdown();
    }
  });

  test('two sessions of one room on one socket count as two connections', async () => {
    const metrics = prometheusRegistry();
    const { config, rooms } = withCollaborationTelemetry({} as never, {
      exporters: [metrics],
      sampleInterval: false,
    });
    const server = new Hocuspocus(config);
    const at = { documentName: ROOM, document: hocusDocument(), socketId: 's1' };
    await server.hooks('onLoadDocument', at as never);
    await server.hooks('afterLoadDocument', at as never);
    await server.hooks('connected', at as never);
    await server.hooks('connected', at as never);
    await server.hooks('onDisconnect', at as never);
    expect(metrics.metrics()).toContain('docx_editor_collab_connections_active 1');
    await server.hooks('onDisconnect', at as never);
    await server.hooks('onDisconnect', at as never);
    expect(metrics.metrics()).toContain('docx_editor_collab_connections_active 0');
    await rooms.shutdown();
  });

  test('one socket in two rooms counts as two connections, and both leave', async () => {
    const metrics = prometheusRegistry();
    const { config, rooms } = withCollaborationTelemetry(
      {},
      { exporters: [metrics], sampleInterval: false }
    );
    const server = new Hocuspocus(config);
    for (const name of ['room-a-000000000000000000', 'room-b-000000000000000000']) {
      const at = { documentName: name, document: hocusDocument(), socketId: 'one-socket' };
      await server.hooks('onLoadDocument', at as never);
      await server.hooks('afterLoadDocument', at as never);
      await server.hooks('connected', at as never);
    }
    expect(metrics.metrics()).toContain('docx_editor_collab_connections_active 2');
    for (const name of ['room-a-000000000000000000', 'room-b-000000000000000000'])
      await server.hooks('onDisconnect', { documentName: name, socketId: 'one-socket' } as never);
    expect(metrics.metrics()).toContain('docx_editor_collab_connections_active 0');
    await rooms.shutdown();
  });

  test('perRoomSeries refuses a label that could carry a room name', () => {
    expect(() =>
      roomTelemetry({ exporters: [], perRoomSeries: true, roomLabel: (name) => name })
    ).toThrow('perRoomSeries');
  });
});

describe('perRoomSeries', () => {
  test('labels people and memory by room, and drops a closed room', async () => {
    const metrics = prometheusRegistry();
    const rooms = roomTelemetry({
      exporters: [metrics],
      sampleInterval: false,
      perRoomSeries: true,
      roomLabel: hmacRoomLabel('server-secret'),
    });
    const room = rooms.open(new Y.Doc(), { name: ROOM });
    rooms.sample();
    const label = hmacRoomLabel('server-secret')(ROOM);
    expect(metrics.metrics()).toContain(
      `docx_editor_collab_room_participants_current{room="${label}"} 0`
    );
    expect(metrics.metrics()).toContain(
      `docx_editor_collab_room_memory_current_bytes{kind="state",room="${label}"}`
    );
    expect(metrics.metrics()).not.toContain(ROOM);
    expect(metrics.metrics()).not.toContain(
      'docx_editor_collab_rooms_memory_bytes{kind="state"} 0'
    );
    room.close();
    expect(metrics.metrics()).not.toContain(label);
    // A closed room leaves no stale total behind.
    expect(metrics.metrics()).toContain('docx_editor_collab_rooms_memory_bytes{kind="state"} 0');
    await rooms.shutdown();
  });
});

describe('serveMetrics', () => {
  function call(hook: (payload: never) => Promise<void>, url: string) {
    const written: { status?: number; headers: Record<string, string>; body?: string } = {
      headers: {},
    };
    const response = {
      statusCode: 0,
      setHeader: (name: string, value: string) => void (written.headers[name] = value),
      writeHead: (status: number, headers?: Record<string, string>) => {
        written.status = status;
        Object.assign(written.headers, headers ?? {});
      },
      end: (body?: string) => void (written.body = body),
    };
    return hook({ request: { url }, response } as never).then(
      () => ({ handled: false, written }),
      (stop: unknown) => ({ handled: stop === null, written })
    );
  }

  test('serves metrics and rooms, and lets other requests through', async () => {
    const metrics = prometheusRegistry();
    const rooms = roomTelemetry({ exporters: [metrics], sampleInterval: false });
    rooms.open(new Y.Doc(), { name: ROOM });
    const hook = serveMetrics(metrics, {
      rooms: { telemetry: rooms, path: '/rooms' },
      authorize: (request) => request.url !== '/rooms?denied',
    });
    expect(() => serveMetrics(metrics, { rooms: { telemetry: rooms, path: '/rooms' } })).toThrow(
      'authorize'
    );
    const bearer = requireBearerToken('scrape-secret');
    expect(bearer({ headers: { authorization: 'Bearer scrape-secret' } } as never)).toBe(true);
    expect(bearer({ headers: { authorization: 'Bearer wrong' } } as never)).toBe(false);
    expect(bearer({ headers: {} } as never)).toBe(false);
    expect(() => requireBearerToken(undefined)).toThrow('non-empty secret');

    const scrape = await call(hook, '/metrics');
    expect(scrape.handled).toBe(true);
    expect(scrape.written.body).toContain('docx_editor_collab_rooms_active 1');

    const listed = await call(hook, '/rooms');
    expect(JSON.parse(listed.written.body!)).toEqual([expect.objectContaining({ room: 'room-1' })]);

    expect((await call(hook, '/rooms?denied')).written.status).toBe(403);
    const throwing = serveMetrics(metrics, {
      authorize: () => {
        throw new Error('bad header');
      },
    });
    expect((await call(throwing, '/metrics')).written.status).toBe(403);
    expect((await call(hook, '/')).handled).toBe(false);
    await rooms.shutdown();
  });
});
