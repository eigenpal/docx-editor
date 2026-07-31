/** @spike-features yjs-backend */
import * as Y from 'yjs';
import { canonicalJson } from '../../canonical-json';
import type { AuthoredMark, AuthoredPackageModel, AuthoredParagraph } from '../../model/types';
import {
  createActorContext,
  findBlockCreationId,
  findRecordCreationId,
  getMetaMap,
  getRecordField,
  getRootArray,
  getRootMap,
  nextCreation,
  registerSemantic,
  setRecordField,
  writeAllocator,
  writeProvenance,
} from './doc-access';
import type { BootstrapContext, YjsDocState, YjsRecordKind } from './doc-types';
import { encodeRelativeEndpoint } from './endpoints';
import type { MutationTrace } from '../mutate';
import { syncStructuralProvenanceOnText } from './structural-provenance';

function syncTextContent(ytext: Y.Text, before: string, after: string): void {
  if (before === after) return;
  let prefix = 0;
  while (
    prefix < before.length &&
    prefix < after.length &&
    before.charCodeAt(prefix) === after.charCodeAt(prefix)
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)
  ) {
    suffix += 1;
  }
  const deleteCount = before.length - prefix - suffix;
  if (deleteCount > 0) ytext.delete(prefix, deleteCount);
  const inserted = after.slice(prefix, after.length - suffix);
  if (inserted.length > 0) ytext.insert(prefix, inserted);
}

function writeMarkRecord(
  state: YjsDocState,
  ctx: BootstrapContext,
  mark: AuthoredMark,
  textCreationId: string,
  ytext: Y.Text,
  checkpoint: string
): string {
  const creationId = nextCreation(ctx);
  // Actor-local redo may intentionally restore the exact creation identity.
  // The corresponding structural tombstone ceases to be live evidence once
  // the record is restored.
  getMetaMap(state.doc, 'tombstones').delete(creationId);
  clearTombstonesForSemanticId(state.doc, mark.markId);
  registerSemantic(ctx, mark.markId);
  const record = new Y.Map<unknown>();
  writeProvenance(record, creationId, mark.markId, ctx);
  setRecordField(record, 'parentTextId', textCreationId);
  setRecordField(record, 'markKind', mark.kind);
  getRootMap(state.doc, 'marks').set(creationId, record);
  writeMarkEndpoints(state, record, mark, textCreationId, ytext, checkpoint);
  return creationId;
}

function writeMarkEndpoints(
  state: YjsDocState,
  record: Y.Map<unknown>,
  mark: AuthoredMark,
  textCreationId: string,
  ytext: Y.Text,
  checkpoint: string
): void {
  setRecordField(record, 'parentTextId', textCreationId);
  setRecordField(record, 'markKind', mark.kind);
  setRecordField(
    record,
    'start',
    encodeRelativeEndpoint({
      doc: state.doc,
      ytext,
      textCreationId,
      index: mark.start,
      affinity: 'before',
      documentId: state.documentId,
      checkpoint,
    })
  );
  setRecordField(
    record,
    'end',
    encodeRelativeEndpoint({
      doc: state.doc,
      ytext,
      textCreationId,
      index: mark.end,
      affinity: 'after',
      documentId: state.documentId,
      checkpoint,
    })
  );
}

function recordTombstone(
  doc: Y.Doc,
  mapName: 'stories' | 'blocks' | 'texts' | 'marks' | 'capsules',
  creationId: string,
  recordKind: YjsRecordKind
): void {
  const record = getRootMap(doc, mapName).get(creationId) as Y.Map<unknown> | undefined;
  if (!record) return;
  getMetaMap(doc, 'tombstones').set(creationId, {
    creationId,
    semanticId: getRecordField<string>(record, 'semanticId'),
    proposedSemanticId: getRecordField<string>(record, 'proposedSemanticId'),
    actorId: getRecordField<string>(record, 'actorId'),
    commitId: getRecordField<string>(record, 'commitId'),
    recordKind,
  });
  getRootMap(doc, mapName).delete(creationId);
}

function removeBlockSubtree(doc: Y.Doc, blockCreationId: string): void {
  const block = getRootMap(doc, 'blocks').get(blockCreationId) as Y.Map<unknown> | undefined;
  if (!block) return;
  const textCreationId = getRecordField<string>(block, 'textId');
  const markIds = getRecordField<Y.Array<string>>(block, 'markIds');
  const capsuleIds = getRecordField<Y.Array<string>>(block, 'capsuleIds');
  for (const creationId of markIds.toArray()) {
    recordTombstone(doc, 'marks', creationId, 'mark');
  }
  for (const creationId of capsuleIds.toArray()) {
    recordTombstone(doc, 'capsules', creationId, 'capsule');
  }
  recordTombstone(doc, 'texts', textCreationId, 'text');
  recordTombstone(doc, 'blocks', blockCreationId, 'block');
}

