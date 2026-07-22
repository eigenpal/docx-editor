/** @spike-features yjs-backend */
import * as Y from 'yjs';
import { canonicalJson } from '../../canonical-json';
import { compareYjsSchema } from '../../comparators/yjs-schema-fingerprint';
import { createDocOpBatch, type DocOpSingle } from '../../contracts/doc-op';
import { createMutationOrigin } from '../../contracts/origins';
import type { ReplicationUpdateEnvelope } from '../../contracts/replication-update';
import { fingerprintAuthoredModel } from '../../model/fingerprint';
import { createFrozenAuthoredFixture } from '../../model/fixture';
import {
  createReplicationCoordinator,
  type ReplicationCoordinator,
} from '../replication-coordinator';
import type { ReplicationStateProbe } from './conformance';

export function validateYjsStateVectorDelta(input: {
  readonly before: ReplicationStateProbe;
  readonly after: ReplicationStateProbe;
  readonly updateBytes: Uint8Array;
}): boolean {
  try {
    const replay = new Y.Doc({ gc: false });
    replay.getMap('root');
    Y.applyUpdate(replay, input.before.fullState);
    Y.applyUpdate(replay, input.updateBytes);
    const root = replay.share.get('root');
    if (
      replay.share.size !== 1 ||
      !(root instanceof Y.Map) ||
      !(root.get('meta') instanceof Y.Map) ||
      !(root.get('storyOrder') instanceof Y.Array) ||
      !(root.get('stories') instanceof Y.Map) ||
      !(root.get('blocks') instanceof Y.Map) ||
      !(root.get('texts') instanceof Y.Map) ||
      !(root.get('marks') instanceof Y.Map) ||
      !(root.get('capsules') instanceof Y.Map) ||
      !(root.get('allocator') instanceof Y.Map)
    ) {
      return false;
    }
    return bytesEqual(Y.encodeStateVector(replay), input.after.stateVector);
  } catch {
    return false;
  }
}

export function validateYjsCausalReverseDelivery(): boolean {
  try {
    const sender = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-conformance-causal-sender',
    });
    const update1 = localUpdate(sender, 'replica-conformance-causal-sender', 'op-causal-1', {
      kind: 'insertText',
      storyId: 'story-body-0',
      blockId: 'block-para-010',
      offset: 0,
      text: 'A',
    });
    const update2 = localUpdate(sender, 'replica-conformance-causal-sender', 'op-causal-2', {
      kind: 'insertText',
      storyId: 'story-body-0',
      blockId: 'block-para-010',
      offset: 1,
      text: 'B',
    });
    const receiver = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-conformance-causal-receiver',
    });
    let notifications = 0;
    receiver.subscribeModel(() => {
      notifications += 1;
    });
    const notificationCount = () => notifications;
    return (
      remoteStatus(receiver, update2) === 'buffered' &&
      notificationCount() === 0 &&
      remoteStatus(receiver, update1) === 'applied' &&
      notificationCount() === 1 &&
      contentFingerprint(receiver) === contentFingerprint(sender)
    );
  } catch {
    return false;
  }
}

export function validateYjsSameActorConvergence(): boolean {
  try {
    const left = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-conformance-shared-left',
    });
    const right = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-conformance-shared-right',
    });
    const split = localUpdate(left, 'replica-conformance-shared-left', 'op-shared-split', {
      kind: 'splitParagraph',
      storyId: 'story-body-0',
      blockId: 'block-para-010',
      offset: 2,
    });
    const mark = localUpdate(right, 'replica-conformance-shared-right', 'op-shared-mark', {
      kind: 'setMark',
      storyId: 'story-body-0',
      blockId: 'block-para-010',
      mark: 'italic',
      start: 1,
      end: 4,
      enabled: true,
    });
    const leftResult = applyRemote(left, mark);
    const rightResult = applyRemote(right, split);
    const repairs = [leftResult, rightResult].flatMap((result) =>
      result.status === 'applied' && result.replicationUpdate
        ? [result.replicationUpdate]
        : []
    );
    for (const repair of repairs) {
      if (!repair) continue;
      applyRemote(left, repair);
      applyRemote(right, repair);
    }
    return (
      contentFingerprint(left) === contentFingerprint(right) &&
      compareYjsSchema(left.inspectYjsModel(), right.inspectYjsModel()).equal
    );
  } catch {
    return false;
  }
}

