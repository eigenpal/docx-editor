/** @spike-features yjs-backend, insert-delete-split-join-operations, origin-metadata */
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
  liveSnapshot: Uint8Array;
  readonly trackedOrigin: string;
}

const bootstrapCache = new Map<string, Uint8Array>();

export function createPocStore(loaded: LoadedPocDocx, options: CreatePocStoreOptions): PocStore {
  validateStoreOptions(options);
  validateLoadedSnapshot(loaded);

  const doc = new Y.Doc({ gc: false });
  doc.clientID = options.clientId;
  Y.applyUpdate(doc, getDeterministicBootstrapUpdate(loaded), 'poc-bootstrap');

  const bodySequence = doc.getText(BODY_SEQUENCE_KEY);
  const markContributions = doc.getMap<Record<string, unknown>>(MARK_CONTRIBUTIONS_KEY);
  const trackedOrigin = createStableTrackedOrigin(options.actorId, options.sessionId);
  const undoManager = new Y.UndoManager([bodySequence, markContributions], {
    trackedOrigins: new Set([trackedOrigin]),
    captureTimeout: Number.MAX_SAFE_INTEGER,
    ignoreRemoteMapChanges: true,
  });

  let operationCounter = 0;
  let remoteUpdateCounter = 0;
  const listeners = new Set<(snapshot: PocSnapshot) => void>();

  const executor = createSynchronousTransactionExecutor<LocalMutationStage, void>({
    preflight(stage) {
      stage.liveSnapshot = Y.encodeStateAsUpdate(stage.liveDoc);
      stage.stagedDoc = cloneDocFromUpdate(stage.liveSnapshot, stage.liveDoc.clientID);
    },
    publish(stage) {
      const update = Y.encodeStateAsUpdate(stage.stagedDoc, Y.encodeStateVector(stage.liveDoc));
      if (update.byteLength === 0) return;
      Y.applyUpdate(stage.liveDoc, update, stage.trackedOrigin);
      assertValidPocDoc(stage.liveDoc, loaded.paragraphId);
    },
    rollback(stage) {
      const reverse = Y.encodeStateAsUpdate(
        cloneDocFromUpdate(stage.liveSnapshot, stage.liveDoc.clientID),
        Y.encodeStateVector(stage.liveDoc)
      );
      if (reverse.byteLength > 0) {
        Y.applyUpdate(stage.liveDoc, reverse, 'poc-rollback');
      }
    },
  });

  const notifyIfChanged = (before: PocSnapshot): void => {
    const after = snapshot();
    if (snapshotsEqual(before, after)) return;
    for (const listener of listeners) listener(after);
  };

  const runLocalMutation = (mutate: (ctx: {
    body: Y.Text;
    marks: Y.Map<Record<string, unknown>>;
    doc: Y.Doc;
  }) => void): boolean => {
    const before = snapshot();
    const stage: LocalMutationStage = {
      liveDoc: doc,
      stagedDoc: doc,
      liveSnapshot: new Uint8Array(),
      trackedOrigin,
    };
    const context = createSynchronousTransactionContext({
      actorId: options.actorId,
      sessionId: options.sessionId,
      groupId: `${options.sessionId}-poc`,
      transactionId: `${options.sessionId}-poc-${operationCounter}`,
      origin: createMutationOrigin('human', {
        actorId: options.actorId,
        sessionId: options.sessionId,
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
    });
    if (!result.ok) return false;
    operationCounter += 1;
    undoManager.stopCapturing();
    notifyIfChanged(before);
    return true;
  };

  const snapshot = (): PocSnapshot => deepFreezeSnapshot(projectSnapshot(doc, loaded.paragraphId));

  return Object.freeze({
    actorId: options.actorId,
    snapshot,
    insert(offset: number, text: string) {
      if (!validateInsertInput(offset, text, readParagraphText(doc))) return;
      runLocalMutation(({ body }) => {
        body.insert(textOffsetToBodyIndex(offset), text);
      });
    },
    delete(start: number, end: number) {
      if (!validateDeleteInput(start, end, readParagraphText(doc))) return;
      const range = normalizeRange(start, end);
      runLocalMutation(({ body }) => {
        body.delete(textOffsetToBodyIndex(range.start), range.end - range.start);
      });
    },
    toggleMark(start: number, end: number, kind: MarkKind) {
      if (!validateMarkKind(kind)) return;
      const text = readParagraphText(doc);
      if (!validateMarkRange(start, end, text)) return;
      const range = normalizeRange(start, end);
      runLocalMutation(({ body, marks, doc: stagedDoc }) => {
        const segments = resolveMarkSegments(body, marks, stagedDoc);
        if (isRangeFullyMarked(segments, kind, range.start, range.end)) {
          disableMark(body, marks, stagedDoc, kind, range, options.actorId, options.sessionId, operationCounter);
        } else {
          enableMark(
            body,
            marks,
            stagedDoc,
            kind,
            range,
            `${options.actorId}:${options.sessionId}:${operationCounter}`,
            options.actorId,
            `${options.sessionId}:${operationCounter}`
          );
        }
      });
    },
    undo(): boolean {
      if (undoManager.undoStack.length === 0) return false;
      const before = snapshot();
      undoManager.undo();
      undoManager.stopCapturing();
      notifyIfChanged(before);
      return true;
    },
    encodeUpdate(): Uint8Array {
      return new Uint8Array(Y.encodeStateAsUpdate(doc));
    },
    applyRemoteUpdate(update: Uint8Array) {
      if (!validateUpdateBytes(update)) return;
      const before = snapshot();
      const staged = cloneDocFromUpdate(Y.encodeStateAsUpdate(doc), doc.clientID);
      const remoteOrigin = createRemoteUntrackedOrigin({
        actorId: 'remote',
        replicaId: `replica-${remoteUpdateCounter}`,
        sessionId: 'remote',
        updateId: `update-${remoteUpdateCounter}`,
      });
      try {
        Y.applyUpdate(staged, update, remoteOrigin);
        assertValidPocDoc(staged, loaded.paragraphId);
      } catch {
        return;
      }
      remoteUpdateCounter += 1;
      Y.applyUpdate(doc, update, remoteOrigin);
      notifyIfChanged(before);
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

function validateStoreOptions(options: CreatePocStoreOptions): void {
  if (!options || typeof options !== 'object') throw new TypeError('options must be an object');
  if (validateSpikeId(options.actorId, 'actorId')) throw new TypeError('invalid actorId');
  if (validateSpikeId(options.sessionId, 'sessionId')) throw new TypeError('invalid sessionId');
  if (!Number.isInteger(options.clientId) || options.clientId <= 0) {
    throw new TypeError('clientId must be a positive integer');
  }
}

function validateLoadedSnapshot(loaded: LoadedPocDocx): void {
  if (!loaded || typeof loaded !== 'object') throw new TypeError('loaded DOCX is required');
  if (typeof loaded.paragraphId !== 'string' || loaded.paragraphId.length === 0) {
    throw new TypeError('loaded paragraphId is required');
  }
  if (typeof loaded.text !== 'string') throw new TypeError('loaded text is required');
  if (loaded.text.length > POC_MAX_TEXT_LENGTH) throw new TypeError('loaded text exceeds bound');
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

function cloneDocFromUpdate(update: Uint8Array, clientId: number): Y.Doc {
  const clone = new Y.Doc({ gc: false });
  clone.clientID = clientId;
  Y.applyUpdate(clone, update);
  return clone;
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
  if (boundary.kind !== 'paragraph-boundary' || boundary.paragraphId !== paragraphId) {
    throw new TypeError('invalid opening boundary embed');
  }
  if (delta.some((item: { insert?: unknown }, index: number) => index > 0 && typeof item.insert === 'object')) {
    throw new TypeError('bodySequence must not contain interior embeds');
  }

  const text = readParagraphText(doc);
  if (text.length > POC_MAX_TEXT_LENGTH) throw new TypeError('paragraph text exceeds bound');

  let contributionCount = 0;
  marks.forEach((record, key) => {
    contributionCount += 1;
    if (contributionCount > POC_MAX_CONTRIBUTIONS) throw new TypeError('mark contribution count exceeds bound');
    validateContributionRecord(record, key);
  });

  projectSnapshot(doc, paragraphId);
}

function validateContributionRecord(record: unknown, key: string): void {
  if (!isPlainRecord(record)) throw new TypeError(`invalid contribution record ${key}`);
  if (record.kind !== 'add' && record.kind !== 'remove') {
    throw new TypeError(`invalid contribution kind for ${key}`);
  }
  if (record.markKind !== 'bold' && record.markKind !== 'italic') {
    throw new TypeError(`invalid mark kind for ${key}`);
  }
  if (typeof record.actorId !== 'string' || record.actorId.length === 0) {
    throw new TypeError(`invalid actorId for ${key}`);
  }
  if (typeof record.commitId !== 'string' || record.commitId.length === 0) {
    throw new TypeError(`invalid commitId for ${key}`);
  }
  if (typeof record.relativeStart !== 'string' || typeof record.relativeEnd !== 'string') {
    throw new TypeError(`invalid endpoints for ${key}`);
  }
  if (!/^[A-Za-z0-9_-]+$/.test(record.relativeStart) || !/^[A-Za-z0-9_-]+$/.test(record.relativeEnd)) {
    throw new TypeError(`endpoint encoding must be canonical base64url for ${key}`);
  }
  if (record.kind === 'remove') {
    if (!Array.isArray(record.targetAddContributionIds)) {
      throw new TypeError(`remove record requires targets for ${key}`);
    }
    const targets = record.targetAddContributionIds as unknown[];
    if (targets.length === 0 || targets.some((target) => typeof target !== 'string')) {
      throw new TypeError(`invalid remove targets for ${key}`);
    }
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype &&
    !Object.values(value as Record<string, unknown>).some((field) => field instanceof Y.AbstractType)
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
  const relative = Y.createRelativePositionFromTypeIndex(body, index, affinity === 'before' ? -1 : 0);
  return btoa(String.fromCharCode(...Y.encodeRelativePosition(relative)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeEndpoint(doc: Y.Doc, body: Y.Text, value: string): number {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new TypeError('endpoint is not canonical base64url');
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const absolute = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(bytes), doc);
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
  actorId: string,
  sessionId: string,
  counter: number
): void {
  const targets: string[] = [];
  marks.forEach((record, id) => {
    if (record.kind !== 'add' || record.markKind !== kind) return;
    const addStart = bodyIndexToTextOffset(decodeEndpoint(doc, body, record.relativeStart as string));
    const addEnd = bodyIndexToTextOffset(decodeEndpoint(doc, body, record.relativeEnd as string));
    if (addStart < range.end && addEnd > range.start) targets.push(id);
  });
  const uniqueTargets = [...new Set(targets)].sort();
  if (uniqueTargets.length === 0) return;
  setCreationOnly(marks, `${actorId}:${sessionId}:remove:${counter}`, {
    kind: 'remove',
    markKind: kind,
    actorId,
    commitId: `${sessionId}:disable:${counter}`,
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
  const adds: MarkSegment[] = [];
  const removals: Array<{
    kind: MarkKind;
    start: number;
    end: number;
    targets: readonly string[];
  }> = [];

  marks.forEach((record, id) => {
    const start = bodyIndexToTextOffset(decodeEndpoint(doc, body, record.relativeStart as string));
    const end = bodyIndexToTextOffset(decodeEndpoint(doc, body, record.relativeEnd as string));
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
    subtractIntervals(add.start, add.end, removals
      .filter((remove) => remove.kind === add.kind && remove.targets.includes(add.contributionId))
      .map(({ start, end }) => ({ start, end })))
      .map((interval) => ({
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
    if (!segments.some((segment) => segment.kind === kind && segment.start <= index && index < segment.end)) {
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
    runs.push({
      text: text.slice(start, end),
      bold: isRangeFullyMarked(segments, 'bold', start, end),
      italic: isRangeFullyMarked(segments, 'italic', start, end),
    });
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
