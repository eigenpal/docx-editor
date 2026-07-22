/** @spike-features insert-delete-split-join-operations, local-backend, one-preservation-capsule, origin-metadata */
import { canonicalJson } from '../../canonical-json';
import {
  readClosedDataObject,
  snapshotDenseArray,
} from '../../contracts/closed-input';
import {
  createSnapshotEnvelope,
  snapshotAndValidateSnapshot,
  type SnapshotEnvelope,
} from '../../contracts/snapshot';
import { isSpikeId } from '../../contracts/ids';
import {
  authoredFingerprintPayload,
  fingerprintAuthoredModel,
} from '../../model/fingerprint';
import { createDocumentModel } from '../../model/fixture';
import type {
  AuthoredMark,
  AuthoredPackageModel,
  AuthoredPackageModelInput,
  AuthoredParagraph,
  DocumentModel,
  UnsupportedCapsule,
} from '../../model/types';
import type { AuthoredProperty } from '../../model/authored-property';
import type { OperationEnvironment } from '../operation-environment';
import { createBackendCoverage, type BackendCoverageState } from './coverage';
import type { BackendIdentity } from './types';
import {
  decodeHistorySnapshotPayload,
  encodeHistorySnapshotPayload,
  type ActorSessionGroupHistoryState,
} from '../history';

export const LOCAL_BACKEND_VERSION = 'local/1';
export const LOCAL_BACKEND_SCHEMA_VERSION = 'local-backend/3';
export const LOCAL_NORMALIZATION_VERSION = '1.0.0';
const LOCAL_SNAPSHOT_KIND = 'local-backend-snapshot/3';

export interface RestoredLocalBackendState {
  readonly identity: BackendIdentity;
  readonly model: DocumentModel;
  readonly env: OperationEnvironment;
  readonly coverage: BackendCoverageState;
  readonly actorSessionGroupHistory: ActorSessionGroupHistoryState;
}

export function encodeLocalBackendSnapshot(input: RestoredLocalBackendState): SnapshotEnvelope {
  const authoredFingerprint = fingerprintAuthoredModel(input.model);
  const checkpoint = checkpointFor(input.model.revision, authoredFingerprint);
  const payload = {
    kind: LOCAL_SNAPSHOT_KIND,
    backendVersion: input.identity.backendVersion,
    schemaVersion: input.identity.schemaVersion,
    normalizationVersion: input.identity.normalizationVersion,
    documentId: input.identity.documentId,
    checkpoint,
    safeAuditCursor: input.actorSessionGroupHistory.safeAuditCursor,
    authoredState: authoredFingerprintPayload(input.model),
    authoredFingerprint,
    allocator: {
      actorId: input.env.actorId,
      nextCommitSeq: input.env.nextCommitSeq,
      nextLocalSeq: input.env.nextLocalSeq,
      reservedSemanticIds: [...input.env.reservedSemanticIds].sort(codeUnitCompare),
    },
    localRevision: input.model.revision,
    appliedCommitIds: [...input.coverage.commitIds].sort(codeUnitCompare),
    appliedConstituentIds: [...input.coverage.constituentIds].sort(codeUnitCompare),
    actorSessionGroupHistory: encodeHistorySnapshotPayload(input.actorSessionGroupHistory),
    redoEligibility: input.actorSessionGroupHistory.redoEligibility.map((record) => ({
      actorId: record.actorId,
      sessionId: record.sessionId,
      eligible: record.eligible,
      reason: record.reason,
    })),
  };
  return createSnapshotEnvelope({
    documentId: input.identity.documentId,
    backendVersion: input.identity.backendVersion,
    schemaVersion: input.identity.schemaVersion,
    normalizationVersion: input.identity.normalizationVersion,
    checkpoint,
    bytes: new TextEncoder().encode(canonicalJson(payload)),
  });
}

