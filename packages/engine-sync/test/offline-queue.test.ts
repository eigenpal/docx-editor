// Offline queue + replay convergence (document-engine task 10.5). Two clients
// edit while offline; on reconnect their queued updates replay without duplicates
// and both converge.

import { describe, expect, test } from 'bun:test';
import { ReplicationCoordinator, YjsBackend, OfflineQueue } from '../src/index.ts';
import { DocumentStore, createEmptyModel, paragraphText } from '@docx-editor.dev/engine-core';

const P1 = 'p-1';

function peer(actor: string, base?: YjsBackend) {
  const store = new DocumentStore(createEmptyModel());
  const backend = base ? YjsBackend.join('doc', actor, base.snapshot()) : YjsBackend.fromModel('doc', actor, createEmptyModel());
  return { coord: new ReplicationCoordinator(store, backend), store, backend, outbox: new OfflineQueue() };
}

describe('offline edit + reconnect', () => {
  test('two offline clients replay queued updates and converge', () => {
    const a = peer('a');
    const b = peer('b', a.backend);

    // --- both offline: edit locally, buffer the outbound update ---
    const ea = a.coord.localInsertText(P1, 'A-offline');
    a.outbox.enqueue(ea.update!);
    const eb = b.coord.localInsertText(P1, 'B-offline');
    b.outbox.enqueue(eb.update!);

    // --- reconnect: exchange drained queues ---
    for (const u of a.outbox.drain()) b.coord.remoteMerge(u);
    for (const u of b.outbox.drain()) a.coord.remoteMerge(u);

    // Converged, both edits present.
    expect(paragraphText(a.store.currentModel, P1)).toBe(paragraphText(b.store.currentModel, P1));
    expect(paragraphText(a.store.currentModel, P1)).toContain('A-offline');
    expect(paragraphText(a.store.currentModel, P1)).toContain('B-offline');
  });

  test('replaying an already-applied update is a no-op (no duplicates)', () => {
    const a = peer('a');
    const b = peer('b', a.backend);
    const ea = a.coord.localInsertText(P1, 'once');
    b.coord.remoteMerge(ea.update!);
    const revAfterFirst = b.store.currentRevision;
    // Re-deliver the same update (e.g. a retried offline send).
    const merge = b.coord.remoteMerge(ea.update!);
    expect(merge).toMatchObject({ ok: true, noop: true });
    expect(b.store.currentRevision).toBe(revAfterFirst); // not applied twice
    expect(paragraphText(b.store.currentModel, P1)).toBe('once');
  });
});

describe('queue mechanics', () => {
  test('enqueue is idempotent; ack removes only acked ids', () => {
    const q = new OfflineQueue();
    const u = (id: string) => ({ envelope: 'update' as const, protocolVersion: 1, documentId: 'd', updateId: id, bytesHex: 'ab' });
    q.enqueue(u('1'));
    q.enqueue(u('1')); // duplicate -> ignored
    q.enqueue(u('2'));
    expect(q.size).toBe(2);
    q.ack(['1']);
    expect(q.size).toBe(1);
    expect(q.drain().map((x) => x.updateId)).toEqual(['2']);
  });
});
