/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/telemetry/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { serveMetrics, withCollaborationTelemetry } from '../hocuspocus/index.ts';
import { fetchMetricsHandler, prometheusRegistry } from '../prometheus/index.ts';
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

  test('one socket in two rooms counts as two connections, and both leave', async () => {
    const metrics = prometheusRegistry();
    const { config, rooms } = withCollaborationTelemetry(
      {},
      { exporters: [metrics], sampleInterval: false }
    );
    const hooks = config as unknown as Record<string, (payload: unknown) => Promise<unknown>>;
    for (const name of ['room-a-000000000000000000', 'room-b-000000000000000000']) {
      const document = new Y.Doc();
      (document as unknown as { awareness: Awareness }).awareness = new Awareness(document);
      await hooks.onLoadDocument!({ documentName: name, document });
      await hooks.connected!({ documentName: name, socketId: 'one-socket' });
    }
    expect(metrics.metrics()).toContain('docx_editor_collab_connections_active 2');
    await hooks.onDisconnect!({
      documentName: 'room-a-000000000000000000',
      socketId: 'one-socket',
    });
    await hooks.onDisconnect!({
      documentName: 'room-b-000000000000000000',
      socketId: 'one-socket',
    });
    expect(metrics.metrics()).toContain('docx_editor_collab_connections_active 0');
    await rooms.shutdown();
  });
});

describe('withCollaborationTelemetry', () => {
  test('observes the host hooks and keeps their behavior', async () => {
    const metrics = prometheusRegistry();
    const calls: string[] = [];
    const { config, rooms } = withCollaborationTelemetry(
      {
        port: 1234,
        async onAuthenticate({ token }: { token: string }) {
          calls.push('auth');
          if (token !== 'ok') throw Object.assign(new Error('denied'), { reason: 'unauthorized' });
          return { user: 'u1' };
        },
        async onLoadDocument({ document }: { document: Y.Doc }) {
          calls.push('load');
          return document;
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
    const hooks = config as unknown as Record<string, (payload: unknown) => Promise<unknown>>;
    expect((config as { port: number }).port).toBe(1234);

    const document = Object.assign(new Y.Doc(), {});
    (document as unknown as { awareness: Awareness }).awareness = new Awareness(document);

    expect(await hooks.onAuthenticate!({ token: 'ok' })).toEqual({ user: 'u1' });
    await expect(hooks.onAuthenticate!({ token: 'bad' })).rejects.toThrow('denied');
    expect(await hooks.onLoadDocument!({ documentName: ROOM, document })).toBe(document);
    await hooks.connected!({ documentName: ROOM, socketId: 's1' });
    await hooks.connected!({ documentName: ROOM, socketId: 's2' });
    await expect(hooks.beforeHandleMessage!({ documentName: ROOM })).rejects.toThrow('stale');
    await hooks.onStoreDocument!({ documentName: ROOM, document });
    // A connection refused at admission never connected, so its disconnect is not subtracted.
    await hooks.onDisconnect!({ documentName: ROOM, socketId: 'never-connected' });
    await hooks.onDisconnect!({ documentName: ROOM, socketId: 's1' });
    rooms.sample();

    expect(calls).toEqual(['auth', 'auth', 'load', 'store']);
    const text = await (await fetchMetricsHandler(metrics)(new Request('http://x/metrics'))).text();
    expect(text).toContain('docx_editor_collab_rooms_active 1');
    expect(text).toContain('docx_editor_collab_connections_active 1');
    expect(text).toContain(
      'docx_editor_collab_admission_rejections_total{reason="unauthorized"} 1'
    );
    expect(text).toContain(
      'docx_editor_collab_message_refusals_total{reason="room-generation-changed"} 1'
    );
    expect(text).toContain(
      'docx_editor_collab_room_store_duration_seconds_count{outcome="success"} 1'
    );
    expect(text).not.toContain(ROOM);

    await hooks.afterUnloadDocument!({ documentName: ROOM });
    rooms.sample();
    expect(metrics.metrics()).toContain('docx_editor_collab_rooms_active 0');
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

    const scrape = await call(hook, '/metrics');
    expect(scrape.handled).toBe(true);
    expect(scrape.written.body).toContain('docx_editor_collab_rooms_active 1');

    const listed = await call(hook, '/rooms');
    expect(JSON.parse(listed.written.body!)).toEqual([expect.objectContaining({ room: 'room-1' })]);

    expect((await call(hook, '/rooms?denied')).written.status).toBe(403);
    expect((await call(hook, '/')).handled).toBe(false);
    await rooms.shutdown();
  });
});
