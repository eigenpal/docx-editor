/** @spike-features insert-delete-split-join-operations, yjs-backend */
import type { BrandedReplicationUpdate } from './brands';
import { snapshotAndValidateDocOp } from './doc-op';
import {
  collectValidation,
  copyBytes,
  hasUniqueStrings,
  readClosedDataObject,
  snapshotBytes,
  snapshotDenseArray,
  type ValidationSnapshot,
} from './closed-input';
import { validateSpikeId, validateSpikeIdList } from './ids';

export const REPLICATION_UPDATE_CONTRACT_VERSION = 'replication-update/2';
export type ReplicationCoverage = 'incremental';
const TRUSTED_REPLICATION_UPDATES = new WeakSet<object>();

export interface ReplicationUpdateEnvelope extends BrandedReplicationUpdate {
  readonly version: typeof REPLICATION_UPDATE_CONTRACT_VERSION;
  readonly documentId: string;
  readonly backendVersion: string;
  readonly schemaVersion: string;
  readonly checkpoint: string;
  readonly updateId: string;
  readonly semanticUpdateId: string;
  readonly sourceActorId: string;
  readonly sourceReplicaId: string;
  readonly sourceSessionId: string;
  readonly sourceClientId: number;
  readonly constituentIds: readonly string[];
  readonly coverage: ReplicationCoverage;
  readonly bytes: Uint8Array;
}

export function createReplicationUpdateEnvelope(input: {
  documentId: string;
  backendVersion: string;
  schemaVersion: string;
  checkpoint: string;
  updateId: string;
  semanticUpdateId: string;
  sourceActorId: string;
  sourceReplicaId: string;
  sourceSessionId: string;
  sourceClientId: number;
  constituentIds: readonly string[];
  coverage: ReplicationCoverage;
  bytes: Uint8Array;
}): ReplicationUpdateEnvelope {
  const value = readClosedDataObject(
    input,
    [
      'documentId',
      'backendVersion',
      'schemaVersion',
      'checkpoint',
      'updateId',
      'semanticUpdateId',
      'sourceActorId',
      'sourceReplicaId',
      'sourceSessionId',
      'sourceClientId',
      'constituentIds',
      'coverage',
      'bytes',
    ],
    'replication update factory input'
  );
  return createValidatedReplicationUpdate(value);
}

function createTrustedReplicationUpdate(input: {
  documentId: string;
  backendVersion: string;
  schemaVersion: string;
  checkpoint: string;
  updateId: string;
  semanticUpdateId: string;
  sourceActorId: string;
  sourceReplicaId: string;
  sourceSessionId: string;
  sourceClientId: number;
  constituentIds: readonly string[];
  coverage: ReplicationCoverage;
  bytes: Uint8Array;
}): ReplicationUpdateEnvelope {
  const bytes = copyBytes(input.bytes);
  const envelope = Object.freeze({
    version: REPLICATION_UPDATE_CONTRACT_VERSION,
    documentId: input.documentId,
    backendVersion: input.backendVersion,
    schemaVersion: input.schemaVersion,
    checkpoint: input.checkpoint,
    updateId: input.updateId,
    semanticUpdateId: input.semanticUpdateId,
    sourceActorId: input.sourceActorId,
    sourceReplicaId: input.sourceReplicaId,
    sourceSessionId: input.sourceSessionId,
    sourceClientId: input.sourceClientId,
    constituentIds: Object.freeze([...input.constituentIds]),
    coverage: input.coverage,
    get bytes() {
      return copyBytes(bytes);
    },
  }) as unknown as ReplicationUpdateEnvelope;
  TRUSTED_REPLICATION_UPDATES.add(envelope);
  return envelope;
}

export function snapshotAndValidateReplicationUpdate(
  input: unknown
): ValidationSnapshot<ReplicationUpdateEnvelope> {
  if (isReplicationUpdate(input)) {
    return { snapshot: input, errors: validateTrustedReplicationUpdate(input) };
  }
  return collectValidation(validateTrustedReplicationUpdate, () => snapshotReplicationUpdate(input));
}

