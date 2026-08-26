/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Chunked framing for `y-webrtc` data channels.
 *
 * `y-webrtc` hands each sync message to `simple-peer` in one `send` call, and
 * `simple-peer` forwards it to `RTCDataChannel.send` without splitting. A
 * browser rejects a single SCTP message above roughly 256 KiB, and `y-webrtc`
 * swallows the resulting throw, so an oversize initial sync fails silently and
 * the joining peer waits forever. A full document exceeds that ceiling even
 * with an optimal encoding, so the transport must split the message itself.
 *
 * Only messages above the chunk size are framed. Smaller messages travel
 * unchanged, so a peer without this shim still exchanges awareness and
 * incremental updates normally.
 *
 * An incomplete frame must not sit forever. Yjs updates are causal: a missing
 * payload parks every later update, while the transport still looks connected.
 *
 * @packageDocumentation
 * @internal
 */

/**
 * First byte of a chunk frame. A `y-webrtc` message opens with a variable
 * length unsigned integer message type in the range 0 to 4, so this value
 * cannot begin an unframed message.
 */
const FRAME_MARKER = 0xfb;

/** Marker, message id, chunk index, and chunk count. */
const HEADER_BYTES = 1 + 4 + 4 + 4;

/** Total frame size on the wire. Every browser accepts a message this small. */
const FRAME_BYTES = 16 * 1024;

const PAYLOAD_BYTES = FRAME_BYTES - HEADER_BYTES;

/** Pause the drain loop above this much unflushed data to bound peer memory. */
const MAX_BUFFERED_BYTES = 1024 * 1024;

const BUFFER_POLL_MS = 20;

/** Give up on a message whose channel never drains. */
const MAX_DRAIN_WAIT_MS = 30_000;

/**
 * Reassembly caps. Every field of an incoming frame is remote input, so the
 * chunk count bounds allocation and the message count bounds retained memory.
 */
const MAX_CHUNKS_PER_MESSAGE = 8192;

const MAX_PARTIAL_MESSAGES = 4;

/**
 * Drop an incomplete message that has gone quiet. A live transfer resets this
 * on every frame. A dropped peer does not, and Yjs will not apply later
 * updates that depend on the missing payload.
 */
const DEFAULT_PARTIAL_IDLE_MS = 30_000;

/** The part of a `simple-peer` instance this shim replaces. @internal */
export interface ChunkablePeer {
  send(payload: Uint8Array | string): void;
  push(data: Uint8Array): void;
  _onChannelMessage(event: { readonly data: unknown }): void;
  readonly destroyed?: boolean;
  readonly _channel?: { readonly bufferedAmount: number } | null;
}

/** Receive-side limits for {@link installChunkedFraming}. @internal */
export interface ChunkedFramingOptions {
  readonly partialTimeoutMs?: number;
  readonly onAbandonedMessage?: () => void;
}

interface PartialMessage {
  readonly chunks: (Uint8Array | undefined)[];
  readonly count: number;
  received: number;
  bytes: number;
  timer: ReturnType<typeof setTimeout> | undefined;
}

const installed = new WeakSet<object>();

const readUint32 = (bytes: Uint8Array, offset: number): number =>
  ((bytes[offset] << 24) |
    (bytes[offset + 1] << 16) |
    (bytes[offset + 2] << 8) |
    bytes[offset + 3]) >>>
  0;

const writeUint32 = (bytes: Uint8Array, offset: number, value: number): void => {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
};

