import { describe, expect, test } from 'bun:test';
import {
  ACCEPT_DOC_OP,
  ACCEPT_MODEL_CHANGE,
  ACCEPT_REPLICATION_UPDATE,
  ACCEPT_SNAPSHOT,
  assertAwarenessExcludedFromAuthoredPayload,
  assertFourContractSeparation,
  createDocOpBatch,
  createInternalAnchorEnvelope,
  createModelChange,
  createMutationOrigin,
  createProjectionOrigin,
  createAwarenessOrigin,
  createRedactedAuditIndexRecord,
  createEncryptedReplayJournalEnvelope,
  createReplicationUpdateEnvelope,
  createSnapshotEnvelope,
  createSynchronousTransactionContext,
  DOC_OP_CONTRACT_VERSION,
  isDocOp,
  isModelChange,
  isReplicationUpdate,
  isSnapshot,
  loadYjsSchemaOracle,
  rejectsDocOpAsModelChange,
  rejectsModelChangeAsDocOp,
  rejectsReplicationUpdateAsDocOp,
  rejectsSnapshotAsDocOp,
  snapshotAndValidateDocOp,
  snapshotAndValidateInternalDocOpSingle,
  snapshotAndValidateModelChange,
  snapshotAndValidateReplicationUpdate,
  snapshotAndValidateSnapshot,
  snapshotAndValidateMutationOrigin,
  snapshotAndValidateProjectionOrigin,
  snapshotAndValidateAwarenessOrigin,
  snapshotAndValidateAwarenessState,
  snapshotAndValidateInternalAnchorEnvelope,
  snapshotAndValidateRedactedAuditIndexRecord,
  snapshotAndValidateEncryptedReplayJournalEnvelope,
  type DocOp,
  type DocOpSingle,
  type ModelChange,
} from '../src/contracts';

const yjsOracle = loadYjsSchemaOracle();

function validInsertOp(): DocOpSingle {
  return {
    kind: 'insertText',
    storyId: 'story-body-0',
    blockId: 'block-para-010',
    offset: 2,
    text: 'X',
  };
}

function validDocOpBatch(): DocOp {
  return createDocOpBatch({
    ops: [validInsertOp()],
    transaction: {
      actorId: 'actor-alice',
      sessionId: 'session-alice-1',
      groupId: 'group-alice-1',
      constituentIds: ['op-a-1'],
    },
  });
}

function validModelChange(): ModelChange {
  return createModelChange({
    commitId: 'commit-alice-11',
    constituentIds: ['op-alice-split-11'],
    causalUpdateIds: [],
    revisionBefore: 10,
    revisionAfter: 11,
    structuralRangesBefore: [
      { storyId: 'story-body-0', blockId: 'block-para-010', start: 0, end: 4 },
    ],
    structuralRangesAfter: [
      { storyId: 'story-body-0', blockId: 'block-para-010', start: 0, end: 2 },
      { storyId: 'story-body-0', blockId: 'block-para-010-tail', start: 0, end: 2 },
    ],
    identityMappings: [
      { kind: 'block', beforeId: 'block-para-010', afterId: 'block-para-010' },
    ],
    dirtyDependencies: [{ dependencyKind: 'block', targetId: 'block-para-010' }],
    origin: createMutationOrigin('human', {
      actorId: 'actor-alice',
      sessionId: 'session-alice-1',
    }),
    normalized: true,
    repairEvidence: null,
  });
}

