/** @spike-features yjs-backend, origin-metadata, insert-delete-split-join-operations */
import { isDocOp, type DocOp } from '../contracts/doc-op';
import { createModelChange } from '../contracts/model-change';
import {
  createMutationOrigin,
  snapshotAndValidateMutationOrigin,
  type MutationOrigin,
} from '../contracts/origins';
import {
  isReplicationUpdate,
  snapshotAndValidateReplicationUpdate,
  type ReplicationUpdateEnvelope,
} from '../contracts/replication-update';
import type { DecodedYjsModel } from '../comparators/yjs-schema-fingerprint';
import type { DocumentModel } from '../model/types';
import type {
  ModelChangeSubscriber,
  NotificationDiagnostic,
  SubscriberError,
} from './apply-result';
import {
  createYjsStoreBackend,
  restoreYjsStoreBackend,
  type YjsStoreBackend,
  type YjsReplicationInspection,
  type YjsReseedResult,
  type YjsSnapshotResyncRequirement,
  type YjsSnapshotResyncResult,
} from './backend/yjs-backend';
import type { SnapshotEnvelope } from '../contracts/snapshot';
import type { BackendIdentity, BackendStateInspection } from './backend/types';
import { YJS_MAX_UPDATE_BYTES } from './yjs/constants';
import { normalizationOwnerId, repairConstituentId } from './publish-metadata';
import { createEmptyActorSessionGroupHistoryState } from './history';
import { decodeYjsBackendSnapshot } from './yjs/snapshot';

export type ReplicationCoordinatorApplyResult =
  | {
      readonly status: 'applied';
      readonly change: ReturnType<typeof createModelChange>;
      readonly replicationUpdate?: ReplicationUpdateEnvelope;
      readonly delivery: 'delivered' | 'queued';
      readonly subscriberErrors: readonly SubscriberError[];
    }
  | { readonly status: 'duplicate'; readonly reason: string }
  | {
      readonly status: 'clientCollision';
      readonly sourceClientId: number;
      readonly boundReplicaId: string;
      readonly boundSessionId: string;
      readonly attemptedReplicaId: string;
      readonly attemptedSessionId: string;
      readonly semanticUpdateId: string;
      readonly reseedRequired: true;
    }
  | {
      readonly status: 'buffered';
      readonly updateId: string;
      readonly constituentIds: readonly string[];
    }
  | { readonly status: 'noOp'; readonly reason: string }
  | { readonly status: 'failed'; readonly code: string; readonly reason: string };

export type ReplicationUpdateSubscriber = (update: ReplicationUpdateEnvelope) => void;

export interface ReplicationCoordinator {
  readonly identity: BackendIdentity;
  readonly model: DocumentModel;
  applyLocal(op: DocOp, origin: MutationOrigin): ReplicationCoordinatorApplyResult;
  applyRemote(
    update: ReplicationUpdateEnvelope,
    origin: MutationOrigin
  ): ReplicationCoordinatorApplyResult;
  reseedLocalUpdate(
    updateId: string,
    input: { readonly clientId?: number; readonly sessionId: string }
  ): YjsReseedResult;
  applySnapshotResync(requirement: YjsSnapshotResyncRequirement): YjsSnapshotResyncResult;
  subscribeModel(subscriber: ModelChangeSubscriber): () => void;
  subscribeUpdates(subscriber: ReplicationUpdateSubscriber): () => void;
  inspectState(): BackendStateInspection;
  inspectYjsModel(): DecodedYjsModel;
  inspectReplicationState(): YjsReplicationInspection;
  encodeSnapshot(): SnapshotEnvelope;
}

export interface ReplicationCoordinatorOptions {
  readonly replicaId?: string;
  readonly sessionId?: string;
  readonly clientId?: number;
  readonly authenticateRemote?: (
    origin: MutationOrigin,
    update: ReplicationUpdateEnvelope
  ) => boolean;
  readonly authorizeSnapshotResync?: (requirement: YjsSnapshotResyncRequirement) => boolean;
}

export function createReplicationCoordinator(
  initialModel: DocumentModel | unknown,
  options: ReplicationCoordinatorOptions = {}
): ReplicationCoordinator {
  const backend = createYjsStoreBackend(initialModel, {
    replicaId: options.replicaId,
    sessionId: options.sessionId,
    clientId: options.clientId,
  });
  return createReplicationCoordinatorFromBackend(backend, options);
}

