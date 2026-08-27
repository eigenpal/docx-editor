/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import {
  UNFRAMED_MESSAGE_LIMIT,
  installChunkedFraming,
  type ChunkablePeer,
} from '../webrtc-chunking.ts';

/** Largest single message a browser accepts on one data channel. */
const CHANNEL_MESSAGE_CEILING = 256 * 1024;

/** Marker, message id, chunk index, and chunk count, as the shim writes them. */
const HEADER_BYTES = 13;

interface FakePeer extends ChunkablePeer {
  /** Messages handed to the underlying channel. */
  readonly wire: Uint8Array[];
  /** Messages surfaced to `y-webrtc` after reassembly. */
  readonly delivered: Uint8Array[];
  /** Messages that reached the unframed path unchanged. */
  readonly passthrough: unknown[];
  bufferedAmount: number;
}

function createPeer(): FakePeer {
  const wire: Uint8Array[] = [];
  const delivered: Uint8Array[] = [];
  const passthrough: unknown[] = [];
  const peer = {
    wire,
    delivered,
    passthrough,
    bufferedAmount: 0,
    destroyed: false,
    get _channel() {
      return { bufferedAmount: peer.bufferedAmount };
    },
    send(payload: Uint8Array | string) {
      if (typeof payload === 'string') throw new Error('unexpected string payload');
      wire.push(payload);
    },
    push(data: Uint8Array) {
      delivered.push(data);
    },
    _onChannelMessage(event: { readonly data: unknown }) {
      passthrough.push(event.data);
    },
  };
  return peer as unknown as FakePeer;
}

/** Send everything one peer put on the wire to the other peer's channel. */
function flush(from: FakePeer, to: FakePeer): void {
  for (const frame of from.wire.splice(0, from.wire.length)) {
    to._onChannelMessage({ data: frame });
  }
}