describe('spike contracts — DocOp vocabulary', () => {
  test('supports insert, delete, split, join, bold, and italic single operations', () => {
    const ops: DocOpSingle[] = [
      validInsertOp(),
      {
        kind: 'deleteRange',
        storyId: 'story-body-0',
        blockId: 'block-para-010',
        start: 1,
        end: 3,
      },
      {
        kind: 'splitParagraph',
        storyId: 'story-body-0',
        blockId: 'block-para-010',
        offset: 2,
      },
      {
        kind: 'joinParagraphs',
        storyId: 'story-body-0',
        firstBlockId: 'block-para-010',
        secondBlockId: 'block-para-010-tail',
      },
      {
        kind: 'setMark',
        storyId: 'story-body-0',
        blockId: 'block-para-001',
        mark: 'bold',
        start: 0,
        end: 2,
        enabled: true,
      },
      {
        kind: 'setMark',
        storyId: 'story-body-0',
        blockId: 'block-para-001',
        mark: 'italic',
        start: 1,
        end: 3,
        enabled: false,
      },
    ];
    for (const op of ops) {
      expect(snapshotAndValidateInternalDocOpSingle(op).errors).toEqual([]);
    }
  });

  test('requires batch transaction metadata for multi-op DocOp', () => {
    const batch = validDocOpBatch();
    expect(batch.kind).toBe('batch');
    expect(snapshotAndValidateDocOp(batch).errors).toEqual([]);
    expect(snapshotAndValidateDocOp({ ...batch, transaction: { ...batch.transaction, groupId: '' } }).errors.length).toBeGreaterThan(0);
  });

  test('rejects unknown fields, accessors, prototype keys, and invalid IDs', () => {
    const op = validInsertOp();
    expect(snapshotAndValidateDocOp({ ...op, extra: true }).errors.length).toBeGreaterThan(0);
    expect(
      snapshotAndValidateDocOp({
        kind: 'insertText',
        storyId: 'story-body-0',
        blockId: 'block-para-010',
        offset: 2,
        text: 'X',
        __proto__: { polluted: true },
      }).errors.length
    ).toBeGreaterThan(0);
    expect(
      snapshotAndValidateDocOp({
        kind: 'insertText',
        storyId: '',
        blockId: 'block-para-010',
        offset: 2,
        text: 'X',
      }).errors.length
    ).toBeGreaterThan(0);
    const accessor = Object.defineProperty(
      { kind: 'insertText', storyId: 'story-body-0', blockId: 'block-para-010', offset: 2, text: 'X' },
      'text',
      { get() { return 'X'; }, enumerable: true }
    );
    expect(snapshotAndValidateDocOp(accessor).errors.length).toBeGreaterThan(0);
  });

  test('DocOp contract version is closed and JSON-safe', () => {
    expect(DOC_OP_CONTRACT_VERSION).toBe('doc-op/1');
    expect(JSON.parse(JSON.stringify(validDocOpBatch()))).toBeTruthy();
  });
});

describe('spike contracts — ModelChange notification', () => {
  test('carries commit, constituent IDs, ranges, identity, dirty deps, origin, repair evidence', () => {
    const change = validModelChange();
    expect(snapshotAndValidateModelChange(change).errors).toEqual([]);
    expect(change.commitId).toBe('commit-alice-11');
    expect(change.constituentIds).toEqual(['op-alice-split-11']);
    expect(change.structuralRangesBefore).toHaveLength(1);
    expect(change.identityMappings).toHaveLength(1);
    expect(change.dirtyDependencies).toHaveLength(1);
    expect(change.origin.domain).toBe('mutation');
    expect(change.normalized).toBe(true);
  });

  test('rejects ModelChange disguised as DocOp and vice versa', () => {
    const change = validModelChange();
    const op = validDocOpBatch();
    expect(rejectsModelChangeAsDocOp(change)).toBe(true);
    expect(rejectsDocOpAsModelChange(op)).toBe(true);
    expect(snapshotAndValidateDocOp(change).errors.length).toBeGreaterThan(0);
    expect(snapshotAndValidateModelChange(op).errors.length).toBeGreaterThan(0);
  });

  test('rejects wire-update-shaped payloads as ModelChange', () => {
    const update = createReplicationUpdateEnvelope({
      documentId: yjsOracle.seedRecords.documentId,
      backendVersion: yjsOracle.backendVersion,
      schemaVersion: yjsOracle.schemaVersion,
      checkpoint: 'ckpt-1',
      updateId: 'update-1',
      semanticUpdateId: 'update-1',
      sourceActorId: 'actor-alice',
      sourceReplicaId: 'replica-1',
      sourceSessionId: 'session-1',
      sourceClientId: 1,
      constituentIds: ['op-1'],
      coverage: 'incremental',
      bytes: new Uint8Array([1, 2, 3]),
    });
    expect(snapshotAndValidateModelChange(update).errors.length).toBeGreaterThan(0);
  });
});

