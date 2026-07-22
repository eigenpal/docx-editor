/** @spike-features origin-metadata, insert-delete-split-join-operations */
import {
  collectValidation,
  copyBytes,
  hasUniqueStrings,
  isNonNegativeSafeInteger,
  isPlainRecord,
  readClosedDataObject,
  snapshotBytes,
  snapshotDenseArray,
  type ValidationSnapshot,
} from './closed-input';
import { validateSpikeId, validateSpikeIdList } from './ids';
import { MUTATION_ORIGIN_KINDS, type MutationOriginKind } from './origins';

export const REDACTED_AUDIT_INDEX_VERSION = 'audit-index/1';
export const ENCRYPTED_REPLAY_JOURNAL_VERSION = 'replay-journal/1';

export interface RedactedAuditIndexRecord {
  readonly version: typeof REDACTED_AUDIT_INDEX_VERSION;
  readonly sequence: number;
  readonly commitId: string;
  readonly constituentIds: readonly string[];
  readonly originKind: MutationOriginKind;
  readonly actorId: string;
  readonly retentionPolicyId: string;
  readonly payloadSchemaVersion: string;
}

export interface EncryptedReplayJournalEnvelope {
  readonly version: typeof ENCRYPTED_REPLAY_JOURNAL_VERSION;
  readonly sequence: number;
  readonly commitId: string;
  readonly payloadSchemaVersion: string;
  readonly retentionPolicyId: string;
  readonly authorizationPolicyId: string;
  readonly encryptedPayload: Uint8Array;
}

const TRUSTED_REPLAY_JOURNALS = new WeakSet<object>();
const TRUSTED_AUDIT_INDEX_RECORDS = new WeakSet<object>();

export function createRedactedAuditIndexRecord(input: {
  sequence: number;
  commitId: string;
  constituentIds: readonly string[];
  originKind: MutationOriginKind;
  actorId: string;
  retentionPolicyId: string;
  payloadSchemaVersion: string;
}): RedactedAuditIndexRecord {
  const value = readClosedDataObject(
    input,
    [
      'sequence',
      'commitId',
      'constituentIds',
      'originKind',
      'actorId',
      'retentionPolicyId',
      'payloadSchemaVersion',
    ],
    'audit index factory input'
  );
  const record = Object.freeze({
    version: REDACTED_AUDIT_INDEX_VERSION,
    sequence: value.sequence as number,
    commitId: value.commitId as string,
    constituentIds: Object.freeze(
      snapshotDenseArray(value.constituentIds, 'constituentIds') as string[]
    ),
    originKind: value.originKind as MutationOriginKind,
    actorId: value.actorId as string,
    retentionPolicyId: value.retentionPolicyId as string,
    payloadSchemaVersion: value.payloadSchemaVersion as string,
  });
  TRUSTED_AUDIT_INDEX_RECORDS.add(record);
  const errors = validateTrustedRedactedAuditIndexRecord(record);
  if (errors.length > 0) throw new TypeError(`invalid audit index: ${errors.join('; ')}`);
  return record;
}

export function createEncryptedReplayJournalEnvelope(input: {
  sequence: number;
  commitId: string;
  payloadSchemaVersion: string;
  retentionPolicyId: string;
  authorizationPolicyId: string;
  encryptedPayload: Uint8Array;
}): EncryptedReplayJournalEnvelope {
  const value = readClosedDataObject(
    input,
    [
      'sequence',
      'commitId',
      'payloadSchemaVersion',
      'retentionPolicyId',
      'authorizationPolicyId',
      'encryptedPayload',
    ],
    'replay journal factory input'
  );
  const encryptedPayload = snapshotBytes(value.encryptedPayload, 'encrypted replay payload');
  const envelope = Object.freeze({
    version: ENCRYPTED_REPLAY_JOURNAL_VERSION,
    sequence: value.sequence as number,
    commitId: value.commitId as string,
    payloadSchemaVersion: value.payloadSchemaVersion as string,
    retentionPolicyId: value.retentionPolicyId as string,
    authorizationPolicyId: value.authorizationPolicyId as string,
    get encryptedPayload() {
      return copyBytes(encryptedPayload);
    },
  });
  TRUSTED_REPLAY_JOURNALS.add(envelope);
  const errors = validateTrustedEncryptedReplayJournalEnvelope(envelope);
  if (errors.length > 0) throw new TypeError(`invalid replay journal: ${errors.join('; ')}`);
  return envelope;
}

export function snapshotAndValidateRedactedAuditIndexRecord(
  input: unknown
): ValidationSnapshot<RedactedAuditIndexRecord> {
  if (isRedactedAuditIndexRecord(input)) {
    return { snapshot: input, errors: validateTrustedRedactedAuditIndexRecord(input) };
  }
  return collectValidation(validateTrustedRedactedAuditIndexRecord, () =>
    snapshotRedactedAuditIndexRecord(input)
  );
}

export function snapshotAndValidateEncryptedReplayJournalEnvelope(
  input: unknown
): ValidationSnapshot<EncryptedReplayJournalEnvelope> {
  if (isEncryptedReplayJournalEnvelope(input)) {
    return { snapshot: input, errors: validateTrustedEncryptedReplayJournalEnvelope(input) };
  }
  return collectValidation(validateTrustedEncryptedReplayJournalEnvelope, () =>
    snapshotEncryptedReplayJournalEnvelope(input)
  );
}

