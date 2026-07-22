/** @spike-features yjs-backend */
import * as Y from 'yjs';
import type {
  DecodedYjsModel,
  RelativeEndpointEnvelope,
} from '../../comparators/yjs-schema-fingerprint';
import {
  getMetaMap,
  getRecordField,
  getRoot,
  getRootArray,
  getRootMap,
  YJS_ROOT_KEYS,
} from './doc-access';
import type { YjsCollisionCandidate, YjsDocState, YjsTombstone } from './doc-types';
import { codeUnitCompare, compareCollisionCandidates } from './identity';
import { compareAuthoredEditEvents, decodeAuthoredEditEvent } from './structural-provenance';

export function decodeYjsDocState(state: YjsDocState): DecodedYjsModel {
  const root = getRoot(state.doc);
  const rootContainers: Record<string, 'Y.Map' | 'Y.Array'> = {};
  for (const key of YJS_ROOT_KEYS) {
    const value = root.get(key);
    if (value instanceof Y.Map) rootContainers[key] = 'Y.Map';
    else if (value instanceof Y.Array) rootContainers[key] = 'Y.Array';
    else throw new TypeError(`root.${key} has invalid Yjs constructor`);
  }
  const meta = getRootMap(state.doc, 'meta');
  const storyOrder = getRootArray(state.doc, 'storyOrder');
  const collisionCandidates = [...getMetaMap(state.doc, 'collisionCandidates').values()]
    .map((value) => decodeCandidate(value))
    .sort(compareCollisionCandidates);
  const tombstones = [...getMetaMap(state.doc, 'tombstones').values()]
    .map((value) => decodeTombstone(value))
    .sort((left, right) => codeUnitCompare(left.creationId, right.creationId));
  const splitTailEditJournal = decodeSplitTailEditJournal(state.doc);
  return Object.freeze({
    documentId: getRecordField<string>(meta, 'documentId'),
    backendVersion: getRecordField<string>(meta, 'backendVersion'),
    schemaVersion: getRecordField<string>(meta, 'schemaVersion'),
    normalizationVersion: getRecordField<string>(meta, 'normalizationVersion'),
    gcEnabled: state.doc.gc,
    rootContainerType: mapTag(root, 'root'),
    rootContainers: Object.freeze(rootContainers),
    storyOrderContainerType: arrayTag(storyOrder, 'storyOrder'),
    storyOrder: Object.freeze([...storyOrder.toArray()]),
    stories: decodeMapRecords(state.doc, 'stories', decodeStory),
    blocks: decodeMapRecords(state.doc, 'blocks', decodeBlock),
    texts: decodeMapRecords(state.doc, 'texts', decodeText),
    marks: decodeMapRecords(state.doc, 'marks', decodeMark),
    capsules: decodeMapRecords(state.doc, 'capsules', decodeCapsule),
    allocatorContainerType: mapTag(getRootMap(state.doc, 'allocator'), 'allocator'),
    allocator: decodeMapRecords(state.doc, 'allocator', (_creationId, record) =>
      decodeAllocator(record)
    ),
    collisionCandidates: Object.freeze(collisionCandidates),
    splitTailEditJournal: Object.freeze(splitTailEditJournal),
    tombstones: Object.freeze(
      tombstones.map((item) => Object.freeze({ ...item, deleted: true as const }))
    ),
  });
}

function mapTag(value: unknown, label: string): 'Y.Map' {
  if (!(value instanceof Y.Map)) throw new TypeError(`${label} constructor mismatch`);
  return 'Y.Map';
}

function arrayTag(value: unknown, label: string): 'Y.Array' {
  if (!(value instanceof Y.Array)) throw new TypeError(`${label} constructor mismatch`);
  return 'Y.Array';
}

function textTag(value: unknown, label: string): 'Y.Text' {
  if (!(value instanceof Y.Text)) throw new TypeError(`${label} constructor mismatch`);
  return 'Y.Text';
}

