import { describe, expect, test } from 'bun:test';
import type { CanonicalPrimitiveJournal } from '@docx-editor.dev/core/collaboration';
import { collaborationDocx } from './support.ts';
import {
  applyJournal,
  collectKind,
  destroyReplica,
  findText,
  loadPackage,
  nodeText,
  packageOf,
  parentOf,
  seedReplica,
  WML,
} from './document-support.ts';
import { applyPrimitiveJournal, isElementRecord } from '../document/index.ts';

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
