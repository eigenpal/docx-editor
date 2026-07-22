/** @spike-features yjs-backend */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as Y from 'yjs';
import {
  createDocOpBatch,
  createFrozenAuthoredFixture,
  createMutationOrigin,
  createReplicationCoordinator,
  createReplicationUpdateEnvelope,
  createSnapshotEnvelope,
  createYjsStoreBackend,
  fingerprintAuthoredModel,
  restoreYjsStoreBackend,
} from '../src';
import * as docAccess from '../src/store/yjs/doc-access';
import {
  bootstrapYjsDocFromModel,
  deriveAuthoredPackageFromYjs,
} from '../src/store/yjs/doc';
import type { YjsDocState } from '../src/store/yjs/doc-types';

const STORY = 'story-body-0';

function applyInsert(
  backend: ReturnType<typeof createYjsStoreBackend>,
  constituentId = 'op-redesign-insert'
) {
  const staged = backend.stageLocalMutation({
    ops: [
      {
        kind: 'insertText',
        storyId: STORY,
        blockId: 'block-para-010',
        offset: 0,
        text: '!',
      },
    ],
    constituentIds: [constituentId],
    actorId: 'actor-alice',
  });
  expect(staged.status).toBe('staged');
  if (staged.status !== 'staged') throw new Error('expected staged mutation');
  backend.commitStagedMutation(staged.staged, {
    actorId: 'actor-alice',
    constituentIds: [constituentId],
  });
}

function decodeSnapshot(snapshot: ReturnType<ReturnType<typeof createYjsStoreBackend>['encodeSnapshot']>) {
  return JSON.parse(new TextDecoder().decode(snapshot.bytes)) as Record<string, unknown>;
}

function hexBytes(value: unknown): Uint8Array {
  if (typeof value !== 'string' || value.length % 2 !== 0) {
    throw new TypeError('expected hex bytes');
  }
  return Uint8Array.from(
    Array.from({ length: value.length / 2 }, (_, index) =>
      Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
    )
  );
}

