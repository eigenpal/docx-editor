/** @spike-features origin-metadata, insert-delete-split-join-operations, yjs-backend */
import * as Y from 'yjs';
import { isDocOp, type DocOp } from '../../contracts/doc-op';
import { createModelChange, type ModelChange } from '../../contracts/model-change';
import {
  createMutationOrigin,
  snapshotAndValidateMutationOrigin,
  type MutationOrigin,
} from '../../contracts/origins';
import type {
  ApplyResult,
  ModelChangeSubscriber,
  NotificationDiagnostic,
} from '../../store/apply-result';
import { createRemoteCommitResult } from '../../store/backend/remote-diff';
import { stageSemanticMutation } from '../../store/backend/staging';
import { fingerprintAuthoredModel } from '../../model/fingerprint';
import { createDocumentModel } from '../../model/fixture';
import type { DocumentModel } from '../../model/types';
import { checkpointFor, hexEncode, nextReplicaCommitSeq } from '../../store/yjs/doc-access';
import { bootstrapYjsDocFromModel } from '../../store/yjs/doc-bootstrap';
import { decodeYjsDocState } from '../../store/yjs/doc-decode';
import { deriveAuthoredPackageFromYjs } from '../../store/yjs/doc-derive';
import { repairYjsDocument } from '../../store/yjs/doc-repair';
import { applyAuthoredTransition } from '../../store/yjs/doc-sync';
import type { YjsDocState } from '../../store/yjs/doc-types';
import { createOperationEnvironment, compactDerivedId } from '../../store/operation-environment';
import { normalizationOwnerId, repairConstituentId } from '../../store/publish-metadata';
import { createRemoteUntrackedOrigin, createStableTrackedOrigin } from './origin-tokens';
import {
  appendJournalEvent,
  createGenesisFromDoc,
  decodeReconstructionJournal,
  materializeReconstructionJournal,
  replayReconstructionJournal,
  yjsDocumentFingerprint,
} from './journal';
import { UNDO_EXPERIMENT_JOURNAL_VERSION, UNDO_EXPERIMENT_LIMITATIONS } from './quotas';
import {
  createActorUndoSession,
  inspectUndoSession,
  redoWithControlOrigin,
  undoWithControlOrigin,
  type ActorUndoSession,
} from './session';
import type {
  ActorHistoryInspection,
  JournalEvent,
  ReconstructionJournal,
  StackItemMeta,
} from './types';

export interface YjsUndoManagerExperiment {
  readonly model: DocumentModel;
  applyLocal(op: DocOp, origin: MutationOrigin): ApplyResult;
  applyRemote(op: DocOp, origin: MutationOrigin): ApplyResult;
  applyRemoteUpdate(bytes: Uint8Array, origin: MutationOrigin): ApplyResult;
  undo(input: { readonly actorId: string; readonly sessionId: string }): ApplyResult;
  redo(input: { readonly actorId: string; readonly sessionId: string }): ApplyResult;
  inspectActorHistory(input: {
    readonly actorId: string;
    readonly sessionId: string;
  }): ActorHistoryInspection;
  inspectYjsFingerprint(): string;
  encodeReconstructionJournal(): ReconstructionJournal;
  reopenFromJournal(journal: ReconstructionJournal): YjsUndoManagerExperiment;
  compact(retainLastGroups: number): void;
  subscribeModel(subscriber: ModelChangeSubscriber): () => void;
  notificationDiagnostics(): readonly NotificationDiagnostic[];
  compareLocalSemanticExpected(localFingerprint: string): {
    readonly experimentFingerprint: string;
    readonly localFingerprint: string;
    readonly match: boolean;
  };
}

export interface YjsUndoManagerExperimentOptions {
  readonly documentId?: string;
  readonly replicaId?: string;
  readonly clientId?: number;
}

interface Runtime {
  readonly state: YjsDocState;
  readonly sessions: Map<string, ActorUndoSession>;
  readonly model: DocumentModel;
  readonly journal: ReconstructionJournal;
}

function actorSessionKey(actorId: string, sessionId: string): string {
  return `${actorId}\u0000${sessionId}`;
}

