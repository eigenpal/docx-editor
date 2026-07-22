/** @spike-features yjs-backend */
import type * as Y from 'yjs';
import { getRecordField, getRootArray, getRootMap } from './doc-access';
import type { YjsDocState } from './doc-types';

export interface YjsDocumentIndex {
  readonly storyCreationId: string;
  readonly blockIdToCreationId: ReadonlyMap<string, string>;
  readonly paragraphIdToCreationId: ReadonlyMap<string, string>;
  readonly markIdToCreationId: ReadonlyMap<string, string>;
  readonly capsuleIdToCreationId: ReadonlyMap<string, string>;
}

export function buildYjsDocumentIndex(state: YjsDocState): YjsDocumentIndex {
  const blockIdToCreationId = new Map<string, string>();
  const paragraphIdToCreationId = new Map<string, string>();
  const markIdToCreationId = new Map<string, string>();
  const capsuleIdToCreationId = new Map<string, string>();
  for (const [creationId, value] of getRootMap(state.doc, 'blocks')) {
    const record = value as Y.Map<unknown>;
    blockIdToCreationId.set(getRecordField<string>(record, 'semanticId'), creationId);
    paragraphIdToCreationId.set(getRecordField<string>(record, 'paragraphId'), creationId);
  }
  for (const [creationId, value] of getRootMap(state.doc, 'marks')) {
    markIdToCreationId.set(
      getRecordField<string>(value as Y.Map<unknown>, 'semanticId'),
      creationId
    );
  }
  for (const [creationId, value] of getRootMap(state.doc, 'capsules')) {
    capsuleIdToCreationId.set(
      getRecordField<string>(value as Y.Map<unknown>, 'semanticId'),
      creationId
    );
  }
  return Object.freeze({
    storyCreationId: getRootArray(state.doc, 'storyOrder').get(0) as string,
    blockIdToCreationId,
    paragraphIdToCreationId,
    markIdToCreationId,
    capsuleIdToCreationId,
  });
}