function snapshotRedactedAuditIndexRecord(input: unknown): RedactedAuditIndexRecord {
  const record = readClosedDataObject(
    input,
    [
      'version',
      'sequence',
      'commitId',
      'constituentIds',
      'originKind',
      'actorId',
      'retentionPolicyId',
      'payloadSchemaVersion',
    ],
    'redacted audit index record'
  );
  if (record.version !== REDACTED_AUDIT_INDEX_VERSION) {
    throw new TypeError('invalid redacted audit index version');
  }
  return createRedactedAuditIndexRecord({
    sequence: record.sequence as number,
    commitId: record.commitId as string,
    constituentIds: snapshotDenseArray(record.constituentIds, 'constituentIds') as string[],
    originKind: record.originKind as MutationOriginKind,
    actorId: record.actorId as string,
    retentionPolicyId: record.retentionPolicyId as string,
    payloadSchemaVersion: record.payloadSchemaVersion as string,
  });
}

function snapshotEncryptedReplayJournalEnvelope(input: unknown): EncryptedReplayJournalEnvelope {
  const envelope = readClosedDataObject(
    input,
    [
      'version',
      'sequence',
      'commitId',
      'payloadSchemaVersion',
      'retentionPolicyId',
      'authorizationPolicyId',
      'encryptedPayload',
    ],
    'encrypted replay journal envelope'
  );
  if (envelope.version !== ENCRYPTED_REPLAY_JOURNAL_VERSION) {
    throw new TypeError('invalid encrypted replay journal version');
  }
  return createEncryptedReplayJournalEnvelope({
    sequence: envelope.sequence as number,
    commitId: envelope.commitId as string,
    payloadSchemaVersion: envelope.payloadSchemaVersion as string,
    retentionPolicyId: envelope.retentionPolicyId as string,
    authorizationPolicyId: envelope.authorizationPolicyId as string,
    encryptedPayload: snapshotBytes(envelope.encryptedPayload, 'encrypted replay payload'),
  });
}

function validateTrustedRedactedAuditIndexRecord(record: RedactedAuditIndexRecord): readonly string[] {
  const errors: string[] = [];
  if (!TRUSTED_AUDIT_INDEX_RECORDS.has(record)) errors.push('untrusted audit index record');
  if (record.version !== REDACTED_AUDIT_INDEX_VERSION) errors.push('invalid audit index version');
  if (!isNonNegativeSafeInteger(record.sequence)) errors.push('invalid audit sequence');
  errors.push(
    validateSpikeId(record.commitId, 'commitId') ?? '',
    validateSpikeIdList(record.constituentIds, 'constituentIds') ?? '',
    validateSpikeId(record.actorId, 'actorId') ?? '',
    validateSpikeId(record.retentionPolicyId, 'retentionPolicyId') ?? ''
  );
  if (!hasUniqueStrings(record.constituentIds)) errors.push('duplicate constituent ID');
  if (!MUTATION_ORIGIN_KINDS.includes(record.originKind)) errors.push('invalid audit originKind');
  if (typeof record.payloadSchemaVersion !== 'string' || record.payloadSchemaVersion.length === 0) {
    errors.push('invalid payloadSchemaVersion');
  }
  if ('rawText' in (record as object)) errors.push('raw text forbidden in audit index');
  if ('projection' in (record as object) || 'awareness' in (record as object)) {
    errors.push('projection/awareness forbidden in audit index');
  }
  return errors.filter(Boolean);
}

function validateTrustedEncryptedReplayJournalEnvelope(
  envelope: EncryptedReplayJournalEnvelope
): readonly string[] {
  const errors: string[] = [];
  if (!TRUSTED_REPLAY_JOURNALS.has(envelope)) errors.push('untrusted replay journal envelope');
  if (envelope.version !== ENCRYPTED_REPLAY_JOURNAL_VERSION) {
    errors.push('invalid replay journal version');
  }
  if (!isNonNegativeSafeInteger(envelope.sequence)) errors.push('invalid journal sequence');
  errors.push(validateSpikeId(envelope.commitId, 'commitId') ?? '');
  if (typeof envelope.payloadSchemaVersion !== 'string' || envelope.payloadSchemaVersion.length === 0) {
    errors.push('invalid payloadSchemaVersion');
  }
  errors.push(
    validateSpikeId(envelope.retentionPolicyId, 'retentionPolicyId') ?? '',
    validateSpikeId(envelope.authorizationPolicyId, 'authorizationPolicyId') ?? ''
  );
  if (!(envelope.encryptedPayload instanceof Uint8Array)) {
    errors.push('encrypted payload must be Uint8Array');
  }
  return errors.filter(Boolean);
}

function isRedactedAuditIndexRecord(value: unknown): value is RedactedAuditIndexRecord {
  return isPlainRecord(value) && TRUSTED_AUDIT_INDEX_RECORDS.has(value);
}

function isEncryptedReplayJournalEnvelope(value: unknown): value is EncryptedReplayJournalEnvelope {
  return isPlainRecord(value) && TRUSTED_REPLAY_JOURNALS.has(value);
}
