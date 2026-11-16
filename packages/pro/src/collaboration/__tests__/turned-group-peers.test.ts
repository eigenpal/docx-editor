/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A turned group in two collaborating editors. Each peer paints it turned and selects it with a
// press on its turned corner, outside its unturned box. Concurrent fill, outline and position
// edits, undo and redo, a delete against an edit, offline edits that reconnect, and a late join
// all converge and keep the group's turn and flip, and the VML copy's turn, on save.
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
  'xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" ' +
  'xmlns:v="urn:schemas-microsoft-com:vml"';
const EMU = 12_700;

const member = (x: number, fill: string) =>
  `<wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="${x * EMU}" y="0"/>` +
  `<a:ext cx="${72 * EMU}" cy="${72 * EMU}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/>` +
  `</a:prstGeom><a:solidFill><a:srgbClr val="${fill}"/></a:solidFill></wps:spPr>` +
  '<wps:bodyPr/></wps:wsp>';

/** A 144 x 72pt group of two squares, flipped and turned 30 degrees, at (100, 200)pt. */
const SHAPE =
  `<mc:AlternateContent ${NS}><mc:Choice Requires="wpg"><w:drawing><wp:anchor distT="0" distB="0" ` +
  'distL="0" distR="0" simplePos="0" relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" ' +
  'allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="margin"><wp:posOffset>' +
  `${100 * EMU}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="margin"><wp:posOffset>` +
  `${200 * EMU}</wp:posOffset></wp:positionV><wp:extent cx="${144 * EMU}" cy="${72 * EMU}"/>` +
  '<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="1" name="Turned group"/>' +
  '<wp:cNvGraphicFramePr/><a:graphic><a:graphicData ' +
  'uri="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"><wpg:wgp>' +
  `<wpg:cNvGrpSpPr/><wpg:grpSpPr><a:xfrm rot="1800000" flipH="1"><a:off x="0" y="0"/>` +
  `<a:ext cx="${144 * EMU}" cy="${72 * EMU}"/><a:chOff x="0" y="0"/>` +
  `<a:chExt cx="${144 * EMU}" cy="${72 * EMU}"/></a:xfrm></wpg:grpSpPr>` +
  `${member(0, 'D9E2F3')}${member(72, 'FBE5D6')}</wpg:wgp></a:graphicData>` +
  '</a:graphic></wp:anchor></w:drawing></mc:Choice><mc:Fallback><w:pict><v:group ' +
  'id="_x0000_s1026" style="position:absolute;margin-left:100pt;margin-top:200pt;width:144pt;' +
  'height:72pt;rotation:30;flip:x" coordsize="144,72"><v:rect style="position:absolute;' +
  'left:0;top:0;width:72;height:72" fillcolor="#d9e2f3" stroked="f"/></v:group></w:pict>' +
  '</mc:Fallback></mc:AlternateContent>';

