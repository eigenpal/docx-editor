/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Shapes and groups selected as objects, in two editors on one room: a selected shape shows
// as the peer's caret at its anchor, and a delete, a move and undo converge with concurrent
// edits. `wp:anchor/@locked` survives every round trip.
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('shape-selection-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});

const EMU = 12_700;
const NAMESPACES =
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" ' +
  'xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"';
const rect = (cx: number, cy: number, x: number, fill: string) =>
  `<wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="${x}" y="0"/>` +
  `<a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
  `<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill></wps:spPr><wps:bodyPr/></wps:wsp>`;

function anchored(options: {
  id: number;
  name: string;
  y: number;
  behind: boolean;
  locked: boolean;
  graphicData: string;
}): string {
  return (
    `<w:r><w:drawing ${NAMESPACES}><wp:anchor distT="0" distB="0" distL="0" distR="0" ` +
    `simplePos="0" relativeHeight="${options.id}" behindDoc="${options.behind ? 1 : 0}" ` +
    `locked="${options.locked ? 1 : 0}" layoutInCell="1" allowOverlap="1">` +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="margin"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
    `<wp:positionV relativeFrom="margin"><wp:posOffset>${options.y}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${300 * EMU}" cy="${40 * EMU}"/><wp:wrapNone/>` +
    `<wp:docPr id="${options.id}" name="${options.name}"/><wp:cNvGraphicFramePr/>` +
    `<a:graphic>${options.graphicData}</a:graphic></wp:anchor></w:drawing></w:r>`
  );
}

const BACKGROUND = anchored({
  id: 1,
  name: 'Background',
  y: 0,
  behind: true,
  locked: true,
  graphicData:
    '<a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
    `${rect(300 * EMU, 40 * EMU, 0, 'FFE699')}</a:graphicData>`,
});
const GROUP = anchored({
  id: 2,
  name: 'Pair',
  y: 200 * EMU,
  behind: false,
  locked: false,
  graphicData:
    '<a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup">' +
    '<wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr><a:xfrm><a:off x="0" y="0"/>' +
    `<a:ext cx="${300 * EMU}" cy="${40 * EMU}"/><a:chOff x="0" y="0"/>` +
    `<a:chExt cx="${300 * EMU}" cy="${40 * EMU}"/></a:xfrm></wpg:grpSpPr>` +
    rect(150 * EMU, 40 * EMU, 0, '9DC3E6') +
    rect(150 * EMU, 40 * EMU, 150 * EMU, 'A9D18E') +
    '</wpg:wgp></a:graphicData>',
});
const BODY =
  `<w:p>${BACKGROUND}<w:r><w:t>Banner text</w:t></w:r></w:p>` +
  `<w:p>${GROUP}<w:r><w:t>Group anchor</w:t></w:r></w:p>` +
  [1, 2, 3].map((n) => `<w:p><w:r><w:t>Paragraph ${n}.</w:t></w:r></w:p>`).join('') +
  '<w:sectPr/>';

function mount(
  document_: Uint8Array,
  session: Parameters<typeof collaborationModule>[0]['session']
) {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: document_,
    modules: [collaborationModule({ session })],
  });
  editors.push(editor);
  return editor;
}

async function pair() {
  const peers = await harness.pair(zipDocument(BODY));
  const [alice, bob] = [peers.alice, peers.bob].map((peer) => {
    peer.detach();
    return mount(peer.room.document, peer.room.session);
  }) as [Editor, Editor];
  function sync() {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
  }
  function converged() {
    sync();
    alice.surface!.layout();
    bob.surface!.layout();
    const left = alice.surface!.session.currentPackage();
    const right = bob.surface!.session.currentPackage();
    expect(packageFingerprint(right)).toBe(packageFingerprint(left));
    expect(saveReopenDigest(right)).toEqual(saveReopenDigest(left));
  }
  return { peers, alice, bob, sync, converged };
}

/** The drawing whose `relativeHeight` is `id`, or null once it is gone. */
function drawing(editor: Editor, id: number) {
  for (const page of editor.surface!.layout().pages)
    for (const record of page.anchoredDrawings ?? [])
      if (record.relativeHeight === id) return record;
  return null;
}

function select(editor: Editor, id: number): void {
  const record = drawing(editor, id)!;
  expect(editor.surface!.selectDrawing(record.drawingNodeId, record.anchorParagraphId)).toBe(true);
  expect(editor.getSelectedImage!()).toMatchObject({ id: record.drawingNodeId, canMove: true });
}

async function documentXml(editor: Editor): Promise<string> {
  const bytes = new Uint8Array(await editor.save());
  const { unzipSync, strFromU8 } = await import('fflate');
  return strFromU8(unzipSync(bytes)['word/document.xml']!);
}

test('a selected shape shows the peer a caret at its anchor', async () => {
  const { peers, alice, bob } = await pair();
  select(alice, 1);
  applyAwarenessUpdate(
    peers.bob.awareness,
    encodeAwarenessUpdate(peers.alice.awareness, [peers.alice.ydoc.clientID]),
    'test'
  );
  const remote = peers.bob.room.session.remoteSelections()[0]!;
  expect(remote.head.nodeId).toBe(drawing(bob, 1)!.anchorParagraphId);
  expect(remote.anchor.nodeId).toBe(remote.head.nodeId);
});

test('a shape deleted while the peer types in its paragraph converges and undoes', async () => {
  const { peers, alice, bob, sync, converged } = await pair();
  const anchor = drawing(bob, 1)!.anchorParagraphId;
  select(alice, 1);
  peers.pause();
  expect(alice.exec({ type: 'deleteImage' })).toMatchObject({ ok: true, changed: true });
  bob.surface!.setSelection({
    anchor: { paragraphId: anchor, offset: 1 },
    head: { paragraphId: anchor, offset: 1 },
  });
  bob.surface!.type('Typed ');
  sync();
  peers.resume();
  converged();
  expect(drawing(bob, 1)).toBeNull();
  expect(bob.findMatches('Typed')).toHaveLength(1);
  expect(alice.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
  converged();
  expect(drawing(bob, 1)).not.toBeNull();
  const xml = await documentXml(bob);
  expect(xml).toContain('name="Background"');
  expect(xml).toContain('locked="1"');
  expect(alice.exec({ type: 'redo' })).toMatchObject({ ok: true, changed: true });
  converged();
  expect(drawing(bob, 1)).toBeNull();
});

test('a group moved by one peer and deleted by the other converges once', async () => {
  const { peers, alice, bob, sync, converged } = await pair();
  select(alice, 2);
  select(bob, 2);
  peers.pause();
  expect(alice.exec({ type: 'setImagePosition', verticalEmu: 260 * EMU })).toMatchObject({
    ok: true,
  });
  expect(bob.exec({ type: 'deleteImage' })).toMatchObject({ ok: true, changed: true });
  sync();
  peers.resume();
  converged();
  const left = alice.surface!.layout().pages.flatMap((page) => page.anchoredDrawings ?? []);
  expect(left.filter((record) => record.relativeHeight === 2).length).toBeLessThanOrEqual(1);
});

test('a moved locked shape keeps its anchor paragraph on both peers', async () => {
  const { alice, bob, converged } = await pair();
  const anchor = drawing(alice, 1)!.anchorParagraphId;
  select(alice, 1);
  expect(alice.exec({ type: 'setImagePosition', verticalEmu: 300 * EMU })).toMatchObject({
    ok: true,
  });
  converged();
  const moved = drawing(bob, 1)!;
  expect(moved.anchorParagraphId).toBe(anchor);
  expect(moved.y).toBeGreaterThan(250);
});
