/** @spike-features yjs-backend */
import * as Y from 'yjs';
import type { AuthoredPackageModel } from '../../model/types';
import {
  YJS_BACKEND_VERSION,
  YJS_NORMALIZATION_VERSION,
  YJS_SCHEMA_VERSION,
  YJS_SEED_ACTOR,
} from './constants';
import {
  checkpointFor,
  createReplicaYjsDoc,
  getRecordField,
  getRootArray,
  getRootMap,
  hexEncode,
  initializeRoot,
  nextCreation,
  registerSemantic,
  setRecordField,
  writeAllocator,
  writeProvenance,
} from './doc-access';
import type { BootstrapContext, YjsDocState } from './doc-types';
import { encodeRelativeEndpoint } from './endpoints';

const SEED_UPDATES = new Map<string, Uint8Array>();

function writeMarkRecord(
  doc: Y.Doc,
  ctx: BootstrapContext,
  mark: { markId: string; kind: 'bold' | 'italic'; start: number; end: number },
  textCreationId: string,
  ytext: Y.Text,
  documentId: string,
  checkpoint: string
): string {
  const creationId = nextCreation(ctx);
  registerSemantic(ctx, mark.markId);
  const record = new Y.Map<unknown>();
  writeProvenance(record, creationId, mark.markId, ctx);
  setRecordField(record, 'parentTextId', textCreationId);
  setRecordField(record, 'markKind', mark.kind);
  setRecordField(
    record,
    'start',
    encodeRelativeEndpoint({
      doc,
      ytext,
      textCreationId,
      index: mark.start,
      affinity: 'before',
      documentId,
      checkpoint,
    })
  );
  setRecordField(
    record,
    'end',
    encodeRelativeEndpoint({
      doc,
      ytext,
      textCreationId,
      index: mark.end,
      affinity: 'after',
      documentId,
      checkpoint,
    })
  );
  getRootMap(doc, 'marks').set(creationId, record);
  return creationId;
}

export function bootstrapYjsDocFromModel(
  model: AuthoredPackageModel,
  documentId: string,
  fingerprint: string,
  replicaId = 'replica-bootstrap',
  clientId?: number
): YjsDocState {
  const seedKey = `${documentId}\u0000${fingerprint}`;
  let seedUpdate = SEED_UPDATES.get(seedKey);
  if (!seedUpdate) {
    const seedDoc = createReplicaYjsDoc({
      documentId,
      replicaId: `seed-${fingerprint.slice(0, 24)}`,
    });
    populateSeedDoc(seedDoc, model, documentId, fingerprint);
    seedUpdate = Y.encodeStateAsUpdate(seedDoc);
    SEED_UPDATES.set(seedKey, seedUpdate.slice());
  }
  const doc = createReplicaYjsDoc({ documentId, replicaId, clientId });
  Y.applyUpdate(doc, seedUpdate);
  const checkpoint = checkpointFor(0, fingerprint, Y.encodeStateVector(doc));
  return Object.freeze({ doc, documentId, checkpoint, replicaId });
}

