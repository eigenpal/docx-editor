/** @spike-features insert-delete-split-join-operations, local-backend, origin-metadata */
import { isDocOp, type DocOp } from '../contracts/doc-op';
import { readClosedDataObject } from '../contracts/closed-input';
import { createModelChange } from '../contracts/model-change';
import { snapshotAndValidateMutationOrigin, type MutationOrigin } from '../contracts/origins';
import type { SnapshotEnvelope } from '../contracts/snapshot';
import { createDocumentModel } from '../model/fixture';
import type { DocumentModel } from '../model/types';
import { validateDocumentModel } from '../model/validators';
import type {
  ApplyResult,
  ModelChangeSubscriber,
  NotificationDiagnostic,
  SubscriberError,
} from './apply-result';
import { createLocalStoreBackend, restoreLocalStoreBackend } from './backend/local-backend';
import { decodeLocalBackendSnapshot, LOCAL_NORMALIZATION_VERSION } from './backend/local-snapshot';
import type { SemanticStoreBackend } from './backend/types';
import { fingerprintAuthoredModel } from '../model/fingerprint';
import { normalizationOwnerId, repairConstituentId } from './publish-metadata';
import { createEmptyActorSessionGroupHistoryState } from './history';

export interface SemanticDocumentStore {
  readonly model: DocumentModel;
  apply(op: DocOp, origin: MutationOrigin): ApplyResult;
  encodeSnapshot(): SnapshotEnvelope;
  restoreFromSnapshot(snapshot: SnapshotEnvelope): SemanticDocumentStore;
  subscribeModel(subscriber: ModelChangeSubscriber): () => void;
  notificationDiagnostics(): readonly NotificationDiagnostic[];
}

export interface SemanticDocumentStoreOptions {
  readonly documentId?: string;
  readonly backend?: SemanticStoreBackend;
}

