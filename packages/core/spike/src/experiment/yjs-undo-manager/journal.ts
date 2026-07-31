/** @spike-features origin-metadata, yjs-backend */
import * as Y from 'yjs';
import {
  isPlainRecord,
  readClosedDataObject,
  snapshotDenseArray,
} from '../../contracts/closed-input';
import { isSpikeId } from '../../contracts/ids';
import { hexDecode, hexEncode } from '../../store/yjs/doc-access';
import {
  UNDO_EXPERIMENT_JOURNAL_VERSION,
  UNDO_EXPERIMENT_MAX_GENESIS_BYTES,
  UNDO_EXPERIMENT_MAX_JOURNAL_EVENTS,
  UNDO_EXPERIMENT_MAX_UPDATE_BYTES,
} from './quotas';
import { createStableTrackedOrigin } from './origin-tokens';
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
  ReconstructionJournalGenesis,
} from './types';

export interface MaterializedJournal {
  readonly doc: Y.Doc;
  readonly sessions: ReadonlyMap<string, ActorUndoSession>;
  readonly revision: number;
  readonly authoredFingerprint: string;
  readonly yjsFingerprint: string;
}

type JournalEventInput = JournalEvent extends infer Event
  ? Event extends JournalEvent
    ? Omit<Event, 'sequence'>
    : never
  : never;

export function yjsDocumentFingerprint(doc: Y.Doc): string {
  return new Bun.CryptoHasher('sha256').update(Y.encodeStateAsUpdate(doc)).digest('hex');
}

function actorSessionKey(actorId: string, sessionId: string): string {
  return `${actorId}\u0000${sessionId}`;
}

function snapshotActorHistory(input: unknown): ActorHistoryInspection {
  const history = readClosedDataObject(
    input,
    [
      'actorId',
      'sessionId',
      'undoEntries',
      'redoEntries',
      'redoEligible',
      'stackItemMeta',
      'undoStackMeta',
      'redoStackMeta',
    ],
    'actor history inspection'
  );
  if (
    !isSpikeId(history.actorId) ||
    !isSpikeId(history.sessionId) ||
    !Number.isSafeInteger(history.undoEntries) ||
    (history.undoEntries as number) < 0 ||
    !Number.isSafeInteger(history.redoEntries) ||
    (history.redoEntries as number) < 0 ||
    typeof history.redoEligible !== 'boolean'
  ) {
    throw new TypeError('invalid actor history inspection');
  }
  const snapshotStack = (inputStack: unknown, label: string) =>
    snapshotDenseArray(inputStack, label).map((entry) => {
      const meta = readClosedDataObject(
        entry,
        ['actorId', 'sessionId', 'groupId', 'constituentIds', 'originKind'],
        'stack item metadata'
      );
      if (
        !isSpikeId(meta.actorId) ||
        !isSpikeId(meta.sessionId) ||
        !isSpikeId(meta.groupId) ||
        (meta.originKind !== 'human' && meta.originKind !== 'agent')
      ) {
        throw new TypeError('invalid stack item metadata');
      }
      if (meta.actorId !== history.actorId || meta.sessionId !== history.sessionId) {
        throw new TypeError('stack item actor/session metadata mismatch');
      }
      const constituentIds = snapshotDenseArray(meta.constituentIds, 'stack item constituent IDs');
      if (!constituentIds.every(isSpikeId)) {
        throw new TypeError('invalid stack item constituent IDs');
      }
      return Object.freeze({
        actorId: meta.actorId,
        sessionId: meta.sessionId,
        groupId: meta.groupId,
        constituentIds: Object.freeze([...constituentIds] as string[]),
        originKind: meta.originKind,
      });
    });
  const stackItemMeta = snapshotStack(history.stackItemMeta, 'stack item metadata');
  const undoStackMeta = snapshotStack(history.undoStackMeta, 'undo stack metadata');
  const redoStackMeta = snapshotStack(history.redoStackMeta, 'redo stack metadata');
  if (
    stackItemMeta.length !== undoStackMeta.length ||
    JSON.stringify(stackItemMeta) !== JSON.stringify(undoStackMeta) ||
    undoStackMeta.length !== history.undoEntries ||
    redoStackMeta.length !== history.redoEntries ||
    history.redoEligible !== (history.redoEntries as number) > 0
  ) {
    throw new TypeError('actor history stack metadata/count mismatch');
  }
  return Object.freeze({
    actorId: history.actorId,
    sessionId: history.sessionId,
    undoEntries: history.undoEntries as number,
    redoEntries: history.redoEntries as number,
    redoEligible: history.redoEligible,
    stackItemMeta: Object.freeze(stackItemMeta),
    undoStackMeta: Object.freeze(undoStackMeta),
    redoStackMeta: Object.freeze(redoStackMeta),
  });
}