function collectSemanticIds(model: DocumentModel): string[] {
  const ids: string[] = [];
  for (const paragraph of model.authored.body.paragraphs.values()) {
    ids.push(paragraph.blockId, paragraph.paragraphId);
    for (const mark of paragraph.marks) ids.push(mark.markId);
  }
  for (const capsule of model.authored.capsules) ids.push(capsule.capsuleId);
  return ids;
}

function deriveModel(state: YjsDocState, revision: number): DocumentModel {
  return createDocumentModel(deriveAuthoredPackageFromYjs(state), revision);
}

function failed(code: string, reason: string): ApplyResult {
  return Object.freeze({ status: 'failed', code, reason });
}

function noOp(reason: string): ApplyResult {
  return Object.freeze({ status: 'noOp', reason });
}

function historiesFor(runtime: Runtime): readonly ActorHistoryInspection[] {
  return Object.freeze(
    [...runtime.sessions.values()]
      .map((session) =>
        Object.freeze({
          actorId: session.actorId,
          sessionId: session.sessionId,
          ...inspectUndoSession(session),
        })
      )
      .sort((left, right) =>
        actorSessionKey(left.actorId, left.sessionId).localeCompare(
          actorSessionKey(right.actorId, right.sessionId)
        )
      )
  );
}

function getSession(runtime: Runtime, actorId: string, sessionId: string): ActorUndoSession {
  const key = actorSessionKey(actorId, sessionId);
  let session = runtime.sessions.get(key);
  if (!session) {
    session = createActorUndoSession(runtime.state.doc, actorId, sessionId);
    runtime.sessions.set(key, session);
  }
  return session;
}

function lastTrackedGroup(
  journal: ReconstructionJournal,
  actorId: string,
  sessionId: string
): string | null {
  for (let index = journal.events.length - 1; index >= 0; index -= 1) {
    const event = journal.events[index]!;
    if (
      event.kind === 'tracked-update' &&
      event.actorId === actorId &&
      event.sessionId === sessionId
    ) {
      return event.groupId;
    }
  }
  return null;
}

function captureOneUpdate(doc: Y.Doc, action: () => void): Uint8Array | null {
  const updates: Uint8Array[] = [];
  const listener = (bytes: Uint8Array) => updates.push(bytes.slice());
  doc.on('update', listener);
  try {
    action();
  } finally {
    doc.off('update', listener);
  }
  if (updates.length === 0) return null;
  if (updates.length !== 1) {
    throw new TypeError('experiment action emitted multiple Yjs updates');
  }
  return updates[0]!;
}

function appendCommit(journal: ReconstructionJournal, runtime: Runtime): ReconstructionJournal {
  return appendJournalEvent(journal, {
    kind: 'commit',
    revision: runtime.model.revision,
    authoredFingerprint: fingerprintAuthoredModel(runtime.model),
    yjsFingerprint: yjsDocumentFingerprint(runtime.state.doc),
    actorHistories: historiesFor(runtime),
  });
}

function modelChangeFor(input: {
  readonly before: Runtime;
  readonly after: Runtime;
  readonly origin: MutationOrigin;
  readonly commitId: string;
  readonly constituentIds: readonly string[];
  readonly causalUpdateIds: readonly string[];
  readonly appliedRepair: boolean;
}): ModelChange {
  const metadata = createRemoteCommitResult({
    commitId: input.commitId,
    beforeModel: input.before.model,
    afterModel: input.after.model,
    beforeYjs: decodeYjsDocState(input.before.state),
    afterYjs: decodeYjsDocState(input.after.state),
    appliedRepair: input.appliedRepair,
  });
  return createModelChange({
    commitId: metadata.commitId,
    constituentIds: input.constituentIds,
    causalUpdateIds: input.causalUpdateIds,
    revisionBefore: metadata.revisionBefore,
    revisionAfter: metadata.revisionAfter,
    structuralRangesBefore: metadata.structuralRangesBefore,
    structuralRangesAfter: metadata.structuralRangesAfter,
    identityMappings: metadata.identityMappings,
    dirtyDependencies: metadata.dirtyDependencies,
    origin: input.origin,
    normalized: input.appliedRepair,
    repairEvidence: input.appliedRepair
      ? {
          repairConstituentId: repairConstituentId(input.constituentIds, input.commitId),
          normalizationOwner: normalizationOwnerId(
            input.origin.actorId,
            input.constituentIds,
            input.commitId
          ),
          appliedRepair: true,
        }
      : null,
  });
}

