/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Room compaction by generation.
 *
 * Yjs state only grows: deleted text, deleted records, formatting markers, and media nobody
 * references stay in a room. A server compacts a room by building a new generation: a fresh
 * document seeded from the room's current content, with a new generation ID. It does so when
 * it loads the room, before any participant syncs, so no participant connected at the time
 * can lose an edit.
 *
 * A replica that still holds the previous generation must not sync with the new one: its
 * items would merge into the fresh document as unrelated state. Every client therefore sends
 * the generation it holds before its first sync message, and the server refuses a mismatch
 * with `room-generation-changed`. The replica keeps its document; it rejoins to continue.
 */
import * as Y from 'yjs';
import { DocumentRegistry, seedPackage } from './document/index.ts';
import { openBaselinePackage, recordFreshSize, recordSeed } from './document-bootstrap.ts';
import { readCollaborationDocument } from './document-read.ts';
import { PACKAGE_META_KEY } from './document/schema.ts';
import { keepFormattingMarkers } from './document/yjs-items.ts';
import { CollaborationSchemaError } from './errors.ts';
import { SHARED_BLOBS_KEY, SharedBlobStore } from './shared-blob-store.ts';

/** The shared metadata field that holds the room's generation ID. */
const ROOM_GENERATION_FIELD = 'roomGeneration';

/** The stateless message a client sends before it syncs. */
const GENERATION_MESSAGE = 'docx-room-generation';

/** The close code a server sends with `room-generation-changed`. */
const GENERATION_CLOSE_CODE = 4409;

/** The default size ratio below which a compaction is not worth a new generation. */
const DEFAULT_MINIMUM_GAIN = 2;

/**
 * Stored states found not worth compacting, by digest and minimum gain. A check reads the
 * whole room and builds it again, and a client causes one each time it opens an unloaded
 * room. The same bytes give the same answer, so opening a room again checks nothing.
 */
const NOT_WORTH_COMPACTING = new Set<string>();
const MAX_REMEMBERED_CHECKS = 1024;

async function checkKey(state: Uint8Array, minimumGain: number): Promise<string> {
  // The digest reads only a view over an `ArrayBuffer`; any other view is copied once.
  const bytes =
    state.buffer instanceof ArrayBuffer ? (state as Uint8Array<ArrayBuffer>) : state.slice();
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  let hex = '';
  for (const byte of digest) hex += byte.toString(16).padStart(2, '0');
  return `${minimumGain}:${hex}`;
}

function rememberNotWorthIt(key: string): void {
  if (NOT_WORTH_COMPACTING.size >= MAX_REMEMBERED_CHECKS) {
    const oldest = NOT_WORTH_COMPACTING.values().next().value;
    if (oldest !== undefined) NOT_WORTH_COMPACTING.delete(oldest);
  }
  NOT_WORTH_COMPACTING.add(key);
}

/**
 * The generation ID of the room a document holds: empty for a room never compacted, and
 * empty for a document that holds no room yet.
 *
 * @public
 */
export function readCollaborationRoomGeneration(document: Y.Doc): string {
  const value = document.getMap(PACKAGE_META_KEY).get(ROOM_GENERATION_FIELD);
  return typeof value === 'string' ? value : '';
}

/** Options for {@link compactCollaborationState}. @public */
export interface CompactCollaborationStateOptions {
  /**
   * Compact only when the stored state is at least this many times the size of the compacted
   * state. Default 2. Pass 1 to compact whenever it makes the room smaller.
   */
  readonly minimumGain?: number;
}

/**
 * Build a new generation of a room from its stored state, or return null when compaction
 * would gain less than `minimumGain`.
 *
 * The new generation holds the room's current content, read as a `.docx` package, under the
 * same document ID and a new generation ID. Deleted text and records, formatting history, and
 * unreferenced media are gone. Call it when the server loads a room, before any participant
 * syncs, and store the result in place of the old state.
 *
 * A check reads the whole room and builds it again. The answer for a state found not worth
 * compacting is remembered in this process, so the same bytes are checked once. A state that
 * changed is checked again.
 *
 * Throws `CollaborationSchemaError` when the stored state cannot be read, as
 * `readCollaborationDocument` does.
 *
 * @public
 */
export async function compactCollaborationState(
  state: Uint8Array,
  options: CompactCollaborationStateOptions = {}
): Promise<Uint8Array | null> {
  const minimumGain = options.minimumGain ?? DEFAULT_MINIMUM_GAIN;
  const key = await checkKey(state, minimumGain);
  if (NOT_WORTH_COMPACTING.has(key)) return null;
  const stored = new Y.Doc();
  try {
    Y.applyUpdate(stored, state);
    const meta = stored.getMap(PACKAGE_META_KEY);
    const documentId = meta.get('documentId');
    if (typeof documentId !== 'string') throw new CollaborationSchemaError('not-initialized');
    // Measured against a fresh build of the content the room holds now. The size the room had
    // when it was seeded is no bound: deleting most of a document makes the fresh build far
    // smaller than the seed while the stored state hardly grows.
    const compacted = await seedGeneration(readCollaborationDocument(stored), documentId);
    if (state.byteLength / Math.max(1, compacted.byteLength) >= minimumGain) return compacted;
    rememberNotWorthIt(key);
    return null;
  } finally {
    stored.destroy();
  }
}

