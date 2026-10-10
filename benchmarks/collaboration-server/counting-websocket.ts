// Count WebSocket traffic in a client worker.
//
// The Hocuspocus provider resolves the global `WebSocket` when it is constructed. Import
// this module before any provider exists, and every byte a simulated client sends or
// receives is counted. The totals are the server's traffic seen from the other end.
//
// Each message is also classified by its Hocuspocus message type, so a run shows how much of
// the traffic is document sync and how much is presence (awareness).

import type { MessageTypeTraffic } from './protocol.ts';

export const traffic = { bytesSent: 0, bytesReceived: 0, messagesSent: 0, messagesReceived: 0 };

/** Traffic by Hocuspocus message type name, in both directions. */
export const trafficByType: Record<string, MessageTypeTraffic> = {};

const MESSAGE_TYPES: Record<number, string> = {
  0: 'sync',
  1: 'awareness',
  2: 'auth',
  3: 'queryAwareness',
  5: 'stateless',
  7: 'close',
  8: 'syncStatus',
  9: 'ping',
  10: 'pong',
};

function bytesOf(data: unknown): Uint8Array | null {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data))
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return null;
}

function sizeOf(data: unknown): number {
  if (typeof data === 'string') return Buffer.byteLength(data);
  if (data instanceof Blob) return data.size;
  return bytesOf(data)?.byteLength ?? 0;
}

/** Read one lib0 variable-length unsigned integer. */
function readVarUint(bytes: Uint8Array, at: { offset: number }): number {
  let value = 0;
  let shift = 0;
  for (;;) {
    const byte = bytes[at.offset++];
    if (byte === undefined) return -1;
    value += (byte & 0x7f) * 2 ** shift;
    if (byte < 0x80) return value;
    shift += 7;
  }
}

/**
 * A Hocuspocus frame starts with the document name as a lib0 string, then the message type.
 * A frame of one byte is a ping or pong.
 */
function typeOf(data: unknown): string {
  const bytes = bytesOf(data);
  if (!bytes) return 'other';
  if (bytes.length === 1) return MESSAGE_TYPES[bytes[0]!] ?? 'other';
  const at = { offset: 0 };
  const nameLength = readVarUint(bytes, at);
  if (nameLength < 0) return 'other';
  at.offset += nameLength;
  return MESSAGE_TYPES[readVarUint(bytes, at)] ?? 'other';
}

function record(direction: 'sent' | 'received', data: unknown): void {
  const size = sizeOf(data);
  const type = typeOf(data);
  const entry = (trafficByType[type] ??= {
    bytesSent: 0,
    bytesReceived: 0,
    messagesSent: 0,
    messagesReceived: 0,
  });
  if (direction === 'sent') {
    traffic.messagesSent += 1;
    traffic.bytesSent += size;
    entry.messagesSent += 1;
    entry.bytesSent += size;
  } else {
    traffic.messagesReceived += 1;
    traffic.bytesReceived += size;
    entry.messagesReceived += 1;
    entry.bytesReceived += size;
  }
}

const NativeWebSocket = globalThis.WebSocket;

class CountingWebSocket extends NativeWebSocket {
  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, protocols);
    this.addEventListener('message', (event) => record('received', event.data));
  }

  override send(data: Parameters<WebSocket['send']>[0]): void {
    record('sent', data);
    super.send(data);
  }
}

globalThis.WebSocket = CountingWebSocket as typeof WebSocket;
