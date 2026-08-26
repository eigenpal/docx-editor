import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createCollaborationDocumentPort } from '../document-port.ts';
import { normalizeParagraphIdentity } from '../../store/package/para-id.ts';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { TreePackageStore } from '../../store/store/tree-package-store.ts';
import { ORIGIN_IDS } from '../../store/registry/frozen-ids.ts';

function bytesWithParagraphIds(ids: readonly (string | null)[]): Uint8Array {
  const paragraphs = ids
    .map(
      (id, index) =>
        `<w:p${id ? ` w14:paraId="${id}" w14:textId="${id}"` : ''}><w:r><w:t>Paragraph ${index}</w:t></w:r></w:p>`
    )
    .join('');
  return zipSync({
    '[Content_Types].xml': strToU8(`<?xml version="1.0"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`),
    'word/document.xml': strToU8(`<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:body>${paragraphs}<w:sectPr/></w:body></w:document>`),
  });
}

function open(ids: readonly (string | null)[]) {
  const loaded = readOoxmlPackage(bytesWithParagraphIds(ids));
  if (!loaded.ok) throw new Error(loaded.reason);
  const main = loaded.package.parts.get(loaded.package.mainDocumentPart);
  if (!main) throw new Error('missing main part');
  const store = new TreePackageStore(loaded.package, normalizeParagraphIdentity(main));
  return { store, port: createCollaborationDocumentPort(store, { documentId: 'test-document' }) };
}

describe('canonical collaboration document port', () => {
  test('normalizes missing and duplicate paragraph identities deterministically', () => {
    const first = open([null, '11111111', '11111111']).port.paragraphs();
    const second = open([null, '11111111', '11111111']).port.paragraphs();
    expect(first.map((paragraph) => paragraph.paragraphId)).toEqual(
      second.map((paragraph) => paragraph.paragraphId)
    );
    expect(new Set(first.map((paragraph) => paragraph.paragraphId)).size).toBe(3);
    expect(first.every((paragraph) => /^[0-7][0-9A-F]{7}$/.test(paragraph.paragraphId))).toBe(true);
  });

  test('collaboration-derived canonical commits bypass legacy snapshot history', () => {
    const { store, port } = open(['11111111']);
    expect(store.canUndo).toBe(false);
    expect(
      port.applyParagraphText('11111111', 'Remote text', {
        origin: ORIGIN_IDS.mutationRemote,
        actorId: 'bob',
        operationId: 'bob-1',
      })
    ).toEqual({ ok: true, changed: true });
    expect(store.canUndo).toBe(false);
    expect(store.undo()).toBeNull();
    expect(port.paragraphs()[0]!.text).toBe('Remote text');
    const paragraph = port.paragraphs()[0]!;
    const local = store.transact({ kind: 'body' }, (context) => {
      context.apply({
        op: 'insertText',
        paragraphId: paragraph.nodeId,
        offset: paragraph.text.length,
        text: ' local',
      });
    });
    expect(local.ok).toBe(true);
    expect(store.canUndo).toBe(true);
    expect(port.paragraphs()[0]!.text).toBe('Remote text local');
    expect(store.undo()).not.toBeNull();
    expect(port.paragraphs()[0]!.text).toBe('Remote text');
  });

  test('publishes multi-paragraph updates atomically and replays acknowledged output as a no-op', () => {
    const { store, port } = open(['11111111', '22222222']);
    let publications = 0;
    store.subscribe(() => {
      publications += 1;
    });
    const mutation = {
      origin: ORIGIN_IDS.mutationRemote,
      actorId: 'bob',
      operationId: 'bob-batch-1',
    };
    const updates = [
      { paragraphId: '11111111', text: 'First remote text' },
      { paragraphId: '22222222', text: 'Second remote text' },
    ];

    expect(port.applyParagraphTexts(updates, mutation)).toEqual({ ok: true, changed: true });
    expect(port.paragraphs().map((paragraph) => paragraph.text)).toEqual([
      'First remote text',
      'Second remote text',
    ]);
    expect(publications).toBe(1);
    const revision = port.revision();

    expect(port.applyParagraphTexts(updates, mutation)).toEqual({ ok: true, changed: false });
    expect(port.revision()).toBe(revision);
    expect(publications).toBe(1);
  });

  test('applyRemotePackage publishes one revision and emits no primitive journal', () => {
    const source = open(['11111111']);
    expect(
      source.port.applyParagraphText('11111111', 'Remote package text', {
        origin: ORIGIN_IDS.mutationRemote,
        actorId: 'source',
        operationId: 'source-1',
      })
    ).toEqual({ ok: true, changed: true });
    const { store, port } = open(['11111111']);
    const journals: unknown[] = [];
    port.observePrimitiveJournal((journal) => journals.push(journal));
    let publications = 0;
    port.subscribe(() => {
      publications += 1;
    });
    const mutation = {
      origin: ORIGIN_IDS.mutationRemote,
      actorId: 'bob',
      operationId: 'bob-package-1',
    };
    expect(port.applyRemotePackage(source.store.currentPackage(), mutation)).toEqual({
      ok: true,
      changed: true,
    });
    port.flushPendingJournals();
    expect(port.paragraphs()[0]!.text).toBe('Remote package text');
    expect(publications).toBe(1);
    expect(journals).toHaveLength(0);
    expect(store.canUndo).toBe(false);
    expect(port.applyRemotePackage(source.store.currentPackage(), mutation)).toEqual({
      ok: true,
      changed: false,
    });
    expect(publications).toBe(1);
    expect(
      port.applyParagraphText('11111111', 'Local follow-up', {
        origin: ORIGIN_IDS.mutationRemote,
        actorId: 'bob',
        operationId: 'bob-text-1',
      })
    ).toEqual({ ok: true, changed: true });
    expect(port.paragraphs()[0]!.text).toBe('Local follow-up');
  });
});
