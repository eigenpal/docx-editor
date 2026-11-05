/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Formatting a paragraph of many differently formatted runs converges for every participant,
// including while another participant types into or deletes from the same paragraph.
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
const RUNS = 300;
const PROPS = [
  '<w:b/>',
  '<w:u w:val="single"/>',
  '<w:color w:val="C00000"/>',
  '<w:sz w:val="24"/>',
  '',
];

function fixture(): Uint8Array {
  const runs = Array.from(
    { length: RUNS },
    (_, index) =>
      `<w:r><w:rPr>${PROPS[index % PROPS.length]}</w:rPr><w:t xml:space="preserve">abc </w:t></w:r>`
  ).join('');
  const document =
    `<w:document xmlns:w="${W}" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">` +
    '<w:body>' +
    `<w:p w14:paraId="11111111" w14:textId="11111111">${runs}</w:p>` +
    '<w:p w14:paraId="22222222" w14:textId="22222222"><w:r><w:t>Second paragraph</w:t></w:r></w:p>' +
    '<w:sectPr/></w:body></w:document>';
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(document),
  });
}

async function peer(name: string, host?: { ydoc: Y.Doc }) {
  const ydoc = new Y.Doc(),
    awareness = new Awareness(ydoc);
  if (host) Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(host.ydoc));
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: 'many-run-formatting',
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

async function mainXml(editor: { save(): Promise<ArrayBuffer | Uint8Array> }) {
  const loaded = readOoxmlPackage(new Uint8Array(await editor.save()));
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.package.parts.get(loaded.package.mainDocumentPart)!;
}

async function verify(a: Peer, b: Peer): Promise<string> {
  const left = await mainXml(a.editor);
  const right = await mainXml(b.editor);
  expect(canonicalOoxmlFingerprint(left)).toBe(canonicalOoxmlFingerprint(right));
  return serializeOoxmlPart(left);
}

function select(client: Peer, paragraph: number, start: number, end: number) {
  const surface = client.editor.surface!;
  const paragraphId = surface.session.paragraphIds()[paragraph]!;
  surface.setSelection({
    anchor: { paragraphId, offset: start },
    head: { paragraphId, offset: end },
  });
}

function italicCount(xml: string): number {
  return xml.match(/<w:i\/>/g)?.length ?? 0;
}

test('formatting a many-run paragraph converges through concurrent edits, undo, rejoin and reopen', async () => {
  const a = await peer('Alice'),
    b = await peer('Bob', a);
  let rejoined: Peer | undefined;
  let reopened: ReturnType<typeof createDocxEditor> | undefined;
  try {
    // Alice italicizes from inside the first run to inside the last while Bob types mid-paragraph.
    select(a, 0, 1, RUNS * 4 - 1);
    expect(a.editor.exec({ type: 'toggleMark', mark: 'italic' })).toMatchObject({
      ok: true,
      changed: true,
    });
    select(b, 0, 600, 600);
    expect(b.editor.exec({ type: 'insertText', text: 'BOB' })).toMatchObject({ ok: true });
    sync(a, b);
    let xml = await verify(a, b);
    expect(italicCount(xml)).toBeGreaterThanOrEqual(RUNS);
    expect(xml).toContain('BOB');

    // Bob deletes a span of runs while Alice bolds an overlapping range.
    select(b, 0, 100, 200);
    expect(b.editor.surface!.deleteSelection()).toBe(true);
    select(a, 0, 150, 400);
    expect(a.editor.exec({ type: 'toggleMark', mark: 'bold' })).toMatchObject({ ok: true });
    sync(a, b);
    xml = await verify(a, b);

    // Undo and redo Alice's bold.
    expect(a.editor.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
    sync(a, b);
    await verify(a, b);
    expect(a.editor.exec({ type: 'redo' })).toMatchObject({ ok: true, changed: true });
    sync(a, b);
    xml = await verify(a, b);

    // A participant joining late sees the same document.
    rejoined = await peer('Rejoined', a);
    sync(a, rejoined);
    expect(await verify(a, rejoined)).toBe(xml);

    // Save and reopen keeps the formatting.
    const saved = new Uint8Array(await a.editor.save());
    reopened = createDocxEditor({ container: document.createElement('div'), document: saved });
    const again = serializeOoxmlPart(await mainXml(reopened));
    expect(italicCount(again)).toBe(italicCount(xml));
    expect(canonicalOoxmlFingerprint(await mainXml(reopened))).toBe(
      canonicalOoxmlFingerprint(await mainXml(a.editor))
    );
  } finally {
    reopened?.destroy();
    rejoined?.destroy();
    b.destroy();
    a.destroy();
  }
});
