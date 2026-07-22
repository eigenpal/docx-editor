/** @spike-features insert-delete-split-join-operations, origin-metadata, awareness-metadata */
import type { DocOp } from './doc-op';
import { isDocOp, snapshotAndValidateDocOp } from './doc-op';
import type { ModelChange } from './model-change';
import { isModelChange, snapshotAndValidateModelChange } from './model-change';
import type { ReplicationUpdateEnvelope } from './replication-update';
import { isReplicationUpdate, snapshotAndValidateReplicationUpdate } from './replication-update';
import type { SnapshotEnvelope } from './snapshot';
import { isSnapshot, snapshotAndValidateSnapshot } from './snapshot';

export function ACCEPT_DOC_OP(value: unknown): DocOp {
  if (!isDocOp(value)) throw new TypeError('value is not a DocOp');
  const result = snapshotAndValidateDocOp(value);
  if (result.errors.length > 0) throw new TypeError(`invalid DocOp: ${result.errors.join('; ')}`);
  return value;
}

export function ACCEPT_MODEL_CHANGE(value: unknown): ModelChange {
  if (!isModelChange(value)) throw new TypeError('value is not a ModelChange');
  const result = snapshotAndValidateModelChange(value);
  if (result.errors.length > 0) {
    throw new TypeError(`invalid ModelChange: ${result.errors.join('; ')}`);
  }
  return value;
}

export function ACCEPT_REPLICATION_UPDATE(value: unknown): ReplicationUpdateEnvelope {
  if (!isReplicationUpdate(value)) throw new TypeError('value is not a ReplicationUpdate');
  const result = snapshotAndValidateReplicationUpdate(value);
  if (result.errors.length > 0) {
    throw new TypeError(`invalid ReplicationUpdate: ${result.errors.join('; ')}`);
  }
  return value;
}

export function ACCEPT_SNAPSHOT(value: unknown): SnapshotEnvelope {
  if (!isSnapshot(value)) throw new TypeError('value is not a Snapshot');
  const result = snapshotAndValidateSnapshot(value);
  if (result.errors.length > 0) throw new TypeError(`invalid Snapshot: ${result.errors.join('; ')}`);
  return value;
}

export function assertFourContractSeparation(input: {
  op: unknown;
  change: unknown;
  update: unknown;
  snapshot: unknown;
}): void {
  ACCEPT_DOC_OP(input.op);
  ACCEPT_MODEL_CHANGE(input.change);
  ACCEPT_REPLICATION_UPDATE(input.update);
  ACCEPT_SNAPSHOT(input.snapshot);

  if (isModelChange(input.op) || isReplicationUpdate(input.op) || isSnapshot(input.op)) {
    throw new TypeError('DocOp slot contains non-DocOp contract');
  }
  if (isDocOp(input.change) || isReplicationUpdate(input.change) || isSnapshot(input.change)) {
    throw new TypeError('ModelChange slot contains non-ModelChange contract');
  }
  if (isDocOp(input.update) || isModelChange(input.update) || isSnapshot(input.update)) {
    throw new TypeError('ReplicationUpdate slot contains non-ReplicationUpdate contract');
  }
  if (isDocOp(input.snapshot) || isModelChange(input.snapshot) || isReplicationUpdate(input.snapshot)) {
    throw new TypeError('Snapshot slot contains non-Snapshot contract');
  }
}

export { assertAwarenessExcludedFromAuthoredPayload } from './awareness';