function populateSeedDoc(
  doc: Y.Doc,
  model: AuthoredPackageModel,
  documentId: string,
  fingerprint: string
): void {
  initializeRoot(doc);
  const checkpoint = checkpointFor(0, fingerprint);
  const ctx: BootstrapContext = {
    actorId: YJS_SEED_ACTOR,
    commitSeq: 0,
    localSeq: 1,
    sourceClientId: doc.clientID,
    observedSemanticIds: new Set(),
  };
  doc.transact(() => {
    const meta = getRootMap(doc, 'meta');
    setRecordField(meta, 'schemaVersion', YJS_SCHEMA_VERSION);
    setRecordField(meta, 'backendVersion', YJS_BACKEND_VERSION);
    setRecordField(meta, 'documentId', documentId);
    setRecordField(meta, 'normalizationVersion', YJS_NORMALIZATION_VERSION);
    setRecordField(meta, 'collisionCandidates', new Y.Map<unknown>());
    setRecordField(meta, 'tombstones', new Y.Map<unknown>());
    setRecordField(meta, 'splitTailEditJournal', new Y.Map<unknown>());

    const storyCreationId = nextCreation(ctx);
    registerSemantic(ctx, model.body.storyId);
    const storyRecord = new Y.Map<unknown>();
    writeProvenance(storyRecord, storyCreationId, model.body.storyId, ctx);
    setRecordField(storyRecord, 'storyKind', 'body');
    setRecordField(storyRecord, 'blockOrder', new Y.Array<string>());
    getRootMap(doc, 'stories').set(storyCreationId, storyRecord);
    getRootArray(doc, 'storyOrder').push([storyCreationId]);
    const blockOrder = getRecordField<Y.Array<string>>(storyRecord, 'blockOrder');

    const capsulesByBlock = new Map(
      model.capsules.map((capsule) => [capsule.ownerBlockId, capsule] as const)
    );
    for (const paragraphId of model.body.paragraphOrder) {
      const paragraph = model.body.paragraphs.get(paragraphId);
      if (!paragraph) continue;
      const blockCreationId = nextCreation(ctx);
      const textCreationId = nextCreation(ctx);
      registerSemantic(ctx, paragraph.blockId);
      registerSemantic(ctx, `text-${paragraph.blockId}`);

      const textRecord = new Y.Map<unknown>();
      writeProvenance(textRecord, textCreationId, `text-${paragraph.blockId}`, ctx);
      setRecordField(textRecord, 'parentBlockId', blockCreationId);
      setRecordField(textRecord, 'content', new Y.Text(paragraph.text));
      getRootMap(doc, 'texts').set(textCreationId, textRecord);
      const ytext = getRecordField<Y.Text>(textRecord, 'content');

      const markIds = new Y.Array<string>();
      const capsuleIds = new Y.Array<string>();
      const blockRecord = new Y.Map<unknown>();
      writeProvenance(blockRecord, blockCreationId, paragraph.blockId, ctx);
      setRecordField(blockRecord, 'storyId', storyCreationId);
      setRecordField(blockRecord, 'parentId', storyCreationId);
      setRecordField(blockRecord, 'blockKind', 'paragraph');
      setRecordField(blockRecord, 'paragraphId', paragraph.paragraphId);
      setRecordField(blockRecord, 'proposedParagraphId', paragraph.paragraphId);
      setRecordField(blockRecord, 'textId', textCreationId);
      setRecordField(blockRecord, 'markIds', markIds);
      setRecordField(blockRecord, 'capsuleIds', capsuleIds);
      setRecordField(blockRecord, 'styleId', paragraph.styleId);
      setRecordField(
        blockRecord,
        'authoredProperties',
        structuredClone(paragraph.authoredProperties)
      );
      getRootMap(doc, 'blocks').set(blockCreationId, blockRecord);

      for (const mark of paragraph.marks) {
        markIds.push([
          writeMarkRecord(doc, ctx, mark, textCreationId, ytext, documentId, checkpoint),
        ]);
      }

      const capsule = capsulesByBlock.get(paragraph.blockId);
      if (capsule) {
        const capsuleCreationId = nextCreation(ctx);
        registerSemantic(ctx, capsule.capsuleId);
        const capsuleRecord = new Y.Map<unknown>();
        writeProvenance(capsuleRecord, capsuleCreationId, capsule.capsuleId, ctx);
        setRecordField(capsuleRecord, 'ownerStoryId', capsule.ownerStoryId);
        setRecordField(capsuleRecord, 'ownerBlockId', capsule.ownerBlockId);
        setRecordField(capsuleRecord, 'parentBlockId', blockCreationId);
        setRecordField(capsuleRecord, 'childIndex', capsule.childIndex);
        setRecordField(capsuleRecord, 'byteBoundaryStart', capsule.byteBoundaryStart);
        setRecordField(capsuleRecord, 'byteBoundaryEnd', capsule.byteBoundaryEnd);
        setRecordField(capsuleRecord, 'bytesHex', hexEncode(capsule.bytes));
        setRecordField(
          capsuleRecord,
          'namespaceBindings',
          structuredClone(capsule.namespaceBindings)
        );
        setRecordField(
          capsuleRecord,
          'previousSiblingBytesHex',
          hexEncode(capsule.previousSiblingBytes)
        );
        setRecordField(capsuleRecord, 'nextSiblingBytesHex', hexEncode(capsule.nextSiblingBytes));
        getRootMap(doc, 'capsules').set(capsuleCreationId, capsuleRecord);
        capsuleIds.push([capsuleCreationId]);
      }
      blockOrder.push([blockCreationId]);
    }
    writeAllocator(doc, ctx);
  });
}