export function validateYjsClientCollisionReseed(): boolean {
  try {
    const knownLeft = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-hash-12470',
    });
    const knownRight = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-hash-87223',
    });
    if (
      knownLeft.inspectReplicationState().clientId ===
      knownRight.inspectReplicationState().clientId
    ) {
      return false;
    }
    const collisionClient = 1_679_832_501;
    const left = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-hash-12470',
      sessionId: 'session-conformance-collision-left',
      clientId: collisionClient,
    });
    const right = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-hash-87223',
      sessionId: 'session-conformance-collision-right',
      clientId: collisionClient,
    });
    const leftUpdate = localUpdate(
      left,
      'replica-hash-12470',
      'op-conformance-collision-left',
      {
        kind: 'insertText',
        storyId: 'story-body-0',
        blockId: 'block-para-010',
        offset: 0,
        text: 'A',
      }
    );
    const rightUpdate = localUpdate(
      right,
      'replica-hash-87223',
      'op-conformance-collision-right',
      {
        kind: 'insertText',
        storyId: 'story-body-0',
        blockId: 'block-para-010',
        offset: 1,
        text: 'B',
      }
    );
    const receiver = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-conformance-collision-receiver',
    });
    if (
      applyRemote(receiver, leftUpdate).status !== 'applied' ||
      applyRemote(receiver, rightUpdate).status !== 'clientCollision'
    ) {
      return false;
    }
    const reseeded = right.reseedLocalUpdate(rightUpdate.updateId, {
      clientId: collisionClient + 1,
      sessionId: 'session-conformance-collision-reseed',
    });
    if (
      reseeded.status !== 'reseeded' ||
      applyRemote(receiver, reseeded.update).status !== 'applied'
    ) {
      return false;
    }
    const text =
      receiver.model.authored.body.paragraphs.get('para-010')?.text ?? '';
    return text.includes('A') && text.includes('B');
  } catch {
    return false;
  }
}

export function validateYjsCommitIdUniqueness(): boolean {
  try {
    const actor = 'actor-conformance-shared';
    const left = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-conformance-commit-left',
      sessionId: 'session-conformance-commit-left',
      clientId: 2_310_000_001,
    });
    const right = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-conformance-commit-right',
      sessionId: 'session-conformance-commit-right',
      clientId: 2_310_000_002,
    });
    localUpdate(left, 'replica-conformance-commit-left', 'op-conformance-commit-left', {
      kind: 'splitParagraph',
      storyId: 'story-body-0',
      blockId: 'block-para-010',
      offset: 2,
    });
    localUpdate(
      right,
      'replica-conformance-commit-right',
      'op-conformance-commit-right',
      {
        kind: 'splitParagraph',
        storyId: 'story-body-0',
        blockId: 'block-para-010',
        offset: 2,
      }
    );
    const leftCommit = left.inspectState().coverage.commitIds.at(-1);
    const rightCommit = right.inspectState().coverage.commitIds.at(-1);
    return (
      actor === 'actor-conformance-shared' &&
      leftCommit !== undefined &&
      rightCommit !== undefined &&
      leftCommit !== rightCommit
    );
  } catch {
    return false;
  }
}

export function validateYjsBufferedAttribution(): boolean {
  try {
    const sender = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-conformance-attribution-sender',
    });
    const first = localUpdate(
      sender,
      'replica-conformance-attribution-sender',
      'op-conformance-attribution-1',
      {
        kind: 'insertText',
        storyId: 'story-body-0',
        blockId: 'block-para-010',
        offset: 0,
        text: 'A',
      }
    );
    const second = localUpdate(
      sender,
      'replica-conformance-attribution-sender',
      'op-conformance-attribution-2',
      {
        kind: 'insertText',
        storyId: 'story-body-0',
        blockId: 'block-para-010',
        offset: 1,
        text: 'B',
      }
    );
    const receiver = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-conformance-attribution-receiver',
    });
    if (applyRemote(receiver, second).status !== 'buffered') return false;
    const result = applyRemote(receiver, first);
    return (
      result.status === 'applied' &&
      equalStrings(result.change.causalUpdateIds, [first.updateId, second.updateId].sort()) &&
      equalStrings(result.change.constituentIds, [
        'op-conformance-attribution-1',
        'op-conformance-attribution-2',
      ])
    );
  } catch {
    return false;
  }
}

