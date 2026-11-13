/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A callout text box in two collaborating editors. Each peer selects it with a press on its
// tail, below its frame, and a press beside the tail goes to the text. A move against typing in
// the box, undo and redo, a delete against an edit, and a late join all converge, and the box
// still selects by its tail where it now paints.
import { expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { readOoxmlPackage, canonicalOoxmlFingerprint } from '@docx-editor.dev/core/store';
import { createDocumentCollaboration } from '../document-session.ts';
import { collaborationModule } from '../collaboration-module.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS =
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"';
const EMU = 12_700;

/** A 144 x 72pt callout text box at (100, 100)pt: its tail tip sits at (42, 81)pt in it. */
const CALLOUT =
  `<w:drawing ${NS}><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ` +
  'relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
  '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="margin"><wp:posOffset>' +
  `${100 * EMU}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="margin">` +
  `<wp:posOffset>${100 * EMU}</wp:posOffset></wp:positionV>` +
  `<wp:extent cx="${144 * EMU}" cy="${72 * EMU}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
  '<wp:wrapNone/><wp:docPr id="1" name="Callout"/><wp:cNvGraphicFramePr/><a:graphic>' +
  '<a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
  '<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/>' +
  `<a:ext cx="${144 * EMU}" cy="${72 * EMU}"/></a:xfrm>` +
  '<a:prstGeom prst="wedgeRectCallout"><a:avLst/></a:prstGeom>' +
  '<a:solidFill><a:srgbClr val="00AA00"/></a:solidFill><a:ln w="12700"><a:solidFill>' +
  '<a:srgbClr val="000000"/></a:solidFill></a:ln></wps:spPr><wps:txbx><w:txbxContent>' +
  '<w:p><w:r><w:t>Callout note</w:t></w:r></w:p></w:txbxContent></wps:txbx><wps:bodyPr/>' +
  '</wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing>';

function fixture(): Uint8Array {
  const fillers = Array.from(
    { length: 20 },
    (_, i) => `<w:p><w:r><w:t>Filler ${i}</w:t></w:r></w:p>`
  );
  const document =
    `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
    `<w:p><w:r>${CALLOUT}<w:t>Anchor</w:t></w:r></w:p>${fillers.join('')}` +
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
    documentId: 'textbox-callout',
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

function calloutRecord(client: Peer) {
  return client.editor.surface!.layout().pages[0]!.anchoredDrawings?.[0] ?? null;
}

/** A press at a point in the callout's frame, on its painted box. */
function pressCallout(client: Peer, x: number, y: number): void {
  const record = calloutRecord(client)!;
  const frame = record.geometry.contentBounds;
  const page = client.editor.surface!.layout().pages[0]!;
  const scale = 96 / 72;
  client.container
    .querySelector(
      `.docx-drawing-textbox[data-drawing-node-id="${CSS.escape(record.drawingNodeId)}"]`
    )!
    .dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 1,
        clientX: (page.contentBox.x + frame.x + x) * scale,
        clientY: (page.contentBox.y + frame.y + y) * scale,
      })
    );
}

/** Select the callout with a press on its tail, below its frame. */
function pressTail(client: Peer): void {
  pressCallout(client, 42, 77);
  expect(client.editor.getSelectedImage!()?.id).toBe(calloutRecord(client)!.drawingNodeId);
}

async function fingerprint(client: Peer): Promise<string> {
  const loaded = readOoxmlPackage(new Uint8Array(await client.editor.save()));
  if (!loaded.ok) throw new Error(loaded.reason);
  return canonicalOoxmlFingerprint(loaded.package.parts.get(loaded.package.mainDocumentPart)!);
}

async function converged(a: Peer, b: Peer): Promise<void> {
  expect(await fingerprint(a)).toBe(await fingerprint(b));
  const [left, right] = [calloutRecord(a), calloutRecord(b)];
  expect(left?.geometry.contentBounds).toEqual(right?.geometry.contentBounds);
}

test('two editors select a callout text box by its tail and converge on edits to it', async () => {
  const a = await peer('Alice'),
    b = await peer('Bob', a);
  let late: Peer | undefined;
  try {
    pressTail(a);
    pressTail(b);
    // Beside the tail, below the frame: the text under it.
    pressCallout(b, 130, 77);
    expect(b.editor.getSelectedImage!()).toBeNull();
    // Alice moves the box while Bob types in it.
    pressTail(a);
    expect(a.editor.exec({ type: 'setImagePosition', horizontalEmu: 160 * EMU })).toMatchObject({
      ok: true,
    });
    const match = b.editor.findMatches('Callout note')[0]!;
    expect(b.editor.surface!.setActiveScope(match.scope!)).toBe(true);
    expect(b.editor.exec({ type: 'insertText', text: 'Bob ' })).toMatchObject({ ok: true });
    sync(a, b);
    await converged(a, b);
    expect(a.editor.findMatches('Bob Callout note')).toHaveLength(1);
    expect(calloutRecord(b)!.x).toBeCloseTo(160, 6);
    // Both still select it by its tail where it now paints.
    pressTail(a);
    pressTail(b);
    // Undo and redo of the move travel.
    expect(a.editor.exec({ type: 'undo' })).toMatchObject({ ok: true });
    sync(a, b);
    await converged(a, b);
    expect(a.editor.exec({ type: 'redo' })).toMatchObject({ ok: true });
    sync(a, b);
    await converged(a, b);
    // Alice deletes the box while Bob moves it; then she undoes the delete.
    pressTail(a);
    pressTail(b);
    expect(a.editor.exec({ type: 'deleteImage' })).toMatchObject({ ok: true });
    expect(b.editor.exec({ type: 'setImagePosition', verticalEmu: 120 * EMU })).toMatchObject({
      ok: true,
    });
    sync(a, b);
    await converged(a, b);
    expect(a.editor.exec({ type: 'undo' })).toMatchObject({ ok: true });
    sync(a, b);
    await converged(a, b);
    expect(calloutRecord(a)?.textboxStory).toBeDefined();
    // A late joiner selects it the same way.
    late = await peer('Late', a);
    await converged(a, late);
    pressTail(late);
  } finally {
    late?.destroy();
    a.destroy();
    b.destroy();
  }
});