function snapshotHistories(input: unknown): readonly ActorHistoryInspection[] {
  return Object.freeze(snapshotDenseArray(input, 'actor histories').map(snapshotActorHistory));
}

function decodeGenesis(input: unknown): ReconstructionJournalGenesis {
  const genesis = readClosedDataObject(
    input,
    [
      'stateBytesHex',
      'stateVectorHex',
      'revision',
      'fingerprint',
      'yjsFingerprint',
      'actorHistories',
    ],
    'journal genesis'
  );
  if (typeof genesis.stateBytesHex !== 'string' || typeof genesis.stateVectorHex !== 'string') {
    throw new TypeError('invalid genesis bytes');
  }
  const stateBytes = hexDecode(genesis.stateBytesHex);
  if (stateBytes.length === 0 || stateBytes.length > UNDO_EXPERIMENT_MAX_GENESIS_BYTES) {
    throw new TypeError('genesis snapshot size invalid');
  }
  hexDecode(genesis.stateVectorHex);
  if (
    !Number.isSafeInteger(genesis.revision) ||
    (genesis.revision as number) < 0 ||
    typeof genesis.fingerprint !== 'string' ||
    typeof genesis.yjsFingerprint !== 'string'
  ) {
    throw new TypeError('invalid genesis metadata');
  }
  const actorHistories = snapshotHistories(genesis.actorHistories);
  if (actorHistories.some((history) => history.undoEntries || history.redoEntries)) {
    throw new TypeError('genesis cannot serialize UndoManager stack internals');
  }
  return Object.freeze({
    stateBytesHex: genesis.stateBytesHex,
    stateVectorHex: genesis.stateVectorHex,
    revision: genesis.revision as number,
    fingerprint: genesis.fingerprint,
    yjsFingerprint: genesis.yjsFingerprint,
    actorHistories,
  });
}

function decodeUpdateHex(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new TypeError(`invalid ${label}`);
  const bytes = hexDecode(value);
  if (bytes.length === 0 || bytes.length > UNDO_EXPERIMENT_MAX_UPDATE_BYTES) {
    throw new TypeError(`${label} size invalid`);
  }
  try {
    Y.decodeUpdate(bytes);
  } catch {
    throw new TypeError(`malformed ${label}`);
  }
  return value;
}

function decodeClientId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > 0xffff_ffff) {
    throw new TypeError('invalid journal source client ID');
  }
  return value;
}

function validateStableOrigin(
  actorId: unknown,
  sessionId: unknown,
  trackedOrigin: unknown
): {
  readonly actorId: string;
  readonly sessionId: string;
  readonly trackedOrigin: string;
} {
  if (!isSpikeId(actorId) || !isSpikeId(sessionId) || typeof trackedOrigin !== 'string') {
    throw new TypeError('invalid journal actor/session identity');
  }
  const expected = createStableTrackedOrigin(actorId, sessionId);
  if (trackedOrigin !== expected) {
    throw new TypeError('journal stable origin actor/session mismatch');
  }
  return Object.freeze({ actorId, sessionId, trackedOrigin });
}

