/** @spike-features origin-metadata, insert-delete-split-join-operations */
import type { DocOpSingle } from '../../contracts/doc-op';
import type { MutationOrigin } from '../../contracts/origins';
import { isSpikeId } from '../../contracts/ids';
import {
  buildVersionedForward,
  computeInverseOps,
  tombstoneReservedIds,
} from './inverse';
import {
  HISTORY_ENTRY_VERSION,
  HISTORY_REPAIR_EFFECT_VERSION,
  HISTORY_STACK_VERSION,
  MAX_CONSTITUENTS_PER_HISTORY_ENTRY,
  MAX_HISTORY_DRAFT_CODE_UNITS,
  MAX_HISTORY_ENTRIES,
  MAX_HISTORY_STACKS,
  MAX_REDO_ENTRIES_PER_ACTOR_SESSION,
  MAX_UNDO_ENTRIES_PER_ACTOR_SESSION,
  actorSessionKey,
  createSafeAuditCursor,
  createVersionedDocOpPayload,
  deserializeDraftSnapshot,
  validateHistoryEntry,
  type ActorSessionGroupHistoryState,
  type ActorSessionHistoryStacks,
  type HistoryEntry,
  type HistoryRepairEffect,
  type IdentityTombstone,
  type RedoEligibilityRecord,
  type SafeAuditCursor,
} from './types';

export interface HistoryCommitInput {
  readonly actorId: string;
  readonly sessionId: string;
  readonly groupId: string;
  readonly constituentIds: readonly string[];
  readonly commitId: string;
  readonly revisionAfter: number;
  readonly forwardOps: readonly DocOpSingle[];
  readonly beforeDraftSnapshot: string;
  readonly tombstones: readonly IdentityTombstone[];
  readonly appliedRepair: boolean;
  readonly normalizationOwner: string | null;
}

export interface HistoryUndoRedoSelection {
  readonly actorId: string;
  readonly sessionId: string;
  readonly groupId: string;
  readonly constituentIds: readonly string[];
  readonly ops: readonly DocOpSingle[];
  readonly tombstones: readonly IdentityTombstone[];
}

export interface ActorHistoryInspection {
  readonly actorId: string;
  readonly sessionId: string;
  readonly undoEntries: number;
  readonly redoEntries: number;
  readonly redoEligible: boolean;
  readonly redoIneligibleReason: string | null;
}

export interface PreparedHistoryCommit {
  readonly key: string;
  readonly entry: HistoryEntry;
  readonly replaceTop: boolean;
}

export interface PreparedHistoryTransform {
  readonly stacks: ReadonlyMap<
    string,
    { readonly undo: readonly HistoryEntry[]; readonly redo: readonly HistoryEntry[] }
  >;
}

const TRUSTED_MANAGERS = new WeakSet<object>();

export interface ActorSessionGroupHistoryManager {
  readonly normalizationVersion: string;
  prepareEligibleCommit(input: HistoryCommitInput): PreparedHistoryCommit;
  commitPrepared(prepared: PreparedHistoryCommit): void;
  prepareTransform(
    ops: readonly DocOpSingle[],
    exclude?: {
      readonly actorId: string;
      readonly sessionId: string;
      readonly groupId: string;
    }
  ): PreparedHistoryTransform;
  commitTransform(prepared: PreparedHistoryTransform): void;
  recordEligibleCommit(input: HistoryCommitInput): void;
  selectUndo(input: { actorId: string; sessionId: string }): HistoryUndoRedoSelection | null;
  selectRedo(input: { actorId: string; sessionId: string }): HistoryUndoRedoSelection | null;
  commitUndoRedo(input: {
    actorId: string;
    sessionId: string;
    direction: 'undo' | 'redo';
    selection: HistoryUndoRedoSelection;
  }): void;
  invalidateRedo(actorId: string, sessionId: string, reason: string): void;
  isRedoEligible(actorId: string, sessionId: string): boolean;
  inspectActor(actorId: string, sessionId: string): ActorHistoryInspection;
  snapshot(revision: number): ActorSessionGroupHistoryState;
  replaceFromSnapshot(state: ActorSessionGroupHistoryState, revision: number): void;
  reservedTombstoneIds(): readonly string[];
}