export function restoreReplicationCoordinator(
  snapshot: SnapshotEnvelope,
  options: ReplicationCoordinatorOptions = {}
): ReplicationCoordinator {
  // Decode and validate every snapshot component before publishing a backend or
  // history manager. A rejection therefore cannot expose partially restored state.
  decodeYjsBackendSnapshot(snapshot, {
    replicaId: options.replicaId,
    sessionId: options.sessionId,
    clientId: options.clientId,
  });
  const backend = restoreYjsStoreBackend(snapshot, {
    replicaId: options.replicaId,
    sessionId: options.sessionId,
    clientId: options.clientId,
  });
  return createReplicationCoordinatorFromBackend(backend, options);
}

function createReplicationCoordinatorFromBackend(
  backend: YjsStoreBackend,
  options: ReplicationCoordinatorOptions
): ReplicationCoordinator {
  const authenticateRemote = options.authenticateRemote ?? (() => true);
  const modelSubscribers: ModelChangeSubscriber[] = [];
  const updateSubscribers: ReplicationUpdateSubscriber[] = [];
  const notificationDiagnostics: NotificationDiagnostic[] = [];
  const notificationQueue: Array<{
    change?: ReturnType<typeof createModelChange>;
    update?: ReplicationUpdateEnvelope;
    origin: MutationOrigin;
    modelSubscribers: readonly ModelChangeSubscriber[];
    updateSubscribers: readonly ReplicationUpdateSubscriber[];
    errors: SubscriberError[];
    suppressUpdateBroadcast: boolean;
  }> = [];
  let delivering = false;

  const coordinator: ReplicationCoordinator = {
    get identity() {
      return backend.identity;
    },
    get model() {
      return backend.model;
    },
    applyLocal(op: DocOp, origin: MutationOrigin): ReplicationCoordinatorApplyResult {
      try {
        if (!isDocOp(op)) {
          return failedResult('untrusted-doc-op', 'DocOp batch is not trusted');
        }
        const originSnapshot = snapshotAndValidateMutationOrigin(origin);
        if (originSnapshot.errors.length > 0 || !originSnapshot.snapshot) {
          return failedResult('invalid-origin', 'apply requires closed mutation origin');
        }
        const validatedOrigin = originSnapshot.snapshot;
        if (
          validatedOrigin.kind !== 'remote' &&
          (validatedOrigin.actorId !== op.transaction.actorId ||
            validatedOrigin.sessionId !== op.transaction.sessionId)
        ) {
          return failedResult(
            'origin-mismatch',
            'mutation origin must match DocOp transaction metadata'
          );
        }

        const staged = backend.stageLocalMutation({
          ops: op.ops,
          constituentIds: op.transaction.constituentIds,
          actorId: op.transaction.actorId,
        });
        if (staged.status === 'failed') {
          return failedResult(staged.code, staged.message);
        }
        if (staged.status === 'noOp') {
          return noOpResult(staged.reason);
        }

        let prepared;
        try {
          prepared = backend.prepareLocalPublication(staged.staged, {
            actorId: op.transaction.actorId,
            constituentIds: op.transaction.constituentIds,
          });
        } catch (error) {
          backend.rollbackStagedMutation(staged.staged);
          return failedResult(
            'commit-preview-failed',
            error instanceof Error ? error.message : 'semantic commit preview failed'
          );
        }

        let change;
        try {
          change = createModelChange({
            commitId: prepared.result.commitId,
            constituentIds: [...op.transaction.constituentIds],
            causalUpdateIds: [prepared.update.updateId],
            revisionBefore: prepared.result.revisionBefore,
            revisionAfter: prepared.result.revisionAfter,
            structuralRangesBefore: prepared.result.structuralRangesBefore,
            structuralRangesAfter: prepared.result.structuralRangesAfter,
            identityMappings: prepared.result.identityMappings,
            dirtyDependencies: prepared.result.dirtyDependencies,
            origin: validatedOrigin,
            normalized: prepared.result.normalized,
            repairEvidence: prepared.result.appliedRepair
              ? {
                  repairConstituentId: repairConstituentId(
                    op.transaction.constituentIds,
                    prepared.result.commitId
                  ),
                  normalizationOwner: normalizationOwnerId(
                    op.transaction.actorId,
                    op.transaction.constituentIds,
                    prepared.result.commitId
                  ),
                  appliedRepair: true,
                }
              : null,
          });
        } catch (error) {
          backend.rollbackStagedMutation(staged.staged);
          return failedResult(
            'model-change-failed',
            error instanceof Error ? error.message : 'ModelChange assembly failed'
          );
        }

        try {
          backend.publishLocalPublication(prepared);
        } catch (error) {
          backend.rollbackStagedMutation(staged.staged);
          return failedResult(
            'commit-failed',
            error instanceof Error ? error.message : 'semantic commit failed'
          );
        }

        const replicationUpdate = prepared.update;

        const subscriberErrors: SubscriberError[] = [];
        const queued = delivering;
        notificationQueue.push({
          change,
          update: replicationUpdate,
          origin: validatedOrigin,
          modelSubscribers: [...modelSubscribers],
          updateSubscribers: [...updateSubscribers],
          errors: subscriberErrors,
          suppressUpdateBroadcast: false,
        });
        drainNotifications(
          notificationQueue,
          notificationDiagnostics,
          () => delivering,
          (value) => {
            delivering = value;
          }
        );
        return appliedResult(
          change,
          replicationUpdate,
          queued ? 'queued' : 'delivered',
          queued ? [] : subscriberErrors
        );
      } catch (error) {
        return failedResult(
          'apply-failed',
          error instanceof Error ? error.message : 'replication apply failed'
        );
      }
    },
    applyRemote(
      updateInput: ReplicationUpdateEnvelope,
      origin: MutationOrigin
    ): ReplicationCoordinatorApplyResult {
      try {
        const originSnapshot = snapshotAndValidateMutationOrigin(origin);
        if (originSnapshot.errors.length > 0 || !originSnapshot.snapshot) {
          return failedResult('invalid-origin', 'remote apply requires closed mutation origin');
        }
        const validatedOrigin = originSnapshot.snapshot;
        if (validatedOrigin.kind !== 'remote') {
          return failedResult('invalid-origin', 'remote apply requires remote origin');
        }

        const updateValidation = snapshotAndValidateReplicationUpdate(updateInput);
        if (!updateValidation.snapshot || updateValidation.errors.length > 0) {
          return failedResult('invalid-update', 'remote update failed validation');
        }
        const update = updateValidation.snapshot;
        if (!isReplicationUpdate(update)) {
          return failedResult('invalid-update', 'remote update is not trusted');
        }
        if (update.bytes.length === 0 || update.bytes.length > YJS_MAX_UPDATE_BYTES) {
          return failedResult('invalid-update', 'remote update exceeds size limit');
        }
        if (
          update.documentId !== backend.identity.documentId ||
          update.backendVersion !== backend.identity.backendVersion ||
          update.schemaVersion !== backend.identity.schemaVersion ||
          !update.checkpoint.startsWith('yjs-')
        ) {
          return failedResult('invalid-update', 'remote update checkpoint or identity mismatch');
        }
        if (
          validatedOrigin.updateId !== update.updateId ||
          validatedOrigin.actorId !== update.sourceActorId ||
          validatedOrigin.replicaId !== update.sourceReplicaId ||
          validatedOrigin.sessionId !== update.sourceSessionId
        ) {
          return failedResult(
            'origin-mismatch',
            'remote origin must match envelope update and source metadata'
          );
        }
        if (!authenticateRemote(validatedOrigin, update)) {
          return failedResult('unauthorized', 'remote update rejected by authentication hook');
        }

        const mergeResult = backend.stageRemoteReplicationUpdate(update);
        if (mergeResult.status === 'failed') {
          return failedResult(mergeResult.code, mergeResult.reason);
        }
        if (mergeResult.status === 'clientCollision') {
          return Object.freeze({
            status: 'clientCollision',
            ...mergeResult.collision,
            reseedRequired: true,
          });
        }
        if (mergeResult.status === 'duplicate') {
          return Object.freeze({ status: 'duplicate', reason: mergeResult.reason });
        }
        if (mergeResult.status === 'buffered') {
          try {
            backend.publishBufferedRemote(mergeResult.prepared);
          } catch (error) {
            return failedResult(
              'buffered-publication-failed',
              error instanceof Error ? error.message : 'buffered publication failed'
            );
          }
          return Object.freeze({
            status: 'buffered',
            updateId: mergeResult.prepared.updateId,
            constituentIds: mergeResult.prepared.constituentIds,
          });
        }
        if (mergeResult.status === 'noOp') {
          return noOpResult(mergeResult.reason);
        }
        const prepared = mergeResult.prepared;
        let change;
        try {
          change = createModelChange({
            commitId: prepared.result.commitId,
            constituentIds: [...prepared.constituentIds],
            causalUpdateIds: [...prepared.causalUpdateIds],
            revisionBefore: prepared.result.revisionBefore,
            revisionAfter: prepared.result.revisionAfter,
            structuralRangesBefore: prepared.result.structuralRangesBefore,
            structuralRangesAfter: prepared.result.structuralRangesAfter,
            identityMappings: prepared.result.identityMappings,
            dirtyDependencies: prepared.result.dirtyDependencies,
            origin: validatedOrigin,
            normalized: true,
            repairEvidence:
              prepared.appliedRepair && prepared.repairUpdate
                ? {
                    repairConstituentId: prepared.repairUpdate.constituentIds[0]!,
                    normalizationOwner: update.updateId,
                    appliedRepair: true,
                  }
                : null,
          });
        } catch (error) {
          return failedResult(
            'model-change-failed',
            error instanceof Error ? error.message : 'remote ModelChange assembly failed'
          );
        }

        try {
          backend.publishRemotePublication(prepared);
        } catch (error) {
          return failedResult(
            'remote-publication-failed',
            error instanceof Error ? error.message : 'remote publication failed'
          );
        }
        const subscriberErrors: SubscriberError[] = [];
        notificationQueue.push({
          change,
          update: prepared.repairUpdate,
          origin: validatedOrigin,
          modelSubscribers: [...modelSubscribers],
          updateSubscribers: [...updateSubscribers],
          errors: subscriberErrors,
          suppressUpdateBroadcast: false,
        });
        drainNotifications(
          notificationQueue,
          notificationDiagnostics,
          () => delivering,
          (value) => {
            delivering = value;
          }
        );
        return appliedResult(change, prepared.repairUpdate, 'delivered', subscriberErrors);
      } catch (error) {
        return failedResult(
          'apply-failed',
          error instanceof Error ? error.message : 'remote apply failed'
        );
      }
    },
    reseedLocalUpdate(
      updateId: string,
      input: { readonly clientId?: number; readonly sessionId: string }
    ): YjsReseedResult {
      const result = backend.reseedLocalUpdate(updateId, input);
      if (result.status === 'reseeded') {
        for (const update of result.updates) {
          notificationQueue.push({
            update,
            origin: createMutationOrigin('agent', {
              actorId: update.sourceActorId,
              sessionId: update.sourceSessionId,
            }),
            modelSubscribers: [],
            updateSubscribers: [...updateSubscribers],
            errors: [],
            suppressUpdateBroadcast: false,
          });
        }
        drainNotifications(
          notificationQueue,
          notificationDiagnostics,
          () => delivering,
          (value) => {
            delivering = value;
          }
        );
      }
      return result;
    },
    applySnapshotResync(requirement: YjsSnapshotResyncRequirement): YjsSnapshotResyncResult {
      if (!options.authorizeSnapshotResync || !options.authorizeSnapshotResync(requirement)) {
        return Object.freeze({ status: 'unauthorized' });
      }
      const result = backend.applySnapshotResync(requirement);
      if (result.status === 'applied' && result.change && result.resyncConstituentId) {
        const repairConstituent = result.resyncConstituentId;
        const origin = createMutationOrigin('repair', {
          actorId: 'actor-repair',
          sessionId: backend.identity.sessionId,
          repairConstituentId: repairConstituent,
        });
        const change = createModelChange({
          commitId: result.change.commitId,
          constituentIds: [repairConstituent],
          causalUpdateIds: [repairConstituent],
          revisionBefore: result.change.revisionBefore,
          revisionAfter: result.change.revisionAfter,
          structuralRangesBefore: result.change.structuralRangesBefore,
          structuralRangesAfter: result.change.structuralRangesAfter,
          identityMappings: result.change.identityMappings,
          dirtyDependencies: result.change.dirtyDependencies,
          origin,
          normalized: true,
          repairEvidence: {
            repairConstituentId: repairConstituent,
            normalizationOwner: result.change.commitId,
            appliedRepair: true,
          },
        });
        notificationQueue.push({
          change,
          origin,
          modelSubscribers: [...modelSubscribers],
          updateSubscribers: [],
          errors: [],
          suppressUpdateBroadcast: true,
        });
        drainNotifications(
          notificationQueue,
          notificationDiagnostics,
          () => delivering,
          (value) => {
            delivering = value;
          }
        );
      }
      return result;
    },
    subscribeModel(subscriber: ModelChangeSubscriber) {
      modelSubscribers.push(subscriber);
      return () => {
        const index = modelSubscribers.indexOf(subscriber);
        if (index >= 0) modelSubscribers.splice(index, 1);
      };
    },
    subscribeUpdates(subscriber: ReplicationUpdateSubscriber) {
      updateSubscribers.push(subscriber);
      return () => {
        const index = updateSubscribers.indexOf(subscriber);
        if (index >= 0) updateSubscribers.splice(index, 1);
      };
    },
    inspectState(): BackendStateInspection {
      return backend.inspectState();
    },
    inspectYjsModel(): DecodedYjsModel {
      return backend.inspectYjsModel();
    },
    inspectReplicationState(): YjsReplicationInspection {
      return backend.inspectReplicationState();
    },
    encodeSnapshot(): SnapshotEnvelope {
      return backend.encodeSnapshot(
        createEmptyActorSessionGroupHistoryState(
          backend.identity.normalizationVersion,
          backend.model.revision
        )
      );
    },
  };
  return coordinator;
}

