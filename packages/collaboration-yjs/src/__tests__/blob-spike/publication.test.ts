import { afterEach, describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import {
  BLOB_PUBLICATION_CONTRACT,
  BLOBS_MAP_KEY,
  containsBytes,
  describeBytes,
  encodeDescriptor,
  LEASE_TTL_MS,
  MAX_BLOB_BYTES,
  MISSING_RETRY_LIMIT,
  parseDescriptor,
  validateDescriptor,
} from './contract.ts';
import { contentDigest } from './digest.ts';
import {
  BlobHost,
  commitLocalBlobRef,
  createConnectedClient,
  descriptorsIn,
  publishBlob,
} from './host.ts';
import { BlobStore } from './store.ts';

function payload(label: string): Uint8Array {
  return new TextEncoder().encode(
    `UNIQUE_BLOB_PAYLOAD_${label}_DO_NOT_COPY_INTO_YJS_UPDATE_______________`
  );
}

function world(): {
  host: BlobHost;
  store: BlobStore;
  roomId: string;
  local: Y.Doc;
} {
  const store = new BlobStore();
  const host = new BlobHost(store);
  const roomId = 'room-a';
  host.createRoom(roomId);
  const local = createConnectedClient(host, roomId, 11);
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

describe('blob publication contract', () => {
  test('records content-addressed sha256 descriptors', () => {
    const bytes = payload('desc');
    const descriptor = describeBytes(bytes, 'image/png');
    expect(descriptor.digest).toBe(contentDigest(bytes));
    expect(descriptor.digest.startsWith(BLOB_PUBLICATION_CONTRACT.digestPrefix)).toBe(true);
    expect(descriptor.storageKey).toBe(descriptor.digest);
    expect(descriptor.size).toBe(bytes.byteLength);
    expect(validateDescriptor(descriptor)).toEqual({ ok: true });
    expect(BLOB_PUBLICATION_CONTRACT.storageKeyEqualsDigest).toBe(true);
    expect(BLOB_PUBLICATION_CONTRACT.uploadBeforeReference).toBe(true);
  });

  test('rejects a storage key that is not the digest or that names a URL', () => {
    const digest = contentDigest(payload('url'));
    const external = validateDescriptor({
      digest,
      size: 4,
      mediaType: 'image/png',
      storageKey: 'https://evil.example/image.png',
    });
    expect(external.ok).toBe(false);
    if (!external.ok) expect(external.code).toBe('external-fetch-forbidden');
    const invalid = validateDescriptor({
      digest,
      size: 4,
      mediaType: 'image/png',
      storageKey: 'other-key',
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.code).toBe('invalid-blob-descriptor');
  });

  test('rejects prototype keys and malformed descriptor JSON', () => {
    const proto = parseDescriptor('{"__proto__":{},"digest":"x"}');
    expect(proto.ok).toBe(false);
    if (!proto.ok) expect(proto.code).toBe('prototype-key');
    const malformed = parseDescriptor('{not-json');
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.code).toBe('invalid-blob-descriptor');
    const nullish = parseDescriptor(null);
    expect(nullish.ok).toBe(false);
    if (!nullish.ok) expect(nullish.code).toBe('invalid-blob-descriptor');
  });

  test('verifies digest and size on PUT before a lease exists', () => {
    const store = new BlobStore();
    const bytes = payload('verify');
    const descriptor = describeBytes(bytes, 'image/png');
    const mismatch = store.put(
      bytes,
      {
        ...descriptor,
        digest: contentDigest(payload('other')),
        storageKey: contentDigest(payload('other')),
      },
      'alice',
      0
    );
    expect(mismatch).toEqual({ ok: false, code: 'digest-mismatch' });
    expect(store.hasBytes(descriptor.digest)).toBe(false);
    const size = store.put(bytes, { ...descriptor, size: descriptor.size + 1 }, 'alice', 0);
    expect(size).toEqual({ ok: false, code: 'size-mismatch' });
    expect(store.hasBytes(descriptor.digest)).toBe(false);
    const ok = store.put(bytes, descriptor, 'alice', 0);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.lease.digest).toBe(descriptor.digest);
  });

  test('rejects oversized or disallowed media before the digest is available', () => {
    const store = new BlobStore();
    const bytes = payload('policy');
    const descriptor = describeBytes(bytes, 'image/png');
    const huge = new Uint8Array(MAX_BLOB_BYTES + 1);
    const fakeDigest = `sha256:${'0'.repeat(64)}`;
    expect(
      store.put(
        huge,
        {
          digest: fakeDigest,
          size: huge.byteLength,
          mediaType: 'image/png',
          storageKey: fakeDigest,
        },
        'alice',
        0
      )
    ).toEqual({
      ok: false,
      code: 'blob-exceeds-policy',
    });
    expect(
      store.put(bytes, { ...descriptor, mediaType: 'application/x-msdownload' }, 'alice', 0)
    ).toEqual({ ok: false, code: 'blob-exceeds-policy' });
    expect(store.hasBytes(descriptor.digest)).toBe(false);
    expect(store.get(descriptor.digest)).toEqual({ ok: false, code: 'blob-bytes-missing' });
  });

  test('rejects an unsafe part name before the digest enters room state', () => {
    const { host, store, roomId, local } = world();
    const bytes = payload('path');
    const descriptor = describeBytes(bytes, 'image/png');
    const put = store.put(bytes, descriptor, 'alice', host.now);
    expect(put.ok).toBe(true);
    if (!put.ok) return;
    const update = commitLocalBlobRef(local, 'word/media/safe.png', descriptor);
    expect(
      host.proposeBlobRef({
        roomId,
        generationId: host.room(roomId).activeGenerationId,
        partName: '../secret.png',
        descriptor,
        leaseId: put.lease.leaseId,
        update,
      })
    ).toEqual({ ok: false, code: 'unsafe-part-name' });
    expect(descriptorsIn(host.activeDoc(roomId)).size).toBe(0);
  });

  test('leases after verified PUT and refuses a reference without that lease', () => {
    const { host, store, roomId, local } = world();
    const bytes = payload('lease');
    const descriptor = describeBytes(bytes, 'image/png');
    const update = commitLocalBlobRef(local, 'word/media/a.png', descriptor);
    const skipped = host.proposeBlobRef({
      roomId,
      generationId: host.room(roomId).activeGenerationId,
      partName: 'word/media/a.png',
      descriptor,
      leaseId: 'lease:missing',
      update,
    });
    expect(skipped).toEqual({ ok: false, code: 'lease-expired' });
    expect(descriptorsIn(host.activeDoc(roomId)).size).toBe(0);
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

  test('keeps blob bytes outside the Yjs update that publishes the descriptor', () => {
    const { host, roomId, local } = world();
    const bytes = payload('not-in-yjs');
    const published = publishBlob(host, local, {
      roomId,
      actorId: 'alice',
      partName: 'word/media/a.png',
      bytes,
      mediaType: 'image/png',
    });
    expect(published.ok).toBe(true);
    if (!published.ok) return;
    expect(containsBytes(published.update, bytes)).toBe(false);
    expect(containsBytes(Y.encodeStateAsUpdate(local), bytes)).toBe(false);
    expect(new TextDecoder().decode(published.update)).toContain(published.descriptor.digest);
    const persisted = host.persistProposal(published.proposalId, roomId);
    expect(persisted.ok).toBe(true);
    expect(containsBytes(Y.encodeStateAsUpdate(host.activeDoc(roomId)), bytes)).toBe(false);
    expect(BLOB_PUBLICATION_CONTRACT.bytesOutsideYjs).toBe(true);
  });

  test('converts a lease into retained ownership only after persistence confirmation', () => {
    const { host, store, roomId, local } = world();
    const published = publishBlob(host, local, {
      roomId,
      actorId: 'alice',
      partName: 'word/media/a.png',
      bytes: payload('persist'),
      mediaType: 'image/png',
    });
    expect(published.ok).toBe(true);
    if (!published.ok) return;
    expect(
      host
        .pins(published.descriptor.digest)
        .map((pin) => pin.reason)
        .sort()
    ).toEqual(['lease', 'pending-persist']);
    expect(descriptorsIn(host.activeDoc(roomId)).size).toBe(0);
    const persisted = host.persistProposal(published.proposalId, roomId);
    expect(persisted.ok).toBe(true);
    host.now += LEASE_TTL_MS + 1;
    store.dropExpiredLeases(host.now);
    expect(host.pins(published.descriptor.digest).map((pin) => pin.reason)).toEqual([
      'active-generation',
    ]);
    expect(host.collectGarbage()).toEqual([]);
    expect(store.hasBytes(published.descriptor.digest)).toBe(true);
  });

  test('blocks materialization while bytes are delayed and succeeds after they appear', () => {
    const { host, store, roomId, local } = world();
    const bytes = payload('delayed');
    const published = publishBlob(host, local, {
      roomId,
      actorId: 'alice',
      partName: 'word/media/a.png',
      bytes,
      mediaType: 'image/png',
    });
    expect(published.ok).toBe(true);
    if (!published.ok) return;
    expect(host.persistProposal(published.proposalId, roomId).ok).toBe(true);
    store.hide(published.descriptor.digest);
    expect(host.materialize(roomId)).toEqual({ ok: false, code: 'blob-bytes-pending' });
    expect(host.room(roomId).quarantine).toBeNull();
    store.reveal(published.descriptor.digest);
    const ready = host.materialize(roomId);
    expect(ready.ok).toBe(true);
    if (ready.ok) expect([...ready.blobs.keys()]).toEqual(['word/media/a.png']);
  });

  test('quarantines after bounded retries when referenced bytes are missing', () => {
    const { host, store, roomId, local } = world();
    const published = publishBlob(host, local, {
      roomId,
      actorId: 'alice',
      partName: 'word/media/a.png',
      bytes: payload('missing'),
      mediaType: 'image/png',
    });
    expect(published.ok).toBe(true);
    if (!published.ok) return;
    expect(host.persistProposal(published.proposalId, roomId).ok).toBe(true);
    const lastValid = host.room(roomId).lastValidCanonicalId;
    store.dropBytes(published.descriptor.digest);
    for (let attempt = 1; attempt < MISSING_RETRY_LIMIT; attempt += 1) {
      expect(host.materialize(roomId)).toEqual({ ok: false, code: 'blob-bytes-missing' });
      expect(host.room(roomId).quarantine).toBeNull();
    }
    expect(host.materialize(roomId)).toEqual({ ok: false, code: 'blob-bytes-missing' });
    expect(host.room(roomId).quarantine).toEqual({
      code: 'blob-bytes-missing',
      digest: published.descriptor.digest,
    });
    expect(host.room(roomId).lastValidCanonicalId).toBe(lastValid);
    expect(MISSING_RETRY_LIMIT).toBe(BLOB_PUBLICATION_CONTRACT.missingRetryLimit);
  });

  test('rebuilds required pins from persisted refs after a restart drops proposals', () => {
    const { host, roomId, local } = world();
    const published = publishBlob(host, local, {
      roomId,
      actorId: 'alice',
      partName: 'word/media/a.png',
      bytes: payload('restart'),
      mediaType: 'image/png',
    });
    expect(published.ok).toBe(true);
    if (!published.ok) return;
    expect(host.persistProposal(published.proposalId, roomId).ok).toBe(true);
    host.restart();
    host.now += LEASE_TTL_MS + 1;
    expect(host.room(roomId).proposals.size).toBe(0);
    expect(host.pins(published.descriptor.digest).map((pin) => pin.reason)).toEqual([
      'active-generation',
    ]);
    expect(host.collectGarbage()).toEqual([]);
    expect(encodeDescriptor(published.descriptor)).toContain(published.descriptor.digest);
    expect(host.activeDoc(roomId).getMap(BLOBS_MAP_KEY).get('word/media/a.png')).toBe(
      encodeDescriptor(published.descriptor)
    );
  });
});