export function createActorSessionGroupHistoryManager(
  normalizationVersion: string
): ActorSessionGroupHistoryManager {
  const stacks = new Map<string, { undo: HistoryEntry[]; redo: HistoryEntry[] }>();
  const redoEligibility = new Map<string, { eligible: boolean; reason: string | null }>();
  let auditSequence = 0;

  const manager = {
    normalizationVersion,
    prepareEligibleCommit(input: HistoryCommitInput): PreparedHistoryCommit {
      const key = actorSessionKey(input.actorId, input.sessionId);
      const session = stacks.get(key);
      if (!session && stacks.size >= MAX_HISTORY_STACKS) {
        throw new TypeError('history stack aggregate quota exceeded');
      }
      const mergedForward = [...input.forwardOps];
      const mergedConstituents = [...input.constituentIds];
      const top = session?.undo[session.undo.length - 1];
      let beforeSnapshot = input.beforeDraftSnapshot;
      let inverseOps: readonly DocOpSingle[];
      if (top && top.groupId === input.groupId) {
        const combinedForward = Object.freeze([...top.forward.ops, ...mergedForward]);
        const combinedConstituents = Object.freeze([...top.constituentIds, ...mergedConstituents]);
        if (combinedConstituents.length > MAX_CONSTITUENTS_PER_HISTORY_ENTRY) {
          throw new TypeError('history group exceeds constituent quota');
        }
        beforeSnapshot = top.beforeDraftSnapshot;
        const mergedTombstones = Object.freeze([
          ...top.tombstones,
          ...input.tombstones.filter(
            (t) => !top.tombstones.some((existing) => existing.restoredId === t.restoredId)
          ),
        ]);
        const constituentBeforeDraft = deserializeDraftSnapshot(
          input.beforeDraftSnapshot,
          []
        );
        const constituentInverse = computeInverseOps(
          constituentBeforeDraft,
          mergedForward,
          input.tombstones
        );
        inverseOps = Object.freeze([
          ...constituentInverse,
          ...top.inverse.ops,
        ]);
        const mergedEntry: HistoryEntry = Object.freeze({
          version: HISTORY_ENTRY_VERSION,
          actorId: input.actorId,
          sessionId: input.sessionId,
          groupId: input.groupId,
          constituentIds: combinedConstituents,
          commitId: input.commitId,
          revisionAfter: input.revisionAfter,
          forward: buildVersionedForward(combinedForward),
          inverse: createVersionedDocOpPayload([...inverseOps]),
          tombstones: mergedTombstones,
          beforeDraftSnapshot: beforeSnapshot,
          repairEffects: mergeRepairEffects(
            top.repairEffects,
            repairEffectsFromTombstones(input.tombstones)
          ),
          appliedRepair: top.appliedRepair || input.appliedRepair,
          normalizationOwner: input.normalizationOwner ?? top.normalizationOwner,
        });
        validateEntryOrThrow(mergedEntry);
        validateAggregateCapacity(mergedEntry, top);
        return Object.freeze({ key, entry: mergedEntry, replaceTop: true });
      } else {
        if ((session?.undo.length ?? 0) >= MAX_UNDO_ENTRIES_PER_ACTOR_SESSION) {
          throw new TypeError('undo stack exceeds history quota');
        }
        const beforeDraft = deserializeDraftSnapshot(beforeSnapshot, []);
        inverseOps = computeInverseOps(beforeDraft, mergedForward, input.tombstones);
        const entry: HistoryEntry = Object.freeze({
          version: HISTORY_ENTRY_VERSION,
          actorId: input.actorId,
          sessionId: input.sessionId,
          groupId: input.groupId,
          constituentIds: Object.freeze(mergedConstituents),
          commitId: input.commitId,
          revisionAfter: input.revisionAfter,
          forward: buildVersionedForward(mergedForward),
          inverse: createVersionedDocOpPayload([...inverseOps]),
          tombstones: input.tombstones,
          beforeDraftSnapshot: beforeSnapshot,
          repairEffects: repairEffectsFromTombstones(input.tombstones),
          appliedRepair: input.appliedRepair,
          normalizationOwner: input.normalizationOwner,
        });
        validateEntryOrThrow(entry);
        validateAggregateCapacity(entry);
        return Object.freeze({ key, entry, replaceTop: false });
      }
    },
    commitPrepared(prepared: PreparedHistoryCommit) {
      let session = stacks.get(prepared.key);
      if (!session) {
        session = { undo: [], redo: [] };
        stacks.set(prepared.key, session);
      }
      if (prepared.replaceTop) {
        session.undo[session.undo.length - 1] = prepared.entry;
      } else {
        session.undo.push(prepared.entry);
      }
      session.redo.length = 0;
      setRedoEligible(prepared.key, false, 'new-eligible-local-edit');
      auditSequence = prepared.entry.revisionAfter;
    },
    recordEligibleCommit(input: HistoryCommitInput) {
      manager.commitPrepared(manager.prepareEligibleCommit(input));
    },
    prepareTransform(
      ops: readonly DocOpSingle[],
      exclude?: {
        readonly actorId: string;
        readonly sessionId: string;
        readonly groupId: string;
      }
    ): PreparedHistoryTransform {
      const transformed = new Map<
        string,
        { readonly undo: readonly HistoryEntry[]; readonly redo: readonly HistoryEntry[] }
      >();
      for (const [key, session] of stacks) {
        const undo = session.undo
          .map((entry) =>
            historyEntryMatches(entry, exclude)
              ? entry
              : transformHistoryEntry(entry, ops)
          )
          .filter((entry): entry is HistoryEntry => entry !== null);
        const redo = session.redo
          .map((entry) =>
            historyEntryMatches(entry, exclude)
              ? entry
              : transformHistoryEntry(entry, ops)
          )
          .filter((entry): entry is HistoryEntry => entry !== null);
        transformed.set(
          key,
          Object.freeze({
            undo: Object.freeze(undo),
            redo: Object.freeze(redo),
          })
        );
      }
      return Object.freeze({ stacks: transformed });
    },
    commitTransform(prepared: PreparedHistoryTransform) {
      for (const [key, transformed] of prepared.stacks) {
        const session = stacks.get(key);
        if (!session) continue;
        session.undo = [...transformed.undo];
        session.redo = [...transformed.redo];
        if (session.redo.length === 0) {
          setRedoEligible(key, false, 'remote-effect-consumed');
        }
      }
    },
    selectUndo(input: { actorId: string; sessionId: string }) {
      const session = stacks.get(actorSessionKey(input.actorId, input.sessionId));
      const entry = session?.undo[session.undo.length - 1];
      if (!entry) return null;
      return selectionFromEntry(entry, 'inverse');
    },
    selectRedo(input: { actorId: string; sessionId: string }) {
      const key = actorSessionKey(input.actorId, input.sessionId);
      if (!isRedoEligible(key)) return null;
      const session = stacks.get(key);
      const entry = session?.redo[session.redo.length - 1];
      if (!entry) return null;
      return selectionFromEntry(entry, 'forward');
    },
    commitUndoRedo(input: {
      actorId: string;
      sessionId: string;
      direction: 'undo' | 'redo';
      selection: HistoryUndoRedoSelection;
    }) {
      const key = actorSessionKey(input.actorId, input.sessionId);
      const session = getOrCreateStacks(key);
      if (input.direction === 'undo') {
        const entry = session.undo.pop();
        if (!entry) return;
        session.redo.push(entry);
        if (session.redo.length > MAX_REDO_ENTRIES_PER_ACTOR_SESSION) session.redo.shift();
        setRedoEligible(key, true, null);
      } else {
        const entry = session.redo.pop();
        if (!entry) return;
        session.undo.push(entry);
        if (session.undo.length > MAX_UNDO_ENTRIES_PER_ACTOR_SESSION) session.undo.shift();
        setRedoEligible(
          key,
          session.redo.length > 0,
          session.redo.length > 0 ? null : 'redo-consumed'
        );
      }
    },
    invalidateRedo(actorId: string, sessionId: string, reason: string) {
      const key = actorSessionKey(actorId, sessionId);
      const session = stacks.get(key);
      if (session) session.redo.length = 0;
      setRedoEligible(key, false, reason);
    },
    isRedoEligible(actorId: string, sessionId: string) {
      return isRedoEligible(actorSessionKey(actorId, sessionId));
    },
    inspectActor(actorId: string, sessionId: string) {
      const key = actorSessionKey(actorId, sessionId);
      const session = stacks.get(key);
      const eligibility = redoEligibility.get(key) ?? { eligible: false, reason: 'empty-redo' };
      return Object.freeze({
        actorId,
        sessionId,
        undoEntries: session?.undo.length ?? 0,
        redoEntries: session?.redo.length ?? 0,
        redoEligible: eligibility.eligible && (session?.redo.length ?? 0) > 0,
        redoIneligibleReason: eligibility.eligible ? null : eligibility.reason,
      });
    },
    snapshot(revision: number) {
      return Object.freeze({
        normalizationVersion,
        stacks: Object.freeze(
          [...stacks.entries()]
            .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
            .map(([key, session]) => {
              const [actorId, sessionId] = key.split('\u0000');
              return Object.freeze({
                version: HISTORY_STACK_VERSION,
                actorId: actorId!,
                sessionId: sessionId!,
                undoStack: Object.freeze(session.undo.map((entry) => Object.freeze({ ...entry }))),
                redoStack: Object.freeze(session.redo.map((entry) => Object.freeze({ ...entry }))),
              });
            })
        ),
        redoEligibility: Object.freeze(snapshotRedoEligibility()),
        safeAuditCursor: createSafeAuditCursor(revision),
      });
    },
    replaceFromSnapshot(state: ActorSessionGroupHistoryState, revision: number) {
      const errors = validateActorSessionGroupHistoryState(state);
      if (errors.length > 0) {
        throw new TypeError(`invalid history snapshot: ${errors.join('; ')}`);
      }
      if (state.normalizationVersion !== normalizationVersion)
        throw new TypeError('history normalization version mismatch');
      if (state.safeAuditCursor.sequence !== revision)
        throw new TypeError('history audit cursor/revision mismatch');
      // Validation above is complete. Only now publish the replacement.
      stacks.clear();
      redoEligibility.clear();
      for (const stack of state.stacks) {
        if (stack.version !== HISTORY_STACK_VERSION) throw new TypeError('invalid history stack version');
        for (const entry of [...stack.undoStack, ...stack.redoStack]) validateEntryOrThrow(entry);
        stacks.set(actorSessionKey(stack.actorId, stack.sessionId), {
          undo: [...stack.undoStack],
          redo: [...stack.redoStack],
        });
      }
      for (const record of state.redoEligibility) {
        redoEligibility.set(actorSessionKey(record.actorId, record.sessionId), {
          eligible: record.eligible,
          reason: record.reason,
        });
      }
      auditSequence = state.safeAuditCursor.sequence ?? revision;
    },
    reservedTombstoneIds() {
      const ids = new Set<string>();
      for (const session of stacks.values()) {
        for (const entry of [...session.undo, ...session.redo]) {
          for (const id of tombstoneReservedIds(entry.tombstones)) ids.add(id);
        }
      }
      return Object.freeze([...ids].sort());
    },
  } satisfies ActorSessionGroupHistoryManager;

  TRUSTED_MANAGERS.add(manager);
  return manager;

  function getOrCreateStacks(key: string) {
    let session = stacks.get(key);
    if (!session) {
      session = { undo: [], redo: [] };
      stacks.set(key, session);
      setRedoEligible(key, false, 'empty-redo');
    }
    return session;
  }

  function setRedoEligible(key: string, eligible: boolean, reason: string | null) {
    redoEligibility.set(key, { eligible, reason });
  }

  function isRedoEligible(key: string) {
    const record = redoEligibility.get(key);
    return record?.eligible === true;
  }

  function repairEffectsFromTombstones(
    tombstones: readonly IdentityTombstone[]
  ): readonly HistoryRepairEffect[] {
    return Object.freeze(
      tombstones
        .filter(
          (tombstone) =>
            tombstone.kind === 'mark' &&
            tombstone.role === 'remapped' &&
            tombstone.headId !== undefined
        )
        .map((tombstone) =>
          Object.freeze({
            version: HISTORY_REPAIR_EFFECT_VERSION,
            kind: 'restore-mark-identity' as const,
            restoredId: tombstone.restoredId,
            normalizedId: tombstone.headId!,
          })
        )
    );
  }

  function mergeRepairEffects(
    left: readonly HistoryRepairEffect[],
    right: readonly HistoryRepairEffect[]
  ): readonly HistoryRepairEffect[] {
    return Object.freeze([
      ...left,
      ...right.filter(
        (candidate) =>
          !left.some(
            (existing) =>
              existing.restoredId === candidate.restoredId &&
              existing.normalizedId === candidate.normalizedId
          )
      ),
    ]);
  }

  function validateAggregateCapacity(
    proposed: HistoryEntry,
    replaced?: HistoryEntry
  ): void {
    let entryCount = 0;
    let draftCodeUnits = 0;
    for (const session of stacks.values()) {
      for (const entry of [...session.undo, ...session.redo]) {
        if (entry === replaced) continue;
        entryCount += 1;
        draftCodeUnits += entry.beforeDraftSnapshot.length;
      }
    }
    entryCount += 1;
    draftCodeUnits += proposed.beforeDraftSnapshot.length;
    if (entryCount > MAX_HISTORY_ENTRIES) {
      throw new TypeError('history entry aggregate quota exceeded');
    }
    if (draftCodeUnits > MAX_HISTORY_DRAFT_CODE_UNITS) {
      throw new TypeError('history draft aggregate quota exceeded');
    }
  }

  function snapshotRedoEligibility(): RedoEligibilityRecord[] {
    return [...redoEligibility.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, record]) => {
        const [actorId, sessionId] = key.split('\u0000');
        return Object.freeze({
          actorId: actorId!,
          sessionId: sessionId!,
          eligible: record.eligible,
          reason: record.reason,
        });
      });
  }
}

