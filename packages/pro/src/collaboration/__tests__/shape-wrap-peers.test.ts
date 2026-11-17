/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Text wrap on a text box and a line in two collaborating editors. Concurrent wrap changes converge
// to one wrap; undo, redo, deletion against a wrap change, an offline change that reconnects, a
// late join, and save and reopen all keep one document. Concurrent moves and height changes of a
// text box written as Word writes it keep one position and one autofit choice.
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
const NS =
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" ' +
  'xmlns:v="urn:schemas-microsoft-com:vml"';

const anchor = (id: number, name: string, graphic: string) =>
  '<w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ' +
  `relativeHeight="${id}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">` +
  '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset>' +
  `</wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>${id * 600000}` +
  '</wp:posOffset></wp:positionV><wp:extent cx="1828800" cy="457200"/>' +
  `<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="${id}" name="${name}"/>` +
  '<wp:cNvGraphicFramePr/><a:graphic><a:graphicData ' +
  `uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">${graphic}` +
  '</a:graphicData></a:graphic></wp:anchor></w:drawing>';

/** A text box as Word writes it: DrawingML in `mc:Choice`, a VML copy in `mc:Fallback`. */
const TEXTBOX =
  `<mc:AlternateContent ${NS}><mc:Choice Requires="wps">` +
  anchor(
    1,
    'Note',
    '<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/>' +
      '<a:ext cx="1828800" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
      '<a:solidFill><a:srgbClr val="FFFF00"/></a:solidFill></wps:spPr><wps:txbx><w:txbxContent>' +
      '<w:p><w:r><w:t>Note</w:t></w:r></w:p></w:txbxContent></wps:txbx><wps:bodyPr>' +
      '<a:spAutoFit/></wps:bodyPr></wps:wsp>'
  ) +
  '</mc:Choice><mc:Fallback><w:pict><v:rect id="_x0000_s1026" style="width:144pt;height:36pt" ' +
  'fillcolor="yellow"><v:textbox><w:txbxContent><w:p><w:r><w:t>Note</w:t></w:r></w:p>' +
  '</w:txbxContent></v:textbox></v:rect></w:pict></mc:Fallback></mc:AlternateContent>';

const LINE = anchor(
  2,
  'Rule',
  '<wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1828800" cy="0"/>' +
    '</a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="12700"><a:solidFill>' +
    '<a:srgbClr val="000000"/></a:solidFill></a:ln></wps:spPr><wps:bodyPr/></wps:wsp>'
);

function fixture(): Uint8Array {
  const document =
    `<w:document xmlns:w="${W}" xmlns:r="${R}" ${NS}><w:body>` +
    '<w:p><w:r><w:t>Alpha paragraph</w:t></w:r></w:p>' +
    `<w:p><w:r>${TEXTBOX}</w:r><w:r>${LINE}<w:t>after</w:t></w:r></w:p>` +
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>' +
    '</w:body></w:document>';
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(document),
  });
}
const FIXTURE = fixture();

async function peer(name: string, host?: { ydoc: Y.Doc }) {
  const ydoc = new Y.Doc(),
    awareness = new Awareness(ydoc);
  if (host) Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(host.ydoc));
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: 'shape-wrap',
    identity: { actorId: name, name },
    bootstrap: host ? { kind: 'join' } : { kind: 'create', document: FIXTURE },
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

async function documentXml(client: Peer): Promise<{ fingerprint: string; xml: string }> {
  const loaded = readOoxmlPackage(new Uint8Array(await client.editor.save()));
  if (!loaded.ok) throw new Error(loaded.reason);
  const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  return { fingerprint: canonicalOoxmlFingerprint(part), xml: serializeOoxmlPart(part) };
}

/** Both peers save the same document, and each drawing holds at most one wrap element. */
async function converged(a: Peer, b: Peer): Promise<string> {
  const [left, right] = await Promise.all([documentXml(a), documentXml(b)]);
  expect(left.fingerprint).toBe(right.fingerprint);
  for (const frame of left.xml.split('<wp:docPr').slice(0, -1)) {
    const tail = frame.slice(frame.lastIndexOf('<wp:anchor'));
    if (tail.startsWith('<wp:anchor'))
      expect(tail.match(/<wp:wrap[A-Za-z]+/g) ?? []).toHaveLength(1);
  }
  return left.xml;
}

/** The anchor or inline frame of the drawing named `name`, from its opening tag to `wp:docPr`. */
function frameOf(xml: string, name: string): string {
  const at = xml.indexOf(`name="${name}"`);
  if (at < 0) return '';
  return xml.slice(
    Math.max(xml.lastIndexOf('<wp:anchor', at), xml.lastIndexOf('<wp:inline', at)),
    at
  );
}