function decodeEvent(input: unknown, sequence: number): JournalEvent {
  if (!isPlainRecord(input) || input.sequence !== sequence) {
    throw new TypeError('journal event sequence mismatch');
  }
  switch (input.kind) {
    case 'tracked-update': {
      const event = readClosedDataObject(
        input,
        [
          'kind',
          'sequence',
          'updateBytesHex',
          'stateVectorBeforeHex',
          'actorId',
          'sessionId',
          'groupId',
          'originKind',
          'constituentIds',
          'sourceClientId',
          'trackedOrigin',
        ],
        'tracked update event'
      );
      if (
        !isSpikeId(event.groupId) ||
        typeof event.stateVectorBeforeHex !== 'string' ||
        (event.originKind !== 'human' && event.originKind !== 'agent')
      ) {
        throw new TypeError('invalid tracked update metadata');
      }
      const identity = validateStableOrigin(event.actorId, event.sessionId, event.trackedOrigin);
      hexDecode(event.stateVectorBeforeHex);
      const constituentIds = snapshotDenseArray(
        event.constituentIds,
        'tracked update constituent IDs'
      );
      if (!constituentIds.every(isSpikeId)) {
        throw new TypeError('invalid tracked update constituent IDs');
      }
      return Object.freeze({
        kind: 'tracked-update',
        sequence,
        updateBytesHex: decodeUpdateHex(event.updateBytesHex, 'tracked update bytes'),
        stateVectorBeforeHex: event.stateVectorBeforeHex,
        actorId: identity.actorId,
        sessionId: identity.sessionId,
        groupId: event.groupId,
        originKind: event.originKind,
        constituentIds: Object.freeze([...constituentIds] as string[]),
        sourceClientId: decodeClientId(event.sourceClientId),
        trackedOrigin: identity.trackedOrigin,
      });
    }
    case 'untracked-update': {
      const event = readClosedDataObject(
        input,
        [
          'kind',
          'sequence',
          'updateBytesHex',
          'stateVectorBeforeHex',
          'actorId',
          'sessionId',
          'updateId',
          'originKind',
          'trackedOrigin',
        ],
        'untracked update event'
      );
      if (
        !isSpikeId(event.updateId) ||
        (event.originKind !== 'remote' && event.originKind !== 'repair') ||
        typeof event.stateVectorBeforeHex !== 'string'
      ) {
        throw new TypeError('invalid untracked update metadata');
      }
      const identity = validateStableOrigin(event.actorId, event.sessionId, event.trackedOrigin);
      hexDecode(event.stateVectorBeforeHex);
      return Object.freeze({
        kind: 'untracked-update',
        sequence,
        updateBytesHex: decodeUpdateHex(event.updateBytesHex, 'untracked update bytes'),
        stateVectorBeforeHex: event.stateVectorBeforeHex,
        actorId: identity.actorId,
        sessionId: identity.sessionId,
        updateId: event.updateId,
        originKind: event.originKind,
        trackedOrigin: identity.trackedOrigin,
      });
    }
    case 'group-boundary': {
      const event = readClosedDataObject(
        input,
        ['kind', 'sequence', 'actorId', 'sessionId', 'groupId', 'trackedOrigin'],
        'group boundary event'
      );
      if (!isSpikeId(event.groupId)) {
        throw new TypeError('invalid group boundary metadata');
      }
      const identity = validateStableOrigin(event.actorId, event.sessionId, event.trackedOrigin);
      return Object.freeze({
        kind: 'group-boundary',
        sequence,
        actorId: identity.actorId,
        sessionId: identity.sessionId,
        groupId: event.groupId,
        trackedOrigin: identity.trackedOrigin,
      });
    }
    case 'undo-control':
    case 'redo-control': {
      const event = readClosedDataObject(
        input,
        [
          'kind',
          'sequence',
          'actorId',
          'sessionId',
          'sourceClientId',
          'updateBytesHex',
          'stateVectorBeforeHex',
          'trackedOrigin',
        ],
        'history control event'
      );
      const identity = validateStableOrigin(event.actorId, event.sessionId, event.trackedOrigin);
      if (typeof event.stateVectorBeforeHex !== 'string') {
        throw new TypeError('invalid history control state vector');
      }
      hexDecode(event.stateVectorBeforeHex);
      return Object.freeze({
        kind: input.kind,
        sequence,
        actorId: identity.actorId,
        sessionId: identity.sessionId,
        sourceClientId: decodeClientId(event.sourceClientId),
        updateBytesHex: decodeUpdateHex(event.updateBytesHex, 'history control update bytes'),
        stateVectorBeforeHex: event.stateVectorBeforeHex,
        trackedOrigin: identity.trackedOrigin,
      });
    }
    case 'commit': {
      const event = readClosedDataObject(
        input,
        ['kind', 'sequence', 'revision', 'authoredFingerprint', 'yjsFingerprint', 'actorHistories'],
        'commit event'
      );
      if (
        !Number.isSafeInteger(event.revision) ||
        (event.revision as number) < 0 ||
        typeof event.authoredFingerprint !== 'string' ||
        typeof event.yjsFingerprint !== 'string'
      ) {
        throw new TypeError('invalid commit metadata');
      }
      return Object.freeze({
        kind: 'commit',
        sequence,
        revision: event.revision as number,
        authoredFingerprint: event.authoredFingerprint,
        yjsFingerprint: event.yjsFingerprint,
        actorHistories: snapshotHistories(event.actorHistories),
      });
    }
    default:
      throw new TypeError('unknown journal event kind');
  }
}