export function isHistoryEligibleOrigin(origin: MutationOrigin): boolean {
  return origin.kind === 'human' || origin.kind === 'agent';
}

export function historyManagerIsTrusted(value: unknown): value is ActorSessionGroupHistoryManager {
  return typeof value === 'object' && value !== null && TRUSTED_MANAGERS.has(value);
}

function validateEntryOrThrow(entry: HistoryEntry): void {
  const errors = validateHistoryEntry(entry);
  if (errors.length > 0) throw new TypeError(`invalid history entry: ${errors.join('; ')}`);
}

function selectionFromEntry(
  entry: HistoryEntry,
  direction: 'forward' | 'inverse'
): HistoryUndoRedoSelection {
  const payload = direction === 'forward' ? entry.forward : entry.inverse;
  return Object.freeze({
    actorId: entry.actorId,
    sessionId: entry.sessionId,
    groupId: entry.groupId,
    constituentIds: Object.freeze([...entry.constituentIds]),
    ops: payload.ops,
    tombstones: entry.tombstones,
  });
}

function historyEntryMatches(
  entry: HistoryEntry,
  candidate: {
    readonly actorId: string;
    readonly sessionId: string;
    readonly groupId: string;
  } | undefined
): boolean {
  return (
    candidate !== undefined &&
    entry.actorId === candidate.actorId &&
    entry.sessionId === candidate.sessionId &&
    entry.groupId === candidate.groupId
  );
}