export function validateYjsPendingQuotas(): boolean {
  try {
    const sender = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-conformance-quota-sender',
    });
    const updates: ReplicationUpdateEnvelope[] = [];
    for (let index = 0; index < 10; index += 1) {
      updates.push(
        localUpdate(
          sender,
          'replica-conformance-quota-sender',
          `op-conformance-quota-${index}`,
          {
            kind: 'insertText',
            storyId: 'story-body-0',
            blockId: 'block-para-010',
            offset: index,
            text: 'Q',
          }
        )
      );
    }
    const receiver = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-conformance-quota-receiver',
    });
    for (const update of updates.slice(2).reverse()) {
      if (applyRemote(receiver, update).status !== 'buffered') return false;
    }
    const rejected = applyRemote(receiver, updates[1]!);
    if (rejected.status !== 'failed' || rejected.code !== 'pending-quota') {
      return false;
    }
    return receiver.inspectReplicationState().pendingUpdateCount === 8;
  } catch {
    return false;
  }
}

export function validateYjsLosslessReseedJournal(): boolean {
  try {
    const clientId = 1_679_832_501;
    const accepted = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-conformance-journal-accepted',
      clientId,
    });
    const retrying = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-conformance-journal-retrying',
      clientId,
    });
    const acceptedUpdate = localUpdate(
      accepted,
      'replica-conformance-journal-accepted',
      'op-conformance-journal-accepted',
      {
        kind: 'insertText',
        storyId: 'story-body-0',
        blockId: 'block-para-010',
        offset: 0,
        text: 'A',
      }
    );
    const first = localUpdate(
      retrying,
      'replica-conformance-journal-retrying',
      'op-conformance-journal-first',
      {
        kind: 'insertText',
        storyId: 'story-body-0',
        blockId: 'block-para-010',
        offset: 0,
        text: 'B',
      }
    );
    const remoteSource = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-conformance-journal-remote',
      clientId: clientId + 100,
    });
    const remoteInterleave = localUpdate(
      remoteSource,
      'replica-conformance-journal-remote',
      'op-conformance-journal-remote',
      {
        kind: 'insertText',
        storyId: 'story-body-0',
        blockId: 'block-para-010',
        offset: 0,
        text: 'R',
      },
      'actor-conformance-remote'
    );
    if (applyRemote(retrying, remoteInterleave).status !== 'applied') return false;
    const second = localUpdate(
      retrying,
      'replica-conformance-journal-retrying',
      'op-conformance-journal-second',
      {
        kind: 'insertText',
        storyId: 'story-body-0',
        blockId: 'block-para-010',
        offset: 1,
        text: 'C',
      }
    );
    const receiver = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-conformance-journal-receiver',
    });
    if (
      applyRemote(receiver, acceptedUpdate).status !== 'applied' ||
      applyRemote(receiver, remoteInterleave).status !== 'applied' ||
      applyRemote(receiver, second).status !== 'clientCollision'
    ) {
      return false;
    }
    const replay = retrying.reseedLocalUpdate(second.updateId, {
      clientId: clientId + 1,
      sessionId: 'session-conformance-journal-reseed',
    });
    if (
      replay.status !== 'reseeded' ||
      replay.updates.length !== 2 ||
      replay.updates[0]!.semanticUpdateId !== first.semanticUpdateId
    ) {
      return false;
    }
    if (
      applyRemote(receiver, replay.updates[0]!).status !== 'applied' ||
      applyRemote(receiver, replay.updates[1]!).status !== 'applied' ||
      applyRemote(receiver, second).status !== 'duplicate'
    ) {
      return false;
    }
    return (
      receiver.model.authored.body.paragraphs.get('para-010')?.text.includes('R') === true
    );
  } catch {
    return false;
  }
}

