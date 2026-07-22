/** @spike-features origin-metadata, insert-delete-split-join-operations */
import { canonicalJson } from '../../canonical-json';
import { readClosedDataObject, snapshotDenseArray } from '../../contracts/closed-input';
import {
  snapshotAndValidateInternalDocOpSingle,
  type DocOpSingle,
} from '../../contracts/doc-op';
import {
  HISTORY_DOCOP_PAYLOAD_VERSION,
  HISTORY_ENTRY_VERSION,
  HISTORY_REPAIR_EFFECT_VERSION,
  HISTORY_STACK_VERSION,
  IDENTITY_TOMBSTONE_VERSION,
  MAX_OPS_PER_HISTORY_ENTRY,
  MAX_HISTORY_DRAFT_CODE_UNITS,
  MAX_HISTORY_ENTRIES,
  MAX_HISTORY_STACKS,
  MAX_REDO_ENTRIES_PER_ACTOR_SESSION,
  MAX_UNDO_ENTRIES_PER_ACTOR_SESSION,
  createSafeAuditCursor,
  deserializeDraftSnapshot,
  validateHistoryEntry,
  type ActorSessionGroupHistoryState,
  type HistoryEntry,
  type HistoryRepairEffect,
  type IdentityTombstone,
} from './types';
import { validateActorSessionGroupHistoryState } from './manager';

export interface HistorySnapshotPayload {
  readonly actorSessionGroupHistory: ActorSessionGroupHistoryState;
}

export function encodeHistorySnapshotPayload(
  state: ActorSessionGroupHistoryState
): Record<string, unknown> {
  const errors = validateActorSessionGroupHistoryState(state);
  if (errors.length > 0) throw new TypeError(`invalid history snapshot: ${errors.join('; ')}`);
  return {
    normalizationVersion: state.normalizationVersion,
    stacks: state.stacks.map((stack) => ({
      version: stack.version,
      actorId: stack.actorId,
      sessionId: stack.sessionId,
      undoStack: stack.undoStack.map(serializeHistoryEntry),
      redoStack: stack.redoStack.map(serializeHistoryEntry),
    })),
    redoEligibility: state.redoEligibility.map((record) => ({
      actorId: record.actorId,
      sessionId: record.sessionId,
      eligible: record.eligible,
      reason: record.reason,
    })),
    safeAuditCursor: { ...state.safeAuditCursor },
  };
}