function transformHistoryEntry(
  entry: HistoryEntry,
  laterOps: readonly DocOpSingle[]
): HistoryEntry | null {
  let forward = [...entry.forward.ops];
  let inverse = [...entry.inverse.ops];
  for (const later of laterOps) {
    const insertPair = insertionPair(forward, inverse);
    if (insertPair && later.kind === 'insertText') {
      const split = splitOwnedInsertionThroughInsert(insertPair, later);
      if (split) {
        forward = split.forward;
        inverse = split.inverse;
        continue;
      }
    }
    if (insertPair && later.kind === 'deleteRange') {
      const split = splitOwnedInsertionThroughDelete(insertPair, later);
      if (split) {
        forward = split.forward;
        inverse = split.inverse;
        continue;
      }
    }
    forward = transformOps(forward, later, 'forward');
    inverse = transformOps(inverse, later, 'inverse');
  }
  if (forward.length === 0 || inverse.length === 0) return null;
  const transformed = Object.freeze({
    ...entry,
    forward: createVersionedDocOpPayload(forward),
    inverse: createVersionedDocOpPayload(inverse),
  });
  validateEntryOrThrow(transformed);
  return transformed;
}

function insertionPair(
  forward: readonly DocOpSingle[],
  inverse: readonly DocOpSingle[]
):
  | {
      readonly inserts: readonly Extract<DocOpSingle, { kind: 'insertText' }>[];
      readonly deletes: readonly Extract<DocOpSingle, { kind: 'deleteRange' }>[];
    }
  | null {
  const candidate = forward[0];
  if (
    forward.length === 0 ||
    candidate?.kind !== 'insertText' ||
    forward.some(
      (op) =>
        op.kind !== 'insertText' ||
        op.storyId !== candidate.storyId ||
        op.blockId !== candidate.blockId
    ) ||
    inverse.length === 0 ||
    forward.length !== inverse.length ||
    inverse.some(
      (op) =>
        op.kind !== 'deleteRange' ||
        op.storyId !== candidate.storyId ||
        op.blockId !== candidate.blockId
    )
  ) {
    return null;
  }
  return {
    inserts: forward as readonly Extract<
      DocOpSingle,
      { kind: 'insertText' }
    >[],
    deletes: inverse as readonly Extract<DocOpSingle, { kind: 'deleteRange' }>[],
  };
}