/** Select the drawing named `name` in `client`, as a press on it would. */
function select(client: Peer, name: string): void {
  const surface = client.editor.surface!;
  const layout = surface.layout();
  const records = layout.pages.flatMap((page) => [
    ...(page.anchoredDrawings ?? []),
    ...page.fragments.flatMap((block) =>
      block.kind === 'paragraph' ? block.lines.flatMap((line) => line.drawings ?? []) : []
    ),
  ]);
  for (const record of records) {
    if (!surface.selectDrawing(record.drawingNodeId, record.paragraphId)) continue;
    if (client.editor.getSelectedImage!()?.name === name) return;
  }
  throw new Error(`no drawing named ${name}`);
}

const wrap = (client: Peer, target: 'inline' | 'square' | 'behind' | 'inFront') =>
  client.editor.exec({ type: 'setImageWrapType', target });

test('two editors converge on wrap changes to a text box and a line', async () => {
  const a = await peer('Alice'),
    b = await peer('Bob', a);
  let late: Peer | undefined;
  try {
    // One peer's change reaches the other, and its selection reads it.
    select(a, 'Note');
    expect(wrap(a, 'behind')).toMatchObject({ ok: true });
    sync(a, b);
    select(b, 'Note');
    expect(b.editor.getSelectedImage!()?.wrap).toBe('behind');
    expect(frameOf(await converged(a, b), 'Note')).toContain('behindDoc="1"');
    // Concurrent changes on one drawing: one wrap survives on both.
    for (const name of ['Note', 'Rule']) {
      select(a, name);
      select(b, name);
      expect(wrap(a, 'square')).toMatchObject({ ok: true });
      expect(wrap(b, 'inFront')).toMatchObject({ ok: true });
      sync(a, b);
      await converged(a, b);
      select(a, name);
      select(b, name);
      expect(a.editor.getSelectedImage!()?.wrap).toBe(b.editor.getSelectedImage!()?.wrap);
    }
    // In line with text and back, then undo and redo travel.
    select(a, 'Note');
    expect(wrap(a, 'inline')).toMatchObject({ ok: true });
    sync(a, b);
    expect(frameOf(await converged(a, b), 'Note')).toStartWith('<wp:inline');
    expect(a.editor.exec({ type: 'undo' })).toMatchObject({ ok: true });
    sync(a, b);
    expect(frameOf(await converged(a, b), 'Note')).toStartWith('<wp:anchor');
    expect(a.editor.exec({ type: 'redo' })).toMatchObject({ ok: true });
    sync(a, b);
    expect(frameOf(await converged(a, b), 'Note')).toStartWith('<wp:inline');
    // Alice deletes the line while Bob changes its wrap; then she undoes the delete.
    select(a, 'Rule');
    select(b, 'Rule');
    expect(a.editor.exec({ type: 'deleteImage' })).toMatchObject({ ok: true });
    expect(wrap(b, 'behind')).toMatchObject({ ok: true });
    sync(a, b);
    await converged(a, b);
    expect(a.editor.exec({ type: 'undo' })).toMatchObject({ ok: true });
    sync(a, b);
    await converged(a, b);
    // Bob changes the text box offline while Alice changes the line, then they reconnect.
    select(b, 'Note');
    expect(wrap(b, 'square')).toMatchObject({ ok: true });
    select(a, 'Rule');
    expect(wrap(a, 'inFront')).toMatchObject({ ok: true });
    sync(a, b);
    const xml = await converged(a, b);
    expect(frameOf(xml, 'Note')).toContain('<wp:wrapSquare');
    // Concurrent moves of the floating text box leave one position per axis.
    select(a, 'Note');
    select(b, 'Note');
    expect(a.editor.exec({ type: 'setImagePosition', verticalEmu: 914400 })).toMatchObject({
      ok: true,
    });
    expect(b.editor.exec({ type: 'setImagePosition', verticalEmu: 1828800 })).toMatchObject({
      ok: true,
    });
    sync(a, b);
    const moved = frameOf(await converged(a, b), 'Note');
    expect(moved.match(/<wp:positionV/g)).toHaveLength(1);
    expect(moved.match(/<wp:posOffset>/g)).toHaveLength(2);
    // Both resize the height of the text box that fits its text: one autofit choice survives.
    select(a, 'Note');
    select(b, 'Note');
    expect(
      a.editor.exec({ type: 'setImageProperties', widthEmu: 1828800, heightEmu: 914400 })
    ).toMatchObject({ ok: true });
    expect(
      b.editor.exec({ type: 'setImageProperties', widthEmu: 1828800, heightEmu: 1371600 })
    ).toMatchObject({ ok: true });
    sync(a, b);
    const fit = (await converged(a, b)).split('name="Note"')[1]!;
    expect(fit.match(/<a:(noAutofit|spAutoFit|normAutofit)\/>/g)).toEqual(['<a:noAutofit/>']);
    // A late joiner reads the same wraps, and the saved file reopens with them.
    late = await peer('Late', a);
    await converged(a, late);
    select(late, 'Note');
    expect(late.editor.getSelectedImage!()?.wrap).toBe('square');
    const reopened = readOoxmlPackage(new Uint8Array(await late.editor.save()));
    expect(reopened.ok).toBe(true);
  } finally {
    late?.destroy();
    a.destroy();
    b.destroy();
  }
});
