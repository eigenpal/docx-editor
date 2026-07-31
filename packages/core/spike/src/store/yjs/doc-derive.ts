/** @spike-features yjs-backend */
import * as Y from 'yjs';
import type { AuthoredProperty } from '../../model/authored-property';
import type { AuthoredMark, AuthoredPackageModel, AuthoredParagraph } from '../../model/types';
import { createImmutableLookup, freezeAuthoredPackage } from '../../model/immutability';
import { getRecordField, getRootArray, getRootMap } from './doc-access';
import type { YjsDocState } from './doc-types';
import { resolveEndpointOffset } from './endpoints';
import { hexDecode } from './doc-access';

function decodeMarksForBlock(
  doc: Y.Doc,
  blockCreationId: string,
  textCreationId: string
): AuthoredMark[] {
  const block = getRootMap(doc, 'blocks').get(blockCreationId) as Y.Map<unknown>;
  const textRecord = getRootMap(doc, 'texts').get(textCreationId) as Y.Map<unknown>;
  const ytext = getRecordField<Y.Text>(textRecord, 'content');
  const markIds = getRecordField<Y.Array<string>>(block, 'markIds');
  const marks: AuthoredMark[] = [];
  for (let index = 0; index < markIds.length; index += 1) {
    const markCreationId = markIds.get(index);
    const markRecord = getRootMap(doc, 'marks').get(markCreationId) as Y.Map<unknown>;
    marks.push({
      markId: getRecordField<string>(markRecord, 'semanticId'),
      kind: getRecordField<'bold' | 'italic'>(markRecord, 'markKind'),
      start: resolveEndpointOffset(doc, ytext, getRecordField(markRecord, 'start')),
      end: resolveEndpointOffset(doc, ytext, getRecordField(markRecord, 'end')),
    });
  }
  return marks;
}

export function deriveAuthoredPackageFromYjs(state: YjsDocState): AuthoredPackageModel {
  const doc = state.doc;
  const storyOrder = getRootArray(doc, 'storyOrder');
  if (storyOrder.length !== 1) throw new TypeError('exactly one body story is required');
  const storyCreationId = storyOrder.get(0);
  const storyRecord = getRootMap(doc, 'stories').get(storyCreationId) as
    | Y.Map<unknown>
    | undefined;
  if (!(storyRecord instanceof Y.Map)) {
    throw new TypeError('body story record must be Y.Map');
  }
  const storyId = getRecordField<string>(storyRecord, 'semanticId');
  const blockOrder = getRecordField<Y.Array<string>>(storyRecord, 'blockOrder');
  if (!(blockOrder instanceof Y.Array)) throw new TypeError('story block order must be Y.Array');

  const paragraphOrder: string[] = [];
  const paragraphEntries: Array<readonly [string, AuthoredParagraph]> = [];
  const capsules: AuthoredPackageModel['capsules'][number][] = [];

  for (let index = 0; index < blockOrder.length; index += 1) {
    const blockCreationId = blockOrder.get(index);
    const blockRecord = getRootMap(doc, 'blocks').get(blockCreationId) as Y.Map<unknown>;
    const blockId = getRecordField<string>(blockRecord, 'semanticId');
    const paragraphId = getRecordField<string>(blockRecord, 'paragraphId');
    const textCreationId = getRecordField<string>(blockRecord, 'textId');
    const textRecord = getRootMap(doc, 'texts').get(textCreationId) as Y.Map<unknown>;
    const ytext = getRecordField<Y.Text>(textRecord, 'content');
    if (!(ytext instanceof Y.Text)) throw new TypeError('text content must be Y.Text');
    const text = ytext.toString();
    const marks = decodeMarksForBlock(doc, blockCreationId, textCreationId);
    const authoredProperties = decodeAuthoredProperties(
      getRecordField<unknown>(blockRecord, 'authoredProperties')
    );

    paragraphOrder.push(paragraphId);
    paragraphEntries.push([
      paragraphId,
      {
        blockId,
        paragraphId,
        text,
        styleId: getRecordField<string>(blockRecord, 'styleId'),
        marks: Object.freeze(marks.map((mark) => Object.freeze({ ...mark }))),
        authoredProperties: Object.freeze(authoredProperties),
      },
    ]);

    const capsuleIds = getRecordField<Y.Array<string>>(blockRecord, 'capsuleIds');
    if (!(capsuleIds instanceof Y.Array)) throw new TypeError('capsule order must be Y.Array');
    for (const capsuleCreationId of capsuleIds.toArray()) {
      const capsuleRecord = getRootMap(doc, 'capsules').get(capsuleCreationId) as Y.Map<unknown>;
      capsules.push({
        capsuleId: getRecordField<string>(capsuleRecord, 'semanticId'),
        ownerStoryId: getRecordField<string>(capsuleRecord, 'ownerStoryId'),
        ownerBlockId: getRecordField<string>(capsuleRecord, 'ownerBlockId'),
        childIndex: getRecordField<number>(capsuleRecord, 'childIndex'),
        byteBoundaryStart: getRecordField<number>(capsuleRecord, 'byteBoundaryStart'),
        byteBoundaryEnd: getRecordField<number>(capsuleRecord, 'byteBoundaryEnd'),
        bytes: hexDecode(getRecordField<string>(capsuleRecord, 'bytesHex')),
        namespaceBindings: structuredClone(
          getRecordField<Record<string, string>>(capsuleRecord, 'namespaceBindings')
        ),
        previousSiblingBytes: hexDecode(
          getRecordField<string>(capsuleRecord, 'previousSiblingBytesHex')
        ),
        nextSiblingBytes: hexDecode(
          getRecordField<string>(capsuleRecord, 'nextSiblingBytesHex')
        ),
      });
    }
  }

  return freezeAuthoredPackage({
    body: {
      storyId,
      paragraphOrder,
      paragraphs: createImmutableLookup(paragraphEntries),
    },
    capsules: Object.freeze(capsules),
  });
}

function decodeAuthoredProperties(value: unknown): Record<string, AuthoredProperty> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError('authored properties must be a plain object');
  }
  return structuredClone(value as Record<string, AuthoredProperty>);
}