function splitOwnedInsertionThroughInsert(
  pair: NonNullable<ReturnType<typeof insertionPair>>,
  later: Extract<DocOpSingle, { kind: 'insertText' }>
): { forward: DocOpSingle[]; inverse: DocOpSingle[] } | null {
  const firstInsert = pair.inserts[0]!;
  if (
    firstInsert.storyId !== later.storyId ||
    firstInsert.blockId !== later.blockId
  ) {
    return null;
  }
  const containingIndex = pair.deletes.findIndex(
    (range) => later.offset > range.start && later.offset < range.end
  );
  if (containingIndex < 0) return null;
  const containing = pair.deletes[containingIndex]!;
  const containingInsert = pair.inserts[containingIndex]!;
  const splitOffset = later.offset - containing.start;
  const head = containingInsert.text.slice(0, splitOffset);
  const tail = containingInsert.text.slice(splitOffset);
  const delta = later.text.length;
  const ownedBefore = pair.deletes.reduce(
    (sum, range) =>
      sum +
      Math.max(0, Math.min(later.offset, range.end) - range.start),
    0
  );
  const remoteStartAfterUndo = later.offset - ownedBefore;
  const remoteEndAfterUndo = remoteStartAfterUndo + delta;
  const transformedDeletes = pair.deletes.flatMap((range) => {
    if (later.offset <= range.start) {
      return [{ ...range, start: range.start + delta, end: range.end + delta }];
    }
    if (later.offset >= range.end) return [range];
    return [
      { ...range, end: later.offset },
      { ...range, start: later.offset + delta, end: range.end + delta },
    ];
  });
  const transformedForward: DocOpSingle[] = pair.inserts
    .filter((_, index) => index !== containingIndex)
    .map((insert) => ({
      ...insert,
      offset:
        remoteStartAfterUndo < insert.offset
          ? insert.offset + delta
          : insert.offset,
    }));
  if (tail.length > 0) {
    transformedForward.push({
      ...containingInsert,
      offset: remoteEndAfterUndo,
      text: tail,
    });
  }
  if (head.length > 0) {
    transformedForward.push({
      ...containingInsert,
      text: head,
    });
  }
  return {
    forward: transformedForward.sort(
      (left, right) =>
        (right as Extract<DocOpSingle, { kind: 'insertText' }>).offset -
        (left as Extract<DocOpSingle, { kind: 'insertText' }>).offset
    ),
    inverse: transformedDeletes.sort(
      (left, right) => right.start - left.start
    ),
  };
}

