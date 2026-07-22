/** @spike-features yjs-backend, insert-delete-split-join-operations, origin-metadata */
/* eslint-disable max-lines -- the POC store is intentionally constrained to one module */
import * as Y from 'yjs';
import {
  createMutationOrigin,
  createSynchronousTransactionContext,
  createSynchronousTransactionExecutor,
} from '../contracts';
import {
  createRemoteUntrackedOrigin,
  createStableTrackedOrigin,
} from '../experiment/yjs-undo-manager/origin-tokens';
import { validateSpikeId } from '../contracts/ids';
import { POC_PARAGRAPH_ID, type LoadedPocDocx } from './docx';

export interface PocSnapshot {
  readonly paragraphId: string;
  readonly text: string;
  readonly runs: readonly { text: string; bold: boolean; italic: boolean }[];
}

export interface PocStore {
  readonly actorId: string;
  readonly clientId: number;
  snapshot(): PocSnapshot;
  insert(offset: number, text: string): void;
  delete(start: number, end: number): void;
  toggleMark(start: number, end: number, kind: 'bold' | 'italic'): void;
  undo(): boolean;
  encodeUpdate(): Uint8Array;
  applyRemoteUpdate(update: Uint8Array): void;
  subscribe(listener: (snapshot: PocSnapshot) => void): () => void;
}

export interface CreatePocStoreOptions {
  readonly actorId: string;
  readonly sessionId: string;
  readonly clientId: number;
}

const BODY_SEQUENCE_KEY = 'bodySequence';
const MARK_CONTRIBUTIONS_KEY = 'markContributions';
const BOOTSTRAP_CLIENT_ID = 1;
const BOOTSTRAP_GUID = 'poc-store-bootstrap-v1';
const POC_MAX_TEXT_LENGTH = 8192;
const POC_MAX_INSERT_LENGTH = 4096;
const POC_MAX_CONTRIBUTIONS = 256;
const POC_MAX_UPDATE_BYTES = 256 * 1024;
const POC_MAX_ID_LENGTH = 256;
const POC_MAX_ENDPOINT_LENGTH = 1024;
const POC_MAX_REMOVE_TARGETS = 256;
// This disposable POC has no replica lifecycle API, so accepted client IDs are
// claimed for the lifetime of the module rather than reused ambiguously.
const claimedStoreClientIds = new Set<number>();

type MarkKind = 'bold' | 'italic';

interface BoundaryEmbed {
  readonly kind: 'paragraph-boundary';
  readonly paragraphId: string;
}

interface TextRange {
  readonly start: number;
  readonly end: number;
}

interface MarkSegment {
  readonly kind: MarkKind;
  readonly start: number;
  readonly end: number;
  readonly contributionId: string;
}

interface LocalMutationStage {
  readonly liveDoc: Y.Doc;
  stagedDoc: Y.Doc;
  update: Uint8Array;
  readonly trackedOrigin: string;
}

const bootstrapCache = new Map<string, Uint8Array>();

