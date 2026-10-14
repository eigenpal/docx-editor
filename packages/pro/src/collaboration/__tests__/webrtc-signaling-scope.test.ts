/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// `y-webrtc` keeps one signaling connection per URL for the whole page and announces every
// room through every connection. A room must reach only the servers its own `signaling`
// lists: these rooms run over simulated sockets and record what each server would receive.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createCollaborationRoomId,
  createWebrtcCollaboration,
  type WebrtcCollaborationHandle,
} from '../webrtc.ts';
import {
  acceptsIncomingSignalingMessage,
  scopeOutgoingSignalingMessage,
} from '../webrtc-signaling-scope.ts';

const SAMPLE = new Uint8Array(
  readFileSync(resolve(import.meta.dir, '../../../../../examples/vite/public/sample.docx'))
);

interface SignalingFrame {
  readonly type: string;
  readonly topic?: string;
  readonly topics?: readonly string[];
}

class FakeSocket {
  static instances: FakeSocket[] = [];
  readonly sent: SignalingFrame[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  binaryType = '';
  closed = false;
  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data) as SignalingFrame);
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }
  open(): void {
    this.onopen?.();
  }
  deliver(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

const originalWebSocket = globalThis.WebSocket;
const handles: WebrtcCollaborationHandle[] = [];

beforeEach(() => {
  FakeSocket.instances = [];
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
});

afterEach(() => {
  for (const handle of handles.splice(0)) handle.destroy();
  globalThis.WebSocket = originalWebSocket;
});

const settle = () => new Promise((done) => setTimeout(done, 0));

async function openRoom(signaling: readonly string[]): Promise<WebrtcCollaborationHandle> {
  const handle = await createWebrtcCollaboration({
    roomId: createCollaborationRoomId(),
    identity: { actorId: `actor-${handles.length}`, name: 'Alex' },
    bootstrap: { kind: 'create', document: SAMPLE },
    signaling,
  });
  handles.push(handle);
  await settle();
  return handle;
}

const openSockets = (url: string): FakeSocket[] =>
  FakeSocket.instances.filter((socket) => socket.url === url && !socket.closed);

/** Every room id a server saw in a frame. */
const topicsSeenBy = (url: string): Set<string> => {
  const seen = new Set<string>();
  for (const socket of FakeSocket.instances) {
    if (socket.url !== url) continue;
    for (const frame of socket.sent) {
      if (frame.topic) seen.add(frame.topic);
      for (const topic of frame.topics ?? []) seen.add(topic);
    }
  }
  return seen;
};

const roomIdOf = (handle: WebrtcCollaborationHandle): string => handle.provider.roomName;

describe('signaling stays with the rooms that chose it', () => {
  test('a room with no signaling never reaches another room’s server', async () => {
    const demo = await openRoom(['wss://demo.example']);
    const [socket] = openSockets('wss://demo.example');
    socket!.open();
    // Opened while the shared connection is up: y-webrtc announces it on every connection.
    const local = await openRoom([]);
    expect(topicsSeenBy('wss://demo.example')).toEqual(new Set([roomIdOf(demo)]));

    // A signaling reconnect subscribes every open room again.
    socket!.close();
    await settle();
    const [reopened] = openSockets('wss://demo.example');
    expect(reopened).toBeDefined();
    reopened!.open();
    expect(reopened!.sent.some((frame) => frame.type === 'subscribe')).toBe(true);
    expect(topicsSeenBy('wss://demo.example').has(roomIdOf(local))).toBe(false);
  });

  test('rooms on different servers stay on their own server', async () => {
    const first = await openRoom(['wss://first.example']);
    const second = await openRoom(['wss://second.example']);
    for (const socket of FakeSocket.instances) socket.open();
    await settle();
    const third = await openRoom(['wss://first.example', 'wss://second.example']);
    expect(topicsSeenBy('wss://first.example')).toEqual(
      new Set([roomIdOf(first), roomIdOf(third)])
    );
    expect(topicsSeenBy('wss://second.example')).toEqual(
      new Set([roomIdOf(second), roomIdOf(third)])
    );
  });

  test('a server cannot introduce peers to a room that did not choose it', async () => {
    await openRoom(['wss://demo.example']);
    const local = await openRoom([]);
    const [socket] = openSockets('wss://demo.example');
    socket!.open();
    socket!.deliver({
      type: 'publish',
      topic: roomIdOf(local),
      data: { type: 'announce', from: 'stranger' },
    });
    await settle();
    expect(local.provider.room?.webrtcConns.size).toBe(0);
  });

  test('leaving a shared server still unsubscribes the room', async () => {
    const staying = await openRoom(['wss://demo.example']);
    const leaving = await openRoom(['wss://demo.example']);
    const [socket] = openSockets('wss://demo.example');
    socket!.open();
    leaving.destroy();
    await settle();
    const unsubscribed = socket!.sent
      .filter((frame) => frame.type === 'unsubscribe')
      .flatMap((frame) => frame.topics ?? []);
    expect(unsubscribed).toEqual([roomIdOf(leaving)]);
    expect(unsubscribed).not.toContain(roomIdOf(staying));
  });
});

describe('signaling connection lifetime', () => {
  test('closing the last room on a server closes its signaling socket', async () => {
    const first = await openRoom(['wss://demo.example']);
    const second = await openRoom(['wss://demo.example']);
    const [socket] = openSockets('wss://demo.example');
    socket!.open();
    first.destroy();
    expect(socket!.closed).toBe(false);
    second.destroy();
    expect(socket!.closed).toBe(true);
    await settle();
    expect(openSockets('wss://demo.example')).toEqual([]);
  });
});

describe('signaling scope rules', () => {
  const connection = { providers: new Set([{ roomName: 'mine' }]) };

  test('subscriptions keep only the connection’s rooms', () => {
    expect(
      scopeOutgoingSignalingMessage(connection, { type: 'subscribe', topics: ['mine', 'other'] })
    ).toEqual({ type: 'subscribe', topics: ['mine'] });
    expect(
      scopeOutgoingSignalingMessage(connection, { type: 'subscribe', topics: ['other'] })
    ).toBeNull();
  });

  test('publications for other rooms are dropped both ways', () => {
    expect(
      scopeOutgoingSignalingMessage(connection, { type: 'publish', topic: 'other', data: {} })
    ).toBeNull();
    expect(acceptsIncomingSignalingMessage(connection, { type: 'publish', topic: 'other' })).toBe(
      false
    );
    expect(acceptsIncomingSignalingMessage(connection, { type: 'publish', topic: 'mine' })).toBe(
      true
    );
  });

  test('pings and other frames pass through', () => {
    const ping = { type: 'ping' };
    expect(scopeOutgoingSignalingMessage(connection, ping)).toBe(ping);
    expect(acceptsIncomingSignalingMessage(connection, { type: 'pong' })).toBe(true);
  });

  test('an unsubscribe names only topics the connection subscribed', () => {
    const fresh = { providers: new Set([{ roomName: 'mine' }]) };
    expect(scopeOutgoingSignalingMessage(fresh, { type: 'unsubscribe', topics: ['mine'] })).toBe(
      null
    );
    scopeOutgoingSignalingMessage(fresh, { type: 'subscribe', topics: ['mine'] });
    expect(
      scopeOutgoingSignalingMessage(fresh, { type: 'unsubscribe', topics: ['mine', 'other'] })
    ).toEqual({ type: 'unsubscribe', topics: ['mine'] });
  });
});
