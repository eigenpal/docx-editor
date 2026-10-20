/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { readOoxmlPackage, readOoxmlPart, serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { createDocumentCollaboration } from '../document-session.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { zipDocument, walk, nodeText } from './document-peer-support.ts';

let registeredDom = false;
beforeAll(() => {
  if (typeof document !== 'undefined') return;
  GlobalRegistrator.register();
  registeredDom = true;
});
afterAll(() => {
  if (registeredDom) GlobalRegistrator.unregister();
});
const source =
  '<w:tbl><w:tblPr><w:tblCellMar><w:top w:w="0"/>' +
  '<w:bottom w:w="0"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/>' +
  '</w:tblGrid><w:tr><w:trPr><w:trHeight w:val="340" w:hRule="exact"/></w:trPr>' +
  '<w:tc><w:p><w:pPr><w:spacing w:line="380" w:lineRule="exact"/></w:pPr>' +
  '<w:r><w:rPr><w:sz w:val="28"/></w:rPr><w:t>LEFT</w:t></w:r></w:p></w:tc>' +
  '</w:tr></w:tbl>';
function partOf(saved: Uint8Array | ArrayBuffer) {
  const read = readOoxmlPackage(saved instanceof Uint8Array ? saved : new Uint8Array(saved));
  if (!read.ok) throw new Error(read.reason);
  return read.package.parts.get(read.package.mainDocumentPart)!;
}
test('two editors keep the exact row source through concurrent replacement, undo, and cold reopen', async () => {
  const { createDocxEditor } = await import('@docx-editor.dev/core/editor');
  const a = new Y.Doc(),
    b = new Y.Doc(),
    aa = new Awareness(a),
    ba = new Awareness(b);
  const leftRoom = await createDocumentCollaboration({
    ydoc: a,
    awareness: aa,
    documentId: 'exact-row-visible',
    identity: { actorId: 'alice', name: 'Alice' },
    bootstrap: { kind: 'create', document: zipDocument(source) },
  });
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a), 'relay');
  const rightRoom = await createDocumentCollaboration({
    ydoc: b,
    awareness: ba,
    documentId: 'exact-row-visible',
    identity: { actorId: 'bob', name: 'Bob' },
    bootstrap: { kind: 'join', timeoutMs: 5000 },
  });
  let paused = false;
  const toA: Uint8Array[] = [],
    toB: Uint8Array[] = [];
  const relayA = (update: Uint8Array, origin: unknown) => {
    if (origin === 'relay') return;
    if (paused) toB.push(update);
    else Y.applyUpdate(b, update, 'relay');
  };
  const relayB = (update: Uint8Array, origin: unknown) => {
    if (origin === 'relay') return;
    if (paused) toA.push(update);
    else Y.applyUpdate(a, update, 'relay');
  };
  a.on('update', relayA);
  b.on('update', relayB);
  const lc = document.createElement('div'),
    rc = document.createElement('div');
  document.body.append(lc, rc);
  const left = createDocxEditor({
    container: lc,
    document: leftRoom.document,
    modules: [collaborationModule({ session: leftRoom.session })],
  });
  const right = createDocxEditor({
    container: rc,
    document: rightRoom.document,
    modules: [collaborationModule({ session: rightRoom.session })],
  });
  const select = (editor: typeof left, start: number, end = start) => {
    const surface = editor.surface!,
      paragraphId = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId, offset: start },
      head: { paragraphId, offset: end },
    });
  };
  const authoredGeometry = (xml: string) => {
    const parsed = readOoxmlPart(xml, {
      name: '/word/document.xml',
      contentType: 'application/xml',
    });
    if (!parsed.ok) throw new Error(parsed.reason);
    const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const rows: string[][] = [],
      lines: string[][] = [];
    walk(parsed.part.root, (node) => {
      if (node.kind === 'textValue' || node.namespaceUri !== w) return;
      const value = (name: string) =>
        node.attributes.find((a) => a.namespaceUri === w && a.localName === name)?.value ?? '';
      if (node.localName === 'trHeight') rows.push([value('val'), value('hRule')]);
      if (node.localName === 'spacing') lines.push([value('line'), value('lineRule')]);
    });
    expect(rows).toEqual([['340', 'exact']]);
    expect(lines).toEqual([['380', 'exact']]);
  };
  try {
    const original = serializeOoxmlPart(partOf(await left.save()));
    authoredGeometry(original);
    paused = true;
    select(left, 0, 4);
    expect(left.exec({ type: 'pasteWithoutFormatting', text: 'A' }).ok).toBe(true);
    select(right, 0);
    expect(right.exec({ type: 'pasteWithoutFormatting', text: 'B' }).ok).toBe(true);
    paused = false;
    for (const update of toA) Y.applyUpdate(a, update, 'relay');
    for (const update of toB) Y.applyUpdate(b, update, 'relay');
    const saved = await left.save();
    const leftXml = serializeOoxmlPart(partOf(saved)),
      rightXml = serializeOoxmlPart(partOf(await right.save()));
    expect(leftXml).toBe(rightXml);
    authoredGeometry(leftXml);
    expect(nodeText(partOf(saved).root)).toContain('A');
    expect(nodeText(partOf(saved).root)).toContain('B');
    expect(nodeText(partOf(saved).root)).not.toContain('LEFT');
    expect(right.exec({ type: 'undo' }).ok).toBe(true);
    expect(right.exec({ type: 'redo' }).ok).toBe(true);
    expect(serializeOoxmlPart(partOf(await left.save()))).toBe(
      serializeOoxmlPart(partOf(await right.save()))
    );
    const cc = document.createElement('div');
    document.body.append(cc);
    const cold = createDocxEditor({ container: cc, document: new Uint8Array(await left.save()) });
    try {
      const coldXml = serializeOoxmlPart(partOf(await cold.save()));
      authoredGeometry(coldXml);
      expect(coldXml).toBe(serializeOoxmlPart(partOf(await left.save())));
    } finally {
      cold.destroy();
      cc.remove();
    }
  } finally {
    a.off('update', relayA);
    b.off('update', relayB);
    left.destroy();
    right.destroy();
    lc.remove();
    rc.remove();
    leftRoom.destroy();
    rightRoom.destroy();
    aa.destroy();
    ba.destroy();
    a.destroy();
    b.destroy();
  }
});