describe('spike contracts — opaque replication update and snapshot envelopes', () => {
  test('replication update requires exact envelope fields and defensive byte copy', () => {
    const source = new Uint8Array([9, 8, 7]);
    const update = createReplicationUpdateEnvelope({
      documentId: yjsOracle.seedRecords.documentId,
      backendVersion: yjsOracle.backendVersion,
      schemaVersion: yjsOracle.schemaVersion,
      checkpoint: 'ckpt-remote-1',
      updateId: 'update-remote-12',
      semanticUpdateId: 'update-remote-12',
      sourceActorId: 'actor-bob',
      sourceReplicaId: 'replica-bob',
      sourceSessionId: 'session-bob',
      sourceClientId: 2,
      constituentIds: ['op-bob-insert-12'],
      coverage: 'incremental',
      bytes: source,
    });
    expect(snapshotAndValidateReplicationUpdate(update).errors).toEqual([]);
    source[0] = 0;
    expect(update.bytes[0]).toBe(9);
    expect(rejectsReplicationUpdateAsDocOp(update)).toBe(true);
  });

  test('snapshot requires full coverage envelope and defensive byte copy', () => {
    const source = new Uint8Array([4, 5, 6]);
    const snapshot = createSnapshotEnvelope({
      documentId: yjsOracle.seedRecords.documentId,
      backendVersion: yjsOracle.backendVersion,
      schemaVersion: yjsOracle.schemaVersion,
      normalizationVersion: yjsOracle.normalizationVersion,
      checkpoint: 'ckpt-durable-13',
      bytes: source,
    });
    expect(snapshotAndValidateSnapshot(snapshot).errors).toEqual([]);
    source[0] = 0;
    expect(snapshot.bytes[0]).toBe(4);
    expect(rejectsSnapshotAsDocOp(snapshot)).toBe(true);
    expect(snapshot.coverage).toBe('full');
  });

  test('rejects non-Uint8Array bytes and extra envelope fields', () => {
    const update = createReplicationUpdateEnvelope({
      documentId: yjsOracle.seedRecords.documentId,
      backendVersion: yjsOracle.backendVersion,
      schemaVersion: yjsOracle.schemaVersion,
      checkpoint: 'ckpt-1',
      updateId: 'update-1',
      semanticUpdateId: 'update-1',
      sourceActorId: 'actor-alice',
      sourceReplicaId: 'replica-1',
      sourceSessionId: 'session-1',
      sourceClientId: 1,
      constituentIds: ['op-1'],
      coverage: 'incremental',
      bytes: new Uint8Array([1]),
    });
    expect(
      snapshotAndValidateReplicationUpdate({ ...update, bytes: [1, 2, 3] }).errors.length
    ).toBeGreaterThan(0);
    expect(
      snapshotAndValidateReplicationUpdate({ ...update, wireKind: 'docOp' }).errors.length
    ).toBeGreaterThan(0);
  });
});