export function snapshotReplicationUpdate(input: unknown): ReplicationUpdateEnvelope {
  const envelope = readClosedDataObject(
    input,
    [
      'version',
      'documentId',
      'backendVersion',
      'schemaVersion',
      'checkpoint',
      'updateId',
      'semanticUpdateId',
      'sourceActorId',
      'sourceReplicaId',
      'sourceSessionId',
      'sourceClientId',
      'constituentIds',
      'coverage',
      'bytes',
    ],
    'replication update'
  );
  if (envelope.version !== REPLICATION_UPDATE_CONTRACT_VERSION) {
    throw new TypeError('invalid replication update version');
  }
  return createValidatedReplicationUpdate(envelope);
}

function createValidatedReplicationUpdate(
  envelope: Record<string, unknown>
): ReplicationUpdateEnvelope {
  const trusted = createTrustedReplicationUpdate({
    documentId: envelope.documentId as string,
    backendVersion: envelope.backendVersion as string,
    schemaVersion: envelope.schemaVersion as string,
    checkpoint: envelope.checkpoint as string,
    updateId: envelope.updateId as string,
    semanticUpdateId: envelope.semanticUpdateId as string,
    sourceActorId: envelope.sourceActorId as string,
    sourceReplicaId: envelope.sourceReplicaId as string,
    sourceSessionId: envelope.sourceSessionId as string,
    sourceClientId: envelope.sourceClientId as number,
    constituentIds: snapshotDenseArray(envelope.constituentIds, 'constituentIds') as string[],
    coverage: envelope.coverage as ReplicationCoverage,
    bytes: snapshotBytes(envelope.bytes, 'replication update bytes'),
  });
  const errors = validateTrustedReplicationUpdate(trusted);
  if (errors.length > 0) throw new TypeError(`invalid replication update: ${errors.join('; ')}`);
  return trusted;
}

function validateTrustedReplicationUpdate(update: ReplicationUpdateEnvelope): readonly string[] {
  const errors: string[] = [];
  if (!TRUSTED_REPLICATION_UPDATES.has(update)) errors.push('untrusted replication update');
  if (update.version !== REPLICATION_UPDATE_CONTRACT_VERSION) {
    errors.push('invalid replication update version');
  }
  errors.push(
    validateSpikeId(update.documentId, 'documentId') ?? '',
    validateSpikeId(update.updateId, 'updateId') ?? '',
    validateSpikeId(update.semanticUpdateId, 'semanticUpdateId') ?? '',
    validateSpikeId(update.sourceActorId, 'sourceActorId') ?? '',
    validateSpikeId(update.sourceReplicaId, 'sourceReplicaId') ?? '',
    validateSpikeId(update.sourceSessionId, 'sourceSessionId') ?? '',
    validateSpikeIdList(update.constituentIds, 'constituentIds') ?? ''
  );
  if (
    !Number.isInteger(update.sourceClientId) ||
    update.sourceClientId <= 0 ||
    update.sourceClientId > 0xffff_ffff
  ) {
    errors.push('sourceClientId must be a nonzero uint32');
  }
  if (!hasUniqueStrings(update.constituentIds)) errors.push('duplicate constituent ID');
  if (typeof update.backendVersion !== 'string' || update.backendVersion.length === 0) {
    errors.push('invalid backendVersion');
  }
  if (typeof update.schemaVersion !== 'string' || update.schemaVersion.length === 0) {
    errors.push('invalid schemaVersion');
  }
  if (typeof update.checkpoint !== 'string' || update.checkpoint.length === 0) {
    errors.push('invalid checkpoint');
  }
  if (update.coverage !== 'incremental') {
    errors.push('replication update coverage must be incremental');
  }
  if (!(update.bytes instanceof Uint8Array)) errors.push('replication update bytes must be Uint8Array');
  return errors.filter(Boolean);
}

export function isReplicationUpdate(value: unknown): value is ReplicationUpdateEnvelope {
  return typeof value === 'object' && value !== null && TRUSTED_REPLICATION_UPDATES.has(value);
}

export function rejectsReplicationUpdateAsDocOp(value: unknown): boolean {
  return snapshotAndValidateDocOp(value).errors.length > 0;
}
