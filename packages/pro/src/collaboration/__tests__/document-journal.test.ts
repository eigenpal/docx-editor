/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import type { CanonicalPrimitiveJournal } from '@docx-editor.dev/core/collaboration';
import { collaborationDocx } from './support.ts';
import {
  applyJournal,
  collectKind,
  destroyReplica,
  findText,
  joinReplica,
  loadPackage,
  nodeText,
  packageOf,
  parentOf,
  seedReplica,
  WML,
} from './document-support.ts';
import { applyPrimitiveJournal, isElementRecord } from '../document/index.ts';

const W15 = 'http://schemas.microsoft.com/office/word/2012/wordml';

const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const DIGEST = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

describe('primitive journal application', () => {
  test('applies every effect kind without partial writes', async () => {
    const replica = await seedReplica(loadPackage(collaborationDocx()));
    try {
      const pkg = packageOf(replica);
      const text = findText(pkg, 'Alpha paragraph');
      const paragraph = parentOf(replica.registry, text.id, 'paragraph');
      const body = parentOf(replica.registry, paragraph, 'body');
      const bodyRecord = replica.registry.record(body);
      if (!bodyRecord || bodyRecord.kind === 'textValue') throw new Error('body missing');
      const paragraphIndex = isElementRecord(bodyRecord)
        ? bodyRecord.childIds.indexOf(paragraph)
        : -1;
      const markId = replica.mint.take();
      const paraId = replica.mint.take();
      const runId = replica.mint.take();
      const textElId = replica.mint.take();
      const textId = replica.mint.take();
      const extraRoot = replica.mint.take();
      replica.blobs.put(DIGEST, PNG);
      applyJournal(replica, {
        effects: [
          { kind: 'spliceText', logicalId: text.id, utf16Start: 0, deleteCount: 0, insert: 'X' },
          {
            kind: 'setAttribute',
            logicalId: paragraph,
            qname: {
              namespaceUri: 'http://schemas.microsoft.com/office/word/2010/wordml',
              localName: 'textId',
              prefix: 'w14',
            },
            value: 'AAAAAAAA',
          },
          {
            kind: 'setNamespaceBinding',
            logicalId: paragraph,
            prefix: 'demo',
            uri: 'urn:docx-editor:journal',
          },
          {
            kind: 'putNode',
            descriptor: {
              logicalId: markId,
              kind: 'generic',
              qname: { namespaceUri: WML, localName: 'b', prefix: 'w' },
            },
          },
          {
            kind: 'putNode',
            descriptor: {
              logicalId: paraId,
              kind: 'paragraph',
              qname: { namespaceUri: WML, localName: 'p', prefix: 'w' },
            },
          },
          {
            kind: 'putNode',
            descriptor: {
              logicalId: runId,
              kind: 'run',
              qname: { namespaceUri: WML, localName: 'r', prefix: 'w' },
            },
          },
          {
            kind: 'putNode',
            descriptor: {
              logicalId: textElId,
              kind: 'text',
              qname: { namespaceUri: WML, localName: 't', prefix: 'w' },
            },
          },
          { kind: 'putNode', descriptor: { logicalId: textId, kind: 'textValue' } },
          { kind: 'spliceText', logicalId: textId, utf16Start: 0, deleteCount: 0, insert: 'New' },
          {
            kind: 'spliceChildren',
            parentLogicalId: textElId,
            start: 0,
            deleteCount: 0,
            childLogicalIds: [textId],
          },
          {
            kind: 'spliceChildren',
            parentLogicalId: runId,
            start: 0,
            deleteCount: 0,
            childLogicalIds: [textElId],
          },
          {
            kind: 'spliceChildren',
            parentLogicalId: paraId,
            start: 0,
            deleteCount: 0,
            childLogicalIds: [runId],
          },
          {
            kind: 'spliceChildren',
            parentLogicalId: body,
            start: paragraphIndex + 1,
            deleteCount: 0,
            childLogicalIds: [paraId],
          },
          {
            kind: 'putNode',
            descriptor: {
              logicalId: extraRoot,
              kind: 'generic',
              qname: { namespaceUri: WML, localName: 'hdr', prefix: 'w' },
            },
          },
          { kind: 'putXmlPart', name: '/word/header1.xml', rootLogicalId: extraRoot },
          {
            kind: 'putRelationship',
            owner: pkg.mainDocumentPart,
            record: {
              ownerPart: pkg.mainDocumentPart,
              id: 'rId99',
              type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header',
              rawTarget: 'header1.xml',
              targetMode: 'Internal',
              order: 99,
            },
          },
          {
            kind: 'putContentTypeOverride',
            partName: '/word/header1.xml',
            mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml',
          },
          {
            kind: 'putBinary',
            descriptor: {
              storageKey: '/word/media/image1.png',
              digest: DIGEST,
              size: PNG.byteLength,
              mediaType: 'image/png',
            },
          },
        ],
      });
      const after = packageOf(replica);
      expect(nodeText(collectKind(after, 'paragraph')[0]!)).toContain('XAlpha');
      expect(collectKind(after, 'paragraph').some((node) => nodeText(node) === 'New')).toBe(true);
      expect(after.parts.has('/word/header1.xml')).toBe(true);
      expect(
        after.relationships.get(pkg.mainDocumentPart)?.some((record) => record.id === 'rId99')
      ).toBe(true);
      expect(replica.registry.contentTypeOverrides().get('/word/header1.xml')).toContain('header');
      expect(after.partBytes.get('/word/media/image1.png')?.byteLength).toBe(PNG.byteLength);

      applyJournal(replica, {
        effects: [
          {
            kind: 'moveNode',
            logicalId: paraId,
            destinationParentLogicalId: body,
            destinationIndex: 0,
          },
        ],
      });
      expect(replica.registry.parentOf(paraId)).toBe(body);

      applyJournal(replica, {
        effects: [
          { kind: 'deleteRelationship', owner: pkg.mainDocumentPart, relationshipId: 'rId99' },
          { kind: 'deleteContentTypeOverride', partName: '/word/header1.xml' },
          { kind: 'deleteXmlPart', name: '/word/header1.xml' },
          { kind: 'deleteBinary', storageKey: '/word/media/image1.png' },
          {
            kind: 'setAttribute',
            logicalId: paragraph,
            qname: {
              namespaceUri: 'http://schemas.microsoft.com/office/word/2010/wordml',
              localName: 'textId',
              prefix: 'w14',
            },
            value: null,
          },
          { kind: 'setNamespaceBinding', logicalId: paragraph, prefix: 'demo', uri: null },
        ],
      });
      const cleaned = packageOf(replica);
      expect(cleaned.parts.has('/word/header1.xml')).toBe(false);
      expect(markId.startsWith('lid:')).toBe(true);
    } finally {
      destroyReplica(replica);
    }
  });

  test('refuses an unknown logical id without applying earlier effects', async () => {
    const replica = await seedReplica(loadPackage(collaborationDocx()));
    try {
      const text = findText(packageOf(replica), 'Alpha paragraph');
      const before = text.value;
      const journal: CanonicalPrimitiveJournal = {
        effects: [
          { kind: 'spliceText', logicalId: text.id, utf16Start: 0, deleteCount: 0, insert: 'KEEP' },
          {
            kind: 'spliceText',
            logicalId: 'missing-id',
            utf16Start: 0,
            deleteCount: 0,
            insert: 'NO',
          },
        ],
      };
      const result = applyPrimitiveJournal(replica.registry, journal);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected refusal');
      expect(result.code).toBe('unknown-logical-id');
      expect(findText(packageOf(replica), 'Alpha paragraph').value).toBe(before);
    } finally {
      destroyReplica(replica);
    }
  });

  test('a re-described text node still takes an insert at offset 0', async () => {
    // `putNode` on an id shared state already holds is a shell update, which is how a qname
    // change replicates without orphaning the node. The initial-fill idempotence rule must not
    // read this as a fill: the node already carries text, so offset 0 is an insert. Skipping it
    // would drop the character and setting it would erase the line.
    const replica = await seedReplica(loadPackage(collaborationDocx()));
    try {
      const text = findText(packageOf(replica), 'Alpha paragraph');
      const result = applyPrimitiveJournal(replica.registry, {
        effects: [
          { kind: 'putNode', descriptor: { logicalId: text.id, kind: 'textValue' } },
          { kind: 'spliceText', logicalId: text.id, utf16Start: 0, deleteCount: 0, insert: 'X' },
        ],
      });
      expect(result.ok).toBe(true);
      expect(replica.registry.textOf(text.id).toString()).toBe('XAlpha paragraph');
    } finally {
      destroyReplica(replica);
    }
  });

  test('admits a journal whose effects depend on each other', async () => {
    // The shape the editing surface emits for ONE typed character: append a scratch `w:t`,
    // splice the character into the neighbouring `w:t`, then drop the scratch. The last
    // effect deletes the child the fifth added, so checking every bound against the state
    // before the journal refuses ordinary typing and leaves the peer read-only.
    const replica = await seedReplica(loadPackage(collaborationDocx()));
    try {
      const text = findText(packageOf(replica), 'Alpha paragraph');
      const textElement = parentOf(replica.registry, text.id, 'text');
      const run = parentOf(replica.registry, textElement, 'run');
      const runRecord = replica.registry.record(run);
      if (!runRecord || !isElementRecord(runRecord)) throw new Error('run missing');
      const childCount = runRecord.childIds.length;
      const scratchElement = replica.mint.take();
      const scratchText = replica.mint.take();

      const result = applyPrimitiveJournal(replica.registry, {
        effects: [
          {
            kind: 'putNode',
            descriptor: {
              logicalId: scratchElement,
              kind: 'text',
              qname: { namespaceUri: WML, localName: 't', prefix: 'w' },
            },
          },
          { kind: 'putNode', descriptor: { logicalId: scratchText, kind: 'textValue' } },
          {
            kind: 'spliceText',
            logicalId: scratchText,
            utf16Start: 0,
            deleteCount: 0,
            insert: 'X',
          },
          {
            kind: 'spliceChildren',
            parentLogicalId: scratchElement,
            start: 0,
            deleteCount: 0,
            childLogicalIds: [scratchText],
          },
          {
            kind: 'spliceChildren',
            parentLogicalId: run,
            start: childCount,
            deleteCount: 0,
            childLogicalIds: [scratchElement],
          },
          {
            kind: 'spliceText',
            logicalId: text.id,
            utf16Start: text.value.length,
            deleteCount: 0,
            insert: 'X',
          },
          {
            kind: 'spliceChildren',
            parentLogicalId: run,
            start: childCount,
            deleteCount: 1,
            childLogicalIds: [],
          },
        ],
      });

      expect(result).toEqual({ ok: true });
      expect(findText(packageOf(replica), 'Alpha paragraphX').value).toBe('Alpha paragraphX');
      const after = replica.registry.record(run);
      if (!after || !isElementRecord(after)) throw new Error('run missing');
      expect(after.childIds).toHaveLength(childCount);
    } finally {
      destroyReplica(replica);
    }
  });

  test('composing removeNode splices do not tombstone the surviving sibling', async () => {
    const replica = await seedReplica(loadPackage(collaborationDocx()));
    try {
      const text = findText(packageOf(replica), 'Alpha paragraph');
      const paragraph = parentOf(replica.registry, text.id, 'paragraph');
      const run = parentOf(replica.registry, text.id, 'run');
      const para = replica.registry.record(paragraph);
      if (!para || !isElementRecord(para)) throw new Error('paragraph missing');
      const runIndex = para.childIds.indexOf(run);
      const startId = replica.mint.take();
      const endId = replica.mint.take();
      applyJournal(replica, {
        effects: [
          {
            kind: 'putNode',
            descriptor: {
              logicalId: startId,
              kind: 'commentRangeStart',
              qname: { namespaceUri: WML, localName: 'commentRangeStart', prefix: 'w' },
            },
          },
          {
            kind: 'putNode',
            descriptor: {
              logicalId: endId,
              kind: 'commentRangeEnd',
              qname: { namespaceUri: WML, localName: 'commentRangeEnd', prefix: 'w' },
            },
          },
          {
            kind: 'spliceChildren',
            parentLogicalId: paragraph,
            start: runIndex,
            deleteCount: 0,
            childLogicalIds: [startId],
          },
          {
            kind: 'spliceChildren',
            parentLogicalId: paragraph,
            start: runIndex + 2,
            deleteCount: 0,
            childLogicalIds: [endId],
          },
        ],
      });
      applyJournal(replica, {
        effects: [
          {
            kind: 'spliceChildren',
            parentLogicalId: paragraph,
            start: runIndex,
            deleteCount: 1,
            childLogicalIds: [],
          },
          {
            kind: 'spliceChildren',
            parentLogicalId: paragraph,
            start: runIndex + 1,
            deleteCount: 1,
            childLogicalIds: [],
          },
        ],
      });
      expect(findText(packageOf(replica), 'Alpha paragraph').value).toBe('Alpha paragraph');
      expect(replica.registry.isTombstoned(run)).toBe(false);
      expect(replica.registry.isTombstoned(startId)).toBe(true);
      expect(replica.registry.isTombstoned(endId)).toBe(true);
    } finally {
      destroyReplica(replica);
    }
  });

  test('setAttribute on a later xml part is visible through current()', async () => {
    const left = await seedReplica(loadPackage(collaborationDocx()));
    const right = joinReplica(left);
    try {
      const rootId = left.mint.take();
      const nodeId = left.mint.take();
      applyJournal(left, {
        effects: [
          {
            kind: 'putNode',
            descriptor: {
              logicalId: rootId,
              kind: 'generic',
              qname: { namespaceUri: W15, localName: 'commentsEx', prefix: 'w15' },
            },
          },
          {
            kind: 'putNode',
            descriptor: {
              logicalId: nodeId,
              kind: 'generic',
              qname: { namespaceUri: W15, localName: 'commentEx', prefix: 'w15' },
            },
          },
          {
            kind: 'setAttribute',
            logicalId: nodeId,
            qname: { namespaceUri: W15, localName: 'done', prefix: 'w15' },
            value: '1',
          },
          {
            kind: 'spliceChildren',
            parentLogicalId: rootId,
            start: 0,
            deleteCount: 0,
            childLogicalIds: [nodeId],
          },
          { kind: 'putXmlPart', name: '/word/commentsExtended.xml', rootLogicalId: rootId },
        ],
      });
      Y.applyUpdate(
        right.doc,
        Y.encodeStateAsUpdate(left.doc, Y.encodeStateVector(right.doc)),
        'sync'
      );
      const created = right.materializer.current();
      if (!created.ok) throw new Error(created.code);
      applyJournal(left, {
        effects: [
          {
            kind: 'setAttribute',
            logicalId: nodeId,
            qname: { namespaceUri: W15, localName: 'done', prefix: 'w15' },
            value: '0',
          },
        ],
      });
      Y.applyUpdate(
        right.doc,
        Y.encodeStateAsUpdate(left.doc, Y.encodeStateVector(right.doc)),
        'sync'
      );
      const viaCurrent = right.materializer.current();
      if (!viaCurrent.ok) throw new Error(viaCurrent.code);
      const part = viaCurrent.package.parts.get('/word/commentsExtended.xml');
      const commentEx = part?.root.children[0];
      const value =
        commentEx && commentEx.kind !== 'textValue'
          ? commentEx.attributes.find((attribute) => attribute.localName === 'done')?.value
          : undefined;
      expect(right.registry.parentOf(nodeId)).toBe(rootId);
      expect(value).toBe('0');
    } finally {
      destroyReplica(left);
      destroyReplica(right);
    }
  });

  test('setAttribute on a journal-created node is visible through current()', async () => {
    const left = await seedReplica(loadPackage(collaborationDocx()));
    const right = joinReplica(left);
    try {
      const paragraph = collectKind(packageOf(left), 'paragraph')[0]!;
      const paraRecord = left.registry.record(paragraph.id);
      if (!paraRecord || !isElementRecord(paraRecord)) throw new Error('paragraph missing');
      const nodeId = left.mint.take();
      applyJournal(left, {
        effects: [
          {
            kind: 'putNode',
            descriptor: {
              logicalId: nodeId,
              kind: 'generic',
              qname: { namespaceUri: W15, localName: 'commentEx', prefix: 'w15' },
            },
          },
          {
            kind: 'setAttribute',
            logicalId: nodeId,
            qname: { namespaceUri: W15, localName: 'done', prefix: 'w15' },
            value: '1',
          },
          {
            kind: 'spliceChildren',
            parentLogicalId: paragraph.id,
            start: paraRecord.childIds.length,
            deleteCount: 0,
            childLogicalIds: [nodeId],
          },
        ],
      });
      Y.applyUpdate(
        right.doc,
        Y.encodeStateAsUpdate(left.doc, Y.encodeStateVector(right.doc)),
        'sync'
      );
      const created = right.materializer.current();
      if (!created.ok) throw new Error(created.code);
      applyJournal(left, {
        effects: [
          {
            kind: 'setAttribute',
            logicalId: nodeId,
            qname: { namespaceUri: W15, localName: 'done', prefix: 'w15' },
            value: '0',
          },
        ],
      });
      Y.applyUpdate(
        right.doc,
        Y.encodeStateAsUpdate(left.doc, Y.encodeStateVector(right.doc)),
        'sync'
      );
      const viaCurrent = right.materializer.current();
      const viaRebuild = right.materializer.rebuild();
      if (!viaCurrent.ok || !viaRebuild.ok) throw new Error('materialize failed');
      const doneOf = (pkg: ReturnType<typeof packageOf>, id: string): string | undefined => {
        const node = collectKind(pkg, 'generic').find((entry) => entry.id === id);
        return node?.attributes.find((attribute) => attribute.localName === 'done')?.value;
      };
      expect(doneOf(viaCurrent.package, nodeId)).toBe('0');
      expect(doneOf(viaRebuild.package, nodeId)).toBe('0');
    } finally {
      destroyReplica(left);
      destroyReplica(right);
    }
  });

  test('refuses a text splice that exceeds the UTF-16 bound', async () => {
    const replica = await seedReplica(loadPackage(collaborationDocx()));
    try {
      const text = findText(packageOf(replica), 'Alpha paragraph');
      const result = applyPrimitiveJournal(replica.registry, {
        effects: [
          { kind: 'spliceText', logicalId: text.id, utf16Start: 0, deleteCount: 500, insert: '' },
        ],
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected refusal');
      expect(result.code).toBe('invalid-bound');
    } finally {
      destroyReplica(replica);
    }
  });
});
