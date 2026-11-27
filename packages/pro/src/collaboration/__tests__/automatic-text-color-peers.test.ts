/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Automatic text (17.3.2.6 color, CT_Color) takes its colour from the text box fill
// (20.1.8.54 solidFill) and the cell shading (17.4.32 shd) on every peer. A fill edit, its undo,
// and a late join all paint the same colour.
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor, editSelectedShape } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('automatic-text-color-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
const containers = new WeakMap<Editor, HTMLElement>();
afterEach(() => {
  for (const editor of editors.splice(0)) {
    containers.get(editor)?.remove();
    editor.destroy();
  }
  harness.cleanup();
});

const NS =
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"';
const EMU = 12_700;
const BOX =
  `<w:drawing ${NS}><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ` +
  'relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
  '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0' +
  '</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0' +
  `</wp:posOffset></wp:positionV><wp:extent cx="${200 * EMU}" cy="${40 * EMU}"/>` +
  '<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="5" name="Box"/>' +
  '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
  '<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/>' +
  `<a:ext cx="${200 * EMU}" cy="${40 * EMU}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/>` +
  '</a:prstGeom><a:solidFill><a:srgbClr val="990033"/></a:solidFill><a:ln><a:noFill/></a:ln>' +
  '</wps:spPr><wps:txbx><w:txbxContent><w:p><w:r><w:t>Story</w:t></w:r></w:p></w:txbxContent>' +
  '</wps:txbx><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing>';
const CELL =
  '<w:tbl><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:tc><w:tcPr>' +
  '<w:tcW w:w="3000" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="000080"/>' +
  '</w:tcPr><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
const BODY = `<w:p><w:r>${BOX}<w:t>Body</w:t></w:r></w:p>${CELL}<w:p/><w:sectPr/>`;

function mount(document: Parameters<typeof createDocxEditor>[0]['document'], session: never) {
  const container = globalThis.document.createElement('div');
  globalThis.document.body.append(container);
  const editor = createDocxEditor({
    container,
    document,
    modules: [collaborationModule({ session })],
  });
  editors.push(editor);
  containers.set(editor, container);
  return editor;
}

/** The automatic colour the first painted text that holds `text` inherits. */
function textColor(editor: Editor, text: string): string {
  editor.surface!.layout();
  const span = [...containers.get(editor)!.querySelectorAll<HTMLElement>('span')].find(
    (item) => item.children.length === 0 && item.textContent?.includes(text)
  );
  expect(span).toBeDefined();
  for (let at: HTMLElement | null = span!; at; at = at.parentElement) {
    if (at.style.color) return at.style.color.toUpperCase();
  }
  return '#000000';
}

async function pair() {
  const peers = await harness.pair(zipDocument(BODY));
  const mounted = [peers.alice, peers.bob].map((peer) => {
    peer.detach();
    const editor = mount(peer.room.document, peer.room.session as never);
    return editor;
  });
  const [alice, bob] = mounted as [Editor, Editor];
  function converged() {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
    alice.surface!.layout();
    bob.surface!.layout();
    const left = alice.surface!.session.currentPackage();
    const right = bob.surface!.session.currentPackage();
    expect(packageFingerprint(right)).toBe(packageFingerprint(left));
    expect(saveReopenDigest(right)).toEqual(saveReopenDigest(left));
  }
  async function join() {
    const peer = await harness.join(peers.alice, 'late-peer');
    peer.detach();
    const editor = mount(peer.room.document, peer.room.session as never);
    return editor;
  }
  return { alice, bob, converged, join };
}

function selectBox(editor: Editor): void {
  const drawings = editor.surface!.layout().pages.flatMap((page) => page.anchoredDrawings ?? []);
  expect(drawings).toHaveLength(1);
  expect(editor.surface!.selectDrawing(drawings[0]!.drawingNodeId, drawings[0]!.paragraphId)).toBe(
    true
  );
}

test('peers paint automatic text from the box fill and the cell shading', async () => {
  const { alice, bob, converged, join } = await pair();
  for (const editor of [alice, bob]) {
    expect(textColor(editor, 'Story')).toBe('#FFFFFF');
    expect(textColor(editor, 'Cell')).toBe('#FFFFFF');
  }

  // Alice gives the box a light fill.
  selectBox(alice);
  expect(
    editSelectedShape(alice, alice.snapshot().image, { type: 'fillColor', color: '#FFFFFF' })
  ).toMatchObject({ ok: true, changed: true });
  converged();
  for (const editor of [alice, bob]) {
    expect(textColor(editor, 'Story')).toBe('#000000');
    expect(textColor(editor, 'Cell')).toBe('#FFFFFF');
  }

  // Undo restores the dark fill, and white automatic text, on both peers.
  expect(alice.exec({ type: 'undo' })).toMatchObject({ ok: true });
  converged();
  for (const editor of [alice, bob]) expect(textColor(editor, 'Story')).toBe('#FFFFFF');

  const late = await join();
  expect(textColor(late, 'Story')).toBe('#FFFFFF');
  expect(textColor(late, 'Cell')).toBe('#FFFFFF');
});