export function createYjsUndoManagerExperiment(
  initialModel: DocumentModel,
  options: YjsUndoManagerExperimentOptions = {}
): YjsUndoManagerExperiment {
  const documentId = options.documentId ?? 'doc-spike-0';
  const replicaId = options.replicaId ?? 'replica-undo-experiment';
  const fingerprint = fingerprintAuthoredModel(initialModel);
  const state = bootstrapYjsDocFromModel(
    initialModel.authored,
    documentId,
    fingerprint,
    replicaId,
    options.clientId
  );
  const initialJournal: ReconstructionJournal = Object.freeze({
    version: UNDO_EXPERIMENT_JOURNAL_VERSION,
    genesis: createGenesisFromDoc(state.doc, {
      revision: initialModel.revision,
      fingerprint,
    }),
    events: Object.freeze([]),
    retainedFromSequence: 0,
  });
  return createExperimentFromRuntime(
    {
      state,
      sessions: new Map(),
      model: initialModel,
      journal: initialJournal,
    },
    { documentId, replicaId }
  );
}

function createExperimentFromRuntime(
  initialRuntime: Runtime,
  identity: { readonly documentId: string; readonly replicaId: string }
): YjsUndoManagerExperiment {
  let live = initialRuntime;
  const subscribers: ModelChangeSubscriber[] = [];
  const diagnostics: NotificationDiagnostic[] = [];

  const reconstruct = (journal = live.journal): Runtime => {
    const materialized = materializeReconstructionJournal(journal, (doc, revision) =>
      fingerprintAuthoredModel(
        deriveModel(
          {
            doc,
            documentId: identity.documentId,
            checkpoint: 'journal-replay',
            replicaId: identity.replicaId,
          },
          revision
        )
      )
    );
    const state: YjsDocState = Object.freeze({
      doc: materialized.doc,
      documentId: identity.documentId,
      checkpoint: checkpointFor(materialized.revision, materialized.authoredFingerprint),
      replicaId: identity.replicaId,
    });
    return {
      state,
      sessions: new Map(materialized.sessions),
      model: deriveModel(state, materialized.revision),
      journal,
    };
  };

  const publish = (staged: Runtime, change: ModelChange): ApplyResult => {
    live = staged;
    const subscriberErrors: Array<{ readonly index: number; readonly message: string }> = [];
    subscribers.forEach((subscriber, index) => {
      try {
        subscriber(change, change.origin);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'subscriber failed';
        subscriberErrors.push({ index, message });
        diagnostics.push(
          Object.freeze({
            revision: change.revisionAfter,
            subscriberIndex: index,
            message,
          })
        );
      }
    });
    return Object.freeze({
      status: 'applied',
      change,
      delivery: 'delivered',
      subscriberErrors: Object.freeze(subscriberErrors),
    });
  };

  const appendRepair = (
    staged: Runtime,
    journal: ReconstructionJournal,
    actorId: string,
    sessionId: string,
    updateId: string
  ): {
    readonly journal: ReconstructionJournal;
    readonly appliedRepair: boolean;
  } => {
    const beforeVector = Y.encodeStateVector(staged.state.doc);
    const repair = repairYjsDocument(staged.state, updateId);
    if (!repair.changed) return { journal, appliedRepair: false };
    const bytes = Y.encodeStateAsUpdate(staged.state.doc, beforeVector);
    return {
      journal: appendJournalEvent(journal, {
        kind: 'untracked-update',
        updateBytesHex: hexEncode(bytes),
        stateVectorBeforeHex: hexEncode(beforeVector),
        actorId,
        sessionId,
        updateId,
        originKind: 'repair',
        trackedOrigin: createStableTrackedOrigin(actorId, sessionId),
      }),
      appliedRepair: true,
    };
  };

  const applySemantic = (op: DocOp, origin: MutationOrigin, tracked: boolean): ApplyResult => {
    try {
      if (!isDocOp(op)) {
        return failed('untrusted-doc-op', 'DocOp batch is not trusted');
      }
      const validated = snapshotAndValidateMutationOrigin(origin);
      if (!validated.snapshot || validated.errors.length > 0) {
        return failed('invalid-origin', 'apply requires closed mutation origin');
      }
      const actorId = op.transaction.actorId;
      const sessionId = op.transaction.sessionId;
      if (validated.snapshot.actorId !== actorId || validated.snapshot.sessionId !== sessionId) {
        return failed(
          'actor-session-mismatch',
          'operation actor/session must match mutation origin'
        );
      }
      const before = reconstruct();
      const staged = reconstruct();
      const semantic = stageSemanticMutation(
        staged.model,
        createOperationEnvironment(actorId, collectSemanticIds(staged.model)),
        op.ops
      );
      if (semantic.status === 'failed') {
        return failed(semantic.code, semantic.message);
      }
      if (semantic.status === 'noOp') return noOp(semantic.reason);

      let journal = staged.journal;
      let transactionOrigin: unknown;
      if (tracked) {
        const session = getSession(staged, actorId, sessionId);
        const priorGroup = lastTrackedGroup(journal, actorId, sessionId);
        if (priorGroup !== null && priorGroup !== op.transaction.groupId) {
          session.stopCapturing();
          journal = appendJournalEvent(journal, {
            kind: 'group-boundary',
            actorId,
            sessionId,
            groupId: op.transaction.groupId,
            trackedOrigin: session.trackedOrigin,
          });
        }
        session.queueNextStackItemMeta({
          actorId,
          sessionId,
          groupId: op.transaction.groupId,
          constituentIds: op.transaction.constituentIds,
          originKind: validated.snapshot.kind === 'agent' ? 'agent' : 'human',
        });
        transactionOrigin = session.trackedOrigin;
      } else {
        transactionOrigin = createRemoteUntrackedOrigin({
          actorId,
          replicaId:
            validated.snapshot.kind === 'remote'
              ? validated.snapshot.replicaId
              : identity.replicaId,
          sessionId,
          updateId:
            validated.snapshot.kind === 'remote'
              ? validated.snapshot.updateId
              : `update-${op.transaction.constituentIds[0]}`,
        });
      }

      const sourceClientId = staged.state.doc.clientID;
      const stateVectorBefore = Y.encodeStateVector(staged.state.doc);
      const commitSeq = nextReplicaCommitSeq(staged.state.doc, actorId);
      const update = captureOneUpdate(staged.state.doc, () => {
        applyAuthoredTransition(
          staged.state,
          staged.model.authored,
          semantic.data.stagedModel.authored,
          actorId,
          commitSeq,
          checkpointFor(semantic.data.revisionAfter, semantic.data.stagedFingerprint),
          semantic.data.trace,
          transactionOrigin
        );
      });
      if (!update) return failed('missing-yjs-update', 'semantic mutation emitted no update');
      if (tracked) {
        journal = appendJournalEvent(journal, {
          kind: 'tracked-update',
          updateBytesHex: hexEncode(update),
          stateVectorBeforeHex: hexEncode(stateVectorBefore),
          actorId,
          sessionId,
          groupId: op.transaction.groupId,
          originKind: validated.snapshot.kind === 'agent' ? 'agent' : 'human',
          constituentIds: op.transaction.constituentIds,
          sourceClientId,
          trackedOrigin: getSession(staged, actorId, sessionId).trackedOrigin,
        });
      } else {
        journal = appendJournalEvent(journal, {
          kind: 'untracked-update',
          updateBytesHex: hexEncode(update),
          stateVectorBeforeHex: hexEncode(stateVectorBefore),
          actorId,
          sessionId,
          updateId:
            validated.snapshot.kind === 'remote'
              ? validated.snapshot.updateId
              : `update-${op.transaction.constituentIds[0]}`,
          originKind: 'remote',
          trackedOrigin: createStableTrackedOrigin(actorId, sessionId),
        });
      }
      const repairId = compactDerivedId(
        `repair-${op.transaction.constituentIds[0]}`,
        `experiment-repair:${op.transaction.constituentIds.join(':')}`
      );
      const repair = appendRepair(staged, journal, actorId, sessionId, repairId);
      journal = repair.journal;
      const afterModel = deriveModel(staged.state, semantic.data.revisionAfter);
      const stagedWithModel: Runtime = {
        ...staged,
        model: afterModel,
        journal,
      };
      journal = appendCommit(journal, stagedWithModel);
      const finalRuntime = { ...stagedWithModel, journal };
      const commitId = compactDerivedId(
        `commit-${actorId}-${afterModel.revision}`,
        `experiment-commit:${actorId}:${afterModel.revision}`
      );
      const change = modelChangeFor({
        before,
        after: finalRuntime,
        origin: validated.snapshot,
        commitId,
        constituentIds: op.transaction.constituentIds,
        causalUpdateIds: validated.snapshot.kind === 'remote' ? [validated.snapshot.updateId] : [],
        appliedRepair: repair.appliedRepair,
      });
      return publish(finalRuntime, change);
    } catch (error) {
      return failed(
        'experiment-stage-failed',
        error instanceof Error ? error.message : 'experiment staging failed'
      );
    }
  };

  const applyHistoryControl = (
    direction: 'undo' | 'redo',
    input: { readonly actorId: string; readonly sessionId: string }
  ): ApplyResult => {
    try {
      const before = reconstruct();
      const staged = reconstruct();
      const session = getSession(staged, input.actorId, input.sessionId);
      const sourceClientId = staged.state.doc.clientID;
      const stateVectorBeforeHex = hexEncode(Y.encodeStateVector(staged.state.doc));
      const update = captureOneUpdate(staged.state.doc, () => {
        const changed =
          direction === 'undo' ? undoWithControlOrigin(session) : redoWithControlOrigin(session);
        if (!changed) throw new TypeError(`empty-${direction}`);
      });
      if (!update) return failed(`empty-${direction}`, `no ${direction} history`);
      let journal = appendJournalEvent(staged.journal, {
        kind: direction === 'undo' ? 'undo-control' : 'redo-control',
        actorId: input.actorId,
        sessionId: input.sessionId,
        sourceClientId,
        updateBytesHex: hexEncode(update),
        stateVectorBeforeHex,
        trackedOrigin: session.trackedOrigin,
      });
      const repairId = compactDerivedId(
        `repair-${input.actorId}-${direction}-${before.model.revision + 1}`,
        `experiment-repair:${input.actorId}:${direction}:${before.model.revision + 1}`
      );
      const repair = appendRepair(staged, journal, input.actorId, input.sessionId, repairId);
      journal = repair.journal;
      const model = deriveModel(staged.state, before.model.revision + 1);
      const stagedWithModel = { ...staged, model, journal };
      journal = appendCommit(journal, stagedWithModel);
      const finalRuntime = { ...stagedWithModel, journal };
      const commitId = compactDerivedId(
        `commit-${input.actorId}-${direction}-${model.revision}`,
        `experiment-${direction}:${input.actorId}:${model.revision}`
      );
      const origin = createMutationOrigin(direction, input);
      const change = modelChangeFor({
        before,
        after: finalRuntime,
        origin,
        commitId,
        constituentIds: [
          compactDerivedId(
            `op-${input.actorId}-${direction}-${model.revision}`,
            `experiment-op:${input.actorId}:${direction}:${model.revision}`
          ),
        ],
        causalUpdateIds: [],
        appliedRepair: repair.appliedRepair,
      });
      return publish(finalRuntime, change);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'history control failed';
      return failed(
        message === `empty-${direction}` ? `empty-${direction}` : 'history-stage-failed',
        message
      );
    }
  };

  const experiment: YjsUndoManagerExperiment = {
    get model() {
      return live.model;
    },
    applyLocal(op, origin) {
      return applySemantic(op, origin, true);
    },
    applyRemote(op, origin) {
      return applySemantic(op, origin, false);
    },
    applyRemoteUpdate(bytes, origin) {
      try {
        const validated = snapshotAndValidateMutationOrigin(origin);
        if (
          !validated.snapshot ||
          validated.errors.length > 0 ||
          validated.snapshot.kind !== 'remote'
        ) {
          return failed('invalid-origin', 'remote update requires remote origin');
        }
        try {
          Y.decodeUpdate(bytes);
        } catch {
          return failed('malformed-yjs-update', 'Yjs update decode failed');
        }
        const before = reconstruct();
        const staged = reconstruct();
        const beforeFingerprint = fingerprintAuthoredModel(staged.model);
        const beforeVector = Y.encodeStateVector(staged.state.doc);
        try {
          Y.applyUpdate(
            staged.state.doc,
            bytes,
            createRemoteUntrackedOrigin({
              actorId: validated.snapshot.actorId,
              replicaId: validated.snapshot.replicaId,
              sessionId: validated.snapshot.sessionId,
              updateId: validated.snapshot.updateId,
            })
          );
        } catch {
          return failed('malformed-yjs-update', 'Yjs update apply failed');
        }
        const remoteIncremental = Y.encodeStateAsUpdate(staged.state.doc, beforeVector);
        let journal = appendJournalEvent(staged.journal, {
          kind: 'untracked-update',
          updateBytesHex: hexEncode(remoteIncremental),
          stateVectorBeforeHex: hexEncode(beforeVector),
          actorId: validated.snapshot.actorId,
          sessionId: validated.snapshot.sessionId,
          updateId: validated.snapshot.updateId,
          originKind: 'remote',
          trackedOrigin: createStableTrackedOrigin(
            validated.snapshot.actorId,
            validated.snapshot.sessionId
          ),
        });
        const repair = appendRepair(
          staged,
          journal,
          validated.snapshot.actorId,
          validated.snapshot.sessionId,
          compactDerivedId(
            `repair-${validated.snapshot.updateId}`,
            `experiment-remote-repair:${validated.snapshot.updateId}`
          )
        );
        const model = deriveModel(staged.state, before.model.revision + 1);
        const authoredOnlyFingerprint = fingerprintAuthoredModel(
          createDocumentModel(model.authored, before.model.revision)
        );
        if (authoredOnlyFingerprint === beforeFingerprint) {
          return noOp('remote update makes no semantic change');
        }
        journal = repair.journal;
        const stagedWithModel = { ...staged, model, journal };
        journal = appendCommit(journal, stagedWithModel);
        const finalRuntime = { ...stagedWithModel, journal };
        const change = modelChangeFor({
          before,
          after: finalRuntime,
          origin: validated.snapshot,
          commitId: compactDerivedId(
            `commit-${validated.snapshot.updateId}`,
            `experiment-remote:${validated.snapshot.updateId}`
          ),
          constituentIds: [
            compactDerivedId(
              `op-${validated.snapshot.updateId}`,
              `experiment-remote-op:${validated.snapshot.updateId}`
            ),
          ],
          causalUpdateIds: [validated.snapshot.updateId],
          appliedRepair: repair.appliedRepair,
        });
        return publish(finalRuntime, change);
      } catch (error) {
        return failed(
          'remote-stage-failed',
          error instanceof Error ? error.message : 'remote staging failed'
        );
      }
    },
    undo(input) {
      return applyHistoryControl('undo', input);
    },
    redo(input) {
      return applyHistoryControl('redo', input);
    },
    inspectActorHistory(input) {
      const session = live.sessions.get(actorSessionKey(input.actorId, input.sessionId));
      const inspection = session
        ? inspectUndoSession(session)
        : {
            undoEntries: 0,
            redoEntries: 0,
            redoEligible: false,
            stackItemMeta: Object.freeze([]),
            undoStackMeta: Object.freeze([]),
            redoStackMeta: Object.freeze([]),
          };
      return Object.freeze({
        actorId: input.actorId,
        sessionId: input.sessionId,
        ...inspection,
      });
    },
    inspectYjsFingerprint() {
      return yjsDocumentFingerprint(live.state.doc);
    },
    encodeReconstructionJournal() {
      return decodeReconstructionJournal(live.journal);
    },
    reopenFromJournal(journal) {
      const runtime = reconstruct(journal);
      return createExperimentFromRuntime(runtime, identity);
    },
    compact(retainLastGroups) {
      if (!Number.isInteger(retainLastGroups) || retainLastGroups < 0) {
        throw new TypeError('retainLastGroups must be a non-negative integer');
      }
      const tracked = live.journal.events
        .map((event, index) => ({ event, index }))
        .filter(
          (
            value
          ): value is {
            event: Extract<JournalEvent, { kind: 'tracked-update' }>;
            index: number;
          } => value.event.kind === 'tracked-update'
        );
      const groups: typeof tracked = [];
      for (const value of tracked) {
        const previous = [...groups]
          .reverse()
          .find(
            ({ event }) =>
              event.actorId === value.event.actorId && event.sessionId === value.event.sessionId
          )?.event;
        if (
          !previous ||
          previous.actorId !== value.event.actorId ||
          previous.sessionId !== value.event.sessionId ||
          previous.groupId !== value.event.groupId
        ) {
          groups.push(value);
        }
      }
      const terminalHistories = historiesFor(live);
      const eligibleGroupKeys = new Set(
        terminalHistories.flatMap((history) =>
          [...history.undoStackMeta, ...history.redoStackMeta].map(
            (meta) => `${meta.actorId}\u0000${meta.sessionId}\u0000${meta.groupId}`
          )
        )
      );
      const retainedGroupKeys = new Set<string>();
      const groupsBySession = new Map<string, typeof groups>();
      for (const group of groups) {
        const key = actorSessionKey(group.event.actorId, group.event.sessionId);
        const values = groupsBySession.get(key) ?? [];
        values.push(group);
        groupsBySession.set(key, values);
      }
      for (const sessionGroups of groupsBySession.values()) {
        const eligible = sessionGroups.filter(({ event }) =>
          eligibleGroupKeys.has(`${event.actorId}\u0000${event.sessionId}\u0000${event.groupId}`)
        );
        const retained = retainLastGroups === 0 ? [] : eligible.slice(-retainLastGroups);
        for (const { event } of retained) {
          retainedGroupKeys.add(`${event.actorId}\u0000${event.sessionId}\u0000${event.groupId}`);
        }
      }
      const retainedStarts = groups.filter(({ event }) =>
        retainedGroupKeys.has(`${event.actorId}\u0000${event.sessionId}\u0000${event.groupId}`)
      );
      let keepIndex =
        retainedStarts.length > 0
          ? Math.min(...retainedStarts.map(({ index }) => index))
          : live.journal.events.length;
      if (keepIndex > 0 && live.journal.events[keepIndex - 1]?.kind === 'group-boundary') {
        keepIndex -= 1;
      }
      const prefixEvents = live.journal.events.slice(0, keepIndex);
      const prefixJournal = decodeReconstructionJournal({
        ...live.journal,
        events: prefixEvents.map((event, index) => ({ ...event, sequence: index })),
      });
      const boundary = reconstruct(prefixJournal);
      const suffixSource = live.journal.events.slice(keepIndex);
      const historyBefore = (absoluteIndex: number) => {
        for (let index = absoluteIndex - 1; index >= 0; index -= 1) {
          const event = live.journal.events[index]!;
          if (event.kind === 'commit') return event.actorHistories;
        }
        return Object.freeze([]) as readonly ActorHistoryInspection[];
      };
      const suffix = suffixSource
        .map((event, index) => {
          const absoluteIndex = keepIndex + index;
          if (event.kind === 'tracked-update') {
            const key = `${event.actorId}\u0000${event.sessionId}\u0000${event.groupId}`;
            if (retainedGroupKeys.has(key)) {
              return { ...event, sequence: index };
            }
            return {
              kind: 'untracked-update' as const,
              sequence: index,
              updateBytesHex: event.updateBytesHex,
              stateVectorBeforeHex: event.stateVectorBeforeHex,
              actorId: event.actorId,
              sessionId: event.sessionId,
              updateId: `compacted-${event.sequence}`,
              originKind: 'repair' as const,
              trackedOrigin: event.trackedOrigin,
            };
          }
          if (event.kind === 'group-boundary') {
            const key = `${event.actorId}\u0000${event.sessionId}\u0000${event.groupId}`;
            return retainedGroupKeys.has(key) ? { ...event, sequence: index } : null;
          }
          if (event.kind === 'undo-control' || event.kind === 'redo-control') {
            const history = historyBefore(absoluteIndex).find(
              (entry) => entry.actorId === event.actorId && entry.sessionId === event.sessionId
            );
            const target =
              event.kind === 'undo-control'
                ? history?.undoStackMeta.at(-1)
                : history?.redoStackMeta.at(-1);
            const targetKey = target
              ? `${target.actorId}\u0000${target.sessionId}\u0000${target.groupId}`
              : null;
            if (!targetKey || !retainedGroupKeys.has(targetKey)) {
              return {
                kind: 'untracked-update' as const,
                sequence: index,
                updateBytesHex: event.updateBytesHex,
                stateVectorBeforeHex: event.stateVectorBeforeHex,
                actorId: event.actorId,
                sessionId: event.sessionId,
                updateId: `compacted-control-${event.sequence}`,
                originKind: 'repair' as const,
                trackedOrigin: event.trackedOrigin,
              };
            }
            return { ...event, sequence: index };
          }
          if (event.kind !== 'commit') return { ...event, sequence: index };
          const actorHistories = event.actorHistories
            .map((history) => {
              const undoStackMeta = history.undoStackMeta.filter((meta) =>
                retainedGroupKeys.has(`${meta.actorId}\u0000${meta.sessionId}\u0000${meta.groupId}`)
              );
              const redoStackMeta = history.redoStackMeta.filter((meta) =>
                retainedGroupKeys.has(`${meta.actorId}\u0000${meta.sessionId}\u0000${meta.groupId}`)
              );
              return {
                ...history,
                undoEntries: undoStackMeta.length,
                redoEntries: redoStackMeta.length,
                redoEligible: redoStackMeta.length > 0,
                stackItemMeta: undoStackMeta,
                undoStackMeta,
                redoStackMeta,
              };
            })
            .filter((history) => history.undoEntries > 0 || history.redoEntries > 0);
          return { ...event, sequence: index, actorHistories };
        })
        .filter((event): event is Exclude<typeof event, null> => event !== null)
        .map((event, sequence) => ({ ...event, sequence }));
      const compacted = decodeReconstructionJournal({
        version: UNDO_EXPERIMENT_JOURNAL_VERSION,
        genesis: createGenesisFromDoc(boundary.state.doc, {
          revision: boundary.model.revision,
          fingerprint: fingerprintAuthoredModel(boundary.model),
        }),
        events: suffix,
        retainedFromSequence: 0,
      });
      const reconstructed = reconstruct(compacted);
      if (
        fingerprintAuthoredModel(reconstructed.model) !== fingerprintAuthoredModel(live.model) ||
        yjsDocumentFingerprint(reconstructed.state.doc) !==
          yjsDocumentFingerprint(live.state.doc) ||
        reconstructed.model.revision !== live.model.revision ||
        JSON.stringify(historiesFor(reconstructed)) !==
          JSON.stringify(
            terminalHistories
              .map((history) => {
                const undoStackMeta = history.undoStackMeta.filter((meta) =>
                  retainedGroupKeys.has(
                    `${meta.actorId}\u0000${meta.sessionId}\u0000${meta.groupId}`
                  )
                );
                const redoStackMeta = history.redoStackMeta.filter((meta) =>
                  retainedGroupKeys.has(
                    `${meta.actorId}\u0000${meta.sessionId}\u0000${meta.groupId}`
                  )
                );
                return {
                  ...history,
                  undoEntries: undoStackMeta.length,
                  redoEntries: redoStackMeta.length,
                  redoEligible: redoStackMeta.length > 0,
                  stackItemMeta: undoStackMeta,
                  undoStackMeta,
                  redoStackMeta,
                };
              })
              .filter((history) => history.undoEntries > 0 || history.redoEntries > 0)
          )
      ) {
        throw new TypeError('compaction changed terminal state or history');
      }
      live = reconstructed;
    },
    subscribeModel(subscriber) {
      subscribers.push(subscriber);
      return () => {
        const index = subscribers.indexOf(subscriber);
        if (index >= 0) subscribers.splice(index, 1);
      };
    },
    notificationDiagnostics() {
      return Object.freeze(diagnostics.map((value) => Object.freeze({ ...value })));
    },
    compareLocalSemanticExpected(localFingerprint) {
      const experimentFingerprint = fingerprintAuthoredModel(live.model);
      return Object.freeze({
        experimentFingerprint,
        localFingerprint,
        match: experimentFingerprint === localFingerprint,
      });
    },
  };

  return experiment;
}

export { decodeReconstructionJournal, replayReconstructionJournal, UNDO_EXPERIMENT_LIMITATIONS };
export type { ActorHistoryInspection, JournalEvent, ReconstructionJournal, StackItemMeta };
