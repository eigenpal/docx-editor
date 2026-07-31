/** @spike-features insert-delete-split-join-operations, origin-metadata */
import { canonicalJson } from '../../canonical-json';
import { readClosedDataObject, snapshotDenseArray } from '../../contracts/closed-input';
import { isSpikeId } from '../../contracts/ids';
import type { DocOpSingle } from '../../contracts/doc-op';
import { snapshotAndValidateInternalDocOpSingle } from '../../contracts/doc-op';
import type { MutableDraft } from '../draft';
import { cloneDraft, draftToAuthoredPackage } from '../draft';
import {
  isUnsafeAuthoredPropertyName,
  isValidAuthoredProperty,
  rejectsResolvedOrCacheAuthoredPropertyName,
} from '../../model/authored-property';

export const HISTORY_ENTRY_VERSION = 'history-entry/1';
export const HISTORY_STACK_VERSION = 'actor-session-history/1';
export const IDENTITY_TOMBSTONE_VERSION = 'identity-tombstone/1';
export const HISTORY_DOCOP_PAYLOAD_VERSION = 'history-docop-payload/1';
export const HISTORY_REPAIR_EFFECT_VERSION = 'history-repair-effect/1';

export const MAX_UNDO_ENTRIES_PER_ACTOR_SESSION = 256;
export const MAX_REDO_ENTRIES_PER_ACTOR_SESSION = 256;
export const MAX_CONSTITUENTS_PER_HISTORY_ENTRY = 64;
export const MAX_OPS_PER_HISTORY_ENTRY = 64;
export const MAX_TOMBSTONES_PER_HISTORY_ENTRY = 256;
export const MAX_DRAFT_SNAPSHOT_CODE_UNITS = 2_000_000;
export const MAX_HISTORY_STACKS = 256;
export const MAX_HISTORY_ENTRIES = 4096;
export const MAX_HISTORY_DRAFT_CODE_UNITS = 8_000_000;

export type IdentityTombstoneKind = 'block' | 'paragraph' | 'mark';

export interface IdentityTombstone {
  readonly version: typeof IDENTITY_TOMBSTONE_VERSION;
  readonly kind: IdentityTombstoneKind;
  readonly restoredId: string;
  readonly role: 'split-tail' | 'deleted' | 'remapped';
  readonly headId?: string;
  readonly splitOffset?: number;
}

export interface VersionedDocOpPayload {
  readonly version: typeof HISTORY_DOCOP_PAYLOAD_VERSION;
  readonly ops: readonly DocOpSingle[];
}

export interface HistoryRepairEffect {
  readonly version: typeof HISTORY_REPAIR_EFFECT_VERSION;
  readonly kind: 'restore-mark-identity';
  readonly restoredId: string;
  readonly normalizedId: string;
}

export interface HistoryEntry {
  readonly version: typeof HISTORY_ENTRY_VERSION;
  readonly actorId: string;
  readonly sessionId: string;
  readonly groupId: string;
  readonly constituentIds: readonly string[];
  readonly commitId: string;
  readonly revisionAfter: number;
  readonly forward: VersionedDocOpPayload;
  readonly inverse: VersionedDocOpPayload;
  readonly tombstones: readonly IdentityTombstone[];
  readonly beforeDraftSnapshot: string;
  readonly repairEffects: readonly HistoryRepairEffect[];
  readonly appliedRepair: boolean;
  readonly normalizationOwner: string | null;
}

export interface ActorSessionHistoryStacks {
  readonly version: typeof HISTORY_STACK_VERSION;
  readonly actorId: string;
  readonly sessionId: string;
  readonly undoStack: readonly HistoryEntry[];
  readonly redoStack: readonly HistoryEntry[];
}

export interface RedoEligibilityRecord {
  readonly actorId: string;
  readonly sessionId: string;
  readonly eligible: boolean;
  readonly reason: string | null;
}

export interface SafeAuditCursor {
  readonly version: 'audit-cursor/1';
  readonly sequence: number;
  readonly containsRawText: false;
  readonly containsProjectionOrAwareness: false;
}

export interface ActorSessionGroupHistoryState {
  readonly normalizationVersion: string;
  readonly stacks: readonly ActorSessionHistoryStacks[];
  readonly redoEligibility: readonly RedoEligibilityRecord[];
  readonly safeAuditCursor: SafeAuditCursor;
}