describe('spike contracts — origin domains', () => {
  test('mutation, projection, and awareness origins are closed and non-overlapping', () => {
    const mutationKinds = yjsOracle.originTags.mutation;
    const projectionKinds = yjsOracle.originTags.projection;
    const awarenessKinds = yjsOracle.originTags.awareness;
    expect(new Set([...mutationKinds, ...projectionKinds, ...awarenessKinds]).size).toBe(
      mutationKinds.length + projectionKinds.length + awarenessKinds.length
    );

    for (const kind of mutationKinds) {
      const origin =
        kind === 'remote'
          ? createMutationOrigin('remote', {
              actorId: 'actor-bob',
              replicaId: 'replica-bob',
              updateId: 'update-1',
            })
          : kind === 'repair'
            ? createMutationOrigin('repair', {
                actorId: 'actor-alice',
                sessionId: 'session-alice-1',
                repairConstituentId: 'repair-1',
              })
            : createMutationOrigin(kind as 'human', {
                actorId: 'actor-alice',
                sessionId: 'session-alice-1',
              });
      expect(snapshotAndValidateMutationOrigin(origin).errors).toEqual([]);
      expect(origin.domain).toBe('mutation');
    }

    const projection = createProjectionOrigin('binding-reconciliation', {
      changeCommitId: 'commit-alice-11',
    });
    expect(snapshotAndValidateProjectionOrigin(projection).errors).toEqual([]);
    expect(projection.domain).toBe('projection');

    for (const kind of awarenessKinds) {
      const awareness = createAwarenessOrigin(kind as 'presence', { actorId: 'actor-alice' });
      expect(snapshotAndValidateAwarenessOrigin(awareness).errors).toEqual([]);
      expect(awareness.domain).toBe('awareness');
    }
  });

  test('only mutation origins are accepted by ModelChange', () => {
    const change = validModelChange();
    expect(snapshotAndValidateModelChange(change).errors).toEqual([]);
    expect(
      snapshotAndValidateModelChange({
        ...change,
        origin: createProjectionOrigin('binding-reconciliation', { changeCommitId: 'commit-1' }),
      }).errors.length
    ).toBeGreaterThan(0);
    expect(
      snapshotAndValidateModelChange({
        ...change,
        origin: createAwarenessOrigin('presence', { actorId: 'actor-alice' }),
      }).errors.length
    ).toBeGreaterThan(0);
  });
});

describe('spike contracts — awareness exclusion', () => {
  test('awareness state is ephemeral and excluded from authored payloads', () => {
    const awareness = {
      version: 'awareness-state/1',
      actorId: 'actor-alice',
      sessionId: 'session-alice-1',
      presence: { status: 'active' },
      selectionEphemeral: { blockId: 'block-para-010', offset: 2 },
    };
    expect(snapshotAndValidateAwarenessState(awareness).errors).toEqual([]);
    expect(() =>
      assertAwarenessExcludedFromAuthoredPayload({
        authored: { body: {}, capsules: [] },
        awareness,
      })
    ).toThrow(/awareness/);
    expect(() =>
      assertAwarenessExcludedFromAuthoredPayload({
        version: 'snapshot/1',
        documentId: yjsOracle.seedRecords.documentId,
        awareness,
      })
    ).toThrow(/awareness/);
  });
});

describe('spike contracts — internal anchor envelope', () => {
  test('uses frozen trusted fields and opaque bytes separate from external DocRange', () => {
    const anchor = createInternalAnchorEnvelope({
      documentId: yjsOracle.seedRecords.documentId,
      backendVersion: yjsOracle.backendVersion,
      schemaVersion: yjsOracle.schemaVersion,
      checkpoint: 'ckpt-anchor-1',
      affinity: 'before',
      relativeBytes: new Uint8Array([0xde, 0xad]),
    });
    expect(snapshotAndValidateInternalAnchorEnvelope(anchor).errors).toEqual([]);
    expect(anchor.version).toBe(yjsOracle.anchorEnvelope.version);
    expect(yjsOracle.anchorEnvelope.trustedFields.sort()).toEqual([
      'affinity',
      'backendVersion',
      'checkpoint',
      'documentId',
      'relativeBytes',
      'schemaVersion',
    ]);
    expect('start' in anchor).toBe(false);
    expect('end' in anchor).toBe(false);
  });
});

describe('spike contracts — synchronous transaction context types', () => {
  test('declares actor/session/group IDs and typed rejection reasons', () => {
    const ctx = createSynchronousTransactionContext({
      actorId: 'actor-alice',
      sessionId: 'session-alice-1',
      groupId: 'group-alice-1',
      transactionId: 'txn-1',
      origin: createMutationOrigin('human', {
        actorId: 'actor-alice',
        sessionId: 'session-alice-1',
      }),
    });
    expect(ctx.actorId).toBe('actor-alice');
    expect(ctx.rejectionReasons).toEqual(['async-callback', 'nested-transaction', 'reentrant-transaction']);
  });
});