function splitOwnedInsertionThroughDelete(
  pair: NonNullable<ReturnType<typeof insertionPair>>,
  later: Extract<DocOpSingle, { kind: 'deleteRange' }>
): { forward: DocOpSingle[]; inverse: DocOpSingle[] } | null {
  const firstInsert = pair.inserts[0]!;
  if (
    firstInsert.storyId !== later.storyId ||
    firstInsert.blockId !== later.blockId
  ) {
    return null;
  }
  const removed = later.end - later.start;
  const map = (offset: number) =>
    offset <= later.start
      ? offset
      : offset >= later.end
        ? offset - removed
        : later.start;
  const survivors: {
    range: Extract<DocOpSingle, { kind: 'deleteRange' }>;
    text: string;
  }[] = [];
  for (let index = 0; index < pair.deletes.length; index += 1) {
    const range = pair.deletes[index]!;
    const insert = pair.inserts[index]!;
    const leftEnd = Math.min(range.end, later.start);
    if (leftEnd > range.start) {
      survivors.push({
        range: {
          ...range,
          start: map(range.start),
          end: map(leftEnd),
        },
        text: insert.text.slice(0, leftEnd - range.start),
      });
    }
    const rightStart = Math.max(range.start, later.end);
    if (rightStart < range.end) {
      survivors.push({
        range: {
          ...range,
          start: map(rightStart),
          end: map(range.end),
        },
        text: insert.text.slice(rightStart - range.start),
      });
    }
  }
  if (survivors.length === 0) return { forward: [], inverse: [] };
  survivors.sort((left, right) => left.range.start - right.range.start);
  let removedOwned = 0;
  const forward = survivors.map((survivor) => {
    const offset = survivor.range.start - removedOwned;
    removedOwned += survivor.range.end - survivor.range.start;
    return {
      ...firstInsert,
      offset,
      text: survivor.text,
    };
  });
  return {
    forward: forward.reverse(),
    inverse: survivors
      .map((survivor) => survivor.range)
      .sort((left, right) => right.start - left.start),
  };
}