function decodeMapRecords<T>(
  doc: Y.Doc,
  mapName: 'stories' | 'blocks' | 'texts' | 'marks' | 'capsules' | 'allocator',
  decoder: (creationId: string, record: Y.Map<unknown>) => T
): readonly T[] {
  return Object.freeze(
    [...getRootMap(doc, mapName).entries()]
      .sort(([left], [right]) => codeUnitCompare(left, right))
      .map(([creationId, value]) => {
        if (!(value instanceof Y.Map)) throw new TypeError(`${mapName} record must be Y.Map`);
        return decoder(creationId, value);
      })
  );
}

function provenance(creationId: string, record: Y.Map<unknown>) {
  return {
    creationId,
    semanticId: getRecordField<string>(record, 'semanticId'),
    proposedSemanticId: getRecordField<string>(record, 'proposedSemanticId'),
    actorId: getRecordField<string>(record, 'actorId'),
    commitId: getRecordField<string>(record, 'commitId'),
  };
}

function decodeStory(
  creationId: string,
  record: Y.Map<unknown>
): DecodedYjsModel['stories'][number] {
  const blockOrder = getRecordField<Y.Array<string>>(record, 'blockOrder');
  return Object.freeze({
    ...provenance(creationId, record),
    containerType: mapTag(record, 'story'),
    storyKind: getRecordField<'body'>(record, 'storyKind'),
    blockOrderContainerType: arrayTag(blockOrder, 'blockOrder'),
    blockOrder: Object.freeze(blockOrder.toArray()),
  });
}

function decodeBlock(
  creationId: string,
  record: Y.Map<unknown>
): DecodedYjsModel['blocks'][number] {
  const markIds = getRecordField<Y.Array<string>>(record, 'markIds');
  const capsuleIds = getRecordField<Y.Array<string>>(record, 'capsuleIds');
  return Object.freeze({
    ...provenance(creationId, record),
    containerType: mapTag(record, 'block'),
    storyId: getRecordField<string>(record, 'storyId'),
    parentId: getRecordField<string>(record, 'parentId'),
    blockKind: getRecordField<'paragraph'>(record, 'blockKind'),
    paragraphId: getRecordField<string>(record, 'paragraphId'),
    proposedParagraphId: getRecordField<string>(record, 'proposedParagraphId'),
    textId: getRecordField<string>(record, 'textId'),
    markIdsContainerType: arrayTag(markIds, 'markIds'),
    markIds: Object.freeze(markIds.toArray()),
    capsuleIdsContainerType: arrayTag(capsuleIds, 'capsuleIds'),
    capsuleIds: Object.freeze(capsuleIds.toArray()),
    styleId: getRecordField<string>(record, 'styleId'),
    authoredProperties: Object.freeze(
      structuredClone(getRecordField<Record<string, unknown>>(record, 'authoredProperties'))
    ),
  });
}

function decodeSplitTailEditJournal(
  doc: Y.Doc
): readonly { readonly key: string; readonly event: ReturnType<typeof decodeAuthoredEditEvent> }[] {
  const journal = getRootMap(doc, 'meta').get('splitTailEditJournal');
  if (!(journal instanceof Y.Map)) {
    throw new TypeError('splitTailEditJournal must be Y.Map');
  }
  return Object.freeze(
    [...journal.entries()]
      .sort(([left], [right]) => codeUnitCompare(left, right))
      .map(([key, value]) =>
        Object.freeze({
          key,
          event: decodeAuthoredEditEvent(value),
        })
      )
  );
}