export function decodeLocalBackendSnapshot(snapshotInput: unknown): RestoredLocalBackendState {
  const validation = snapshotAndValidateSnapshot(snapshotInput);
  if (!validation.snapshot || validation.errors.length > 0) {
    throw new TypeError(`invalid local snapshot envelope: ${validation.errors.join('; ')}`);
  }
  const snapshot = validation.snapshot;
  if (
    snapshot.backendVersion !== LOCAL_BACKEND_VERSION ||
    snapshot.schemaVersion !== LOCAL_BACKEND_SCHEMA_VERSION ||
    snapshot.normalizationVersion !== LOCAL_NORMALIZATION_VERSION
  ) {
    throw new TypeError('local snapshot version mismatch');
  }

  let decoded: unknown;
  try {
    decoded = parseBoundedSnapshotJson(
      new TextDecoder('utf-8', { fatal: true }).decode(snapshot.bytes)
    );
  } catch {
    throw new TypeError('invalid local snapshot bytes');
  }
  const payload = readClosedDataObject(
    decoded,
    [
      'kind',
      'backendVersion',
      'schemaVersion',
      'normalizationVersion',
      'documentId',
      'checkpoint',
      'safeAuditCursor',
      'authoredState',
      'authoredFingerprint',
      'allocator',
      'localRevision',
      'appliedCommitIds',
      'appliedConstituentIds',
      'actorSessionGroupHistory',
      'redoEligibility',
    ],
    'local snapshot payload'
  );
  if (
    payload.kind !== LOCAL_SNAPSHOT_KIND ||
    payload.backendVersion !== snapshot.backendVersion ||
    payload.schemaVersion !== snapshot.schemaVersion ||
    payload.normalizationVersion !== snapshot.normalizationVersion ||
    payload.documentId !== snapshot.documentId ||
    payload.checkpoint !== snapshot.checkpoint
  ) {
    throw new TypeError('local snapshot metadata mismatch');
  }
  const actorSessionGroupHistory = decodeHistorySnapshotPayload(payload.actorSessionGroupHistory);
  const cursor = readClosedDataObject(
    payload.safeAuditCursor,
    ['version', 'sequence', 'containsRawText', 'containsProjectionOrAwareness'],
    'safe audit cursor'
  );
  if (
    cursor.version !== actorSessionGroupHistory.safeAuditCursor.version ||
    cursor.sequence !== actorSessionGroupHistory.safeAuditCursor.sequence ||
    cursor.containsRawText !== false ||
    cursor.containsProjectionOrAwareness !== false ||
    canonicalJson(payload.redoEligibility) !==
      canonicalJson(actorSessionGroupHistory.redoEligibility)
  ) {
    throw new TypeError('local snapshot history metadata mismatch');
  }
  if (!isSpikeId(payload.documentId)) throw new TypeError('invalid snapshot documentId');
  if (!isNonNegativeSafeInteger(payload.localRevision)) {
    throw new TypeError('invalid local snapshot revision');
  }

  const model = decodeAuthoredState(payload.authoredState, payload.localRevision);
  if (actorSessionGroupHistory.safeAuditCursor.sequence !== model.revision) {
    throw new TypeError('local history audit cursor/revision mismatch');
  }
  const authoredFingerprint = fingerprintAuthoredModel(model);
  if (
    payload.authoredFingerprint !== authoredFingerprint ||
    snapshot.checkpoint !== checkpointFor(model.revision, authoredFingerprint)
  ) {
    throw new TypeError('local snapshot authored fingerprint mismatch');
  }

  const allocator = readClosedDataObject(
    payload.allocator,
    ['actorId', 'nextCommitSeq', 'nextLocalSeq', 'reservedSemanticIds'],
    'local snapshot allocator'
  );
  if (
    !isSpikeId(allocator.actorId) ||
    !isPositiveSafeInteger(allocator.nextCommitSeq) ||
    !isPositiveSafeInteger(allocator.nextLocalSeq)
  ) {
    throw new TypeError('invalid local snapshot allocator');
  }
  const reservedSemanticIds = readUniqueIds(
    allocator.reservedSemanticIds,
    'reserved semantic IDs',
    true
  );
  const appliedCommitIds = readUniqueIds(payload.appliedCommitIds, 'applied commit IDs', true);
  const appliedConstituentIds = readUniqueIds(
    payload.appliedConstituentIds,
    'applied constituent IDs',
    true
  );
  const authoredIds = collectSemanticIds(model);
  if (authoredIds.some((id) => !reservedSemanticIds.includes(id))) {
    throw new TypeError('local snapshot allocator omits authored identity');
  }

  const identity = Object.freeze({
    documentId: snapshot.documentId,
    backendVersion: snapshot.backendVersion,
    schemaVersion: snapshot.schemaVersion,
    normalizationVersion: snapshot.normalizationVersion,
  });
  const env: OperationEnvironment = Object.freeze({
    actorId: allocator.actorId,
    nextCommitSeq: allocator.nextCommitSeq,
    nextLocalSeq: allocator.nextLocalSeq,
    reservedSemanticIds: new Set(reservedSemanticIds),
  });
  return Object.freeze({
    identity,
    model,
    env,
    coverage: createBackendCoverage(appliedConstituentIds, appliedCommitIds),
    actorSessionGroupHistory,
  });
}

