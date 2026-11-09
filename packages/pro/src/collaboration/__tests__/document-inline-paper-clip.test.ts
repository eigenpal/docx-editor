/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { strToU8, unzipSync, zipSync } from 'fflate';
import { afterEach, expect, test } from 'bun:test';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { caretAt, type SemanticLayout } from '@docx-editor.dev/core/layout';
import { writeOoxmlPackage } from '@docx-editor.dev/core/store';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

const harness = createPeerHarness('body-inline-paper-clip-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});
function wideDocument(): Uint8Array {
  const entries = unzipSync(
    zipDocument('', {
      overrides: '<Default Extension="png" ContentType="image/png"/>',
      documentRels:
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>',
    })
  );
  entries['word/document.xml'] = strToU8(
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:r><w:t>A</w:t></w:r><w:r><w:drawing><wp:inline><wp:extent cx="2159000" cy="457200"/><wp:docPr id="1" name="Picture"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="Picture"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:ext cx="2159000" cy="457200"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r><w:r><w:t>B</w:t></w:r></w:p><w:p><w:r><w:t>Tail</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="4000" w:h="6000"/><w:pgMar w:top="400" w:right="400" w:bottom="400" w:left="400"/></w:sectPr></w:body></w:document>`
  );
  entries['word/media/image1.png'] = Uint8Array.from(
    atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII='
    ),
    (c) => c.charCodeAt(0)
  );
  return zipSync(entries);
}
const geometry = (layout: SemanticLayout) => layout.pages.map((page) => page.fragments);
// Saving assigns source addresses again after structural edits. Compare every other layout field.
const savedGeometry = (layout: SemanticLayout) =>
  JSON.parse(
    JSON.stringify(geometry(layout), (key, value) =>
      key === 'id' || key.endsWith('Id') ? undefined : value
    )
  );
test('body inline margin pictures converge through edits, history, conflicts, and reopen', async () => {
  const peers = await harness.pair(wideDocument());
  const mounted = [peers.alice, peers.bob].map((peer) => {
    peer.detach();
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
    editors.push(editor);
    return editor;
  });
  const [alice, bob] = mounted as [Editor, Editor];
  const surface = (editor: Editor) => editor.surface!;
  const targetBlock = surface(alice).layout().pages[0]!.fragments[0]!;
  if (targetBlock.kind !== 'paragraph') throw Error('Missing picture paragraph');
  const target = targetBlock.paragraphId;
  const select = (editor: Editor, offset: number, head = offset) =>
    surface(editor).setSelection({
      anchor: { paragraphId: target, offset },
      head: { paragraphId: target, offset: head },
    });
  const flush = () => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
  };
  const converge = (verifyReopen = true) => {
    flush();
    const left = surface(alice).session.currentPackage();
    const right = surface(bob).session.currentPackage();
    expect(packageFingerprint(left)).toBe(packageFingerprint(right));
    expect(geometry(surface(alice).layout())).toEqual(geometry(surface(bob).layout()));
    if (!verifyReopen) return;
    expect(saveReopenDigest(left)).toEqual(saveReopenDigest(right));
    const reopened = createDocxEditor({
      container: document.createElement('div'),
      document: writeOoxmlPackage(left),
    });
    try {
      expect(savedGeometry(surface(alice).layout())).toEqual(
        savedGeometry(surface(reopened).layout())
      );
    } finally {
      reopened.destroy();
    }
  };
  const originalFingerprint = packageFingerprint(surface(alice).session.currentPackage());
  const picture = targetBlock.lines.flatMap((line) => line.drawings ?? [])[0]!;
  expect(picture.width).toBe(170);
  expect(picture.paintBounds.width).toBe(170);
  expect(picture.paintBounds.x + picture.paintBounds.width).toBeGreaterThan(160);
  expect(picture.paintBounds.x + picture.paintBounds.width).toBeLessThanOrEqual(180);
  expect(picture.hitBounds).toEqual(picture.paintBounds);
  expect(picture.geometry.paintBounds).toEqual(picture.paintBounds);
  expect(picture.height).toBe(36);
  select(alice, 3);
  surface(alice).type(' More words after the picture');
  converge();
  applyAwarenessUpdate(
    peers.bob.awareness,
    encodeAwarenessUpdate(peers.alice.awareness, [peers.alice.ydoc.clientID]),
    'test'
  );
  const remote = peers.bob.room.session.remoteSelections()[0]!;
  expect(
    caretAt(surface(bob).layout(), { paragraphId: remote.head.nodeId, offset: remote.head.offset })
  ).toEqual(caretAt(surface(alice).layout(), surface(alice).state().selection.head));
  let undoCount = 0;
  while (packageFingerprint(surface(alice).session.currentPackage()) !== originalFingerprint) {
    expect(undoCount++).toBeLessThan(10);
    expect(alice.exec({ type: 'undo' }).ok).toBe(true);
    converge();
  }
  expect(geometry(surface(alice).layout())).toEqual(geometry(surface(bob).layout()));
  for (let index = 0; index < undoCount; index += 1) {
    expect(alice.exec({ type: 'redo' }).ok).toBe(true);
    converge();
  }
  // Delete the inline object while another participant edits its paragraph.
  peers.pause();
  select(alice, 1, 2);
  select(bob, 3);
  surface(alice).deleteBackward();
  surface(bob).type('Z');
  flush();
  peers.resume();
  converge();
  expect(bob.findMatches('Z')).toHaveLength(1);
  const fragment = surface(bob).layout().pages[0]!.fragments[0]!;
  if (fragment.kind !== 'paragraph') throw Error('Missing picture paragraph');
  expect(fragment.lines.flatMap((line) => line.drawings ?? [])).toHaveLength(0);
});
