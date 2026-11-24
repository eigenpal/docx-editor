/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A group whose second member is a nested group: both peers paint every member, one peer
// recolours a shape inside the nested group, and the edit converges, undoes, and survives a
// concurrent delete of the whole group and a save on both peers.
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

/** A nested group over the right half that authors its member in half-size child units. */
const NESTED =
  '<wpg:grpSp><wpg:cNvPr id="20" name="Inner"/><wpg:cNvGrpSpPr/><wpg:grpSpPr><a:xfrm>' +
  `<a:off x="${100 * EMU}" y="0"/><a:ext cx="${100 * EMU}" cy="${80 * EMU}"/>` +
  `<a:chOff x="0" y="0"/><a:chExt cx="${50 * EMU}" cy="${40 * EMU}"/></a:xfrm></wpg:grpSpPr>` +
  member(12, 0, 'D9E2F3').replace(
    `cx="${100 * EMU}" cy="${80 * EMU}"`,
    `cx="${50 * EMU}" cy="${40 * EMU}"`
  ) +
  '</wpg:grpSp>';

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
  NESTED +
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
    documentId: 'nested-group-member',
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

function groupRecords(client: Peer) {
  return client.editor.surface!.layout().pages.flatMap((page) => page.anchoredDrawings ?? []);
}

/** Select the group on `client`, and return the group drawing. */
function selectGroup(client: Peer) {
  const [group] = groupRecords(client);
  expect(group).toBeDefined();
  expect(client.editor.surface!.selectDrawing(group!.drawingNodeId, group!.paragraphId)).toBe(true);
  return group!;
}

/** The id of the shape inside the nested group, from the live tree. */
function nestedMemberId(client: Peer): string {
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

/** The fill colours both shapes paint, in paint order. */
function fills(client: Peer): (string | null)[] {
  return (groupRecords(client)[0]?.vectorShape?.components ?? []).map((c) => c.fillHex);
}

async function saved(client: Peer): Promise<{ fingerprint: string; xml: string }> {
  const loaded = readOoxmlPackage(new Uint8Array(await client.editor.save()));
  if (!loaded.ok) throw new Error(loaded.reason);
  const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  return { fingerprint: canonicalOoxmlFingerprint(part), xml: serializeOoxmlPart(part) };
}

async function converged(a: Peer, b: Peer): Promise<string> {
  const [left, right] = await Promise.all([saved(a), saved(b)]);
  expect(left.fingerprint).toBe(right.fingerprint);
  expect(fills(a)).toEqual(fills(b));
  return left.xml;
}

test('two editors converge on an edit to a shape inside a nested group', async () => {
  const a = await peer('Alice'),
    b = await peer('Bob', a);
  try {
    // Both peers paint the direct shape and the nested one.
    expect(fills(a)).toEqual(['1F3864', 'D9E2F3']);
    expect(fills(b)).toEqual(['1F3864', 'D9E2F3']);
    // Alice selects the nested shape and recolours it alone; Bob recolours the whole group.
    selectGroup(a);
    selectGroup(b);
    expect(a.editor.surface!.selectDrawingMember(nestedMemberId(a))).toBe(true);
    expect(a.editor.exec({ type: 'setShapeFill', color: 'FF0000' })).toMatchObject({ ok: true });
    expect(b.editor.exec({ type: 'setShapeFill', color: '00B050' })).toMatchObject({ ok: true });
    sync(a, b);
    const xml = await converged(a, b);
    expect(xml).toContain('<wpg:grpSp>');
    expect(fills(a)).toHaveLength(2);
    // Undo and redo travel.
    expect(a.editor.exec({ type: 'undo' })).toMatchObject({ ok: true });
    sync(a, b);
    await converged(a, b);
    expect(a.editor.exec({ type: 'redo' })).toMatchObject({ ok: true });
    sync(a, b);
    await converged(a, b);
    // Bob deletes the group while Alice recolours the nested shape; then he undoes the delete.
    selectGroup(a);
    selectGroup(b);
    expect(a.editor.surface!.selectDrawingMember(nestedMemberId(a))).toBe(true);
    expect(b.editor.exec({ type: 'deleteImage' })).toMatchObject({ ok: true });
    expect(a.editor.exec({ type: 'setShapeFill', color: '7030A0' })).toMatchObject({ ok: true });
    sync(a, b);
    await converged(a, b);
    expect(b.editor.exec({ type: 'undo' })).toMatchObject({ ok: true });
    sync(a, b);
    const restored = await converged(a, b);
    expect(restored).toContain('<wpg:grpSp>');
    expect(fills(a)).toHaveLength(2);
  } finally {
    a.destroy();
    b.destroy();
  }
});
