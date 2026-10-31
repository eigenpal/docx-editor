/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A bound control refreshed at open is the same document for every participant: the room
// is created from the refreshed tree, a joiner receives it, and edits around it converge.
import { expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import {
  readOoxmlPackage,
  canonicalOoxmlFingerprint,
  serializeOoxmlPart,
} from '@docx-editor.dev/core/store';
import { createDocumentCollaboration } from '../document-session.ts';
import { collaborationModule } from '../collaboration-module.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
const ITEM_ID = '{4E5C8A11-2B3D-4F60-9A7B-1C2D3E4F5A6B}';
const NS = 'urn:example:contract';

function fixture(): Uint8Array {
  const bound =
    `<w:sdt><w:sdtPr><w:dataBinding w:prefixMappings="xmlns:ns0='${NS}'" ` +
    `w:xpath="/ns0:contract[1]/ns0:party[1]" w:storeItemID="${ITEM_ID}"/><w:text/></w:sdtPr>` +
    '<w:sdtContent><w:r><w:t>Old party</w:t></w:r></w:sdtContent></w:sdt>';
  const document =
    `<w:document xmlns:w="${W}" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">` +
    '<w:body>' +
    `<w:p w14:paraId="11111111" w14:textId="11111111"><w:r><w:t xml:space="preserve">Party: </w:t></w:r>${bound}</w:p>` +
    '<w:p w14:paraId="22222222" w14:textId="22222222"><w:r><w:t>Bravo paragraph</w:t></w:r></w:p>' +
    '<w:sectPr/></w:body></w:document>';
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/customXml/itemProps1.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${PKG}"><Relationship Id="rIdX" Type="${R}/customXml" Target="../customXml/item1.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(document),
    'customXml/item1.xml': strToU8(
      `<ns0:contract xmlns:ns0="${NS}"><ns0:party>Northwind Traders</ns0:party></ns0:contract>`
    ),
    'customXml/_rels/item1.xml.rels': strToU8(
      `<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${R}/customXmlProps" Target="itemProps1.xml"/></Relationships>`
    ),
    'customXml/itemProps1.xml': strToU8(
      `<ds:datastoreItem ds:itemID="${ITEM_ID}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"><ds:schemaRefs/></ds:datastoreItem>`
    ),
  });
}

async function peer(name: string, host?: { ydoc: Y.Doc }) {
  const ydoc = new Y.Doc(),
    awareness = new Awareness(ydoc);
  if (host) Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(host.ydoc));
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: 'bound-content-refresh',
    identity: { actorId: name, name },
    bootstrap: host ? { kind: 'join' } : { kind: 'create', document: fixture() },
  });
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: room.document,
    modules: [collaborationModule({ session: room.session })],
  });
  return {
    ydoc,
    editor,
    destroy() {
      editor.destroy();
      container.remove();
      room.destroy();
      awareness.destroy();
      ydoc.destroy();
    },
  };
}
type Peer = Awaited<ReturnType<typeof peer>>;

function sync(a: Peer, b: Peer) {
  Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc, Y.encodeStateVector(b.ydoc)), 'relay');
  Y.applyUpdate(a.ydoc, Y.encodeStateAsUpdate(b.ydoc, Y.encodeStateVector(a.ydoc)), 'relay');
}

async function mainOf(bytes: Uint8Array) {
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.package.parts.get(loaded.package.mainDocumentPart)!;
}

async function verify(a: Peer, b: Peer) {
  const left = await mainOf(new Uint8Array(await a.editor.save()));
  const right = await mainOf(new Uint8Array(await b.editor.save()));
  expect(canonicalOoxmlFingerprint(left)).toBe(canonicalOoxmlFingerprint(right));
  const xml = serializeOoxmlPart(left);
  expect(xml).toContain('Northwind Traders');
  expect(xml).not.toContain('Old party');
  return xml;
}

function typeAt(client: Peer, paragraph: number, offset: number, text: string) {
  const surface = client.editor.surface!;
  const paragraphId = surface.session.paragraphIds()[paragraph]!;
  surface.setSelection({ anchor: { paragraphId, offset }, head: { paragraphId, offset } });
  expect(client.editor.exec({ type: 'insertText', text })).toMatchObject({
    ok: true,
    changed: true,
  });
}

test('two editors share the refreshed bound value through edits, undo, rejoin and reopen', async () => {
  const a = await peer('Alice'),
    b = await peer('Bob', a);
  let rejoined: Peer | undefined;
  let reopened: ReturnType<typeof createDocxEditor> | undefined;
  try {
    for (const client of [a, b])
      expect(client.editor.surface!.session.bodyText()).toContain('Northwind Traders');
    typeAt(a, 0, 0, 'A ');
    typeAt(b, 1, 0, 'B ');
    sync(a, b);
    await verify(a, b);
    expect(a.editor.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
    sync(a, b);
    await verify(a, b);
    rejoined = await peer('Rejoined', a);
    sync(a, rejoined);
    const xml = await verify(a, rejoined);
    // Save and reopen: the saved file already holds the value, so a reopen changes nothing.
    reopened = createDocxEditor({
      container: document.createElement('div'),
      document: new Uint8Array(await a.editor.save()),
    });
    expect(serializeOoxmlPart(await mainOf(new Uint8Array(await reopened.save()))).length).toBe(
      xml.length
    );
  } finally {
    reopened?.destroy();
    rejoined?.destroy();
    b.destroy();
    a.destroy();
  }
});