function insertBlock(
  state: YjsDocState,
  ctx: BootstrapContext,
  storyCreationId: string,
  paragraph: AuthoredParagraph,
  checkpoint: string,
  trace?: MutationTrace
): string {
  const blockCreationId = nextCreation(ctx);
  const textCreationId = nextCreation(ctx);
  getMetaMap(state.doc, 'tombstones').delete(blockCreationId);
  getMetaMap(state.doc, 'tombstones').delete(textCreationId);
  clearTombstonesForSemanticId(state.doc, paragraph.blockId);
  clearTombstonesForSemanticId(state.doc, `text-${paragraph.blockId}`);
  registerSemantic(ctx, paragraph.blockId);
  registerSemantic(ctx, `text-${paragraph.blockId}`);

  const textRecord = new Y.Map<unknown>();
  writeProvenance(textRecord, textCreationId, `text-${paragraph.blockId}`, ctx);
  setRecordField(textRecord, 'parentBlockId', blockCreationId);
  setRecordField(textRecord, 'content', new Y.Text(paragraph.text));
  getRootMap(state.doc, 'texts').set(textCreationId, textRecord);
  syncStructuralProvenanceOnText(textRecord, paragraph.blockId, trace, ctx);
  const ytext = getRecordField<Y.Text>(textRecord, 'content');

  const blockRecord = new Y.Map<unknown>();
  writeProvenance(blockRecord, blockCreationId, paragraph.blockId, ctx);
  setRecordField(blockRecord, 'storyId', storyCreationId);
  setRecordField(blockRecord, 'parentId', storyCreationId);
  setRecordField(blockRecord, 'blockKind', 'paragraph');
  setRecordField(blockRecord, 'paragraphId', paragraph.paragraphId);
  setRecordField(blockRecord, 'proposedParagraphId', paragraph.paragraphId);
  setRecordField(blockRecord, 'textId', textCreationId);
  setRecordField(blockRecord, 'markIds', new Y.Array<string>());
  setRecordField(blockRecord, 'capsuleIds', new Y.Array<string>());
  setRecordField(blockRecord, 'styleId', paragraph.styleId);
  setRecordField(blockRecord, 'authoredProperties', structuredClone(paragraph.authoredProperties));
  getRootMap(state.doc, 'blocks').set(blockCreationId, blockRecord);

  const markIds = getRecordField<Y.Array<string>>(blockRecord, 'markIds');
  for (const mark of paragraph.marks) {
    markIds.push([writeMarkRecord(state, ctx, mark, textCreationId, ytext, checkpoint)]);
  }
  return blockCreationId;
}

function clearTombstonesForSemanticId(doc: Y.Doc, semanticId: string): void {
  const tombstones = getMetaMap(doc, 'tombstones');
  for (const [creationId, value] of tombstones) {
    const tombstone = value as {
      semanticId?: unknown;
      proposedSemanticId?: unknown;
    };
    if (tombstone.semanticId === semanticId || tombstone.proposedSemanticId === semanticId) {
      tombstones.delete(creationId);
    }
  }
}

function syncMarks(
  state: YjsDocState,
  ctx: BootstrapContext,
  block: Y.Map<unknown>,
  beforeMarks: readonly AuthoredMark[],
  afterMarks: readonly AuthoredMark[],
  checkpoint: string
): void {
  const textCreationId = getRecordField<string>(block, 'textId');
  const textRecord = getRootMap(state.doc, 'texts').get(textCreationId) as Y.Map<unknown>;
  const ytext = getRecordField<Y.Text>(textRecord, 'content');
  const markIds = getRecordField<Y.Array<string>>(block, 'markIds');
  const beforeById = new Map(beforeMarks.map((mark) => [mark.markId, mark]));
  const desiredCreationIds: string[] = [];
  for (const mark of afterMarks) {
    const existingCreationId = findRecordCreationId(state.doc, 'marks', mark.markId);
    if (existingCreationId && beforeById.has(mark.markId)) {
      const record = getRootMap(state.doc, 'marks').get(existingCreationId) as Y.Map<unknown>;
      const beforeMark = beforeById.get(mark.markId)!;
      if (
        beforeMark.kind !== mark.kind ||
        beforeMark.start !== mark.start ||
        beforeMark.end !== mark.end
      ) {
        writeMarkEndpoints(state, record, mark, textCreationId, ytext, checkpoint);
      }
      desiredCreationIds.push(existingCreationId);
    } else {
      desiredCreationIds.push(writeMarkRecord(state, ctx, mark, textCreationId, ytext, checkpoint));
    }
  }
  const desired = new Set(desiredCreationIds);
  for (const creationId of markIds.toArray()) {
    if (!desired.has(creationId)) recordTombstone(state.doc, 'marks', creationId, 'mark');
  }
  syncArray(markIds, desiredCreationIds);
}