function pattern(bytes: number): Uint8Array {
  const message = new Uint8Array(bytes);
  for (let index = 0; index < bytes; index += 1) message[index] = (index * 31 + 7) & 0xff;
  return message;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

describe('webrtc chunked framing', () => {
  test('sends a small message unframed so an unpatched peer still reads it', () => {
    const sender = createPeer();
    installChunkedFraming(sender);
    const message = pattern(1024);

    sender.send(message);

    expect(sender.wire).toHaveLength(1);
    expect(sender.wire[0]).toBe(message);
  });

  test('reassembles a document-sized message that no single channel message could carry', async () => {
    const sender = createPeer();
    const receiver = createPeer();
    installChunkedFraming(sender);
    installChunkedFraming(receiver);
    const message = pattern(6304 * 1024);

    sender.send(message);
    await sleep(0);
    const frames = sender.wire.length;
    flush(sender, receiver);

    expect(frames).toBeGreaterThan(1);
    for (const frame of sender.wire) expect(frame.byteLength).toBeLessThan(CHANNEL_MESSAGE_CEILING);
    expect(receiver.delivered).toHaveLength(1);
    expect(receiver.delivered[0]).toEqual(message);
    expect(receiver.passthrough).toHaveLength(0);
  });

  test('keeps every frame under the browser single-message ceiling', async () => {
    const sender = createPeer();
    installChunkedFraming(sender);

    sender.send(pattern(UNFRAMED_MESSAGE_LIMIT * 4));
    await sleep(0);

    expect(sender.wire.length).toBeGreaterThan(3);
    for (const frame of sender.wire) {
      expect(frame.byteLength).toBeLessThanOrEqual(CHANNEL_MESSAGE_CEILING);
    }
  });

  test('passes an unframed message through untouched', () => {
    const receiver = createPeer();
    installChunkedFraming(receiver);
    const sync = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);

    receiver._onChannelMessage({ data: sync });

    expect(receiver.passthrough).toEqual([sync]);
    expect(receiver.delivered).toHaveLength(0);
  });

  test('interleaves two framed messages without mixing their payloads', async () => {
    const sender = createPeer();
    const receiver = createPeer();
    installChunkedFraming(sender);
    installChunkedFraming(receiver);
    const first = pattern(UNFRAMED_MESSAGE_LIMIT * 3);
    const second = pattern(UNFRAMED_MESSAGE_LIMIT * 2 + 11);

    sender.send(first);
    sender.send(second);
    await sleep(0);
    const frames = sender.wire.splice(0, sender.wire.length);
    for (const frame of frames.reverse()) receiver._onChannelMessage({ data: frame });

    expect(receiver.delivered).toHaveLength(2);
    const delivered = receiver.delivered.map((message) => message.byteLength).sort((a, b) => a - b);
    expect(delivered).toEqual([second.byteLength, first.byteLength]);
  });

  test('waits for the channel to drain before sending more frames', async () => {
    const sender = createPeer();
    installChunkedFraming(sender);
    sender.bufferedAmount = 8 * 1024 * 1024;

    sender.send(pattern(UNFRAMED_MESSAGE_LIMIT * 3));
    await sleep(0);
    const blocked = sender.wire.length;
    sender.bufferedAmount = 0;
    await sleep(60);

    expect(blocked).toBe(0);
    expect(sender.wire.length).toBeGreaterThan(2);
  });

  test('ignores a frame claiming an implausible chunk count', () => {
    const receiver = createPeer();
    installChunkedFraming(receiver);
    const hostile = new Uint8Array(HEADER_BYTES + 4);
    hostile[0] = 0xfb;
    hostile.set([0, 0, 0, 1], 1);
    hostile.set([0, 0, 0, 0], 5);
    hostile.set([0xff, 0xff, 0xff, 0xff], 9);

    receiver._onChannelMessage({ data: hostile });

    expect(receiver.delivered).toHaveLength(0);
    expect(receiver.passthrough).toHaveLength(0);
  });

  test('installs once per peer', () => {
    const sender = createPeer();
    installChunkedFraming(sender);
    const patched = sender.send;
    installChunkedFraming(sender);

    expect(sender.send).toBe(patched);
  });

  test('abandons a stalled partial so a later update lands and the failure is visible', async () => {
    const receiver = createPeer();
    // Collected rather than a mutable flag: the order is the point (nothing reported while the
    // partial is merely young), and a `let` narrowed by its initializer cannot be compared
    // against the other arm without the assertion itself becoming a type error.
    const reported: string[] = [];
    installChunkedFraming(receiver, {
      partialTimeoutMs: 25,
      onAbandonedMessage: () => {
        reported.push('abandoned');
      },
    });
    const stalled = chunkFrame(1, 0, 3, pattern(8));
    const later = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    const complete = pattern(24);

    receiver._onChannelMessage({ data: stalled });
    receiver._onChannelMessage({ data: later });
    receiver._onChannelMessage({ data: chunkFrame(2, 0, 2, complete.subarray(0, 12)) });
    receiver._onChannelMessage({ data: chunkFrame(2, 1, 2, complete.subarray(12)) });
    expect(receiver.passthrough).toEqual([later]);
    expect(receiver.delivered).toEqual([complete]);
    expect(reported).toEqual([]);

    await sleep(80);

    expect(reported).toEqual(['abandoned']);
    expect(receiver.delivered).toEqual([complete]);

    receiver._onChannelMessage({ data: chunkFrame(1, 1, 3, pattern(8)) });
    receiver._onChannelMessage({ data: chunkFrame(1, 2, 3, pattern(8)) });
    expect(receiver.delivered).toEqual([complete]);
    // Still one report: the abandoned message's late chunks must not re-arm and re-report it.
    expect(reported).toEqual(['abandoned']);
  });
});

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function chunkFrame(
  messageId: number,
  index: number,
  count: number,
  payload: Uint8Array
): Uint8Array {
  const frame = new Uint8Array(HEADER_BYTES + payload.byteLength);
  frame[0] = 0xfb;
  writeUint32(frame, 1, messageId);
  writeUint32(frame, 5, index);
  writeUint32(frame, 9, count);
  frame.set(payload, HEADER_BYTES);
  return frame;
}