function decodeText(
  creationId: string,
  record: Y.Map<unknown>
): DecodedYjsModel['texts'][number] {
  const content = getRecordField<Y.Text>(record, 'content');
  const splitOffset = record.get('structuralSplitOffset');
  const originalTail = record.get('structuralOriginalTail');
  const contributionsRaw = record.get('authoredContributions');
  const authoredContributions =
    contributionsRaw instanceof Y.Map
      ? Object.freeze(
          [...contributionsRaw.entries()]
            .sort(([left], [right]) => codeUnitCompare(left, right))
            .map(([, value]) => decodeAuthoredEditEvent(value))
            .sort(compareAuthoredEditEvents)
        )
      : contributionsRaw instanceof Y.Array
        ? Object.freeze(
            contributionsRaw
              .toArray()
              .map((value) => decodeAuthoredEditEvent(value))
              .sort(compareAuthoredEditEvents)
          )
        : Object.freeze([]);
  return Object.freeze({
    ...provenance(creationId, record),
    parentBlockId: getRecordField<string>(record, 'parentBlockId'),
    containerType: mapTag(record, 'text record'),
    contentContainerType: textTag(content, 'text content'),
    content: content.toString(),
    ...(typeof splitOffset === 'number' ? { structuralSplitOffset: splitOffset } : {}),
    ...(typeof originalTail === 'string' ? { structuralOriginalTail: originalTail } : {}),
    ...(authoredContributions.length > 0 ? { authoredContributions } : {}),
  });
}

function decodeMark(
  creationId: string,
  record: Y.Map<unknown>
): DecodedYjsModel['marks'][number] {
  return Object.freeze({
    ...provenance(creationId, record),
    containerType: mapTag(record, 'mark'),
    parentTextId: getRecordField<string>(record, 'parentTextId'),
    markKind: getRecordField<'bold' | 'italic'>(record, 'markKind'),
    start: Object.freeze(
      structuredClone(getRecordField<RelativeEndpointEnvelope>(record, 'start'))
    ),
    end: Object.freeze(
      structuredClone(getRecordField<RelativeEndpointEnvelope>(record, 'end'))
    ),
  });
}

function decodeCapsule(
  creationId: string,
  record: Y.Map<unknown>
): DecodedYjsModel['capsules'][number] {
  return Object.freeze({
    ...provenance(creationId, record),
    containerType: mapTag(record, 'capsule'),
    ownerStoryId: getRecordField<string>(record, 'ownerStoryId'),
    ownerBlockId: getRecordField<string>(record, 'ownerBlockId'),
    parentBlockId: getRecordField<string>(record, 'parentBlockId'),
    childIndex: getRecordField<number>(record, 'childIndex'),
    byteBoundaryStart: getRecordField<number>(record, 'byteBoundaryStart'),
    byteBoundaryEnd: getRecordField<number>(record, 'byteBoundaryEnd'),
    bytesHex: getRecordField<string>(record, 'bytesHex'),
    namespaceBindings: Object.freeze(
      structuredClone(getRecordField<Record<string, string>>(record, 'namespaceBindings'))
    ),
    previousSiblingBytesHex: getRecordField<string>(record, 'previousSiblingBytesHex'),
    nextSiblingBytesHex: getRecordField<string>(record, 'nextSiblingBytesHex'),
  });
}

function decodeAllocator(
  record: Y.Map<unknown>
): DecodedYjsModel['allocator'][number] {
  const observed = getRecordField<Y.Map<boolean>>(record, 'observedSemanticIds');
  return Object.freeze({
    containerType: mapTag(record, 'allocator record'),
    actorId: getRecordField<string>(record, 'actorId'),
    nextLocalSeq: getRecordField<number>(record, 'nextLocalSeq'),
    nextCommitSeq: getRecordField<number>(record, 'nextCommitSeq'),
    observedSemanticIdsContainerType: mapTag(observed, 'observedSemanticIds'),
    observedSemanticIds: Object.freeze([...observed.keys()].sort(codeUnitCompare)),
  });
}

function decodeCandidate(value: unknown): YjsCollisionCandidate {
  if (value === null || typeof value !== 'object') {
    throw new TypeError('collision candidate must be object');
  }
  return structuredClone(value as YjsCollisionCandidate);
}

function decodeTombstone(value: unknown): YjsTombstone {
  if (value === null || typeof value !== 'object') {
    throw new TypeError('tombstone must be object');
  }
  return structuredClone(value as YjsTombstone);
}