function syncArray(target: Y.Array<string>, desired: readonly string[]): void {
  const current = target.toArray();
  if (
    current.length === desired.length &&
    current.every((value, index) => value === desired[index])
  ) {
    return;
  }
  let prefix = 0;
  while (
    prefix < current.length &&
    prefix < desired.length &&
    current[prefix] === desired[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < current.length - prefix &&
    suffix < desired.length - prefix &&
    current[current.length - 1 - suffix] === desired[desired.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const deleteCount = current.length - prefix - suffix;
  if (deleteCount > 0) target.delete(prefix, deleteCount);
  const inserted = desired.slice(prefix, desired.length - suffix);
  if (inserted.length > 0) target.insert(prefix, [...inserted]);
}

export function applyAuthoredTransition(
  state: YjsDocState,
  before: AuthoredPackageModel,
  after: AuthoredPackageModel,
  actorId: string,
  commitSeq: number,
  checkpoint: string,
  trace?: MutationTrace,
  origin?: unknown
): YjsDocState {
  const storyCreationId = getRootArray(state.doc, 'storyOrder').get(0);
  const story = getRootMap(state.doc, 'stories').get(storyCreationId) as Y.Map<unknown>;
  const blockOrder = getRecordField<Y.Array<string>>(story, 'blockOrder');
  const beforeByParagraph = new Map(
    before.body.paragraphOrder.map((id) => [id, before.body.paragraphs.get(id)!])
  );
  const afterByParagraph = new Map(
    after.body.paragraphOrder.map((id) => [id, after.body.paragraphs.get(id)!])
  );
  const ctx = createActorContext(state.doc, actorId, commitSeq);

  state.doc.transact(
    () => {
      for (const [paragraphId, paragraph] of beforeByParagraph) {
        if (afterByParagraph.has(paragraphId)) continue;
        const blockCreationId = findBlockCreationId(state.doc, paragraph.blockId);
        if (blockCreationId) removeBlockSubtree(state.doc, blockCreationId);
      }

      const desiredBlockOrder: string[] = [];
      for (const paragraphId of after.body.paragraphOrder) {
        const paragraph = afterByParagraph.get(paragraphId)!;
        const beforeParagraph = beforeByParagraph.get(paragraphId);
        let blockCreationId = findBlockCreationId(state.doc, paragraph.blockId);
        if (!blockCreationId) {
          blockCreationId = insertBlock(state, ctx, storyCreationId, paragraph, checkpoint, trace);
        } else {
          const block = getRootMap(state.doc, 'blocks').get(blockCreationId) as Y.Map<unknown>;
          if (getRecordField<string>(block, 'proposedSemanticId') === paragraph.blockId) {
            if (getRecordField<string>(block, 'paragraphId') !== paragraph.paragraphId) {
              setRecordField(block, 'paragraphId', paragraph.paragraphId);
            }
            if (getRecordField<string>(block, 'proposedParagraphId') !== paragraph.paragraphId) {
              setRecordField(block, 'proposedParagraphId', paragraph.paragraphId);
            }
          }
          if (getRecordField<string>(block, 'styleId') !== paragraph.styleId) {
            setRecordField(block, 'styleId', paragraph.styleId);
          }
          if (
            canonicalJson(getRecordField(block, 'authoredProperties')) !==
            canonicalJson(paragraph.authoredProperties)
          ) {
            setRecordField(
              block,
              'authoredProperties',
              structuredClone(paragraph.authoredProperties)
            );
          }
          const textCreationId = getRecordField<string>(block, 'textId');
          const text = getRootMap(state.doc, 'texts').get(textCreationId) as Y.Map<unknown>;
          syncTextContent(
            getRecordField<Y.Text>(text, 'content'),
            beforeParagraph?.text ?? '',
            paragraph.text
          );
          syncStructuralProvenanceOnText(
            text,
            paragraph.blockId,
            trace,
            ctx,
            beforeParagraph?.text
          );
          syncMarks(state, ctx, block, beforeParagraph?.marks ?? [], paragraph.marks, checkpoint);
        }
        desiredBlockOrder.push(blockCreationId);
      }
      syncArray(blockOrder, desiredBlockOrder);
      writeAllocator(state.doc, ctx);
    },
    origin ?? { kind: 'semantic-local', actorId, commitSeq }
  );

  return Object.freeze({ ...state, checkpoint });
}

export function cloneYjsDocState(
  state: YjsDocState,
  replicaId = state.replicaId ?? 'replica-clone'
): YjsDocState {
  const doc = new Y.Doc({ gc: false });
  doc.getMap('root');
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(state.doc));
  doc.clientID = state.doc.clientID;
  return Object.freeze({
    doc,
    documentId: state.documentId,
    checkpoint: state.checkpoint,
    replicaId,
  });
}

export function mergeRemoteUpdate(
  state: YjsDocState,
  update: Uint8Array,
  origin?: unknown
): YjsDocState {
  Y.applyUpdate(state.doc, update, origin);
  return state;
}

export { findBlockCreationId };