function transformOps(
  ops: readonly DocOpSingle[],
  later: DocOpSingle,
  payload: 'forward' | 'inverse'
): DocOpSingle[] {
  const transformed = ops.flatMap((op) => transformOp(op, later));
  if (
    payload === 'inverse' &&
    later.kind === 'setMark' &&
    later.enabled
  ) {
    const removesSameMark = transformed.some(
      (op) =>
        op.kind === 'setMark' &&
        !op.enabled &&
        op.storyId === later.storyId &&
        op.blockId === later.blockId &&
        op.mark === later.mark &&
        op.start < later.end &&
        op.end > later.start
    );
    if (removesSameMark) transformed.push({ ...later });
  }
  return transformed;
}

function transformOp(op: DocOpSingle, later: DocOpSingle): DocOpSingle[] {
  if (
    'blockId' in op &&
    'blockId' in later &&
    op.storyId === later.storyId &&
    op.blockId === later.blockId
  ) {
    if (later.kind === 'insertText') {
      return transformThroughInsert(op, later.offset, later.text.length);
    }
    if (later.kind === 'deleteRange') {
      return transformThroughDelete(op, later.start, later.end);
    }
    if (
      later.kind === 'setMark' &&
      !later.enabled &&
      op.kind === 'setMark' &&
      op.enabled &&
      op.mark === later.mark
    ) {
      return subtractRange(op, later.start, later.end);
    }
  }
  return [op];
}

function transformThroughInsert(
  op: DocOpSingle,
  offset: number,
  length: number
): DocOpSingle[] {
  if (op.kind === 'insertText') {
    return [{ ...op, offset: offset <= op.offset ? op.offset + length : op.offset }];
  }
  if (op.kind === 'splitParagraph') {
    return [{ ...op, offset: offset <= op.offset ? op.offset + length : op.offset }];
  }
  if (op.kind === 'deleteRange' || op.kind === 'setMark') {
    if (offset <= op.start) {
      return [{ ...op, start: op.start + length, end: op.end + length }];
    }
    if (offset >= op.end) return [op];
    return [
      { ...op, end: offset },
      { ...op, start: offset + length, end: op.end + length },
    ];
  }
  return [op];
}

function transformThroughDelete(
  op: DocOpSingle,
  start: number,
  end: number
): DocOpSingle[] {
  const removed = end - start;
  const map = (offset: number) =>
    offset <= start ? offset : offset >= end ? offset - removed : start;
  if (op.kind === 'insertText') return [{ ...op, offset: map(op.offset) }];
  if (op.kind === 'splitParagraph') return [{ ...op, offset: map(op.offset) }];
  if (op.kind === 'deleteRange' || op.kind === 'setMark') {
    const pieces = subtractRange(op, start, end).map((piece) => ({
      ...piece,
      start: map(piece.start),
      end: map(piece.end),
    }));
    return pieces.filter((piece) => piece.end > piece.start);
  }
  return [op];
}