describe('spike contracts — audit index vs replay journal', () => {
  test('redacted audit index excludes raw text and projection/awareness', () => {
    const record = createRedactedAuditIndexRecord({
      sequence: 13,
      commitId: 'commit-alice-13',
      constituentIds: ['op-alice-undo-13'],
      originKind: 'undo',
      actorId: 'actor-alice',
      retentionPolicyId: 'retention-audit-index-30d',
      payloadSchemaVersion: 'audit-index-payload/1',
    });
    expect(snapshotAndValidateRedactedAuditIndexRecord(record).errors).toEqual([]);
    expect('rawText' in record).toBe(false);
    expect('projection' in record).toBe(false);
    expect('awareness' in record).toBe(false);
  });

  test('encrypted replay journal envelope is distinct with retention and authorization metadata', () => {
    const journal = createEncryptedReplayJournalEnvelope({
      sequence: 13,
      commitId: 'commit-alice-13',
      payloadSchemaVersion: 'replay-journal-payload/1',
      retentionPolicyId: 'retention-replay-90d',
      authorizationPolicyId: 'authz-replay-test',
      encryptedPayload: new Uint8Array([0x01, 0x02]),
    });
    expect(snapshotAndValidateEncryptedReplayJournalEnvelope(journal).errors).toEqual([]);
    expect(journal.version).toBe('replay-journal/1');
    expect(journal.encryptedPayload).toBeInstanceOf(Uint8Array);
    expect(journal.version).not.toBe('audit-index/1');
  });
});

describe('spike contracts — four-contract separation guards', () => {
  test('accept helpers and runtime guards distinguish all four contracts', () => {
    const op = validDocOpBatch();
    const change = validModelChange();
    const update = createReplicationUpdateEnvelope({
      documentId: yjsOracle.seedRecords.documentId,
      backendVersion: yjsOracle.backendVersion,
      schemaVersion: yjsOracle.schemaVersion,
      checkpoint: 'ckpt-1',
      updateId: 'update-1',
      semanticUpdateId: 'update-1',
      sourceActorId: 'actor-alice',
      sourceReplicaId: 'replica-1',
      sourceSessionId: 'session-1',
      sourceClientId: 1,
      constituentIds: ['op-1'],
      coverage: 'incremental',
      bytes: new Uint8Array([1]),
    });
    const snapshot = createSnapshotEnvelope({
      documentId: yjsOracle.seedRecords.documentId,
      backendVersion: yjsOracle.backendVersion,
      schemaVersion: yjsOracle.schemaVersion,
      normalizationVersion: yjsOracle.normalizationVersion,
      checkpoint: 'ckpt-1',
      bytes: new Uint8Array([2]),
    });

    expect(isDocOp(op)).toBe(true);
    expect(isModelChange(change)).toBe(true);
    expect(isReplicationUpdate(update)).toBe(true);
    expect(isSnapshot(snapshot)).toBe(true);

    expect(ACCEPT_DOC_OP(op)).toBe(op);
    expect(ACCEPT_MODEL_CHANGE(change)).toBe(change);
    expect(ACCEPT_REPLICATION_UPDATE(update)).toBe(update);
    expect(ACCEPT_SNAPSHOT(snapshot)).toBe(snapshot);

    assertFourContractSeparation({ op, change, update, snapshot });
    expect(() => ACCEPT_DOC_OP(change)).toThrow();
    expect(() => ACCEPT_MODEL_CHANGE(op)).toThrow();
    expect(() => ACCEPT_REPLICATION_UPDATE(op)).toThrow();
    expect(() => ACCEPT_SNAPSHOT(change)).toThrow();
  });
});

describe('spike contracts — no ProseMirror surface outside binding', () => {
  test('contracts modules do not import prosemirror', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const root = join(import.meta.dir, '../src/contracts');
    const paths: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (full.endsWith('.ts')) paths.push(full);
      }
    };
    walk(root);
    expect(paths.length).toBeGreaterThan(0);
    const combined = paths.map((path) => readFileSync(path, 'utf8')).join('\n');
    expect(combined).not.toMatch(/prosemirror|EditorState|EditorView|Step\b/);
  });
});