export function createSemanticDocumentStore(
  initialModel: DocumentModel | unknown,
  options: SemanticDocumentStoreOptions = {}
): SemanticDocumentStore {
  const errors = validateDocumentModel(initialModel);
  if (errors.length > 0) throw new TypeError(errors.join('; '));

  const initial = initialModel as DocumentModel;
  const documentId = options.documentId ?? 'doc-spike-0';
  const validatedInitial = createDocumentModel(initial.authored, initial.revision);
  const backend = options.backend ?? createLocalStoreBackend(validatedInitial, { documentId });
  const identityDescriptor = Object.getOwnPropertyDescriptor(backend, 'identity');
  if (!identityDescriptor || !identityDescriptor.enumerable || !('value' in identityDescriptor)) {
    throw new TypeError('injected backend identity must be an own data property');
  }
  const backendIdentity = readClosedDataObject(
    identityDescriptor.value,
    ['documentId', 'backendVersion', 'schemaVersion', 'normalizationVersion'],
    'injected backend identity'
  );
  if (backendIdentity.documentId !== documentId) {
    throw new TypeError('injected backend document identity mismatch');
  }
  if (
    backend.model.revision !== validatedInitial.revision ||
    fingerprintAuthoredModel(backend.model) !== fingerprintAuthoredModel(validatedInitial)
  ) {
    throw new TypeError('injected backend model mismatch');
  }
  const subscribers: ModelChangeSubscriber[] = [];
  const notificationDiagnostics: NotificationDiagnostic[] = [];
  const notificationQueue: Array<{
    change: ReturnType<typeof createModelChange>;
    origin: MutationOrigin;
    subscribers: readonly ModelChangeSubscriber[];
    errors: SubscriberError[];
  }> = [];
  let delivering = false;

  const store: SemanticDocumentStore = {
    get model() {
      return backend.model;
    },
    apply(op: DocOp, origin: MutationOrigin): ApplyResult {
      return applyInternal(op, origin);
    },
    encodeSnapshot() {
      return backend.encodeSnapshot(
        createEmptyActorSessionGroupHistoryState(
          LOCAL_NORMALIZATION_VERSION,
          backend.model.revision
        )
      );
    },
    restoreFromSnapshot(snapshot) {
      const restored = decodeLocalBackendSnapshot(snapshot);
      return createSemanticDocumentStore(restored.model, {
        documentId: restored.identity.documentId,
        backend: restoreLocalStoreBackend(snapshot),
      });
    },
    subscribeModel(subscriber: ModelChangeSubscriber) {
      subscribers.push(subscriber);
      return () => {
        const index = subscribers.indexOf(subscriber);
        if (index >= 0) subscribers.splice(index, 1);
      };
    },
    notificationDiagnostics() {
      return Object.freeze(
        notificationDiagnostics.map((diagnostic) => Object.freeze({ ...diagnostic }))
      );
    },
  };

  return store;

  function applyInternal(op: DocOp, origin: MutationOrigin): ApplyResult {
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

      let commitResult;
      try {
        commitResult = backend.previewStagedMutation(staged.staged, {
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
          commitId: commitResult.commitId,
          constituentIds: [...op.transaction.constituentIds],
          causalUpdateIds: [],
          revisionBefore: commitResult.revisionBefore,
          revisionAfter: commitResult.revisionAfter,
          structuralRangesBefore: commitResult.structuralRangesBefore,
          structuralRangesAfter: commitResult.structuralRangesAfter,
          identityMappings: commitResult.identityMappings,
          dirtyDependencies: commitResult.dirtyDependencies,
          origin: validatedOrigin,
          normalized: commitResult.normalized,
          repairEvidence: commitResult.appliedRepair
            ? {
                repairConstituentId: repairConstituentId(
                  op.transaction.constituentIds,
                  commitResult.commitId
                ),
                normalizationOwner: normalizationOwnerId(
                  op.transaction.actorId,
                  op.transaction.constituentIds,
                  commitResult.commitId
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
        backend.commitStagedMutation(staged.staged, {
          actorId: op.transaction.actorId,
          constituentIds: op.transaction.constituentIds,
        });
      } catch (error) {
        backend.rollbackStagedMutation(staged.staged);
        return failedResult(
          'commit-failed',
          error instanceof Error ? error.message : 'semantic commit failed'
        );
      }

      const subscriberErrors: SubscriberError[] = [];
      const queued = delivering;
      notificationQueue.push({
        change,
        origin: validatedOrigin,
        subscribers: [...subscribers],
        errors: subscriberErrors,
      });
      drainNotifications(
        notificationQueue,
        notificationDiagnostics,
        () => delivering,
        (value) => {
          delivering = value;
        }
      );
      return appliedResult(change, queued ? 'queued' : 'delivered', queued ? [] : subscriberErrors);
    } catch (error) {
      return failedResult(
        'apply-failed',
        error instanceof Error ? error.message : 'semantic apply failed'
      );
    }
  }
}

function drainNotifications(
  queue: Array<{
    change: ReturnType<typeof createModelChange>;
    origin: MutationOrigin;
    subscribers: readonly ModelChangeSubscriber[];
    errors: SubscriberError[];
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
      delivery.subscribers.forEach((subscriber, index) => {
        try {
          subscriber(delivery.change, delivery.origin);
        } catch (error) {
          delivery.errors.push({
            index,
            message: error instanceof Error ? error.message : 'subscriber failed',
          });
          diagnostics.push(
            Object.freeze({
              revision: delivery.change.revisionAfter,
              subscriberIndex: index,
              message: error instanceof Error ? error.message : 'subscriber failed',
            })
          );
        }
      });
    }
  } finally {
    setDelivering(false);
  }
}

function appliedResult(
  change: ReturnType<typeof createModelChange>,
  delivery: 'delivered' | 'queued',
  subscriberErrors: readonly SubscriberError[]
): ApplyResult {
  return Object.freeze({
    status: 'applied',
    change,
    delivery,
    subscriberErrors: Object.freeze(subscriberErrors.map((error) => Object.freeze({ ...error }))),
  });
}

function noOpResult(reason: string): ApplyResult {
  return Object.freeze({ status: 'noOp', reason });
}

function failedResult(code: string, reason: string): ApplyResult {
  return Object.freeze({ status: 'failed', code, reason });
}
