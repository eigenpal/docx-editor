/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// One peer gives a group member no fill (it has no outline either): the group keeps painting
// its other member on both peers, and the other peer's Format shape pane stays on the group.
import { expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { strToU8, zipSync } from 'fflate';
import {
  createDocxEditor,
  editSelectedShape,
  readSelectedShape,
} from '@docx-editor.dev/core/editor';
import { createDocumentCollaboration } from '../document-session.ts';
import { collaborationModule } from '../collaboration-module.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS =
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" ' +
  'xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"';
const EMU = 12_700;

const member = (id: number, x: number, color: string) =>
  `<wps:wsp><wps:cNvPr id="${id}" name="Member ${id}"/><wps:cNvSpPr/><wps:spPr><a:xfrm>` +
  `<a:off x="${x}" y="0"/><a:ext cx="${100 * EMU}" cy="${80 * EMU}"/></a:xfrm>` +
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
  `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln>` +
  '</wps:spPr><wps:bodyPr/></wps:wsp>';

const GROUP =
  `<w:drawing ${NS}><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ` +
  'relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
  '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0' +
  '</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0' +
  `</wp:posOffset></wp:positionV><wp:extent cx="${200 * EMU}" cy="${80 * EMU}"/>` +
  '<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="5" name="Group"/>' +
  '<wp:cNvGraphicFramePr/><a:graphic><a:graphicData ' +
  'uri="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"><wpg:wgp>' +
  '<wpg:cNvGrpSpPr/><wpg:grpSpPr><a:xfrm><a:off x="0" y="0"/>' +
  `<a:ext cx="${200 * EMU}" cy="${80 * EMU}"/><a:chOff x="0" y="0"/>` +
  `<a:chExt cx="${200 * EMU}" cy="${80 * EMU}"/></a:xfrm></wpg:grpSpPr>` +
  member(11, 0, '1F3864') +
  member(12, 100 * EMU, 'D9E2F3') +
  '</wpg:wgp></a:graphicData></a:graphic></wp:anchor></w:drawing>';

function fixture(): Uint8Array {
  const document =
    `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
    '<w:p><w:r><w:t>Alpha paragraph</w:t></w:r></w:p>' +
    `<w:p><w:r>${GROUP}<w:t>after</w:t></w:r></w:p>` +
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
    documentId: 'group-member-no-fill',
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

/** Select the group on `client`, and return the group drawing. */
function selectGroup(client: Peer) {
  const surface = client.editor.surface!;
  const drawings = surface.layout().pages.flatMap((page) => page.anchoredDrawings ?? []);
  expect(drawings).toHaveLength(1);
  const group = drawings[0]!;
  expect(surface.selectDrawing(group.drawingNodeId, group.paragraphId)).toBe(true);
  return group;
}

/** The id of the group's second member, from the live tree. */
function secondMemberId(client: Peer): string {
  const members: string[] = [];
  const walk = (node: unknown) => {
    const element = node as { kind?: string; localName?: string; id: string; children?: unknown[] };
    if (element.kind === 'textValue') return;
    if (element.localName === 'wsp') members.push(element.id);
    for (const child of element.children ?? []) walk(child);
  };
  walk(client.editor.surface!.session.part().root);
  return members[1]!;
}

test('a group member given no fill keeps the group painted and the other pane open', async () => {
  const a = await peer('Alice'),
    b = await peer('Bob', a);
  try {
    const group = selectGroup(a);
    selectGroup(b);
    expect(readSelectedShape(b.editor, b.editor.snapshot().image).drawingNodeId).toBe(
      group.drawingNodeId
    );
    // Alice selects the second member and gives it no fill: it has no outline either.
    expect(a.editor.surface!.selectDrawingMember(secondMemberId(a))).toBe(true);
    expect(
      editSelectedShape(a.editor, a.editor.snapshot().image, { type: 'noFill' })
    ).toMatchObject({ ok: true, changed: true });
    sync(a, b);
    for (const client of [a, b]) {
      const drawings = client.editor
        .surface!.layout()
        .pages.flatMap((page) => page.anchoredDrawings ?? []);
      expect(drawings).toHaveLength(1);
      expect(drawings[0]!.vectorShape?.components).toHaveLength(1);
    }
    // Bob's pane stays on the group, and the group still takes its fill edits.
    const view = readSelectedShape(b.editor, b.editor.snapshot().image);
    expect(view.drawingNodeId).toBe(group.drawingNodeId);
    expect(view.canEditFill).toBe(true);
    // Undo brings the member's fill back on both peers.
    expect(a.editor.exec({ type: 'undo' })).toMatchObject({ ok: true });
    sync(a, b);
    const restored = b.editor
      .surface!.layout()
      .pages.flatMap((page) => page.anchoredDrawings ?? [])[0]!;
    expect(restored.vectorShape?.components).toHaveLength(2);
  } finally {
    a.destroy();
    b.destroy();
  }
});