function fixture(): Uint8Array {
  const fillers = Array.from(
    { length: 20 },
    (_, i) => `<w:p><w:r><w:t>Filler ${i}</w:t></w:r></w:p>`
  );
  const document =
    `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
    '<w:p><w:r><w:t>Alpha paragraph</w:t></w:r></w:p>' +
    `<w:p><w:r>${SHAPE}<w:t>after</w:t></w:r></w:p>${fillers.join('')}` +
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
    documentId: 'turned-group',
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
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    editor.surface?.layout();
  }
  return {
    ydoc,
    editor,
    container,
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

/** The turned group's laid-out record on the first page. */
function turnedRecord(client: Peer) {
  const drawing = client.editor.surface!.layout().pages[0]!.anchoredDrawings?.[0];
  return drawing ?? null;
}

/**
 * Select the group with a press inside its turned corner, left of its unturned box, where the
 * browser reports the page under the press.
 */
function pressTurnedCorner(client: Peer): void {
  const record = turnedRecord(client)!;
  expect(record.vectorShape?.rotationDegrees).toBe(30);
  const box = record.geometry.contentBounds;
  const page = client.editor.surface!.layout().pages[0]!;
  const scale = 96 / 72;
  const x = box.x + box.width / 2 - 78;
  const y = box.y + box.height / 2 - 4.8;
  expect(x).toBeLessThan(box.x);
  client.container.querySelector('.docx-page-content')!.dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerId: 1,
      clientX: (page.contentBox.x + x) * scale,
      clientY: (page.contentBox.y + y) * scale,
    })
  );
  expect(client.editor.getSelectedImage!()?.id).toBe(record.drawingNodeId);
}

/** The saved document part: its canonical fingerprint and its XML. */
async function saved(client: Peer): Promise<{ fingerprint: string; xml: string }> {
  const loaded = readOoxmlPackage(new Uint8Array(await client.editor.save()));
  if (!loaded.ok) throw new Error(loaded.reason);
  const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  return { fingerprint: canonicalOoxmlFingerprint(part), xml: serializeOoxmlPart(part) };
}

/** Both peers save the same document; a group that remains keeps its turn and flip. */
async function converged(a: Peer, b: Peer): Promise<string> {
  const [left, right] = await Promise.all([saved(a), saved(b)]);
  expect(left.fingerprint).toBe(right.fingerprint);
  if (left.xml.includes('<wpg:wgp>')) {
    expect(left.xml).toMatch(/<a:xfrm (flipH="1" rot="1800000"|rot="1800000" flipH="1")>/);
    expect(left.xml).toContain('rotation:30');
    expect(turnedRecord(a)?.vectorShape?.rotationDegrees).toBe(30);
    expect(turnedRecord(b)?.vectorShape?.rotationDegrees).toBe(30);
  }
  return left.xml;
}

test('two editors converge on edits to a turned group, keep its turn, and select it by its corner', async () => {
  const a = await peer('Alice'),
    b = await peer('Bob', a);
  let late: Peer | undefined;
  try {
    // Concurrent fills: one fill survives on both, and both still paint the shape turned.
    pressTurnedCorner(a);
    pressTurnedCorner(b);
    expect(a.editor.exec({ type: 'setShapeFill', color: 'FF0000' })).toMatchObject({ ok: true });
    expect(b.editor.exec({ type: 'setShapeFill', color: '00B050' })).toMatchObject({ ok: true });
    sync(a, b);
    await converged(a, b);
    // Concurrent outlines.
    pressTurnedCorner(a);
    pressTurnedCorner(b);
    expect(a.editor.exec({ type: 'setShapeOutline', color: '0000FF' })).toMatchObject({ ok: true });
    expect(b.editor.exec({ type: 'setShapeOutline', widthPt: 4 })).toMatchObject({ ok: true });
    sync(a, b);
    expect(await converged(a, b)).toContain('<a:ln');
    // Undo and redo travel.
    expect(a.editor.exec({ type: 'undo' })).toMatchObject({ ok: true });
    sync(a, b);
    await converged(a, b);
    expect(a.editor.exec({ type: 'redo' })).toMatchObject({ ok: true });
    sync(a, b);
    await converged(a, b);
    // Concurrent moves: one position wins on both, and the group still paints turned.
    pressTurnedCorner(a);
    pressTurnedCorner(b);
    expect(a.editor.exec({ type: 'setImagePosition', horizontalEmu: 120 * EMU })).toMatchObject({
      ok: true,
    });
    expect(b.editor.exec({ type: 'setImagePosition', verticalEmu: 220 * EMU })).toMatchObject({
      ok: true,
    });
    sync(a, b);
    await converged(a, b);
    expect(a.editor.exec({ type: 'undo' })).toMatchObject({ ok: true });
    expect(b.editor.exec({ type: 'undo' })).toMatchObject({ ok: true });
    sync(a, b);
    await converged(a, b);
    // Alice deletes the turned group while Bob recolours it; then she undoes the delete.
    pressTurnedCorner(a);
    pressTurnedCorner(b);
    expect(a.editor.exec({ type: 'deleteImage' })).toMatchObject({ ok: true });
    expect(b.editor.exec({ type: 'setShapeFill', color: '7030A0' })).toMatchObject({ ok: true });
    sync(a, b);
    await converged(a, b);
    expect(a.editor.exec({ type: 'undo' })).toMatchObject({ ok: true });
    sync(a, b);
    expect(await converged(a, b)).toContain('<wpg:wgp>');
    // Offline edits on both, then they reconnect.
    pressTurnedCorner(a);
    pressTurnedCorner(b);
    expect(b.editor.exec({ type: 'setShapeFill', transparency: 0.5 })).toMatchObject({ ok: true });
    expect(a.editor.exec({ type: 'setShapeOutline', visible: false })).toMatchObject({ ok: true });
    sync(a, b);
    await converged(a, b);
    // A late joiner paints it turned and selects it the same way.
    late = await peer('Late', a);
    await converged(a, late);
    pressTurnedCorner(late);
  } finally {
    late?.destroy();
    a.destroy();
    b.destroy();
  }
});