function drainNotifications(
  queue: Array<{
    change?: ReturnType<typeof createModelChange>;
    update?: ReplicationUpdateEnvelope;
    origin: MutationOrigin;
    modelSubscribers: readonly ModelChangeSubscriber[];
    updateSubscribers: readonly ReplicationUpdateSubscriber[];
    errors: SubscriberError[];
    suppressUpdateBroadcast: boolean;
  }>,
  diagnostics: NotificationDiagnostic[],
  getDelivering: () => boolean,
  setDelivering: (value: boolean) => void
): void {
  if (getDelivering()) return;
  setDelivering(true);
  try {
    while (queue.length > 0) {
      const delivery = queue.shift()!;
      if (delivery.change) {
        delivery.modelSubscribers.forEach((subscriber, index) => {
          try {
            subscriber(delivery.change!, delivery.origin);
          } catch (error) {
            delivery.errors.push({
              index,
              message: error instanceof Error ? error.message : 'subscriber failed',
            });
            diagnostics.push(
              Object.freeze({
                revision: delivery.change!.revisionAfter,
                subscriberIndex: index,
                message: error instanceof Error ? error.message : 'subscriber failed',
              })
            );
          }
        });
      }
      if (delivery.update && !delivery.suppressUpdateBroadcast) {
        delivery.updateSubscribers.forEach((subscriber) => {
          try {
            subscriber(delivery.update!);
          } catch {
            // update subscribers do not fail apply
          }
        });
      }
    }
  } finally {
    setDelivering(false);
  }
}

function appliedResult(
  change: ReturnType<typeof createModelChange>,
  replicationUpdate: ReplicationUpdateEnvelope | undefined,
  delivery: 'delivered' | 'queued',
  subscriberErrors: readonly SubscriberError[]
): ReplicationCoordinatorApplyResult {
  return Object.freeze({
    status: 'applied',
    change,
    replicationUpdate,
    delivery,
    subscriberErrors: Object.freeze(subscriberErrors.map((error) => Object.freeze({ ...error }))),
  });
}

function noOpResult(reason: string): ReplicationCoordinatorApplyResult {
  return Object.freeze({ status: 'noOp', reason });
}

function failedResult(code: string, reason: string): ReplicationCoordinatorApplyResult {
  return Object.freeze({ status: 'failed', code, reason });
}

export type { YjsStoreBackend };