export function actorSessionKey(actorId: string, sessionId: string): string {
  return `${actorId}\u0000${sessionId}`;
}

export function serializeDraftSnapshot(draft: MutableDraft): string {
  const payload = draftToAuthoredPackage(cloneDraft(draft));
  return canonicalJson({
    storyId: payload.body.storyId,
    paragraphOrder: payload.body.paragraphOrder,
    paragraphs: payload.body.paragraphOrder.map((paragraphId) => {
      const paragraph = payload.body.paragraphs.get(paragraphId)!;
      return {
        blockId: paragraph.blockId,
        paragraphId: paragraph.paragraphId,
        text: paragraph.text,
        styleId: paragraph.styleId,
        marks: paragraph.marks.map((mark) => ({ ...mark })),
        authoredProperties: { ...paragraph.authoredProperties },
      };
    }),
    capsules: payload.capsules.map((capsule) => ({
      capsuleId: capsule.capsuleId,
      ownerStoryId: capsule.ownerStoryId,
      ownerBlockId: capsule.ownerBlockId,
      childIndex: capsule.childIndex,
    })),
  });
}

export function deserializeDraftSnapshot(
  snapshot: string,
  capsules: MutableDraft['capsules']
): MutableDraft {
  let decoded: unknown;
  try {
    decoded = JSON.parse(snapshot);
  } catch {
    throw new TypeError('invalid draft snapshot JSON');
  }
  const payload = readClosedDataObject(
    decoded,
    ['storyId', 'paragraphOrder', 'paragraphs', 'capsules'],
    'draft snapshot'
  );
  const paragraphOrder = snapshotDenseArray(
    payload.paragraphOrder,
    'draft snapshot paragraphOrder'
  ) as string[];
  const paragraphInputs = snapshotDenseArray(payload.paragraphs, 'draft snapshot paragraphs');
  if (paragraphOrder.length > 256 || paragraphInputs.length > 256) {
    throw new TypeError('draft snapshot paragraph quota exceeded');
  }
  const paragraphs = new Map<string, import('../draft').MutableParagraph>();
  for (const paragraphInput of paragraphInputs) {
    const paragraph = readClosedDataObject(
      paragraphInput,
      ['blockId', 'paragraphId', 'text', 'styleId', 'marks', 'authoredProperties'],
      'draft snapshot paragraph'
    );
    const markInputs = snapshotDenseArray(paragraph.marks, 'draft snapshot marks');
    if (markInputs.length > 256) {
      throw new TypeError('draft snapshot mark quota exceeded');
    }
    const marks = markInputs.map((markInput) => {
      const mark = readClosedDataObject(
        markInput,
        ['markId', 'kind', 'start', 'end'],
        'draft snapshot mark'
      );
      if (
        !isSpikeId(mark.markId) ||
        (mark.kind !== 'bold' && mark.kind !== 'italic') ||
        !Number.isSafeInteger(mark.start) ||
        !Number.isSafeInteger(mark.end) ||
        (mark.start as number) < 0 ||
        (mark.end as number) <= (mark.start as number) ||
        typeof paragraph.text !== 'string' ||
        (mark.end as number) > paragraph.text.length
      ) {
        throw new TypeError('invalid draft snapshot mark');
      }
      return {
        markId: mark.markId as string,
        kind: mark.kind as 'bold' | 'italic',
        start: mark.start as number,
        end: mark.end as number,
      };
    });
    if (
      !isSpikeId(paragraph.blockId) ||
      !isSpikeId(paragraph.paragraphId) ||
      typeof paragraph.text !== 'string' ||
      paragraph.text.length > 1_000_000 ||
      typeof paragraph.styleId !== 'string' ||
      paragraph.styleId.length === 0
    ) {
      throw new TypeError('invalid draft snapshot paragraph');
    }
    validateDraftAuthoredProperties(paragraph.authoredProperties);
    paragraphs.set(paragraph.paragraphId as string, {
      blockId: paragraph.blockId as string,
      paragraphId: paragraph.paragraphId as string,
      text: paragraph.text as string,
      styleId: paragraph.styleId as string,
      marks,
      authoredProperties: paragraph.authoredProperties as Record<
        string,
        import('../../model/authored-property').AuthoredProperty
      >,
    });
  }
  const capsuleInputs = snapshotDenseArray(payload.capsules, 'draft snapshot capsules');
  if (capsuleInputs.length > 16) {
    throw new TypeError('draft snapshot capsule quota exceeded');
  }
  for (const capsuleInput of capsuleInputs) {
    const capsule = readClosedDataObject(
      capsuleInput,
      ['capsuleId', 'ownerStoryId', 'ownerBlockId', 'childIndex'],
      'draft snapshot capsule'
    );
    if (
      !isSpikeId(capsule.capsuleId) ||
      !isSpikeId(capsule.ownerStoryId) ||
      !isSpikeId(capsule.ownerBlockId) ||
      capsule.ownerStoryId !== payload.storyId ||
      ![...paragraphs.values()].some((paragraph) => paragraph.blockId === capsule.ownerBlockId) ||
      !Number.isSafeInteger(capsule.childIndex) ||
      (capsule.childIndex as number) < 0
    ) {
      throw new TypeError('invalid draft snapshot capsule');
    }
  }
  if (
    !isSpikeId(payload.storyId) ||
    new Set(paragraphOrder).size !== paragraphOrder.length ||
    paragraphOrder.some((paragraphId) => !isSpikeId(paragraphId) || !paragraphs.has(paragraphId)) ||
    paragraphs.size !== paragraphOrder.length ||
    new Set([...paragraphs.values()].map((paragraph) => paragraph.blockId)).size !== paragraphs.size
  ) {
    throw new TypeError('invalid draft snapshot story structure');
  }
  const draft: MutableDraft = {
    storyId: payload.storyId as string,
    paragraphOrder: [...paragraphOrder],
    paragraphs,
    capsules,
  };
  return draft;
}