function subtractRange<T extends Extract<DocOpSingle, { start: number; end: number }>>(
  op: T,
  start: number,
  end: number
): T[] {
  if (end <= op.start || start >= op.end) return [op];
  const result: T[] = [];
  if (start > op.start) result.push({ ...op, end: Math.min(start, op.end) });
  if (end < op.end) result.push({ ...op, start: Math.max(end, op.start) });
  return result;
}

export function validateActorSessionGroupHistoryState(
  state: ActorSessionGroupHistoryState
): readonly string[] {
  const errors: string[] = [];
  if (typeof state.normalizationVersion !== 'string' || state.normalizationVersion.length === 0) {
    errors.push('invalid normalizationVersion');
  }
  if (state.safeAuditCursor.version !== 'audit-cursor/1') errors.push('invalid audit cursor');
  if (
    !Number.isSafeInteger(state.safeAuditCursor.sequence) ||
    state.safeAuditCursor.sequence < 0
  ) {
    errors.push('invalid audit cursor sequence');
  }
  if (state.safeAuditCursor.containsRawText !== false) errors.push('audit cursor must exclude raw text');
  if (state.safeAuditCursor.containsProjectionOrAwareness !== false) {
    errors.push('audit cursor must exclude projection/awareness');
  }
  for (const stack of state.stacks) {
    if (stack.version !== HISTORY_STACK_VERSION) errors.push('invalid stack version');
    if (!isSpikeId(stack.actorId) || !isSpikeId(stack.sessionId)) {
      errors.push('invalid stack actor/session');
    }
    if (stack.undoStack.length > MAX_UNDO_ENTRIES_PER_ACTOR_SESSION) {
      errors.push('undo stack exceeds quota');
    }
    if (stack.redoStack.length > MAX_REDO_ENTRIES_PER_ACTOR_SESSION) {
      errors.push('redo stack exceeds quota');
    }
    const entries = [...stack.undoStack, ...stack.redoStack];
    for (const entry of entries) {
      errors.push(...validateHistoryEntry(entry));
      if (
        entry.actorId !== stack.actorId ||
        entry.sessionId !== stack.sessionId
      ) {
        errors.push('history entry actor/session mismatch');
      }
    }
    for (let index = 1; index < stack.undoStack.length; index += 1) {
      if (stack.undoStack[index - 1]!.groupId === stack.undoStack[index]!.groupId) {
        errors.push('adjacent history groups must be coalesced');
      }
    }
  }
  const stackKeys = state.stacks.map((stack) =>
    actorSessionKey(stack.actorId, stack.sessionId)
  );
  const eligibilityKeys = state.redoEligibility.map((record) =>
    actorSessionKey(record.actorId, record.sessionId)
  );
  if (
    new Set(stackKeys).size !== stackKeys.length ||
    new Set(eligibilityKeys).size !== eligibilityKeys.length ||
    stackKeys.some((key) => !eligibilityKeys.includes(key)) ||
    eligibilityKeys.some((key) => !stackKeys.includes(key))
  ) {
    errors.push('history stack/redo eligibility mismatch');
  }
  for (const stack of state.stacks) {
    const eligibility = state.redoEligibility.find(
      (record) =>
        record.actorId === stack.actorId && record.sessionId === stack.sessionId
    );
    if (
      !eligibility ||
      typeof eligibility.eligible !== 'boolean' ||
      eligibility.eligible !== (stack.redoStack.length > 0)
    ) {
      errors.push('invalid redo eligibility');
    }
  }
  for (const record of state.redoEligibility) {
    if (
      !isSpikeId(record.actorId) ||
      !isSpikeId(record.sessionId) ||
      typeof record.eligible !== 'boolean' ||
      (record.eligible
        ? record.reason !== null
        : typeof record.reason !== 'string' || record.reason.length === 0)
    ) {
      errors.push('invalid redo eligibility record');
    }
  }
  return errors.filter(Boolean);
}

export type { SafeAuditCursor };
