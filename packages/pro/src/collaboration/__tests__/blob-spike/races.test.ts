/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { describeBytes, LEASE_TTL_MS } from './contract.ts';
import { BlobHost, commitLocalBlobRef, createConnectedClient, publishBlob } from './host.ts';
import { BlobStore } from './store.ts';

function payload(label: string): Uint8Array {
  return new TextEncoder().encode(
    `UNIQUE_BLOB_PAYLOAD_${label}_DO_NOT_COPY_INTO_YJS_UPDATE_______________`
  );
}

function world(roomId = 'room-a') {
  const store = new BlobStore();
  const host = new BlobHost(store);
  host.createRoom(roomId);
  const local = createConnectedClient(host, roomId, 31);
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

describe('blob publication races', () => {
  test('does not delete a required blob when a lease appears during collection', () => {
    const { host, store, roomId, local } = world();
    const bytes = payload('race-lease');
    const published = publishBlob(host, local, {
      roomId,
      actorId: 'alice',
      partName: 'word/media/a.png',
      bytes,
      mediaType: 'image/png',
    });
    expect(published.ok).toBe(true);
    if (!published.ok) return;
    host.abandonProposal(published.proposalId, roomId);
    host.now += LEASE_TTL_MS + 1;
    host.collectHook = (digest) => {
      expect(digest).toBe(published.descriptor.digest);
      store.put(bytes, published.descriptor, 'bob', host.now);
    };
    expect(host.collectGarbage()).toEqual([]);
    expect(store.hasBytes(published.descriptor.digest)).toBe(true);
    expect(host.missingRequired()).toEqual([]);
  });

  test('does not delete a required blob when a checkpoint appears during collection', () => {
    const { host, store, roomId, local } = world();
    const published = publishBlob(host, local, {
      roomId,
      actorId: 'alice',
      partName: 'word/media/a.png',
      bytes: payload('race-checkpoint'),
      mediaType: 'image/png',
    });
    expect(published.ok).toBe(true);
    if (!published.ok) return;
    host.abandonProposal(published.proposalId, roomId);
    host.now += LEASE_TTL_MS + 1;
    host.collectHook = () => {
      Y.applyUpdate(host.activeDoc(roomId), published.update, 'race-checkpoint');
      host.checkpoint(roomId);
    };
    expect(host.collectGarbage()).toEqual([]);
    host.collectHook = null;
    expect(
      host
        .pins(published.descriptor.digest)
        .map((pin) => pin.reason)
        .sort()
    ).toEqual(['active-generation', 'checkpoint']);
    expect(store.hasBytes(published.descriptor.digest)).toBe(true);
  });

  test('does not delete a required blob when an offline frame appears during collection', () => {
    const { host, store, roomId, local } = world();
    const published = publishBlob(host, local, {
      roomId,
      actorId: 'alice',
      partName: 'word/media/a.png',
      bytes: payload('race-frame'),
      mediaType: 'image/png',
    });
    expect(published.ok).toBe(true);
    if (!published.ok) return;
    host.abandonProposal(published.proposalId, roomId);
    host.now += LEASE_TTL_MS + 1;
    host.collectHook = () => {
      host.bufferOfflineFrame({
        roomId,
        generationId: host.room(roomId).activeGenerationId,
        update: published.update,
      });
    };
    expect(host.collectGarbage()).toEqual([]);
    expect(host.pins(published.descriptor.digest).map((pin) => pin.reason)).toEqual([
      'offline-frame',
    ]);
    expect(store.hasBytes(published.descriptor.digest)).toBe(true);
  });

  test('keeps pending-persist pins when the lease expires before confirmation', () => {
    const { host, store, roomId, local } = world();
    const published = publishBlob(host, local, {
      roomId,
      actorId: 'alice',
      partName: 'word/media/a.png',
      bytes: payload('race-expiry'),
      mediaType: 'image/png',
    });
    expect(published.ok).toBe(true);
    if (!published.ok) return;
    host.now += LEASE_TTL_MS + 1;
    expect(store.lease(published.leaseId, host.now)).toBeNull();
    expect(host.pins(published.descriptor.digest).map((pin) => pin.reason)).toEqual([
      'pending-persist',
    ]);
    expect(host.collectGarbage()).toEqual([]);
    expect(host.persistProposal(published.proposalId, roomId).ok).toBe(true);
    expect(host.materialize(roomId).ok).toBe(true);
  });

  test('rejects a late persist after generation replacement', () => {
    const { host, roomId, local } = world();
    const published = publishBlob(host, local, {
      roomId,
      actorId: 'alice',
      partName: 'word/media/a.png',
      bytes: payload('race-generation'),
      mediaType: 'image/png',
    });
    expect(published.ok).toBe(true);
    if (!published.ok) return;
    const next = host.replaceGeneration(roomId);
    expect(host.persistProposal(published.proposalId, roomId)).toEqual({
      ok: false,
      code: 'wrong-generation',
    });
    expect(host.room(roomId).activeGenerationId).toBe(next);
    host.now += LEASE_TTL_MS + 1;
    expect(host.collectGarbage()).toEqual([published.descriptor.digest]);
  });

  test('lets two actors share one digest with independent leases', () => {
    const { host, store, roomId, local } = world();
    host.createRoom('room-b');
    const other = createConnectedClient(host, 'room-b', 32);
    cleanups.push(() => other.destroy());
    const bytes = payload('race-dup');
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
    expect(first.leaseId).not.toBe(second.leaseId);
    expect(store.liveLeases(first.descriptor.digest, host.now)).toHaveLength(2);
    host.abandonProposal(first.proposalId, roomId);
    host.now += LEASE_TTL_MS + 1;
    expect(host.collectGarbage()).toEqual([]);
    expect(host.persistProposal(second.proposalId, 'room-b').ok).toBe(true);
    expect(store.hasBytes(first.descriptor.digest)).toBe(true);
  });

  test('refuses a reference that races ahead of PUT even if the local Y.Doc already committed', () => {
    const { host, store, roomId, local } = world();
    const bytes = payload('race-ahead');
    const descriptor = describeBytes(bytes, 'image/png');
    const update = commitLocalBlobRef(local, 'word/media/a.png', descriptor);
    expect(local.getMap('blobs').get('word/media/a.png')).toBeDefined();
    expect(
      host.proposeBlobRef({
        roomId,
        generationId: host.room(roomId).activeGenerationId,
        partName: 'word/media/a.png',
        descriptor,
        leaseId: 'lease:too-early',
        update,
      })
    ).toEqual({ ok: false, code: 'lease-expired' });
    expect(Y.encodeStateAsUpdate(host.activeDoc(roomId)).byteLength).toBeGreaterThan(0);
    expect(store.hasBytes(descriptor.digest)).toBe(false);
    const put = store.put(bytes, descriptor, 'alice', host.now);
    expect(put.ok).toBe(true);
    if (!put.ok) return;
    const proposed = host.proposeBlobRef({
      roomId,
      generationId: host.room(roomId).activeGenerationId,
      partName: 'word/media/a.png',
      descriptor,
      leaseId: put.lease.leaseId,
      update,
    });
    expect(proposed.ok).toBe(true);
  });

  test('validates a later blob frame against pending unpersisted frames', () => {
    const { host, roomId, local } = world();
    const first = publishBlob(host, local, {
      roomId,
      actorId: 'alice',
      partName: 'word/media/a.png',
      bytes: payload('pending-a'),
      mediaType: 'image/png',
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = publishBlob(host, local, {
      roomId,
      actorId: 'alice',
      partName: 'word/media/b.png',
      bytes: payload('pending-b'),
      mediaType: 'image/png',
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(host.persistProposal(first.proposalId, roomId).ok).toBe(true);
    expect(host.persistProposal(second.proposalId, roomId).ok).toBe(true);
    const ready = host.materialize(roomId);
    expect(ready.ok).toBe(true);
    if (ready.ok) {
      expect([...ready.blobs.keys()].sort()).toEqual(['word/media/a.png', 'word/media/b.png']);
    }
  });

  test('never reports a required digest as deleted after mixed retain and collect steps', () => {
    const { host, store, roomId, local } = world();
    const first = publishBlob(host, local, {
      roomId,
      actorId: 'alice',
      partName: 'word/media/a.png',
      bytes: payload('invariant-a'),
      mediaType: 'image/png',
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(host.persistProposal(first.proposalId, roomId).ok).toBe(true);
    const second = publishBlob(host, local, {
      roomId,
      actorId: 'alice',
      partName: 'word/media/c.png',
      bytes: payload('invariant-c'),
      mediaType: 'image/png',
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(host.persistProposal(second.proposalId, roomId).ok).toBe(true);
    host.checkpoint(roomId);
    host.removeBlobRef(roomId, 'word/media/a.png');
    const oldGeneration = host.room(roomId).activeGenerationId;
    host.replaceGeneration(roomId);
    host.collectHook = (digest) => {
      expect(host.pins(digest).length + store.liveLeases(digest, host.now).length).toBe(0);
    };
    const deleted = host.collectGarbage();
    expect(deleted).toEqual([]);
    expect(host.missingRequired()).toEqual([]);
    expect(store.hasBytes(first.descriptor.digest)).toBe(true);
    expect(store.hasBytes(second.descriptor.digest)).toBe(true);
    host.discardGeneration(roomId, oldGeneration);
    host.deleteRoom(roomId, false);
    host.now += LEASE_TTL_MS + 1;
    host.collectHook = null;
    const later = host.collectGarbage();
    expect([...later].sort()).toEqual([first.descriptor.digest, second.descriptor.digest].sort());
    expect(host.missingRequired()).toEqual([]);
  });
});