describe('task 2.2 redesign adversarial probes', () => {
  test('uses one top-level root map with actual integrated nested Yjs containers', () => {
    const model = createFrozenAuthoredFixture();
    const state = bootstrapYjsDocFromModel(
      model.authored,
      'doc-redesign-root',
      fingerprintAuthoredModel(model)
    );
    expect([...state.doc.share.keys()]).toEqual(['root']);
    const root = state.doc.share.get('root');
    expect(root).toBeInstanceOf(Y.Map);
    if (!(root instanceof Y.Map)) return;
    expect(root.get('meta')).toBeInstanceOf(Y.Map);
    expect(root.get('storyOrder')).toBeInstanceOf(Y.Array);
    expect(root.get('stories')).toBeInstanceOf(Y.Map);
    expect(root.get('blocks')).toBeInstanceOf(Y.Map);
    expect(root.get('texts')).toBeInstanceOf(Y.Map);
    expect(root.get('marks')).toBeInstanceOf(Y.Map);
    expect(root.get('capsules')).toBeInstanceOf(Y.Map);
    expect(root.get('allocator')).toBeInstanceOf(Y.Map);
  });

  test('derives every canonical field from a raw Yjs clone without process-local caches', () => {
    const model = createFrozenAuthoredFixture();
    const seeded = bootstrapYjsDocFromModel(
      model.authored,
      'doc-redesign-derive',
      fingerprintAuthoredModel(model)
    );
    const clonedDoc = new Y.Doc({ gc: false });
    clonedDoc.getMap('root');
    Y.applyUpdate(clonedDoc, Y.encodeStateAsUpdate(seeded.doc));
    const rawClone: YjsDocState = Object.freeze({
      doc: clonedDoc,
      documentId: seeded.documentId,
      checkpoint: seeded.checkpoint,
    });
    const derived = deriveAuthoredPackageFromYjs(rawClone);
    expect(
      fingerprintAuthoredModel({ authored: derived, revision: model.revision })
    ).toBe(fingerprintAuthoredModel(model));
    expect(derived.body.paragraphs.get('para-002')?.authoredProperties).toEqual(
      model.authored.body.paragraphs.get('para-002')?.authoredProperties
    );
    expect(derived.capsules[0]).toEqual(model.authored.capsules[0]);

    const cacheSource = readFileSync(
      join(import.meta.dir, '../src/store/yjs/doc-caches.ts'),
      'utf8'
    );
    expect(cacheSource).not.toMatch(/WeakMap/);
  });

  test('uses random default clients and preserves explicit session client IDs', () => {
    const factory = (
      docAccess as unknown as {
        createReplicaYjsDoc?: (input: {
          documentId: string;
          replicaId: string;
          clientId?: number;
        }) => Y.Doc;
      }
    ).createReplicaYjsDoc;
    expect(typeof factory).toBe('function');
    if (!factory) return;
    const left = factory({ documentId: 'doc-client-id', replicaId: 'replica-left' });
    const leftAgain = factory({
      documentId: 'doc-client-id',
      replicaId: 'replica-left',
    });
    const right = factory({ documentId: 'doc-client-id', replicaId: 'replica-right' });
    expect(left.clientID).not.toBe(leftAgain.clientID);
    expect(left.clientID).not.toBe(0);
    expect(right.clientID).not.toBe(0);
    expect(left.clientID).not.toBe(right.clientID);
    const ids = new Set<number>();
    for (let index = 0; index < 1024; index += 1) {
      ids.add(
        factory({
          documentId: 'doc-client-id',
          replicaId: `replica-collision-${index}`,
          clientId: index + 1,
        }).clientID
      );
    }
    expect(ids.size).toBe(1024);
  });

  test('replicas clone one identical seed state before unique local structs', () => {
    const left = createYjsStoreBackend(createFrozenAuthoredFixture(), {
      documentId: 'doc-identical-seed',
      replicaId: 'replica-seed-left',
    });
    const right = createYjsStoreBackend(createFrozenAuthoredFixture(), {
      documentId: 'doc-identical-seed',
      replicaId: 'replica-seed-right',
    });
    expect(left.inspectReplicationState().clientId).not.toBe(
      right.inspectReplicationState().clientId
    );
    expect([...left.inspectReplicationState().fullState]).toEqual([
      ...right.inspectReplicationState().fullState,
    ]);
  });

  test('emits a true state-vector delta materially smaller than full state', () => {
    const backend = createYjsStoreBackend(createFrozenAuthoredFixture(), {
      documentId: 'doc-redesign-delta',
      actorId: 'actor-alice',
      replicaId: 'replica-delta',
    });
    const before = decodeSnapshot(backend.encodeSnapshot());
    applyInsert(backend);
    const update = backend.encodeReplicationUpdate();
    const after = decodeSnapshot(backend.encodeSnapshot());
    const fullAfter = hexBytes(after.yjsUpdateHex);
    expect(update.bytes.length * 4).toBeLessThan(fullAfter.length);

    const replay = new Y.Doc({ gc: false });
    replay.getMap('root');
    Y.applyUpdate(replay, hexBytes(before.yjsUpdateHex));
    Y.applyUpdate(replay, update.bytes);
    expect([...Y.encodeStateVector(replay)]).toEqual([
      ...Y.encodeStateVectorFromUpdate(fullAfter),
    ]);
  });

  test('snapshot restore rejects canonical/Yjs split-brain before publication', () => {
    const backend = createYjsStoreBackend(createFrozenAuthoredFixture(), {
      documentId: 'doc-redesign-snapshot',
      actorId: 'actor-alice',
      replicaId: 'replica-snapshot',
    });
    applyInsert(backend);
    const snapshot = backend.encodeSnapshot();
    const payload = decodeSnapshot(snapshot);
    payload.yjsUpdateHex = payload.initialYjsUpdateHex;
    const tampered = createSnapshotEnvelope({
      documentId: snapshot.documentId,
      backendVersion: snapshot.backendVersion,
      schemaVersion: snapshot.schemaVersion,
      normalizationVersion: snapshot.normalizationVersion,
      checkpoint: snapshot.checkpoint,
      bytes: new TextEncoder().encode(JSON.stringify(payload)),
    });
    expect(() => restoreYjsStoreBackend(tampered)).toThrow(
      /canonical|fingerprint|Yjs/i
    );
  });

  test('mixed covered and new constituent IDs reject the whole remote update', () => {
    const sender = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-overlap-sender',
    });
    const receiver = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-overlap-receiver',
    });
    const first = sender.applyLocal(
      createDocOpBatch({
        ops: [
          {
            kind: 'insertText',
            storyId: STORY,
            blockId: 'block-para-010',
            offset: 0,
            text: 'A',
          },
        ],
        transaction: {
          actorId: 'actor-alice',
          sessionId: 'session-alice',
          groupId: 'group-alice',
          constituentIds: ['op-covered'],
        },
      }),
      createMutationOrigin('human', {
        actorId: 'actor-alice',
        sessionId: 'session-alice',
      })
    );
    expect(first.status).toBe('applied');
    if (first.status !== 'applied' || !first.replicationUpdate) return;
    expect(
      receiver.applyRemote(
        first.replicationUpdate,
        createMutationOrigin('remote', {
          actorId: 'actor-alice',
          replicaId: first.replicationUpdate.sourceReplicaId,
          updateId: first.replicationUpdate.updateId,
        })
      ).status
    ).toBe('applied');

    const second = sender.applyLocal(
      createDocOpBatch({
        ops: [{
          kind: 'insertText',
          storyId: STORY,
          blockId: 'block-para-010',
          offset: 1,
          text: 'B',
        }],
        transaction: {
          actorId: 'actor-alice',
          sessionId: 'session-alice',
          groupId: 'group-alice',
          constituentIds: ['op-new'],
        },
      }),
      createMutationOrigin('human', {
        actorId: 'actor-alice',
        sessionId: 'session-alice',
      })
    );
    expect(second.status).toBe('applied');
    if (second.status !== 'applied' || !second.replicationUpdate) return;
    const mixed = createReplicationUpdateEnvelope({
      documentId: second.replicationUpdate.documentId,
      backendVersion: second.replicationUpdate.backendVersion,
      schemaVersion: second.replicationUpdate.schemaVersion,
      checkpoint: second.replicationUpdate.checkpoint,
      updateId: 'update-mixed-overlap',
      semanticUpdateId: 'update-mixed-overlap',
      sourceActorId: second.replicationUpdate.sourceActorId,
      sourceReplicaId: second.replicationUpdate.sourceReplicaId,
      sourceSessionId: second.replicationUpdate.sourceSessionId,
      sourceClientId: second.replicationUpdate.sourceClientId,
      constituentIds: ['op-covered', 'op-new'],
      coverage: 'incremental',
      bytes: second.replicationUpdate.bytes,
    });
    const before = receiver.inspectState();
    expect(
      receiver.applyRemote(
        mixed,
        createMutationOrigin('remote', {
          actorId: 'actor-alice',
          replicaId: mixed.sourceReplicaId,
          updateId: mixed.updateId,
        })
      ).status
    ).toBe('failed');
    expect(receiver.inspectState()).toEqual(before);
    expect(receiver.inspectState().coverage.constituentIds).not.toContain('op-new');
  });
});