export function decodeReconstructionJournal(input: unknown): ReconstructionJournal {
  const payload = readClosedDataObject(
    input,
    ['version', 'genesis', 'events', 'retainedFromSequence'],
    'reconstruction journal'
  );
  if (payload.version !== UNDO_EXPERIMENT_JOURNAL_VERSION) {
    throw new TypeError('invalid reconstruction journal version');
  }
  const inputs = snapshotDenseArray(payload.events, 'journal events');
  if (inputs.length > UNDO_EXPERIMENT_MAX_JOURNAL_EVENTS) {
    throw new TypeError('journal exceeds experiment event quota');
  }
  const events = inputs.map(decodeEvent);
  if (payload.retainedFromSequence !== 0) {
    throw new TypeError('compacted journal sequences must restart at zero');
  }
  return Object.freeze({
    version: UNDO_EXPERIMENT_JOURNAL_VERSION,
    genesis: decodeGenesis(payload.genesis),
    events: Object.freeze(events),
    retainedFromSequence: 0,
  });
}

export function encodeReconstructionJournal(journal: ReconstructionJournal): ReconstructionJournal {
  return decodeReconstructionJournal(journal);
}

export function appendJournalEvent(
  journal: ReconstructionJournal,
  event: JournalEventInput
): ReconstructionJournal {
  const decoded = decodeReconstructionJournal(journal);
  if (decoded.events.length >= UNDO_EXPERIMENT_MAX_JOURNAL_EVENTS) {
    throw new TypeError('journal exceeds experiment event quota');
  }
  return decodeReconstructionJournal({
    ...decoded,
    events: [...decoded.events, { ...event, sequence: decoded.events.length }],
  });
}

function freshClientId(doc: Y.Doc): void {
  const existing = Y.decodeStateVector(Y.encodeStateVector(doc));
  for (;;) {
    const candidate = new Y.Doc().clientID;
    if (!existing.has(candidate)) {
      doc.clientID = candidate;
      return;
    }
  }
}

function updateClientIds(bytes: Uint8Array): ReadonlySet<number> {
  const decoded = Y.decodeUpdate(bytes);
  return new Set([
    ...decoded.structs.map((struct) => struct.id.client),
    ...decoded.ds.clients.keys(),
  ]);
}

function applyUpdateWithoutClientCollision(doc: Y.Doc, bytes: Uint8Array, origin: unknown): void {
  if (updateClientIds(bytes).has(doc.clientID)) freshClientId(doc);
  Y.applyUpdate(doc, bytes, origin);
}

function historiesFor(
  sessions: ReadonlyMap<string, ActorUndoSession>
): readonly ActorHistoryInspection[] {
  return Object.freeze(
    [...sessions.values()]
      .map((session) => {
        const inspection = inspectUndoSession(session);
        return Object.freeze({
          actorId: session.actorId,
          sessionId: session.sessionId,
          ...inspection,
        });
      })
      .sort((left, right) =>
        actorSessionKey(left.actorId, left.sessionId).localeCompare(
          actorSessionKey(right.actorId, right.sessionId)
        )
      )
  );
}