function decodeAuthoredState(value: unknown, localRevision: number): DocumentModel {
  const authored = readClosedDataObject(
    value,
    ['revision', 'storyId', 'paragraphs', 'capsules'],
    'local snapshot authored state'
  );
  if (authored.revision !== localRevision || typeof authored.storyId !== 'string') {
    throw new TypeError('local snapshot authored revision mismatch');
  }
  const paragraphInputs = snapshotDenseArray(authored.paragraphs, 'snapshot paragraphs');
  const paragraphOrder: string[] = [];
  const paragraphs = new Map<string, AuthoredParagraph>();
  for (const paragraphInput of paragraphInputs) {
    const paragraph = readClosedDataObject(
      paragraphInput,
      ['blockId', 'paragraphId', 'text', 'styleId', 'marks', 'authoredProperties'],
      'snapshot paragraph'
    );
    const marks = snapshotDenseArray(paragraph.marks, 'snapshot marks').map((markInput) => {
      const mark = readClosedDataObject(
        markInput,
        ['markId', 'kind', 'start', 'end'],
        'snapshot mark'
      );
      return { ...mark } as unknown as AuthoredMark;
    });
    const properties = decodeAuthoredProperties(paragraph.authoredProperties);
    const paragraphId = paragraph.paragraphId;
    if (typeof paragraphId !== 'string' || paragraphs.has(paragraphId)) {
      throw new TypeError('invalid snapshot paragraph identity');
    }
    paragraphOrder.push(paragraphId);
    paragraphs.set(paragraphId, {
      blockId: paragraph.blockId,
      paragraphId,
      text: paragraph.text,
      styleId: paragraph.styleId,
      marks,
      authoredProperties: properties,
    } as AuthoredParagraph);
  }
  const capsules = snapshotDenseArray(authored.capsules, 'snapshot capsules').map(
    decodeCapsule
  );
  const packageModel: AuthoredPackageModelInput = {
    body: {
      storyId: authored.storyId as string,
      paragraphOrder,
      paragraphs,
    },
    capsules,
  };
  return createDocumentModel(packageModel, localRevision);
}

function decodeAuthoredProperties(value: unknown): Record<string, AuthoredProperty> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError('snapshot authored properties must be a plain object');
  }
  const result: Record<string, AuthoredProperty> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key)) {
      throw new TypeError('invalid snapshot authored property key');
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!descriptor.enumerable || !('value' in descriptor)) {
      throw new TypeError('snapshot authored property accessors are forbidden');
    }
    const property = descriptor.value as Record<string, unknown>;
    const state = property?.state;
    const expected =
      state === 'omitted' ? ['state'] : state === 'raw' ? ['state', 'rawLexical'] : ['state', 'value'];
    result[key] = readClosedDataObject(
      property,
      expected,
      'snapshot authored property'
    ) as unknown as AuthoredProperty;
  }
  return result;
}