const toBytes = (data: unknown): Uint8Array | null => {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return null;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Replace `send` and `_onChannelMessage` on one `simple-peer` instance so
 * oversize messages travel as ordered frames. Safe to call more than once for
 * the same peer.
 *
 * @internal
 */
export function installChunkedFraming(peer: ChunkablePeer, options?: ChunkedFramingOptions): void {
  if (installed.has(peer)) return;
  installed.add(peer);

  const originalSend = peer.send.bind(peer);
  const originalReceive = peer._onChannelMessage.bind(peer);
  const requestedTimeout = options?.partialTimeoutMs;
  const partialTimeoutMs =
    typeof requestedTimeout === 'number' &&
    Number.isFinite(requestedTimeout) &&
    requestedTimeout > 0
      ? requestedTimeout
      : DEFAULT_PARTIAL_IDLE_MS;
  const onAbandonedMessage = options?.onAbandonedMessage;

  const queue: Uint8Array[] = [];
  const partials = new Map<number, PartialMessage>();
  let draining = false;
  let nextMessageId = 1;

  const abandon = (messageId: number): void => {
    const partial = partials.get(messageId);
    if (!partial) return;
    if (partial.timer !== undefined) clearTimeout(partial.timer);
    partials.delete(messageId);
    if (peer.destroyed === true) return;
    onAbandonedMessage?.();
  };

  const watchIdle = (messageId: number): void => {
    const partial = partials.get(messageId);
    if (!partial) return;
    if (partial.timer !== undefined) clearTimeout(partial.timer);
    partial.timer = setTimeout(() => {
      abandon(messageId);
    }, partialTimeoutMs);
  };

  const bufferedAmount = (): number => peer._channel?.bufferedAmount ?? 0;

  const waitForCapacity = async (): Promise<boolean> => {
    let waited = 0;
    while (bufferedAmount() > MAX_BUFFERED_BYTES) {
      if (peer.destroyed === true) return false;
      if (waited >= MAX_DRAIN_WAIT_MS) return false;
      await sleep(BUFFER_POLL_MS);
      waited += BUFFER_POLL_MS;
    }
    return peer.destroyed !== true;
  };

  const sendFrames = async (message: Uint8Array): Promise<void> => {
    const count = Math.ceil(message.byteLength / PAYLOAD_BYTES);
    if (count > MAX_CHUNKS_PER_MESSAGE) {
      throw new Error(
        `collaboration message needs ${count} chunks, above the ${MAX_CHUNKS_PER_MESSAGE} limit`
      );
    }
    const messageId = nextMessageId;
    nextMessageId = (nextMessageId + 1) >>> 0 || 1;
    for (let index = 0; index < count; index += 1) {
      if (!(await waitForCapacity())) return;
      const start = index * PAYLOAD_BYTES;
      const payload = message.subarray(start, Math.min(start + PAYLOAD_BYTES, message.byteLength));
      const frame = new Uint8Array(HEADER_BYTES + payload.byteLength);
      frame[0] = FRAME_MARKER;
      writeUint32(frame, 1, messageId);
      writeUint32(frame, 5, index);
      writeUint32(frame, 9, count);
      frame.set(payload, HEADER_BYTES);
      originalSend(frame);
    }
  };

  const drain = async (): Promise<void> => {
    if (draining) return;
    draining = true;
    try {
      while (queue.length > 0) {
        const message = queue.shift();
        if (!message) continue;
        if (peer.destroyed === true) return;
        await sendFrames(message);
      }
    } finally {
      draining = false;
    }
  };

  peer.send = (payload: Uint8Array | string): void => {
    if (typeof payload === 'string' || payload.byteLength <= PAYLOAD_BYTES) {
      originalSend(payload);
      return;
    }
    queue.push(payload);
    void drain();
  };

  peer._onChannelMessage = (event: { readonly data: unknown }): void => {
    const data = toBytes(event.data);
    if (!data || data.byteLength < HEADER_BYTES || data[0] !== FRAME_MARKER) {
      originalReceive(event);
      return;
    }
    const messageId = readUint32(data, 1);
    const index = readUint32(data, 5);
    const count = readUint32(data, 9);
    if (count === 0 || count > MAX_CHUNKS_PER_MESSAGE || index >= count) return;

    let partial = partials.get(messageId);
    if (!partial) {
      if (partials.size >= MAX_PARTIAL_MESSAGES) {
        const oldest = partials.keys().next();
        if (!oldest.done) abandon(oldest.value);
      }
      partial = {
        chunks: new Array<Uint8Array | undefined>(count),
        count,
        received: 0,
        bytes: 0,
        timer: undefined,
      };
      partials.set(messageId, partial);
    }
    if (partial.count !== count || partial.chunks[index]) return;

    const payload = data.subarray(HEADER_BYTES);
    partial.chunks[index] = payload;
    partial.received += 1;
    partial.bytes += payload.byteLength;
    if (partial.received !== partial.count) {
      watchIdle(messageId);
      return;
    }

    if (partial.timer !== undefined) clearTimeout(partial.timer);
    partials.delete(messageId);
    const message = new Uint8Array(partial.bytes);
    let offset = 0;
    for (const chunk of partial.chunks) {
      if (!chunk) return;
      message.set(chunk, offset);
      offset += chunk.byteLength;
    }
    if (peer.destroyed === true) return;
    peer.push(message);
  };
}

/** Largest message this shim sends without framing. @internal */
export const UNFRAMED_MESSAGE_LIMIT = PAYLOAD_BYTES;