export function validateYjsIndependentPendingChains(): boolean {
  try {
    const sourceA = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-conformance-chain-a',
    });
    const sourceB = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-conformance-chain-b',
    });
    const a1 = localUpdate(sourceA, 'replica-conformance-chain-a', 'op-chain-a1', {
      kind: 'insertText',
      storyId: 'story-body-0',
      blockId: 'block-para-010',
      offset: 0,
      text: 'A',
    });
    const a2 = localUpdate(sourceA, 'replica-conformance-chain-a', 'op-chain-a2', {
      kind: 'insertText',
      storyId: 'story-body-0',
      blockId: 'block-para-010',
      offset: 1,
      text: 'a',
    });
    const b1 = localUpdate(sourceB, 'replica-conformance-chain-b', 'op-chain-b1', {
      kind: 'insertText',
      storyId: 'story-body-0',
      blockId: 'block-para-010',
      offset: 0,
      text: 'B',
    });
    const b2 = localUpdate(sourceB, 'replica-conformance-chain-b', 'op-chain-b2', {
      kind: 'insertText',
      storyId: 'story-body-0',
      blockId: 'block-para-010',
      offset: 1,
      text: 'b',
    });
    const receiver = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-conformance-chain-receiver',
    });
    if (
      applyRemote(receiver, a2).status !== 'buffered' ||
      applyRemote(receiver, b2).status !== 'buffered'
    ) {
      return false;
    }
    const resolvedA = applyRemote(receiver, a1);
    if (
      resolvedA.status !== 'applied' ||
      !equalStrings(resolvedA.change.causalUpdateIds, [a1.updateId, a2.updateId].sort()) ||
      !equalStrings(receiver.inspectReplicationState().bufferedUpdateIds, [b2.updateId])
    ) {
      return false;
    }
    const resolvedB = applyRemote(receiver, b1);
    return (
      resolvedB.status === 'applied' &&
      equalStrings(resolvedB.change.causalUpdateIds, [b1.updateId, b2.updateId].sort())
    );
  } catch {
    return false;
  }
}

export function validateYjsSnapshotResyncRecovery(): boolean {
  try {
    const sender = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-conformance-resync-sender',
      clientId: 3_010_000_001,
    });
    const updates = Array.from({ length: 10 }, (_, index) =>
      localUpdate(
        sender,
        'replica-conformance-resync-sender',
        `op-conformance-resync-${index}`,
        {
          kind: 'insertText',
          storyId: 'story-body-0',
          blockId: 'block-para-010',
          offset: index,
          text: 'S',
        }
      )
    );
    const recovery = sender.reseedLocalUpdate(updates[0]!.semanticUpdateId, {
      clientId: 3_010_000_002,
      sessionId: 'session-conformance-resync',
    });
    if (recovery.status !== 'fullSnapshotResyncRequired') return false;
    const receiver = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-conformance-resync-receiver',
      authorizeSnapshotResync: () => true,
    });
    if (receiver.applySnapshotResync(recovery).status !== 'applied') return false;
    const divergent = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-conformance-resync-divergent',
      authorizeSnapshotResync: () => true,
    });
    localUpdate(
      divergent,
      'replica-conformance-resync-divergent',
      'op-conformance-resync-divergent',
      {
        kind: 'insertText',
        storyId: 'story-body-0',
        blockId: 'block-para-010',
        offset: 0,
        text: 'D',
      }
    );
    const before = divergent.inspectState();
    const refused = divergent.applySnapshotResync(recovery);
    return (
      refused.status === 'conflict' &&
      canonicalJson(divergent.inspectState()) === canonicalJson(before)
    );
  } catch {
    return false;
  }
}