function historiesEqual(
  left: readonly ActorHistoryInspection[],
  right: readonly ActorHistoryInspection[]
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function materializeReconstructionJournal(
  journal: ReconstructionJournal,
  deriveAuthoredFingerprint: (doc: Y.Doc, revision: number) => string
): MaterializedJournal {
  const decoded = decodeReconstructionJournal(journal);
  const doc = new Y.Doc({ gc: false });
  doc.getMap('root');
  applyUpdateWithoutClientCollision(doc, hexDecode(decoded.genesis.stateBytesHex), 'genesis');
  if (
    yjsDocumentFingerprint(doc) !== decoded.genesis.yjsFingerprint ||
    deriveAuthoredFingerprint(doc, decoded.genesis.revision) !== decoded.genesis.fingerprint
  ) {
    throw new TypeError('genesis fingerprint mismatch');
  }
  let revision = decoded.genesis.revision;
  let authoredFingerprint = decoded.genesis.fingerprint;
  let yjsFingerprint = decoded.genesis.yjsFingerprint;
  const sessions = new Map<string, ActorUndoSession>();
  const getSession = (actorId: string, sessionId: string, trackedOrigin: string) => {
    const key = actorSessionKey(actorId, sessionId);
    let session = sessions.get(key);
    if (!session) {
      session = createActorUndoSession(doc, actorId, sessionId);
      sessions.set(key, session);
    }
    if (session.trackedOrigin !== trackedOrigin) {
      throw new TypeError('registered session stable origin mismatch');
    }
    return session;
  };
  const assertStateVector = (expected: string) => {
    if (hexEncode(Y.encodeStateVector(doc)) !== expected) {
      throw new TypeError('journal replay state vector drift');
    }
  };

  for (const event of decoded.events) {
    switch (event.kind) {
      case 'tracked-update': {
        assertStateVector(event.stateVectorBeforeHex);
        const session = getSession(event.actorId, event.sessionId, event.trackedOrigin);
        session.queueNextStackItemMeta({
          actorId: event.actorId,
          sessionId: event.sessionId,
          groupId: event.groupId,
          constituentIds: event.constituentIds,
          originKind: event.originKind,
        });
        applyUpdateWithoutClientCollision(
          doc,
          hexDecode(event.updateBytesHex),
          session.trackedOrigin
        );
        break;
      }
      case 'untracked-update':
        assertStateVector(event.stateVectorBeforeHex);
        applyUpdateWithoutClientCollision(doc, hexDecode(event.updateBytesHex), {
          kind: event.originKind,
          actorId: event.actorId,
          sessionId: event.sessionId,
          updateId: event.updateId,
        });
        break;
      case 'group-boundary':
        getSession(event.actorId, event.sessionId, event.trackedOrigin).stopCapturing();
        break;
      case 'undo-control':
      case 'redo-control': {
        assertStateVector(event.stateVectorBeforeHex);
        const session = getSession(event.actorId, event.sessionId, event.trackedOrigin);
        doc.clientID = event.sourceClientId;
        let generated: Uint8Array | undefined;
        const listener = (bytes: Uint8Array) => {
          generated = bytes.slice();
        };
        doc.once('update', listener);
        const changed =
          event.kind === 'undo-control'
            ? undoWithControlOrigin(session)
            : redoWithControlOrigin(session);
        doc.off('update', listener);
        if (!changed || !generated || hexEncode(generated) !== event.updateBytesHex) {
          throw new TypeError('history control replay update mismatch');
        }
        freshClientId(doc);
        break;
      }
      case 'commit': {
        const actualYjs = yjsDocumentFingerprint(doc);
        const actualAuthored = deriveAuthoredFingerprint(doc, event.revision);
        const actualHistories = historiesFor(sessions);
        if (
          event.revision !== revision + 1 ||
          actualYjs !== event.yjsFingerprint ||
          actualAuthored !== event.authoredFingerprint ||
          !historiesEqual(actualHistories, event.actorHistories)
        ) {
          throw new TypeError('journal commit validation mismatch');
        }
        revision = event.revision;
        yjsFingerprint = actualYjs;
        authoredFingerprint = actualAuthored;
        break;
      }
    }
  }
  freshClientId(doc);
  return Object.freeze({
    doc,
    sessions,
    revision,
    authoredFingerprint,
    yjsFingerprint,
  });
}

export function createGenesisFromDoc(
  doc: Y.Doc,
  input: {
    readonly revision: number;
    readonly fingerprint: string;
  }
): ReconstructionJournalGenesis {
  const stateBytes = Y.encodeStateAsUpdate(doc);
  if (stateBytes.length === 0 || stateBytes.length > UNDO_EXPERIMENT_MAX_GENESIS_BYTES) {
    throw new TypeError('genesis snapshot size invalid');
  }
  return Object.freeze({
    stateBytesHex: hexEncode(stateBytes),
    stateVectorHex: hexEncode(Y.encodeStateVector(doc)),
    revision: input.revision,
    fingerprint: input.fingerprint,
    yjsFingerprint: yjsDocumentFingerprint(doc),
    actorHistories: Object.freeze([]),
  });
}

export function compactJournalRetainingHorizon(
  journal: ReconstructionJournal,
  _retainFromSequence: number
): ReconstructionJournal {
  return decodeReconstructionJournal(journal);
}

export function replayReconstructionJournal(
  journal: ReconstructionJournal,
  input: {
    readonly deriveFingerprint: (doc: Y.Doc, revision: number) => string;
    readonly deriveRevision: (doc: Y.Doc) => number;
  }
) {
  const materialized = materializeReconstructionJournal(journal, (doc, revision) =>
    input.deriveFingerprint(doc, revision)
  );
  return Object.freeze({
    fingerprint: materialized.authoredFingerprint,
    revision: input.deriveRevision(materialized.doc),
    doc: materialized.doc,
    actorInspections: historiesFor(materialized.sessions),
  });
}

export function reconstructTrackedOrigin(actorId: string, sessionId: string): string {
  return createStableTrackedOrigin(actorId, sessionId);
}
