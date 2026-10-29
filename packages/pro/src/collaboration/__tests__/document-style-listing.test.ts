/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Listing styles through automation on a collaborative document (issue #1616).
//
// A joined replica lists the same styles as the replica that created the session, and a paragraph
// style one participant chooses from that listing reaches the other participant and its save.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { DocxEditor, type DocxEditorServerRuntime } from '@docx-editor.dev/editor-api';
import { createDocumentCollaboration } from '../document-session.ts';

const ROOM = 'document-style-listing';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';

const STYLED = zipSync({
  '[Content_Types].xml': strToU8(
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '</Types>'
  ),
  '_rels/.rels': strToU8(
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>'
  ),
  'word/_rels/document.xml.rels': strToU8(
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>'
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>` +
      '<w:p w14:paraId="11111111" w14:textId="11111111"><w:r><w:t>Alpha</w:t></w:r></w:p>' +
      '<w:p w14:paraId="22222222" w14:textId="22222222"><w:r><w:t>Bravo</w:t></w:r></w:p>' +
      '<w:sectPr/></w:body></w:document>'
  ),
  'word/styles.xml': strToU8(
    `<w:styles xmlns:w="${W}">` +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      '<w:style w:type="paragraph" w:customStyle="1" w:styleId="Quote"><w:name w:val="Quote"/>' +
      '<w:basedOn w:val="Normal"/></w:style>' +
      '<w:style w:type="character" w:styleId="Strong"><w:name w:val="Strong"/></w:style>' +
      '</w:styles>'
  ),
});

function sync(source: Y.Doc, target: Y.Doc): void {
  Y.applyUpdate(target, Y.encodeStateAsUpdate(source, Y.encodeStateVector(target)), 'provider');
}

async function listing(runtime: DocxEditorServerRuntime): Promise<unknown> {
  return runtime.run(async (context) => {
    const styles = context.document.getStyles();
    styles.load('items/nameLocal,items/type,items/builtIn,items/baseStyle');
    await context.sync();
    return styles.items.map((style) => [
      style.nameLocal,
      style.type,
      style.builtIn,
      style.baseStyle,
    ]);
  });
}

test('a joined replica lists the same styles and receives a listed style applied remotely', async () => {
  const docs = [new Y.Doc(), new Y.Doc()];
  const awareness = docs.map((doc) => new Awareness(doc));
  const first = await createDocumentCollaboration({
    ydoc: docs[0]!,
    awareness: awareness[0]!,
    documentId: ROOM,
    sessionId: 'first',
    identity: { actorId: 'first', name: 'First' },
    bootstrap: { kind: 'create', document: STYLED },
  });
  Y.applyUpdate(docs[1]!, Y.encodeStateAsUpdate(docs[0]!), 'initial');
  const second = await createDocumentCollaboration({
    ydoc: docs[1]!,
    awareness: awareness[1]!,
    documentId: ROOM,
    sessionId: 'second',
    identity: { actorId: 'second', name: 'Second' },
    bootstrap: { kind: 'join' },
  });
  const writer = await DocxEditor.createCollaborative(first.document, first.session);
  const reader = await DocxEditor.createCollaborative(second.document, second.session);
  try {
    const expected = [
      ['Normal', 'Paragraph', true, ''],
      ['Quote', 'Paragraph', false, 'Normal'],
      ['Strong', 'Character', true, ''],
    ];
    expect(await listing(writer)).toEqual(expected);
    expect(await listing(reader)).toEqual(expected);

    await writer.run(async (context) => {
      const styles = context.document.getStyles();
      const quote = styles.getByNameOrNullObject('quote');
      quote.load('nameLocal');
      const paragraph = context.document.body.paragraphs.getFirst();
      await context.sync();
      if (quote.isNullObject) throw new Error('the listed style is missing');
      paragraph.style = quote.nameLocal;
      await context.sync();
    });
    sync(docs[0]!, docs[1]!);

    const read = await reader.run(async (context) => {
      const paragraph = context.document.body.paragraphs.getFirst();
      paragraph.load('style');
      await context.sync();
      return paragraph.style;
    });
    expect(read).toBe('Quote');
    const saved = strFromU8(unzipSync(await reader.save())['word/document.xml']!);
    expect(saved).toContain('<w:pStyle w:val="Quote"/>');
    expect(await listing(reader)).toEqual(expected);
  } finally {
    writer.dispose();
    reader.dispose();
    first.destroy();
    second.destroy();
    for (const entry of awareness) entry.destroy();
    for (const doc of docs) doc.destroy();
  }
});