export function decodeHistorySnapshotPayload(value: unknown): ActorSessionGroupHistoryState {
  const payload = readClosedDataObject(
    value,
    ['normalizationVersion', 'stacks', 'redoEligibility', 'safeAuditCursor'],
    'history snapshot payload'
  );
  const stackInputs = snapshotDenseArray(payload.stacks, 'history stacks');
  if (stackInputs.length > MAX_HISTORY_STACKS) {
    throw new TypeError('history stack aggregate quota exceeded');
  }
  let aggregateEntries = 0;
  let aggregateDraftCodeUnits = 0;
  const stacks = stackInputs.map((stackInput) => {
    const stack = readClosedDataObject(
      stackInput,
      ['version', 'actorId', 'sessionId', 'undoStack', 'redoStack'],
      'history stack'
    );
    if (stack.version !== HISTORY_STACK_VERSION) throw new TypeError('invalid history stack version');
    const actorId = stack.actorId as string;
    const sessionId = stack.sessionId as string;
    const undoStack = snapshotDenseArray(stack.undoStack, 'undo stack').map(
      deserializeHistoryEntry
    );
    const redoStack = snapshotDenseArray(stack.redoStack, 'redo stack').map(
      deserializeHistoryEntry
    );
    aggregateEntries += undoStack.length + redoStack.length;
    for (const entry of [...undoStack, ...redoStack]) {
      aggregateDraftCodeUnits += entry.beforeDraftSnapshot.length;
    }
    if (
      aggregateEntries > MAX_HISTORY_ENTRIES ||
      aggregateDraftCodeUnits > MAX_HISTORY_DRAFT_CODE_UNITS
    ) {
      throw new TypeError('history aggregate quota exceeded');
    }
    if (undoStack.length > MAX_UNDO_ENTRIES_PER_ACTOR_SESSION) {
      throw new TypeError('undo stack exceeds history quota');
    }
    if (redoStack.length > MAX_REDO_ENTRIES_PER_ACTOR_SESSION) {
      throw new TypeError('redo stack exceeds history quota');
    }
    if (
      [...undoStack, ...redoStack].some(
        (entry) =>
          entry.actorId !== actorId || entry.sessionId !== sessionId
      )
    ) {
      throw new TypeError('history entry actor/session does not match stack');
    }
    return Object.freeze({
      version: HISTORY_STACK_VERSION,
      actorId,
      sessionId,
      undoStack: Object.freeze(undoStack),
      redoStack: Object.freeze(redoStack),
    });
  });
  const redoEligibility = snapshotDenseArray(payload.redoEligibility, 'redo eligibility').map(
    (recordInput) => {
      const record = readClosedDataObject(
        recordInput,
        ['actorId', 'sessionId', 'eligible', 'reason'],
        'redo eligibility record'
      );
      return Object.freeze({
        actorId: record.actorId as string,
        sessionId: record.sessionId as string,
        eligible: record.eligible as boolean,
        reason: record.reason as string | null,
      });
    }
  );
  const cursor = readClosedDataObject(
    payload.safeAuditCursor,
    ['version', 'sequence', 'containsRawText', 'containsProjectionOrAwareness'],
    'safe audit cursor'
  );
  if (
    cursor.version !== 'audit-cursor/1' ||
    cursor.containsRawText !== false ||
    cursor.containsProjectionOrAwareness !== false
  ) {
    throw new TypeError('invalid safe audit cursor flags');
  }
  const state: ActorSessionGroupHistoryState = Object.freeze({
    normalizationVersion: payload.normalizationVersion as string,
    stacks: Object.freeze(stacks),
    redoEligibility: Object.freeze(redoEligibility),
    safeAuditCursor: createSafeAuditCursor(cursor.sequence as number),
  });
  const stackKeys = stacks.map((stack) => `${stack.actorId}\u0000${stack.sessionId}`);
  const eligibilityKeys = redoEligibility.map(
    (record) => `${record.actorId}\u0000${record.sessionId}`
  );
  if (
    new Set(stackKeys).size !== stackKeys.length ||
    new Set(eligibilityKeys).size !== eligibilityKeys.length ||
    stackKeys.some((key) => !eligibilityKeys.includes(key)) ||
    eligibilityKeys.some((key) => !stackKeys.includes(key))
  ) {
    throw new TypeError('history stack/redo eligibility keys mismatch');
  }
  for (const stack of stacks) {
    const eligibility = redoEligibility.find(
      (record) =>
        record.actorId === stack.actorId && record.sessionId === stack.sessionId
    )!;
    if (eligibility.eligible !== (stack.redoStack.length > 0)) {
      throw new TypeError('history redo eligibility does not match redo stack');
    }
  }
  const errors = validateActorSessionGroupHistoryState(state);
  if (errors.length > 0) throw new TypeError(`invalid decoded history snapshot: ${errors.join('; ')}`);
  return state;
}

function serializeHistoryEntry(entry: HistoryEntry): Record<string, unknown> {
  validateHistoryEntry(entry);
  return {
    version: entry.version,
    actorId: entry.actorId,
    sessionId: entry.sessionId,
    groupId: entry.groupId,
    constituentIds: [...entry.constituentIds],
    commitId: entry.commitId,
    revisionAfter: entry.revisionAfter,
    forward: { version: entry.forward.version, ops: [...entry.forward.ops] },
    inverse: { version: entry.inverse.version, ops: [...entry.inverse.ops] },
    tombstones: entry.tombstones.map((tombstone) => ({ ...tombstone })),
    beforeDraftSnapshot: entry.beforeDraftSnapshot,
    repairEffects: entry.repairEffects.map((effect) => ({ ...effect })),
    appliedRepair: entry.appliedRepair,
    normalizationOwner: entry.normalizationOwner,
  };
}