function decodeCapsule(value: unknown): UnsupportedCapsule {
  const capsule = readClosedDataObject(
    value,
    [
      'capsuleId',
      'ownerStoryId',
      'ownerBlockId',
      'childIndex',
      'byteBoundaryStart',
      'byteBoundaryEnd',
      'bytesHex',
      'namespaceBindings',
      'previousSiblingBytesHex',
      'nextSiblingBytesHex',
    ],
    'snapshot capsule'
  );
  const namespaceBindings = capsule.namespaceBindings;
  if (
    namespaceBindings === null ||
    typeof namespaceBindings !== 'object' ||
    Object.getPrototypeOf(namespaceBindings) !== Object.prototype
  ) {
    throw new TypeError('invalid snapshot capsule namespaces');
  }
  return {
    capsuleId: capsule.capsuleId,
    ownerStoryId: capsule.ownerStoryId,
    ownerBlockId: capsule.ownerBlockId,
    childIndex: capsule.childIndex,
    byteBoundaryStart: capsule.byteBoundaryStart,
    byteBoundaryEnd: capsule.byteBoundaryEnd,
    bytes: decodeHex(capsule.bytesHex, 'capsule bytes'),
    namespaceBindings: { ...(namespaceBindings as Record<string, string>) },
    previousSiblingBytes: decodeHex(capsule.previousSiblingBytesHex, 'previous sibling bytes'),
    nextSiblingBytes: decodeHex(capsule.nextSiblingBytesHex, 'next sibling bytes'),
  } as UnsupportedCapsule;
}

function decodeHex(value: unknown, label: string): Uint8Array {
  if (typeof value !== 'string' || value.length % 2 !== 0 || !/^[0-9a-f]*$/.test(value)) {
    throw new TypeError(`invalid ${label}`);
  }
  return Uint8Array.from(
    Array.from({ length: value.length / 2 }, (_, index) =>
      Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
    )
  );
}

function readUniqueIds(value: unknown, label: string, allowEmpty: boolean): string[] {
  const ids = snapshotDenseArray(value, label);
  if ((!allowEmpty && ids.length === 0) || ids.some((id) => !isSpikeId(id))) {
    throw new TypeError(`invalid ${label}`);
  }
  if (new Set(ids).size !== ids.length) throw new TypeError(`duplicate ${label}`);
  const strings = ids as string[];
  if (!strings.every((id, index) => index === 0 || codeUnitCompare(strings[index - 1]!, id) < 0)) {
    throw new TypeError(`${label} must be canonically ordered`);
  }
  return strings;
}

function collectSemanticIds(model: DocumentModel): string[] {
  const ids: string[] = [];
  for (const paragraphId of model.authored.body.paragraphOrder) {
    const paragraph = model.authored.body.paragraphs.get(paragraphId)!;
    ids.push(paragraph.blockId, paragraph.paragraphId);
    for (const mark of paragraph.marks) ids.push(mark.markId);
  }
  for (const capsule of model.authored.capsules) ids.push(capsule.capsuleId);
  return ids;
}

function checkpointFor(revision: number, fingerprint: string): string {
  return `local-${revision}-${fingerprint.slice(0, 24)}`;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function codeUnitCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function parseBoundedSnapshotJson(text: string): unknown {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const character of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{' || character === '[') {
      depth += 1;
      if (depth > 64) throw new TypeError('snapshot nesting exceeds quota');
    } else if (character === '}' || character === ']') {
      depth -= 1;
      if (depth < 0) throw new TypeError('invalid snapshot nesting');
    }
  }
  if (depth !== 0 || inString) throw new TypeError('invalid snapshot nesting');
  return JSON.parse(text);
}