/** A fresh room state that holds `bytes`, with a new generation ID. */
export async function seedGeneration(bytes: Uint8Array, documentId: string): Promise<Uint8Array> {
  const fresh = new Y.Doc();
  const stopKeepingMarkers = keepFormattingMarkers(fresh);
  const registry = new DocumentRegistry(fresh);
  try {
    const blobs = new SharedBlobStore(fresh.getMap<Uint8Array>(SHARED_BLOBS_KEY));
    const seeded = await seedPackage(registry, openBaselinePackage(bytes), blobs);
    if (!seeded.ok) throw new CollaborationSchemaError(seeded.code);
    fresh.transact(() => {
      registry.schema.meta.set('documentId', documentId);
      registry.schema.meta.set(ROOM_GENERATION_FIELD, globalThis.crypto.randomUUID());
      recordSeed(fresh);
    });
    recordFreshSize(fresh);
    return Y.encodeStateAsUpdate(fresh);
  } finally {
    registry.destroy();
    stopKeepingMarkers();
    fresh.destroy();
  }
}

/**
 * The stateless message a client sends before it syncs: the generation it holds, or null for
 * a document that holds no room yet.
 */
export function roomGenerationMessage(document: Y.Doc): string {
  const initialized = document.getMap(PACKAGE_META_KEY).get('initialized') === true;
  return JSON.stringify({
    type: GENERATION_MESSAGE,
    generation: initialized ? readCollaborationRoomGeneration(document) : null,
  });
}

/** Whether a connection close reports a changed room generation. */
export function isRoomGenerationClose(event: {
  readonly code?: number;
  readonly reason?: string;
}): boolean {
  return event.code === GENERATION_CLOSE_CODE || event.reason === 'room-generation-changed';
}

/** What the gate reads of a Hocuspocus `beforeHandleMessage` payload. @public */
export interface CollaborationRoomGatePayload {
  /** The connection's context object, which the gate marks once the generation matched. */
  readonly context: object;
  /** The room's server-side `Y.Doc`. */
  readonly document: Y.Doc;
  /** The incoming message bytes. */
  readonly update: Uint8Array;
}

/** Hocuspocus message types the gate tells apart (`@hocuspocus/server` `MessageType`). */
const SYNC_MESSAGES = new Set([0, 1, 3, 4, 6]);
const STATELESS_MESSAGE = 5;
const CHECKED = Symbol('docx-room-generation-checked');

/**
 * Refuse a connection whose replica holds another generation of the room. Call it from the
 * Hocuspocus `beforeHandleMessage` hook. A client sends the generation it holds before its
 * first sync message; on a mismatch, or a sync message without one, this throws an error
 * that closes the connection with `room-generation-changed` before any of its state merges.
 * A message the gate cannot read is refused the same way.
 *
 * A replica that holds no room yet names no generation and passes: it has no state of an
 * earlier generation to merge. The gate keeps honest replicas of two generations apart. It
 * is not access control: a client that may write to the room can send any update, so
 * authenticate connections in `onAuthenticate`.
 *
 * @public
 */
export function checkCollaborationRoomGeneration(payload: CollaborationRoomGatePayload): void {
  const message = readMessageHead(payload.update);
  // A message the gate cannot read could be one the server reads as a sync.
  if (!message) throw generationRefusal();
  if (message.type === STATELESS_MESSAGE) {
    const generation = generationOf(message.payload);
    if (generation === undefined) return;
    if (generation !== null && generation !== readCollaborationRoomGeneration(payload.document)) {
      throw generationRefusal();
    }
    (payload.context as Record<symbol, unknown>)[CHECKED] = true;
    return;
  }
  if (
    SYNC_MESSAGES.has(message.type) &&
    (payload.context as Record<symbol, unknown>)[CHECKED] !== true
  ) {
    throw generationRefusal();
  }
}

function generationRefusal(): Error & { readonly code: number; readonly reason: string } {
  return Object.assign(new Error('room-generation-changed'), {
    code: GENERATION_CLOSE_CODE,
    reason: 'room-generation-changed',
  });
}

/** The generation a stateless payload names, null for none, or undefined for another message. */
function generationOf(payload: string | null): string | null | undefined {
  if (payload === null || payload.length > 512) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const record = parsed as { readonly type?: unknown; readonly generation?: unknown };
  if (record.type !== GENERATION_MESSAGE) return undefined;
  if (record.generation === null) return null;
  return typeof record.generation === 'string' && record.generation.length <= 128
    ? record.generation
    : undefined;
}

/** The type of a raw Hocuspocus message, and a stateless message's payload. */
function readMessageHead(
  bytes: Uint8Array
): { readonly type: number; readonly payload: string | null } | null {
  const reader = { at: 0 };
  const key = readVarString(bytes, reader);
  if (key === null) return null;
  const type = readVarUint(bytes, reader);
  if (type === null) return null;
  return { type, payload: type === STATELESS_MESSAGE ? readVarString(bytes, reader) : null };
}

function readVarUint(bytes: Uint8Array, reader: { at: number }): number | null {
  let value = 0;
  let scale = 1;
  for (let step = 0; step < 8; step += 1) {
    const byte = bytes[reader.at];
    if (byte === undefined) return null;
    reader.at += 1;
    value += (byte & 0x7f) * scale;
    if (byte < 0x80) return value;
    scale *= 0x80;
  }
  return null;
}

function readVarString(bytes: Uint8Array, reader: { at: number }): string | null {
  const length = readVarUint(bytes, reader);
  if (length === null || reader.at + length > bytes.length) return null;
  const text = new TextDecoder().decode(bytes.subarray(reader.at, reader.at + length));
  reader.at += length;
  return text;
}