export function validateYjsStructuralTextConservation(): boolean {
  try {
    const left = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-conformance-conserve-left',
    });
    const right = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-conformance-conserve-right',
    });
    const leftUpdate = localUpdate(
      left,
      'replica-conformance-conserve-left',
      'op-conformance-conserve-left',
      {
        kind: 'splitParagraph',
        storyId: 'story-body-0',
        blockId: 'block-para-010',
        offset: 1,
      }
    );
    const rightUpdate = localUpdate(
      right,
      'replica-conformance-conserve-right',
      'op-conformance-conserve-right',
      {
        kind: 'splitParagraph',
        storyId: 'story-body-0',
        blockId: 'block-para-010',
        offset: 3,
      }
    );
    if (
      applyRemote(left, rightUpdate).status !== 'applied' ||
      applyRemote(right, leftUpdate).status !== 'applied'
    ) {
      return false;
    }
    return [left, right].every((replica) =>
      replica.model.authored.body.paragraphOrder
        .map((id) => replica.model.authored.body.paragraphs.get(id)!)
        .filter((paragraph) => paragraph.paragraphId.startsWith('para-010'))
        .map((paragraph) => paragraph.text)
        .join('') === 'p010'
    );
  } catch {
    return false;
  }
}

export function validateYjsPendingDeleteReverseDelivery(): boolean {
  try {
    const inserter = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-conformance-delete-inserter',
    });
    const deleter = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-conformance-delete-deleter',
    });
    const insert = localUpdate(
      inserter,
      'replica-conformance-delete-inserter',
      'op-conformance-delete-insert',
      {
        kind: 'insertText',
        storyId: 'story-body-0',
        blockId: 'block-para-010',
        offset: 0,
        text: 'Z',
      },
      'actor-conformance-insert'
    );
    const integrated = applyRemote(deleter, insert);
    if (integrated.status !== 'applied') return false;
    const deletion = localUpdate(
      deleter,
      'replica-conformance-delete-deleter',
      'op-conformance-delete',
      {
        kind: 'deleteRange',
        storyId: 'story-body-0',
        blockId: 'block-para-010',
        start: 0,
        end: 1,
      },
      'actor-conformance-delete'
    );
    const receiver = createReplicationCoordinator(createFrozenAuthoredFixture(), {
      replicaId: 'replica-conformance-delete-receiver',
    });
    if (applyRemote(receiver, deletion).status !== 'buffered') return false;
    const prerequisite = applyRemote(receiver, insert);
    if (prerequisite.status !== 'applied' && prerequisite.status !== 'buffered') {
      return false;
    }
    if (
      integrated.replicationUpdate &&
      !['applied', 'duplicate'].includes(
        applyRemote(receiver, integrated.replicationUpdate).status
      )
    ) {
      return false;
    }
    return (
      receiver.model.authored.body.paragraphs.get('para-010')?.text === 'p010'
    );
  } catch {
    return false;
  }
}

function localUpdate(
  coordinator: ReplicationCoordinator,
  replicaId: string,
  constituentId: string,
  op: DocOpSingle,
  actorId = 'actor-conformance-shared'
): ReplicationUpdateEnvelope {
  const sessionId = `${replicaId}-session`;
  const result = coordinator.applyLocal(
    createDocOpBatch({
      ops: [op],
      transaction: {
        actorId,
        sessionId,
        groupId: `${replicaId}-group`,
        constituentIds: [constituentId],
      },
    }),
    createMutationOrigin('human', { actorId, sessionId })
  );
  if (result.status !== 'applied' || !result.replicationUpdate) {
    throw new TypeError('conformance local update failed');
  }
  return result.replicationUpdate;
}

function applyRemote(
  coordinator: ReplicationCoordinator,
  update: ReplicationUpdateEnvelope
) {
  return coordinator.applyRemote(
    update,
    createMutationOrigin('remote', {
      actorId: update.sourceActorId,
      replicaId: update.sourceReplicaId,
      sessionId: update.sourceSessionId,
      updateId: update.updateId,
    })
  );
}

function remoteStatus(
  coordinator: ReplicationCoordinator,
  update: ReplicationUpdateEnvelope
) {
  return applyRemote(coordinator, update).status;
}

function contentFingerprint(coordinator: ReplicationCoordinator): string {
  return fingerprintAuthoredModel({ authored: coordinator.model.authored, revision: 0 });
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function equalStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