function deserializeHistoryEntry(input: unknown): HistoryEntry {
  const entry = readClosedDataObject(
    input,
    [
      'version',
      'actorId',
      'sessionId',
      'groupId',
      'constituentIds',
      'commitId',
      'revisionAfter',
      'forward',
      'inverse',
      'tombstones',
      'beforeDraftSnapshot',
      'repairEffects',
      'appliedRepair',
      'normalizationOwner',
    ],
    'history entry'
  );
  if (entry.version !== HISTORY_ENTRY_VERSION) throw new TypeError('invalid history entry version');
  const forward = readClosedDataObject(entry.forward, ['version', 'ops'], 'forward payload');
  const inverse = readClosedDataObject(entry.inverse, ['version', 'ops'], 'inverse payload');
  if (forward.version !== HISTORY_DOCOP_PAYLOAD_VERSION || inverse.version !== HISTORY_DOCOP_PAYLOAD_VERSION) {
    throw new TypeError('invalid versioned docop payload');
  }
  const forwardOps = snapshotHistoryOps(forward.ops, 'forward ops');
  const inverseOps = snapshotHistoryOps(inverse.ops, 'inverse ops');
  const deserialized: HistoryEntry = Object.freeze({
    version: HISTORY_ENTRY_VERSION,
    actorId: entry.actorId as string,
    sessionId: entry.sessionId as string,
    groupId: entry.groupId as string,
    constituentIds: Object.freeze(snapshotDenseArray(entry.constituentIds, 'constituentIds') as string[]),
    commitId: entry.commitId as string,
    revisionAfter: entry.revisionAfter as number,
    forward: Object.freeze({
      version: HISTORY_DOCOP_PAYLOAD_VERSION,
      ops: Object.freeze(forwardOps),
    }),
    inverse: Object.freeze({
      version: HISTORY_DOCOP_PAYLOAD_VERSION,
      ops: Object.freeze(inverseOps),
    }),
    tombstones: Object.freeze(
      snapshotDenseArray(entry.tombstones, 'tombstones').map((tombstoneInput) => {
        if (
          tombstoneInput === null ||
          typeof tombstoneInput !== 'object' ||
          Object.getPrototypeOf(tombstoneInput) !== Object.prototype
        ) {
          throw new TypeError('invalid identity tombstone');
        }
        const hasHeadId = Object.prototype.hasOwnProperty.call(
          tombstoneInput,
          'headId'
        );
        const hasSplitOffset = Object.prototype.hasOwnProperty.call(
          tombstoneInput,
          'splitOffset'
        );
        const tombstone = readClosedDataObject(
          tombstoneInput,
          [
            'version',
            'kind',
            'restoredId',
            'role',
            ...(hasHeadId ? ['headId'] : []),
            ...(hasSplitOffset ? ['splitOffset'] : []),
          ],
          'identity tombstone'
        );
        if (tombstone.version !== IDENTITY_TOMBSTONE_VERSION) {
          throw new TypeError('invalid identity tombstone version');
        }
        return Object.freeze({
          version: IDENTITY_TOMBSTONE_VERSION,
          kind: tombstone.kind as IdentityTombstone['kind'],
          restoredId: tombstone.restoredId as string,
          role: tombstone.role as IdentityTombstone['role'],
          ...(hasHeadId
            ? { headId: tombstone.headId as string }
            : {}),
          ...(hasSplitOffset
            ? { splitOffset: tombstone.splitOffset as number }
            : {}),
        }) as IdentityTombstone;
      })
    ),
    beforeDraftSnapshot: entry.beforeDraftSnapshot as string,
    repairEffects: Object.freeze(
      snapshotDenseArray(entry.repairEffects, 'repair effects').map(
        (effectInput) => {
          const effect = readClosedDataObject(
            effectInput,
            ['version', 'kind', 'restoredId', 'normalizedId'],
            'history repair effect'
          );
          if (
            effect.version !== HISTORY_REPAIR_EFFECT_VERSION ||
            effect.kind !== 'restore-mark-identity'
          ) {
            throw new TypeError('invalid history repair effect');
          }
          return Object.freeze({
            version: HISTORY_REPAIR_EFFECT_VERSION,
            kind: 'restore-mark-identity',
            restoredId: effect.restoredId as string,
            normalizedId: effect.normalizedId as string,
          }) satisfies HistoryRepairEffect;
        }
      )
    ),
    appliedRepair: entry.appliedRepair as boolean,
    normalizationOwner: entry.normalizationOwner as string | null,
  });
  deserializeDraftSnapshot(deserialized.beforeDraftSnapshot, []);
  const errors = validateHistoryEntry(deserialized);
  if (errors.length > 0) throw new TypeError(`invalid history entry: ${errors.join('; ')}`);
  return deserialized;
}

function snapshotHistoryOps(value: unknown, label: string): DocOpSingle[] {
  const inputs = snapshotDenseArray(value, label);
  if (inputs.length === 0 || inputs.length > MAX_OPS_PER_HISTORY_ENTRY) {
    throw new TypeError(`${label} exceeds history operation quota`);
  }
  return inputs.map((input, index) => {
    const validation = snapshotAndValidateInternalDocOpSingle(input);
    if (!validation.snapshot || validation.errors.length > 0) {
      throw new TypeError(`invalid ${label} ${index}`);
    }
    return validation.snapshot;
  });
}

export function historySnapshotFingerprint(state: ActorSessionGroupHistoryState): string {
  return canonicalJson(encodeHistorySnapshotPayload(state));
}