function validateDraftAuthoredProperties(value: unknown): void {
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError('invalid draft snapshot authored properties');
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length > 64) {
    throw new TypeError('draft snapshot authored property quota exceeded');
  }
  for (const key of keys) {
    if (
      typeof key !== 'string' ||
      isUnsafeAuthoredPropertyName(key) ||
      rejectsResolvedOrCacheAuthoredPropertyName(key)
    ) {
      throw new TypeError('invalid draft snapshot authored property key');
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !('value' in descriptor) ||
      !isValidAuthoredProperty(descriptor.value)
    ) {
      throw new TypeError('invalid draft snapshot authored property');
    }
  }
}

export function createVersionedDocOpPayload(ops: readonly DocOpSingle[]): VersionedDocOpPayload {
  if (ops.length === 0) throw new TypeError('history payload requires operations');
  if (ops.length > MAX_OPS_PER_HISTORY_ENTRY) {
    throw new TypeError('history payload exceeds operation quota');
  }
  return Object.freeze({
    version: HISTORY_DOCOP_PAYLOAD_VERSION,
    ops: Object.freeze(ops.map((op) => Object.freeze({ ...op }))),
  });
}

export function validateHistoryEntry(entry: HistoryEntry): readonly string[] {
  const errors: string[] = [];
  if (entry.version !== HISTORY_ENTRY_VERSION) errors.push('invalid history entry version');
  if (!isSpikeId(entry.actorId)) errors.push('invalid history actorId');
  if (!isSpikeId(entry.sessionId)) errors.push('invalid history sessionId');
  if (!isSpikeId(entry.groupId)) errors.push('invalid history groupId');
  if (!isSpikeId(entry.commitId)) errors.push('invalid history commitId');
  if (
    entry.constituentIds.length === 0 ||
    entry.constituentIds.length > MAX_CONSTITUENTS_PER_HISTORY_ENTRY
  ) {
    errors.push('invalid constituent count');
  }
  for (const id of entry.constituentIds) {
    if (!isSpikeId(id)) errors.push('invalid constituent ID');
  }
  if (entry.forward.version !== HISTORY_DOCOP_PAYLOAD_VERSION)
    errors.push('invalid forward payload version');
  if (entry.inverse.version !== HISTORY_DOCOP_PAYLOAD_VERSION)
    errors.push('invalid inverse payload version');
  for (const [label, payload] of [
    ['forward', entry.forward],
    ['inverse', entry.inverse],
  ] as const) {
    if (payload.ops.length === 0 || payload.ops.length > MAX_OPS_PER_HISTORY_ENTRY) {
      errors.push(`${label} payload exceeds operation quota`);
    }
    for (const op of payload.ops) {
      errors.push(
        ...snapshotAndValidateInternalDocOpSingle(op).errors.map(
          (error) => `${label} payload ${error}`
        )
      );
    }
  }
  if (entry.tombstones.length > MAX_TOMBSTONES_PER_HISTORY_ENTRY) {
    errors.push('tombstones exceed history quota');
  }
  for (const tombstone of entry.tombstones) {
    if (tombstone.version !== IDENTITY_TOMBSTONE_VERSION) errors.push('invalid tombstone version');
    if (!['block', 'paragraph', 'mark'].includes(tombstone.kind))
      errors.push('invalid tombstone kind');
    if (!['split-tail', 'deleted', 'remapped'].includes(tombstone.role))
      errors.push('invalid tombstone role');
    if (!isSpikeId(tombstone.restoredId)) errors.push('invalid tombstone restoredId');
    if (tombstone.headId !== undefined && !isSpikeId(tombstone.headId)) {
      errors.push('invalid tombstone headId');
    }
    if (
      tombstone.splitOffset !== undefined &&
      (!Number.isSafeInteger(tombstone.splitOffset) || tombstone.splitOffset < 0)
    ) {
      errors.push('invalid tombstone splitOffset');
    }
    if (
      tombstone.role === 'split-tail' &&
      (tombstone.headId === undefined || tombstone.splitOffset === undefined)
    ) {
      errors.push('split-tail tombstone requires head and offset');
    }
    if (
      tombstone.role === 'remapped' &&
      (tombstone.headId === undefined || tombstone.splitOffset !== undefined)
    ) {
      errors.push('invalid remapped tombstone shape');
    }
    if (tombstone.role === 'deleted' && tombstone.splitOffset !== undefined) {
      errors.push('deleted tombstone cannot carry split offset');
    }
  }
  if (
    new Set(
      entry.tombstones.map(
        (tombstone) =>
          `${tombstone.kind}\u0000${tombstone.restoredId}\u0000${tombstone.headId ?? ''}`
      )
    ).size !== entry.tombstones.length
  ) {
    errors.push('duplicate identity tombstone');
  }
  if (
    typeof entry.beforeDraftSnapshot !== 'string' ||
    entry.beforeDraftSnapshot.length === 0 ||
    entry.beforeDraftSnapshot.length > MAX_DRAFT_SNAPSHOT_CODE_UNITS
  ) {
    errors.push('invalid before draft snapshot');
  }
  if (!Array.isArray(entry.repairEffects)) {
    errors.push('invalid repair effects');
  } else {
    for (const effect of entry.repairEffects) {
      if (
        effect.version !== HISTORY_REPAIR_EFFECT_VERSION ||
        effect.kind !== 'restore-mark-identity' ||
        !isSpikeId(effect.restoredId) ||
        !isSpikeId(effect.normalizedId)
      ) {
        errors.push('invalid repair effect');
      }
    }
  }
  if (typeof entry.appliedRepair !== 'boolean') errors.push('invalid appliedRepair');
  if (
    entry.appliedRepair ? !isSpikeId(entry.normalizationOwner) : entry.normalizationOwner !== null
  ) {
    errors.push('invalid normalization ownership');
  }
  if (!Number.isSafeInteger(entry.revisionAfter) || entry.revisionAfter < 1) {
    errors.push('invalid history revision');
  }
  return errors;
}

export function createEmptyActorSessionGroupHistoryState(
  normalizationVersion: string,
  revision = 0
): ActorSessionGroupHistoryState {
  return Object.freeze({
    normalizationVersion,
    stacks: Object.freeze([]),
    redoEligibility: Object.freeze([]),
    safeAuditCursor: createSafeAuditCursor(revision),
  });
}

export function createSafeAuditCursor(sequence: number): SafeAuditCursor {
  if (!Number.isInteger(sequence) || sequence < 0)
    throw new TypeError('invalid audit cursor sequence');
  return Object.freeze({
    version: 'audit-cursor/1',
    sequence,
    containsRawText: false as const,
    containsProjectionOrAwareness: false as const,
  });
}
