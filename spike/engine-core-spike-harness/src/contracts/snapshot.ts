/** @spike-features insert-delete-split-join-operations, yjs-backend */
import type { BrandedSnapshot } from './brands';
import {
  collectValidation,
  copyBytes,
  readClosedDataObject,
  snapshotBytes,
  type ValidationSnapshot,
} from './closed-input';
import { validateSpikeId } from './ids';
import { snapshotAndValidateDocOp } from './doc-op';

export const SNAPSHOT_CONTRACT_VERSION = 'snapshot/1';
export const MAX_SNAPSHOT_BYTES = 16_000_000;
const TRUSTED_SNAPSHOTS = new WeakSet<object>();

export interface SnapshotEnvelope extends BrandedSnapshot {
  readonly version: typeof SNAPSHOT_CONTRACT_VERSION;
  readonly documentId: string;
  readonly backendVersion: string;
  readonly schemaVersion: string;
  readonly normalizationVersion: string;
  readonly checkpoint: string;
  readonly coverage: 'full';
  readonly bytes: Uint8Array;
}

export function createSnapshotEnvelope(input: {
  documentId: string;
  backendVersion: string;
  schemaVersion: string;
  normalizationVersion: string;
  checkpoint: string;
  bytes: Uint8Array;
}): SnapshotEnvelope {
  const value = readClosedDataObject(
    input,
    [
      'documentId',
      'backendVersion',
      'schemaVersion',
      'normalizationVersion',
      'checkpoint',
      'bytes',
    ],
    'snapshot factory input'
  );
  return createValidatedSnapshot(value);
}

function createTrustedSnapshot(input: {
  documentId: string;
  backendVersion: string;
  schemaVersion: string;
  normalizationVersion: string;
  checkpoint: string;
  bytes: Uint8Array;
}): SnapshotEnvelope {
  const bytes = copyBytes(input.bytes);
  const snapshot = Object.freeze({
    version: SNAPSHOT_CONTRACT_VERSION,
    documentId: input.documentId,
    backendVersion: input.backendVersion,
    schemaVersion: input.schemaVersion,
    normalizationVersion: input.normalizationVersion,
    checkpoint: input.checkpoint,
    coverage: 'full' as const,
    get bytes() {
      return copyBytes(bytes);
    },
  }) as unknown as SnapshotEnvelope;
  TRUSTED_SNAPSHOTS.add(snapshot);
  return snapshot;
}

export function snapshotAndValidateSnapshot(input: unknown): ValidationSnapshot<SnapshotEnvelope> {
  if (isSnapshot(input)) {
    return { snapshot: input, errors: validateTrustedSnapshot(input) };
  }
  return collectValidation(validateTrustedSnapshot, () => snapshotSnapshotEnvelope(input));
}

export function snapshotSnapshotEnvelope(input: unknown): SnapshotEnvelope {
  const envelope = readClosedDataObject(
    input,
    [
      'version',
      'documentId',
      'backendVersion',
      'schemaVersion',
      'normalizationVersion',
      'checkpoint',
      'coverage',
      'bytes',
    ],
    'snapshot'
  );
  if (envelope.version !== SNAPSHOT_CONTRACT_VERSION) throw new TypeError('invalid snapshot version');
  if (envelope.coverage !== 'full') throw new TypeError('snapshot coverage must be full');
  return createValidatedSnapshot(envelope);
}

function createValidatedSnapshot(envelope: Record<string, unknown>): SnapshotEnvelope {
  const trusted = createTrustedSnapshot({
    documentId: envelope.documentId as string,
    backendVersion: envelope.backendVersion as string,
    schemaVersion: envelope.schemaVersion as string,
    normalizationVersion: envelope.normalizationVersion as string,
    checkpoint: envelope.checkpoint as string,
    bytes: snapshotBytes(envelope.bytes, 'snapshot bytes'),
  });
  const errors = validateTrustedSnapshot(trusted);
  if (errors.length > 0) throw new TypeError(`invalid snapshot: ${errors.join('; ')}`);
  return trusted;
}

function validateTrustedSnapshot(snapshot: SnapshotEnvelope): readonly string[] {
  const errors: string[] = [];
  if (!TRUSTED_SNAPSHOTS.has(snapshot)) errors.push('untrusted snapshot');
  if (snapshot.version !== SNAPSHOT_CONTRACT_VERSION) errors.push('invalid snapshot version');
  errors.push(validateSpikeId(snapshot.documentId, 'documentId') ?? '');
  if (typeof snapshot.backendVersion !== 'string' || snapshot.backendVersion.length === 0) {
    errors.push('invalid backendVersion');
  }
  if (typeof snapshot.schemaVersion !== 'string' || snapshot.schemaVersion.length === 0) {
    errors.push('invalid schemaVersion');
  }
  if (typeof snapshot.normalizationVersion !== 'string' || snapshot.normalizationVersion.length === 0) {
    errors.push('invalid normalizationVersion');
  }
  if (typeof snapshot.checkpoint !== 'string' || snapshot.checkpoint.length === 0) {
    errors.push('invalid checkpoint');
  }
  if (snapshot.coverage !== 'full') errors.push('snapshot coverage must be full');
  if (!(snapshot.bytes instanceof Uint8Array)) errors.push('snapshot bytes must be Uint8Array');
  if (snapshot.bytes.byteLength > MAX_SNAPSHOT_BYTES) {
    errors.push('snapshot bytes exceed quota');
  }
  return errors.filter(Boolean);
}

export function isSnapshot(value: unknown): value is SnapshotEnvelope {
  return typeof value === 'object' && value !== null && TRUSTED_SNAPSHOTS.has(value);
}

export function rejectsSnapshotAsDocOp(value: unknown): boolean {
  return snapshotAndValidateDocOp(value).errors.length > 0;
}
