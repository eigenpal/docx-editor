/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { strToU8, unzipSync, zipSync } from 'fflate';
import { afterEach, expect, test } from 'bun:test';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import {
  createDocxEditor,
  computeImageResizeResult,
  selectedDrawingOverlayTargetOf,
} from '@docx-editor.dev/core/editor';
import { caretAt, type SemanticLayout } from '@docx-editor.dev/core/layout';
import { writeOoxmlPackage } from '@docx-editor.dev/core/store';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

const harness = createPeerHarness('rotated-picture-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});
function rotatedDocument(): Uint8Array {
  const entries = unzipSync(
    zipDocument('', {
      overrides: '<Default Extension="png" ContentType="image/png"/>',
      documentRels:
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>',
    })
  );
  entries['word/document.xml'] = strToU8(
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:r><w:t>A</w:t></w:r><w:r><w:drawing><wp:inline><wp:extent cx="381000" cy="1143000"/><wp:effectExtent l="12700" t="25400" r="38100" b="50800"/><wp:docPr id="1" name="Picture"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="Picture"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:srcRect l="10000"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm rot="5400000"><a:ext cx="381000" cy="1143000"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r><w:r><w:t>B</w:t></w:r></w:p><w:p><w:r><w:t>Tail</w:t></w:r></w:p></w:body></w:document>`
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
test('inline rotated pictures converge through typing, history, conflicts, reconnect, and reopen', async () => {
  const peers = await harness.pair(rotatedDocument());
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
  expect(targetBlock.lines[0]!.drawings![0]!.width).toBe(90);
  expect(targetBlock.lines[0]!.drawings![0]!.height).toBe(30);
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

test('rotated picture resize and wrap roundtrips converge without changing visible extent', async () => {
  const peers = await harness.pair(rotatedDocument());
  const [alice, bob] = [peers.alice, peers.bob].map((peer) => {
    peer.detach();
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
    editors.push(editor);
    return editor;
  }) as [Editor, Editor];
  const paragraph = alice.surface!.layout().pages[0]!.fragments[0]!;
  if (paragraph.kind !== 'paragraph') throw Error('Missing paragraph');
  const select = (editor: Editor, offset = 1) =>
    editor.surface!.setSelection({
      anchor: { paragraphId: paragraph.paragraphId, offset },
      head: { paragraphId: paragraph.paragraphId, offset },
    });
  const flush = () => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
  };
  const converge = () => {
    flush();
    expect(packageFingerprint(alice.surface!.session.currentPackage())).toBe(
      packageFingerprint(bob.surface!.session.currentPackage())
    );
    select(alice);
    select(bob);
    const left = selectedDrawingOverlayTargetOf(alice.surface)!;
    const right = selectedDrawingOverlayTargetOf(bob.surface)!;
    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
    expect(left).toEqual(right);
    const reopened = createDocxEditor({
      container: document.createElement('div'),
      document: writeOoxmlPackage(alice.surface!.session.currentPackage()),
    });
    try {
      const first = reopened.surface!.layout().pages[0]!.fragments[0]!;
      if (first.kind !== 'paragraph') throw Error('Missing reopened paragraph');
      reopened.surface!.setSelection({
        anchor: { paragraphId: first.paragraphId, offset: 1 },
        head: { paragraphId: first.paragraphId, offset: 1 },
      });
      const saved = selectedDrawingOverlayTargetOf(reopened.surface)!;
      expect({ width: saved.width, height: saved.height }).toEqual({
        width: left.width,
        height: left.height,
      });
    } finally {
      reopened.destroy();
    }
    return left;
  };
  const initial = converge();
  const beforeStale = packageFingerprint(alice.surface!.session.currentPackage());
  expect(
    alice.exec({ type: 'setImageWrapType', target: 'square', drawingNodeId: 'stale' }).ok
  ).toBe(false);
  expect(packageFingerprint(alice.surface!.session.currentPackage())).toBe(beforeStale);
  const resize = computeImageResizeResult({
    handle: 'e',
    startWidthEmu: initial.widthEmu,
    startHeightEmu: initial.heightEmu,
    startBounds: initial,
    startPosition: initial.position,
    transform: initial.transform,
    kind: initial.kind,
    preserveAspect: false,
    deltaXPt: 10,
    deltaYPt: 0,
  });
  expect(
    alice.exec({
      type: 'setImageProperties',
      widthEmu: resize.widthEmu,
      heightEmu: resize.heightEmu,
    }).ok
  ).toBe(true);
  const resized = converge();
  expect(resized.width).toBeCloseTo(resize.previewBounds.width, 5);
  expect(resized.height).toBeCloseTo(resize.previewBounds.height, 5);
  peers.pause();
  expect(alice.exec({ type: 'setImageWrapType', target: 'square' }).ok).toBe(true);
  select(bob, 3);
  bob.surface!.type(' concurrent');
  flush();
  peers.resume();
  const floated = converge();
  expect(floated.kind).toBe('anchored');
  expect(floated.width).toBe(resized.width);
  expect(floated.height).toBe(resized.height);
  expect(alice.exec({ type: 'setImageProperties', wrap: 'inline' }).ok).toBe(true);
  const returned = converge();
  expect(returned.kind).toBe('inline');
  expect(returned.width).toBe(resized.width);
  expect(returned.height).toBe(resized.height);
  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  converge();
  expect(alice.exec({ type: 'redo' }).ok).toBe(true);
  converge();
  expect(alice.exec({ type: 'setImageProperties', wrap: 'square', widthEmu: 12700 * 120 }).ok).toBe(
    true
  );
  const explicit = converge();
  expect(explicit.widthEmu).toBe(12700 * 120);
  expect(explicit.heightEmu).toBe(12700 * 30);
  expect(
    alice.exec({ type: 'setImageProperties', wrap: 'inline', heightEmu: 12700 * 110 }).ok
  ).toBe(true);
  const explicitInline = converge();
  expect(explicitInline.widthEmu).toBe(12700 * 30);
  expect(explicitInline.heightEmu).toBe(12700 * 110);
});

test('locked rotated pictures refuse wrap extent changes without partial mutation', () => {
  const entries = unzipSync(rotatedDocument());
  entries['word/document.xml'] = strToU8(
    new TextDecoder()
      .decode(entries['word/document.xml'])
      .replace(
        '<wp:docPr id="1" name="Picture"/>',
        '<wp:docPr id="1" name="Picture"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noResize="1"/></wp:cNvGraphicFramePr>'
      )
  );
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: zipSync(entries),
  });
  editors.push(editor);
  const first = editor.surface!.layout().pages[0]!.fragments[0]!;
  if (first.kind !== 'paragraph') throw Error('Missing paragraph');
  editor.surface!.setSelection({
    anchor: { paragraphId: first.paragraphId, offset: 1 },
    head: { paragraphId: first.paragraphId, offset: 1 },
  });
  const before = packageFingerprint(editor.surface!.session.currentPackage());
  expect(editor.can({ type: 'setImageWrapType', target: 'square' }).ok).toBe(false);
  expect(editor.exec({ type: 'setImageWrapType', target: 'square' })).toMatchObject({
    ok: false,
    code: 'locked',
  });
  expect(editor.exec({ type: 'setImageProperties', wrap: 'square' })).toMatchObject({
    ok: false,
    code: 'locked',
  });
  expect(packageFingerprint(editor.surface!.session.currentPackage())).toBe(before);
});
