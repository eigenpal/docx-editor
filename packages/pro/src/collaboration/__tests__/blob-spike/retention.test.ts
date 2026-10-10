/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, describe, expect, test } from 'bun:test';
import { createConnectedClient, publishBlob, BlobHost } from './host.ts';
import { BlobStore } from './store.ts';
import { LEASE_TTL_MS } from './contract.ts';

function payload(label: string): Uint8Array {
  return new TextEncoder().encode(
    `UNIQUE_BLOB_PAYLOAD_${label}_DO_NOT_COPY_INTO_YJS_UPDATE_______________`
  );
}

function world(roomId = 'room-a') {
  const store = new BlobStore();
  const host = new BlobHost(store);
  host.createRoom(roomId);
  const local = createConnectedClient(host, roomId, 21);
  cleanups.push(() => {
    local.destroy();
    host.destroy();
  });
  return { host, store, roomId, local };
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

describe('blob retention and garbage collection', () => {
  test('keeps bytes after reference removal while a checkpoint still names the digest', () => {
    const { host, store, roomId, local } = world();
    const published = publishBlob(host, local, {
      roomId,
      actorId: 'alice',
      partName: 'word/media/a.png',
      bytes: payload('checkpoint'),
      mediaType: 'image/png',
    });
    expect(published.ok).toBe(true);
    if (!published.ok) return;
    expect(host.persistProposal(published.proposalId, roomId).ok).toBe(true);
    const checkpoint = host.checkpoint(roomId);
    expect(checkpoint.requiredDigests).toEqual([published.descriptor.digest]);
    host.removeBlobRef(roomId, 'word/media/a.png');
    host.now += LEASE_TTL_MS + 1;
    expect(host.pins(published.descriptor.digest).map((pin) => pin.reason)).toEqual(['checkpoint']);
    expect(host.collectGarbage()).toEqual([]);
    expect(store.hasBytes(published.descriptor.digest)).toBe(true);
  });

  test('fails restore without replacing the room when a checkpoint blob is missing', () => {
    const { host, store, roomId, local } = world();
    const published = publishBlob(host, local, {
      roomId,
      actorId: 'alice',
      partName: 'word/media/a.png',
      bytes: payload('restore-missing'),
      mediaType: 'image/png',
    });
    expect(published.ok).toBe(true);
    if (!published.ok) return;
    expect(host.persistProposal(published.proposalId, roomId).ok).toBe(true);
    const checkpoint = host.checkpoint(roomId);
    const active = host.room(roomId).activeGenerationId;
    const lastValid = host.room(roomId).lastValidCanonicalId;
    store.dropBytes(published.descriptor.digest);
    expect(host.restoreCheckpoint(roomId, checkpoint.checkpointId)).toEqual({
      ok: false,
      code: 'checkpoint-blob-missing',
    });
    expect(host.room(roomId).activeGenerationId).toBe(active);
    expect(host.room(roomId).lastValidCanonicalId).toBe(lastValid);
  });

  test('restores a new generation when every checkpoint blob is visible', () => {
    const { host, roomId, local } = world();
    const published = publishBlob(host, local, {
      roomId,
      actorId: 'alice',
      partName: 'word/media/a.png',
      bytes: payload('restore-ok'),
      mediaType: 'image/png',
    });
    expect(published.ok).toBe(true);
    if (!published.ok) return;
    expect(host.persistProposal(published.proposalId, roomId).ok).toBe(true);
    const checkpoint = host.checkpoint(roomId);
    host.replaceGeneration(roomId);
    const restored = host.restoreCheckpoint(roomId, checkpoint.checkpointId);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.generationId).not.toBe(checkpoint.generationId);
    expect(host.room(roomId).activeGenerationId).toBe(restored.generationId);
    const ready = host.materialize(roomId);
    expect(ready.ok).toBe(true);
  });

  test('pins a digest while an unacked offline frame still names it', () => {
    const { host, store, roomId, local } = world();
    const published = publishBlob(host, local, {
      roomId,
      actorId: 'alice',
      partName: 'word/media/a.png',
      bytes: payload('offline'),
      mediaType: 'image/png',
    });
    expect(published.ok).toBe(true);
    if (!published.ok) return;
    host.abandonProposal(published.proposalId, roomId);
    const buffered = host.bufferOfflineFrame({
      roomId,
      generationId: host.room(roomId).activeGenerationId,
      update: published.update,
    });
    expect(buffered.ok).toBe(true);
    if (!buffered.ok) return;
    expect(buffered.requiredDigests).toEqual([published.descriptor.digest]);
    host.now += LEASE_TTL_MS + 1;
    expect(host.pins(published.descriptor.digest).map((pin) => pin.reason)).toEqual([
      'offline-frame',
    ]);
    expect(host.collectGarbage()).toEqual([]);
    expect(store.hasBytes(published.descriptor.digest)).toBe(true);
    host.nackFrame(roomId, buffered.frameId);
    expect(host.collectGarbage()).toEqual([published.descriptor.digest]);
    expect(store.hasBytes(published.descriptor.digest)).toBe(false);
  });

  test('retains a blob that only the previous generation still references', () => {
    const { host, store, roomId, local } = world();
    const published = publishBlob(host, local, {
      roomId,
      actorId: 'alice',
      partName: 'word/media/a.png',
      bytes: payload('generation'),
      mediaType: 'image/png',
    });
    expect(published.ok).toBe(true);
    if (!published.ok) return;
    expect(host.persistProposal(published.proposalId, roomId).ok).toBe(true);
    const oldGeneration = host.room(roomId).activeGenerationId;
    host.replaceGeneration(roomId);
    host.now += LEASE_TTL_MS + 1;
    expect(host.pins(published.descriptor.digest).map((pin) => pin.reason)).toEqual([
      'retained-generation',
    ]);
    expect(host.collectGarbage()).toEqual([]);
    expect(host.discardGeneration(roomId, oldGeneration)).toEqual({ ok: true });
    expect(host.collectGarbage()).toEqual([published.descriptor.digest]);
    expect(store.hasBytes(published.descriptor.digest)).toBe(false);
  });

  test('does not delete a content-addressed blob while another room still references it', () => {
    const { host, store, roomId, local } = world('room-a');
    host.createRoom('room-b');
    const other = createConnectedClient(host, 'room-b', 22);
    cleanups.push(() => other.destroy());
    const bytes = payload('shared');
    const first = publishBlob(host, local, {
      roomId,
      actorId: 'alice',
      partName: 'word/media/a.png',
      bytes,
      mediaType: 'image/png',
    });
    const second = publishBlob(host, other, {
      roomId: 'room-b',
      actorId: 'bob',
      partName: 'word/media/b.png',
      bytes,
      mediaType: 'image/png',
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.descriptor.digest).toBe(second.descriptor.digest);
    expect(host.persistProposal(first.proposalId, roomId).ok).toBe(true);
    expect(host.persistProposal(second.proposalId, 'room-b').ok).toBe(true);
    host.deleteRoom(roomId, false);
    host.now += LEASE_TTL_MS + 1;
    expect(host.collectGarbage()).toEqual([]);
    expect(store.hasBytes(first.descriptor.digest)).toBe(true);
    host.deleteRoom('room-b', false);
    expect(host.collectGarbage()).toEqual([first.descriptor.digest]);
  });

  test('keeps checkpoint pins after room deletion when policy retains checkpoints', () => {
    const { host, store, roomId, local } = world();
    const published = publishBlob(host, local, {
      roomId,
      actorId: 'alice',
      partName: 'word/media/a.png',
      bytes: payload('deleted-room'),
      mediaType: 'image/png',
    });
    expect(published.ok).toBe(true);
    if (!published.ok) return;
    expect(host.persistProposal(published.proposalId, roomId).ok).toBe(true);
    host.checkpoint(roomId);
    host.deleteRoom(roomId, true);
    host.now += LEASE_TTL_MS + 1;
    expect(host.pins(published.descriptor.digest).map((pin) => pin.reason)).toEqual(['checkpoint']);
    expect(host.collectGarbage()).toEqual([]);
    expect(store.hasBytes(published.descriptor.digest)).toBe(true);
  });

  test('deletes a blob only after every pin is gone', () => {
    const { host, store, roomId, local } = world();
    const published = publishBlob(host, local, {
      roomId,
      actorId: 'alice',
      partName: 'word/media/a.png',
      bytes: payload('gc'),
      mediaType: 'image/png',
    });
    expect(published.ok).toBe(true);
    if (!published.ok) return;
    expect(host.persistProposal(published.proposalId, roomId).ok).toBe(true);
    expect(host.missingRequired()).toEqual([]);
    host.removeBlobRef(roomId, 'word/media/a.png');
    expect(host.collectGarbage()).toEqual([]);
    host.now += LEASE_TTL_MS + 1;
    expect(host.collectGarbage()).toEqual([published.descriptor.digest]);
    expect(store.hasBytes(published.descriptor.digest)).toBe(false);
    expect(host.missingRequired()).toEqual([]);
  });

  test('acks an offline frame into active-generation ownership', () => {
    const { host, roomId, local } = world();
    const published = publishBlob(host, local, {
      roomId,
      actorId: 'alice',
      partName: 'word/media/a.png',
      bytes: payload('ack-frame'),
      mediaType: 'image/png',
    });
    expect(published.ok).toBe(true);
    if (!published.ok) return;
    host.abandonProposal(published.proposalId, roomId);
    const buffered = host.bufferOfflineFrame({
      roomId,
      generationId: host.room(roomId).activeGenerationId,
      update: published.update,
    });
    expect(buffered.ok).toBe(true);
    if (!buffered.ok) return;
    expect(host.ackFrame(roomId, buffered.frameId).ok).toBe(true);
    host.now += LEASE_TTL_MS + 1;
    expect(host.pins(published.descriptor.digest).map((pin) => pin.reason)).toEqual([
      'active-generation',
    ]);
    expect(host.materialize(roomId).ok).toBe(true);
  });
});