export function createPocStore(loaded: LoadedPocDocx, options: CreatePocStoreOptions): PocStore {
  const identity = snapshotStoreOptions(options);
  validateLoadedSnapshot(loaded);
  claimStoreClientId(identity.clientId);

  const doc = new Y.Doc({ gc: false });
  doc.clientID = identity.clientId;
  Y.applyUpdate(doc, getDeterministicBootstrapUpdate(loaded), 'poc-bootstrap');

  const bodySequence = doc.getText(BODY_SEQUENCE_KEY);
  const markContributions = doc.getMap<Record<string, unknown>>(MARK_CONTRIBUTIONS_KEY);
  const trackedOrigin = createStableTrackedOrigin(identity.actorId, identity.sessionId);
  const undoManager = new Y.UndoManager([bodySequence, markContributions], {
    trackedOrigins: new Set([trackedOrigin]),
    captureTimeout: Number.MAX_SAFE_INTEGER,
    ignoreRemoteMapChanges: true,
  });

  const contributionPrefix = `${identity.actorId}:${identity.sessionId}:${identity.clientId}:op:`;
  let operationCounter = nextContributionSequence(markContributions, contributionPrefix);
  let remoteUpdateCounter = 0;
  const listeners = new Set<(snapshot: PocSnapshot) => void>();
  const actionQueue: Array<() => void> = [];
  const notificationQueue: PocSnapshot[] = [];
  let drainingActions = false;
  let deliveringNotifications = false;

  const executor = createSynchronousTransactionExecutor<LocalMutationStage, void>({
    preflight(stage) {
      const liveUpdate = Y.encodeStateAsUpdate(stage.liveDoc);
      const operationClientId = allocateOperationClientId(
        identity.clientId,
        operationCounter,
        stage.liveDoc
      );
      stage.stagedDoc = cloneDocFromUpdate(liveUpdate, operationClientId);
    },
    publish(stage) {
      if (stage.update.byteLength > 0) {
        Y.applyUpdate(stage.liveDoc, stage.update, stage.trackedOrigin);
      }
    },
    rollback() {},
  });

  const deliverNotifications = (): void => {
    if (deliveringNotifications) return;
    deliveringNotifications = true;
    try {
      while (notificationQueue.length > 0) {
        const next = notificationQueue.shift()!;
        const delivery = [...listeners];
        for (const listener of delivery) {
          try {
            listener(next);
          } catch {
            // Listener failures are isolated from store publication and peers.
          }
        }
      }
    } finally {
      deliveringNotifications = false;
    }
  };

  const notifyIfChanged = (before: PocSnapshot): void => {
    const after = snapshot();
    if (snapshotsEqual(before, after)) return;
    notificationQueue.push(after);
    deliverNotifications();
  };

  const enqueueAction = (action: () => void): void => {
    actionQueue.push(action);
    if (drainingActions) return;
    drainingActions = true;
    try {
      while (actionQueue.length > 0) {
        actionQueue.shift()!();
      }
    } finally {
      drainingActions = false;
    }
  };

  const runLocalMutation = (
    mutate: (ctx: { body: Y.Text; marks: Y.Map<Record<string, unknown>>; doc: Y.Doc }) => void
  ): boolean => {
    const before = snapshot();
    const stage: LocalMutationStage = {
      liveDoc: doc,
      stagedDoc: doc,
      update: new Uint8Array(),
      trackedOrigin,
    };
    const context = createSynchronousTransactionContext({
      actorId: identity.actorId,
      sessionId: identity.sessionId,
      groupId: `${identity.sessionId}-poc`,
      transactionId: `${identity.sessionId}-poc-${operationCounter}`,
      origin: createMutationOrigin('human', {
        actorId: identity.actorId,
        sessionId: identity.sessionId,
      }),
    });
    const result = executor.transact(context, stage, (_capability, staged) => {
      const stagedDoc = staged.value.stagedDoc;
      const body = stagedDoc.getText(BODY_SEQUENCE_KEY);
      const marks = stagedDoc.getMap<Record<string, unknown>>(MARK_CONTRIBUTIONS_KEY);
      stagedDoc.transact(() => {
        mutate({ body, marks, doc: stagedDoc });
      }, trackedOrigin);
      assertValidPocDoc(stagedDoc, loaded.paragraphId);
      staged.value.update = Y.encodeStateAsUpdate(
        stagedDoc,
        Y.encodeStateVector(staged.value.liveDoc)
      );
      assertValidDifferentialUpdate(staged.value.update, staged.value.liveDoc, loaded.paragraphId);
    });
    if (!result.ok) return false;
    operationCounter += 1;
    undoManager.stopCapturing();
    notifyIfChanged(before);
    return true;
  };

  const snapshot = (): PocSnapshot => deepFreezeSnapshot(projectSnapshot(doc, loaded.paragraphId));

  return Object.freeze({
    actorId: identity.actorId,
    clientId: identity.clientId,
    snapshot,
    insert(offset: number, text: string) {
      enqueueAction(() => {
        if (!validateInsertInput(offset, text, readParagraphText(doc))) return;
        runLocalMutation(({ body }) => {
          body.insert(textOffsetToBodyIndex(offset), text);
        });
      });
    },
    delete(start: number, end: number) {
      enqueueAction(() => {
        if (!validateDeleteInput(start, end, readParagraphText(doc))) return;
        const range = normalizeRange(start, end);
        runLocalMutation(({ body }) => {
          body.delete(textOffsetToBodyIndex(range.start), range.end - range.start);
        });
      });
    },
    toggleMark(start: number, end: number, kind: MarkKind) {
      enqueueAction(() => {
        if (!validateMarkKind(kind)) return;
        const text = readParagraphText(doc);
        if (!validateMarkRange(start, end, text)) return;
        const range = normalizeRange(start, end);
        operationCounter = Math.max(
          operationCounter,
          nextContributionSequence(markContributions, contributionPrefix)
        );
        const operationIdentity = `${contributionPrefix}${operationCounter}`;
        runLocalMutation(({ body, marks, doc: stagedDoc }) => {
          const segments = resolveMarkSegments(body, marks, stagedDoc);
          if (isRangeFullyMarked(segments, kind, range.start, range.end)) {
            disableMark(
              body,
              marks,
              stagedDoc,
              kind,
              range,
              `${operationIdentity}:remove:${kind}`,
              identity.actorId,
              `${identity.sessionId}:${identity.clientId}:${operationCounter}`
            );
          } else {
            enableMark(
              body,
              marks,
              stagedDoc,
              kind,
              range,
              `${operationIdentity}:add:${kind}`,
              identity.actorId,
              `${identity.sessionId}:${identity.clientId}:${operationCounter}`
            );
          }
        });
      });
    },
    undo(): boolean {
      if (undoManager.undoStack.length === 0) return false;
      enqueueAction(() => {
        const before = snapshot();
        undoManager.undo();
        undoManager.stopCapturing();
        notifyIfChanged(before);
      });
      return true;
    },
    encodeUpdate(): Uint8Array {
      return new Uint8Array(Y.encodeStateAsUpdate(doc));
    },
    applyRemoteUpdate(update: Uint8Array) {
      enqueueAction(() => {
        if (!validateUpdateBytes(update)) return;
        if (!updateHasNovelContent(update, doc)) return;
        const before = snapshot();
        const incomingClients = new Set(
          Y.decodeUpdate(update).structs.map((struct) => struct.id.client)
        );
        const staged = cloneDocFromUpdate(
          Y.encodeStateAsUpdate(doc),
          allocateOperationClientId(identity.clientId, remoteUpdateCounter, doc, incomingClients)
        );
        const remoteOrigin = createRemoteUntrackedOrigin({
          actorId: 'remote',
          replicaId: `replica-${remoteUpdateCounter}`,
          sessionId: 'remote',
          updateId: `update-${remoteUpdateCounter}`,
        });
        try {
          assertValidDifferentialUpdate(update, doc, loaded.paragraphId);
          Y.applyUpdate(staged, update, remoteOrigin);
          assertValidPocDoc(staged, loaded.paragraphId);
        } catch {
          return;
        }
        remoteUpdateCounter += 1;
        Y.applyUpdate(doc, update, remoteOrigin);
        operationCounter = Math.max(
          operationCounter,
          nextContributionSequence(markContributions, contributionPrefix)
        );
        notifyIfChanged(before);
      });
    },
    subscribe(listener: (snapshot: PocSnapshot) => void): () => void {
      if (typeof listener !== 'function') throw new TypeError('listener must be a function');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}

export function getDeterministicBootstrapUpdate(loaded: LoadedPocDocx): Uint8Array {
  validateLoadedSnapshot(loaded);
  const key = bootstrapCacheKey(loaded);
  const cached = bootstrapCache.get(key);
  if (cached) return new Uint8Array(cached);

  const doc = new Y.Doc({ gc: false, guid: BOOTSTRAP_GUID });
  doc.clientID = BOOTSTRAP_CLIENT_ID;
  const body = doc.getText(BODY_SEQUENCE_KEY);
  const marks = doc.getMap<Record<string, unknown>>(MARK_CONTRIBUTIONS_KEY);

  doc.transact(() => {
    body.insertEmbed(0, createBoundaryEmbed(loaded.paragraphId));
    body.insert(1, loaded.text);
    let offset = 0;
    let contributionIndex = 0;
    for (const run of loaded.runs) {
      const start = offset;
      const end = offset + run.text.length;
      if (run.bold) {
        enableMark(
          body,
          marks,
          doc,
          'bold',
          { start, end },
          `bootstrap:add:bold:${contributionIndex}`,
          'bootstrap',
          `bootstrap-${contributionIndex}`
        );
        contributionIndex += 1;
      }
      if (run.italic) {
        enableMark(
          body,
          marks,
          doc,
          'italic',
          { start, end },
          `bootstrap:add:italic:${contributionIndex}`,
          'bootstrap',
          `bootstrap-${contributionIndex}`
        );
        contributionIndex += 1;
      }
      offset = end;
    }
  }, 'poc-bootstrap');

  assertValidPocDoc(doc, loaded.paragraphId);
  const update = Y.encodeStateAsUpdate(doc);
  bootstrapCache.set(key, update.slice());
  return new Uint8Array(update);
}

function snapshotStoreOptions(options: CreatePocStoreOptions): Readonly<CreatePocStoreOptions> {
  if (!options || typeof options !== 'object') throw new TypeError('options must be an object');
  const names = Object.getOwnPropertyNames(options);
  const symbols = Object.getOwnPropertySymbols(options);
  const expected = ['actorId', 'clientId', 'sessionId'];
  if (
    symbols.length !== 0 ||
    names.length !== expected.length ||
    [...names].sort().some((name, index) => name !== expected[index])
  ) {
    throw new TypeError('options must contain exactly actorId, sessionId, and clientId');
  }
  const values: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const name of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(options, name);
    if (!descriptor || !('value' in descriptor)) {
      throw new TypeError(`options ${name} descriptor must be own data`);
    }
    values[name] = descriptor.value;
  }
  const actorId = values.actorId;
  const sessionId = values.sessionId;
  const clientId = values.clientId;
  if (validateSpikeId(actorId, 'actorId')) throw new TypeError('invalid actorId');
  if (validateSpikeId(sessionId, 'sessionId')) throw new TypeError('invalid sessionId');
  if (
    !Number.isInteger(clientId) ||
    (clientId as number) <= 0 ||
    (clientId as number) > 0xffff_ffff
  ) {
    throw new TypeError('clientId must be a positive integer');
  }
  if (clientId === BOOTSTRAP_CLIENT_ID) {
    throw new TypeError('clientId is reserved for deterministic bootstrap state');
  }
  return Object.freeze({
    actorId: actorId as string,
    sessionId: sessionId as string,
    clientId: clientId as number,
  });
}

function claimStoreClientId(clientId: number): void {
  if (claimedStoreClientIds.has(clientId)) {
    throw new TypeError(`clientId ${clientId} is already claimed by a live POC store identity`);
  }
  claimedStoreClientIds.add(clientId);
}

function validateLoadedSnapshot(loaded: LoadedPocDocx): void {
  if (!loaded || typeof loaded !== 'object') throw new TypeError('loaded DOCX is required');
  if (typeof loaded.paragraphId !== 'string' || loaded.paragraphId.length === 0) {
    throw new TypeError('loaded paragraphId is required');
  }
  if (
    loaded.paragraphId.length > POC_MAX_ID_LENGTH ||
    containsInvalidSurrogateBoundary(loaded.paragraphId)
  ) {
    throw new TypeError('loaded paragraphId is invalid');
  }
  if (typeof loaded.text !== 'string') throw new TypeError('loaded text is required');
  if (loaded.text.length > POC_MAX_TEXT_LENGTH) throw new TypeError('loaded text exceeds bound');
  if (containsInvalidSurrogateBoundary(loaded.text))
    throw new TypeError('loaded text is invalid UTF-16');
  if (!Array.isArray(loaded.runs)) throw new TypeError('loaded runs are required');
}

function bootstrapCacheKey(loaded: LoadedPocDocx): string {
  return `${loaded.paragraphId}\u0000${loaded.text}\u0000${loaded.runs
    .map((run) => `${run.text}:${run.bold ? 1 : 0}:${run.italic ? 1 : 0}`)
    .join('\u0001')}`;
}

function createBoundaryEmbed(paragraphId: string): BoundaryEmbed {
  return Object.freeze({ kind: 'paragraph-boundary', paragraphId });
}

function textOffsetToBodyIndex(offset: number): number {
  return offset + 1;
}

function readParagraphText(doc: Y.Doc): string {
  const body = doc.getText(BODY_SEQUENCE_KEY);
  let text = '';
  for (const delta of body.toDelta()) {
    if (typeof delta.insert === 'string') text += delta.insert;
  }
  return text;
}

function validateInsertInput(offset: number, text: string, currentText: string): boolean {
  if (typeof text !== 'string' || text.length === 0) return false;
  if (text.length > POC_MAX_INSERT_LENGTH) return false;
  if (!Number.isInteger(offset) || offset < 0 || offset > currentText.length) return false;
  if (currentText.length + text.length > POC_MAX_TEXT_LENGTH) return false;
  if (containsInvalidSurrogateBoundary(text)) return false;
  if (offset > 0 && isLowSurrogate(currentText[offset - 1]!)) return false;
  if (offset < currentText.length && isHighSurrogate(currentText[offset]!)) return false;
  return true;
}

function validateDeleteInput(start: number, end: number, currentText: string): boolean {
  if (!Number.isInteger(start) || !Number.isInteger(end)) return false;
  const range = normalizeRange(start, end);
  if (range.start === range.end) return false;
  if (range.start < 0 || range.end > currentText.length) return false;
  for (let index = range.start; index < range.end; index += 1) {
    const char = currentText[index]!;
    if (isHighSurrogate(char)) {
      if (index + 1 >= range.end || !isLowSurrogate(currentText[index + 1]!)) return false;
      index += 1;
      continue;
    }
    if (isLowSurrogate(char)) return false;
  }
  return true;
}

function validateMarkRange(start: number, end: number, currentText: string): boolean {
  if (!Number.isInteger(start) || !Number.isInteger(end)) return false;
  const range = normalizeRange(start, end);
  if (range.start === range.end) return false;
  if (range.start < 0 || range.end > currentText.length) return false;
  for (let index = range.start; index < range.end; index += 1) {
    const char = currentText[index]!;
    if (isHighSurrogate(char)) {
      if (index + 1 >= range.end || !isLowSurrogate(currentText[index + 1]!)) return false;
      index += 1;
      continue;
    }
    if (isLowSurrogate(char)) return false;
  }
  return true;
}

function validateMarkKind(kind: unknown): kind is MarkKind {
  return kind === 'bold' || kind === 'italic';
}

function validateUpdateBytes(update: unknown): update is Uint8Array {
  if (!(update instanceof Uint8Array)) return false;
  if (update.byteLength === 0 || update.byteLength > POC_MAX_UPDATE_BYTES) return false;
  return true;
}

function normalizeRange(start: number, end: number): TextRange {
  return start <= end ? { start, end } : { start: end, end: start };
}

function isHighSurrogate(char: string): boolean {
  const code = char.codePointAt(0)!;
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(char: string): boolean {
  const code = char.codePointAt(0)!;
  return code >= 0xdc00 && code <= 0xdfff;
}

function containsInvalidSurrogateBoundary(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= text.length) return true;
      const next = text.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

function isSurrogateSplitOffset(text: string, offset: number): boolean {
  return (
    offset > 0 &&
    offset < text.length &&
    isHighSurrogate(text[offset - 1]!) &&
    isLowSurrogate(text[offset]!)
  );
}

function cloneDocFromUpdate(update: Uint8Array, clientId: number): Y.Doc {
  const clone = new Y.Doc({ gc: false });
  clone.clientID = clientId;
  Y.applyUpdate(clone, update);
  return clone;
}

function allocateOperationClientId(
  storeClientId: number,
  sequence: number,
  doc: Y.Doc,
  additionalOccupied: ReadonlySet<number> = new Set()
): number {
  const occupied = Y.decodeStateVector(Y.encodeStateVector(doc));
  for (let probe = 0; probe < 0xffff_ffff; probe += 1) {
    let hash = 0x811c9dc5;
    const input = `${storeClientId}:${sequence}:${probe}`;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    const candidate = hash >>> 0;
    if (
      candidate !== 0 &&
      candidate !== storeClientId &&
      !occupied.has(candidate) &&
      !additionalOccupied.has(candidate)
    ) {
      return candidate;
    }
  }
  throw new TypeError('unable to allocate collision-free operation clientId');
}

function nextContributionSequence(marks: Y.Map<Record<string, unknown>>, prefix: string): number {
  let next = 0;
  for (const key of marks.keys()) {
    if (!key.startsWith(prefix)) continue;
    const suffix = key.slice(prefix.length);
    const separator = suffix.indexOf(':');
    const encoded = separator === -1 ? suffix : suffix.slice(0, separator);
    if (!/^(0|[1-9][0-9]*)$/.test(encoded)) continue;
    const sequence = Number(encoded);
    if (Number.isSafeInteger(sequence)) next = Math.max(next, sequence + 1);
  }
  return next;
}

function updateHasNovelContent(update: Uint8Array, doc: Y.Doc): boolean {
  try {
    const current = Y.decodeStateVector(Y.encodeStateVector(doc));
    const decoded = Y.decodeUpdate(update);
    if (
      decoded.structs.some(
        (struct) => struct.id.clock + struct.length > (current.get(struct.id.client) ?? 0)
      )
    ) {
      return true;
    }
    for (const [clientId, ranges] of decoded.ds.clients) {
      const structs = doc.store.clients.get(clientId) ?? [];
      for (const range of ranges) {
        const end = range.clock + range.len;
        let clock = range.clock;
        while (clock < end) {
          const struct = structs.find(
            (candidate) =>
              candidate.id.clock <= clock && candidate.id.clock + candidate.length > clock
          );
          if (!struct || !struct.deleted) return true;
          clock = Math.min(end, struct.id.clock + struct.length);
        }
      }
    }
    return false;
  } catch {
    return false;
  }
}

function assertValidDifferentialUpdate(
  update: Uint8Array,
  liveDoc: Y.Doc,
  paragraphId: string
): void {
  if (update.byteLength === 0) return;
  const decoded = Y.decodeUpdate(update);
  const current = Y.decodeStateVector(Y.encodeStateVector(liveDoc));
  const seenMapKeys = new Set<string>();
  const liveMarks = liveDoc.getMap<Record<string, unknown>>(MARK_CONTRIBUTIONS_KEY);

  for (const struct of decoded.structs) {
    const coveredClock = current.get(struct.id.client) ?? 0;
    if (struct.id.clock + struct.length <= coveredClock) continue;
    if (struct.id.clock < coveredClock) {
      throw new TypeError('differential update partially overlaps covered structs');
    }
    if (!(struct instanceof Y.Item)) continue;

    const parent = struct.parent as unknown;
    if (
      typeof parent === 'string' &&
      parent !== BODY_SEQUENCE_KEY &&
      parent !== MARK_CONTRIBUTIONS_KEY
    ) {
      throw new TypeError('differential update introduces unknown root');
    }

    if (struct.parentSub !== null) {
      const key = struct.parentSub;
      if (key.length === 0 || key.length > POC_MAX_ID_LENGTH) {
        throw new TypeError('invalid contribution key in differential update');
      }
      if (seenMapKeys.has(key)) {
        throw new TypeError('differential update assigns a creation key more than once');
      }
      if (liveMarks.has(key)) {
        throw new TypeError('differential update overwrites a creation-only key');
      }
      seenMapKeys.add(key);
      if (!(struct.content instanceof Y.ContentAny)) {
        throw new TypeError('mark contribution must contain plain JSON');
      }
      const content = struct.content.getContent();
      if (content.length !== 1)
        throw new TypeError('mark contribution assignment must be singular');
      validateContributionRecord(content[0], key);
      continue;
    }

    const isStringContent = struct.content instanceof Y.ContentString;
    if (
      !isStringContent &&
      !(struct.content instanceof Y.ContentEmbed) &&
      !(struct.content instanceof Y.ContentDeleted)
    ) {
      throw new TypeError('bodySequence differential content is not permitted');
    }
    if (
      isStringContent &&
      (() => {
        const values = struct.content.getContent();
        if (values.some((value) => typeof value !== 'string')) return true;
        const text = (values as string[]).join('');
        return containsInvalidSurrogateBoundary(text) || text.includes('\uFFFD');
      })()
    ) {
      throw new TypeError('bodySequence differential contains invalid UTF-16');
    }
  }

  void paragraphId;
}

function assertValidPocDoc(doc: Y.Doc, paragraphId: string): void {
  if (doc.share.size !== 2) throw new TypeError('POC doc must contain exactly two shared types');
  for (const key of doc.share.keys()) {
    if (key !== BODY_SEQUENCE_KEY && key !== MARK_CONTRIBUTIONS_KEY) {
      throw new TypeError('unexpected shared type');
    }
  }
  if (!doc.share.has(BODY_SEQUENCE_KEY) || !doc.share.has(MARK_CONTRIBUTIONS_KEY)) {
    throw new TypeError('missing required shared types');
  }
  const body = doc.getText(BODY_SEQUENCE_KEY);
  const marks = doc.getMap<Record<string, unknown>>(MARK_CONTRIBUTIONS_KEY);

  const delta = body.toDelta();
  if (delta.length === 0) throw new TypeError('bodySequence must not be empty');
  const first = delta[0]!;
  if (typeof first.insert !== 'object' || first.insert === null) {
    throw new TypeError('bodySequence must start with opening boundary embed');
  }
  const boundary = first.insert as BoundaryEmbed;
  if (
    !hasExactOwnKeys(boundary as unknown as Record<string, unknown>, ['kind', 'paragraphId']) ||
    boundary.kind !== 'paragraph-boundary' ||
    boundary.paragraphId !== paragraphId
  ) {
    throw new TypeError('invalid opening boundary embed');
  }
  if (
    delta.some(
      (item: { insert?: unknown; attributes?: unknown }, index: number) =>
        item.attributes !== undefined || (index > 0 && typeof item.insert !== 'string')
    )
  ) {
    throw new TypeError('bodySequence must not contain interior embeds');
  }

  const text = readParagraphText(doc);
  if (text.length > POC_MAX_TEXT_LENGTH) throw new TypeError('paragraph text exceeds bound');
  if (containsInvalidSurrogateBoundary(text))
    throw new TypeError('paragraph text is invalid UTF-16');

  let contributionCount = 0;
  const records = new Map<string, Record<string, unknown>>();
  marks.forEach((record, key) => {
    contributionCount += 1;
    if (contributionCount > POC_MAX_CONTRIBUTIONS)
      throw new TypeError('mark contribution count exceeds bound');
    validateContributionRecord(record, key);
    records.set(key, record);
  });
  validateContributionSemantics(records, doc, body, text);

  projectSnapshot(doc, paragraphId);
}

function validateContributionRecord(record: unknown, key: string): void {
  if (typeof key !== 'string' || key.length === 0 || key.length > POC_MAX_ID_LENGTH) {
    throw new TypeError('invalid contribution id');
  }
  if (!isPlainRecord(record)) throw new TypeError(`invalid contribution record ${key}`);
  if (record.kind !== 'add' && record.kind !== 'remove') {
    throw new TypeError(`invalid contribution kind for ${key}`);
  }
  const expectedKeys =
    record.kind === 'add'
      ? ['actorId', 'commitId', 'kind', 'markKind', 'relativeEnd', 'relativeStart']
      : [
          'actorId',
          'commitId',
          'kind',
          'markKind',
          'relativeEnd',
          'relativeStart',
          'targetAddContributionIds',
        ];
  if (!hasExactOwnKeys(record, expectedKeys)) {
    throw new TypeError(`contribution record has unexpected fields for ${key}`);
  }
  if (record.markKind !== 'bold' && record.markKind !== 'italic') {
    throw new TypeError(`invalid mark kind for ${key}`);
  }
  if (
    typeof record.actorId !== 'string' ||
    record.actorId.length === 0 ||
    record.actorId.length > POC_MAX_ID_LENGTH ||
    containsInvalidSurrogateBoundary(record.actorId)
  ) {
    throw new TypeError(`invalid actorId for ${key}`);
  }
  if (
    typeof record.commitId !== 'string' ||
    record.commitId.length === 0 ||
    record.commitId.length > POC_MAX_ID_LENGTH ||
    containsInvalidSurrogateBoundary(record.commitId)
  ) {
    throw new TypeError(`invalid commitId for ${key}`);
  }
  if (typeof record.relativeStart !== 'string' || typeof record.relativeEnd !== 'string') {
    throw new TypeError(`invalid endpoints for ${key}`);
  }
  if (
    record.relativeStart.length > POC_MAX_ENDPOINT_LENGTH ||
    record.relativeEnd.length > POC_MAX_ENDPOINT_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(record.relativeStart) ||
    !/^[A-Za-z0-9_-]+$/.test(record.relativeEnd)
  ) {
    throw new TypeError(`endpoint encoding must be canonical base64url for ${key}`);
  }
  if (record.kind === 'remove') {
    if (!Array.isArray(record.targetAddContributionIds)) {
      throw new TypeError(`remove record requires targets for ${key}`);
    }
    const targets = record.targetAddContributionIds as unknown[];
    if (
      targets.length === 0 ||
      targets.length > POC_MAX_REMOVE_TARGETS ||
      targets.some(
        (target) =>
          typeof target !== 'string' || target.length === 0 || target.length > POC_MAX_ID_LENGTH
      ) ||
      new Set(targets).size !== targets.length
    ) {
      throw new TypeError(`invalid remove targets for ${key}`);
    }
  }
}

function hasExactOwnKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  if (Object.getOwnPropertySymbols(record).length !== 0) return false;
  const actual = Object.getOwnPropertyNames(record).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((name, index) => name === sortedExpected[index])
  );
}

function validateContributionSemantics(
  records: ReadonlyMap<string, Record<string, unknown>>,
  doc: Y.Doc,
  body: Y.Text,
  text: string
): void {
  for (const [id, record] of records) {
    const start = bodyIndexToTextOffset(decodeEndpoint(doc, body, record.relativeStart as string));
    const end = bodyIndexToTextOffset(decodeEndpoint(doc, body, record.relativeEnd as string));
    if (start < 0 || end < 0 || start > end || end > text.length) {
      throw new TypeError(`contribution endpoints are out of range for ${id}`);
    }
    if (isSurrogateSplitOffset(text, start) || isSurrogateSplitOffset(text, end)) {
      throw new TypeError(`contribution endpoint splits UTF-16 for ${id}`);
    }
    if (record.kind !== 'remove') continue;
    for (const targetId of record.targetAddContributionIds as readonly string[]) {
      const target = records.get(targetId);
      if (!target || target.kind !== 'add' || target.markKind !== record.markKind) {
        throw new TypeError(`remove target is missing or incompatible for ${id}`);
      }
    }
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype &&
    !Object.values(value as Record<string, unknown>).some(
      (field) => field instanceof Y.AbstractType
    )
  );
}

function setCreationOnly(
  map: Y.Map<Record<string, unknown>>,
  key: string,
  value: Record<string, unknown>
): void {
  if (map.has(key)) throw new TypeError(`creation-only key already exists: ${key}`);
  map.set(key, Object.freeze({ ...value }));
}

function encodeEndpoint(body: Y.Text, index: number, affinity: 'before' | 'after'): string {
  const relative = Y.createRelativePositionFromTypeIndex(
    body,
    index,
    affinity === 'before' ? -1 : 0
  );
  return btoa(String.fromCharCode(...Y.encodeRelativePosition(relative)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeEndpoint(doc: Y.Doc, body: Y.Text, value: string): number {
  if (
    value.length === 0 ||
    value.length > POC_MAX_ENDPOINT_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw new TypeError('endpoint is not canonical base64url');
  }
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const canonical = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  if (canonical !== value) throw new TypeError('endpoint is not canonical base64url');
  const absolute = Y.createAbsolutePositionFromRelativePosition(
    Y.decodeRelativePosition(bytes),
    doc
  );
  if (!absolute || absolute.type !== body) throw new TypeError('endpoint detached');
  return absolute.index;
}

function bodyIndexToTextOffset(index: number): number {
  return index - 1;
}

function enableMark(
  body: Y.Text,
  marks: Y.Map<Record<string, unknown>>,
  doc: Y.Doc,
  kind: MarkKind,
  range: TextRange,
  contributionId: string,
  actorId: string,
  commitId: string
): void {
  setCreationOnly(marks, contributionId, {
    kind: 'add',
    markKind: kind,
    actorId,
    commitId,
    relativeStart: encodeEndpoint(body, textOffsetToBodyIndex(range.start), 'after'),
    relativeEnd: encodeEndpoint(body, textOffsetToBodyIndex(range.end), 'before'),
  });
  void doc;
}

function disableMark(
  body: Y.Text,
  marks: Y.Map<Record<string, unknown>>,
  doc: Y.Doc,
  kind: MarkKind,
  range: TextRange,
  contributionId: string,
  actorId: string,
  commitId: string
): void {
  const targets: string[] = [];
  marks.forEach((record, id) => {
    if (record.kind !== 'add' || record.markKind !== kind) return;
    const addStart = bodyIndexToTextOffset(
      decodeEndpoint(doc, body, record.relativeStart as string)
    );
    const addEnd = bodyIndexToTextOffset(decodeEndpoint(doc, body, record.relativeEnd as string));
    if (addStart < range.end && addEnd > range.start) targets.push(id);
  });
  const uniqueTargets = [...new Set(targets)].sort();
  if (uniqueTargets.length === 0) return;
  setCreationOnly(marks, contributionId, {
    kind: 'remove',
    markKind: kind,
    actorId,
    commitId,
    relativeStart: encodeEndpoint(body, textOffsetToBodyIndex(range.start), 'after'),
    relativeEnd: encodeEndpoint(body, textOffsetToBodyIndex(range.end), 'before'),
    targetAddContributionIds: Object.freeze(uniqueTargets),
  });
}

function resolveMarkSegments(
  body: Y.Text,
  marks: Y.Map<Record<string, unknown>>,
  doc: Y.Doc
): readonly MarkSegment[] {
  const textLength = readParagraphText(doc).length;
  const adds: MarkSegment[] = [];
  const removals: Array<{
    kind: MarkKind;
    start: number;
    end: number;
    targets: readonly string[];
  }> = [];

  marks.forEach((record, id) => {
    const decodedStart = bodyIndexToTextOffset(
      decodeEndpoint(doc, body, record.relativeStart as string)
    );
    const decodedEnd = bodyIndexToTextOffset(
      decodeEndpoint(doc, body, record.relativeEnd as string)
    );
    const start = Math.max(0, Math.min(textLength, decodedStart));
    const end = Math.max(start, Math.min(textLength, decodedEnd));
    if (record.kind === 'add') {
      adds.push({ kind: record.markKind as MarkKind, start, end, contributionId: id });
    } else if (record.kind === 'remove') {
      removals.push({
        kind: record.markKind as MarkKind,
        start,
        end,
        targets: record.targetAddContributionIds as readonly string[],
      });
    }
  });

  return adds.flatMap((add) =>
    subtractIntervals(
      add.start,
      add.end,
      removals
        .filter((remove) => remove.kind === add.kind && remove.targets.includes(add.contributionId))
        .map(({ start, end }) => ({ start, end }))
    ).map((interval) => ({
      kind: add.kind,
      start: interval.start,
      end: interval.end,
      contributionId: add.contributionId,
    }))
  );
}

function subtractIntervals(
  start: number,
  end: number,
  removes: readonly { start: number; end: number }[]
): Array<{ start: number; end: number }> {
  let ranges = [{ start, end }];
  for (const remove of removes) {
    ranges = ranges.flatMap((range) => {
      if (remove.end <= range.start || remove.start >= range.end) return [range];
      const parts: Array<{ start: number; end: number }> = [];
      if (remove.start > range.start) parts.push({ start: range.start, end: remove.start });
      if (remove.end < range.end) parts.push({ start: remove.end, end: range.end });
      return parts;
    });
  }
  return ranges.filter((range) => range.end > range.start);
}

function isRangeFullyMarked(
  segments: readonly MarkSegment[],
  kind: MarkKind,
  start: number,
  end: number
): boolean {
  for (let index = start; index < end; index += 1) {
    if (
      !segments.some(
        (segment) => segment.kind === kind && segment.start <= index && index < segment.end
      )
    ) {
      return false;
    }
  }
  return true;
}

function projectSnapshot(doc: Y.Doc, paragraphId: string): PocSnapshot {
  const body = doc.getText(BODY_SEQUENCE_KEY);
  const marks = doc.getMap<Record<string, unknown>>(MARK_CONTRIBUTIONS_KEY);
  const text = readParagraphText(doc);
  const segments = resolveMarkSegments(body, marks, doc);
  const breakpoints = new Set<number>([0, text.length]);
  for (const segment of segments) {
    breakpoints.add(segment.start);
    breakpoints.add(segment.end);
  }
  const sorted = [...breakpoints].sort((left, right) => left - right);
  const runs: Array<{ text: string; bold: boolean; italic: boolean }> = [];
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const start = sorted[index]!;
    const end = sorted[index + 1]!;
    if (start === end) continue;
    const run = {
      text: text.slice(start, end),
      bold: isRangeFullyMarked(segments, 'bold', start, end),
      italic: isRangeFullyMarked(segments, 'italic', start, end),
    };
    const previous = runs[runs.length - 1];
    if (previous && previous.bold === run.bold && previous.italic === run.italic) {
      previous.text += run.text;
    } else {
      runs.push(run);
    }
  }
  return {
    paragraphId,
    text,
    runs: Object.freeze(runs.map((run) => Object.freeze({ ...run }))),
  };
}

function deepFreezeSnapshot(snapshot: PocSnapshot): PocSnapshot {
  return Object.freeze({
    paragraphId: snapshot.paragraphId,
    text: snapshot.text,
    runs: Object.freeze(snapshot.runs.map((run) => Object.freeze({ ...run }))),
  });
}

function snapshotsEqual(left: PocSnapshot, right: PocSnapshot): boolean {
  if (left.paragraphId !== right.paragraphId || left.text !== right.text) return false;
  if (left.runs.length !== right.runs.length) return false;
  return left.runs.every(
    (run, index) =>
      run.text === right.runs[index]!.text &&
      run.bold === right.runs[index]!.bold &&
      run.italic === right.runs[index]!.italic
  );
}

export const POC_STORE_PARAGRAPH_ID = POC_PARAGRAPH_ID;
