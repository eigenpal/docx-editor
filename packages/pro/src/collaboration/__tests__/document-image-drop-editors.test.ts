/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, expect, test } from 'bun:test';
import { unzipSync, strFromU8 } from 'fflate';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { caretAt } from '@docx-editor.dev/core/layout';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('image-drop-editors', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const opened: { editor: Editor; container: HTMLElement }[] = [];
const png = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (char) => char.charCodeAt(0)
);
const image = {
  type: 'insertImage' as const,
  data: png,
  mime: 'image/png' as const,
  widthPoints: 12,
  heightPoints: 12,
};
const source = () =>
  zipDocument(
    '<w:p><w:r><w:t>Alpha</w:t></w:r></w:p>' + '<w:p><w:r><w:t>Bravo</w:t></w:r></w:p><w:sectPr/>'
  );

afterEach(() => {
  for (const { editor, container } of opened.splice(0)) {
    editor.destroy();
    container.remove();
  }
  harness.cleanup();
});

function open(peer: Peer): Editor {
  peer.detach();
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: peer.room.document,
    imageDecodePort: {
      decode: async () => ({ pixelWidth: 1, pixelHeight: 1, dpiX: 96, dpiY: 96 }),
    },
    modules: [collaborationModule({ session: peer.room.session })],
  });
  opened.push({ editor, container });
  return editor;
}

function select(editor: Editor, paragraph: number, offset: number, end = offset) {
  const paragraphId = editor.surface!.session.paragraphIds()[paragraph]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset },
    head: { paragraphId, offset: end },
  });
}

function point(editor: Editor, paragraph: number, offset: number) {
  const surface = editor.surface!;
  const paragraphId = surface.session.paragraphIds()[paragraph]!;
  const layout = surface.layout();
  const caret = caretAt(layout, { paragraphId, offset })!;
  const page = layout.pages[caret.pageIndex]!;
  const { paintScale, pageOffsetX } = surface.overlayCoordinates();
  const position = editor.positionAtPoint(
    (page.contentBox.x + (pageOffsetX.get(page.index) ?? 0) + caret.x) * paintScale,
    (page.contentBox.y + caret.y + caret.height / 2) * paintScale
  );
  expect(position).toMatchObject({ paragraphId, offset });
  return position!;
}

test('pointer image targets converge through concurrent edits, history, presence, reconnect, and reopen', async () => {
  const peers = await harness.pair(source());
  const alice = open(peers.alice);
  const bob = open(peers.bob);
  const same = () => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
    const left = alice.surface!.session.currentPackage();
    const right = bob.surface!.session.currentPackage();
    expect(packageFingerprint(left)).toBe(packageFingerprint(right));
    expect(saveReopenDigest(left)).toEqual(saveReopenDigest(right));
  };

  peers.pause();
  const target = point(alice, 1, 2);
  select(alice, 0, 0);
  expect((await alice.executeImageCommand({ ...image, at: target })).ok).toBe(true);
  select(bob, 0, 0);
  expect(bob.exec({ type: 'insertText', text: 'B' }).ok).toBe(true);
  peers.resume();
  same();
  expect(alice.surface!.session.bodyText()).toBe('BAlpha\nBr\uFFFCavo');
  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  same();
  expect(bob.surface!.session.bodyText()).toBe('BAlpha\nBravo');
  expect(alice.exec({ type: 'redo' }).ok).toBe(true);
  same();

  const savedImageContainer = document.createElement('div');
  document.body.append(savedImageContainer);
  const savedImage = createDocxEditor({
    container: savedImageContainer,
    document: await alice.save(),
  });
  opened.push({ editor: savedImage, container: savedImageContainer });
  expect(savedImage.surface!.session.bodyText()).toBe('BAlpha\nBr\uFFFCavo');
  expect(savedImageContainer.querySelector('[data-drawing-node-id]')).not.toBeNull();

  select(alice, 1, 3);
  applyAwarenessUpdate(
    peers.bob.awareness,
    encodeAwarenessUpdate(peers.alice.awareness, [peers.alice.ydoc.clientID]),
    'test'
  );
  const remote = peers.bob.room.session.remoteSelections()[0]!;
  expect(
    caretAt(bob.surface!.layout(), { paragraphId: remote.head.nodeId, offset: remote.head.offset })
  ).toEqual(caretAt(alice.surface!.layout(), alice.surface!.state().selection.head));

  peers.pause();
  select(alice, 1, 2, 3);
  expect(alice.exec({ type: 'deleteText' }).ok).toBe(true);
  select(bob, 1, 0);
  expect(bob.exec({ type: 'insertText', text: 'C' }).ok).toBe(true);
  peers.resume();
  same();
  expect(bob.surface!.session.bodyText()).toBe('BAlpha\nCBravo');

  const saved = await alice.save();
  const container = document.createElement('div');
  document.body.append(container);
  const reopened = createDocxEditor({ container, document: saved });
  opened.push({ editor: reopened, container });
  expect(reopened.surface!.session.bodyText()).toBe(alice.surface!.session.bodyText());
  bob.destroy();
  harness.leave(peers.bob);
  const joined = open(await harness.join(peers.alice, 'joined'));
  expect(packageFingerprint(joined.surface!.session.currentPackage())).toBe(
    packageFingerprint(alice.surface!.session.currentPackage())
  );
});

test('a remote edit invalidates an image target before asynchronous file reading finishes', async () => {
  const peers = await harness.pair(source());
  const alice = open(peers.alice);
  const bob = open(peers.bob);
  const target = point(alice, 1, 2);
  select(bob, 1, 0, 5);
  expect(bob.exec({ type: 'deleteText' }).ok).toBe(true);
  peers.bob.room.session.flushPendingJournals();
  const before = packageFingerprint(alice.surface!.session.currentPackage());
  expect((await alice.executeImageCommand({ ...image, at: target })).ok).toBe(false);
  expect(packageFingerprint(alice.surface!.session.currentPackage())).toBe(before);
});

test('inline image moves retain one identity through concurrent moves, history, and reconnect', async () => {
  const peers = await harness.pair(source());
  const alice = open(peers.alice);
  const bob = open(peers.bob);
  select(alice, 0, 1);
  expect((await alice.executeImageCommand(image)).ok).toBe(true);
  peers.alice.room.session.flushPendingJournals();
  const move = (editor: Editor, paragraph: number, offset: number) =>
    editor.surface!.applyDrawingOps([
      {
        op: 'moveInlineDrawing',
        drawingNodeId: opened
          .find((item) => item.editor === editor)!
          .container.querySelector('[data-drawing-node-id]')!
          .getAttribute('data-drawing-node-id')!,
        paragraphId: editor.surface!.session.paragraphIds()[paragraph]!,
        offset,
      },
    ]);
  const same = () => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
    expect(packageFingerprint(alice.surface!.session.currentPackage())).toBe(
      packageFingerprint(bob.surface!.session.currentPackage())
    );
    expect(saveReopenDigest(alice.surface!.session.currentPackage())).toEqual(
      saveReopenDigest(bob.surface!.session.currentPackage())
    );
    expect(alice.surface!.session.bodyText().split('\uFFFC')).toHaveLength(2);
  };
  expect(move(alice, 1, 2).committed).toBe(true);
  same();
  expect(bob.surface!.session.bodyText()).toBe('Alpha\nBr\uFFFCavo');
  select(alice, 1, 3);
  applyAwarenessUpdate(
    peers.bob.awareness,
    encodeAwarenessUpdate(peers.alice.awareness, [peers.alice.ydoc.clientID]),
    'test'
  );
  const remote = peers.bob.room.session.remoteSelections()[0]!;
  expect(
    caretAt(bob.surface!.layout(), { paragraphId: remote.head.nodeId, offset: remote.head.offset })
  ).toEqual(caretAt(alice.surface!.layout(), alice.surface!.state().selection.head));
  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  same();
  expect(bob.surface!.session.bodyText()).toBe('A\uFFFClpha\nBravo');
  expect(alice.exec({ type: 'redo' }).ok).toBe(true);
  same();
  peers.pause();
  expect(move(alice, 0, 3).committed).toBe(true);
  expect(move(bob, 1, 5).committed).toBe(true);
  peers.resume();
  same();
  const container = document.createElement('div');
  document.body.append(container);
  const saved = createDocxEditor({ container, document: await alice.save() });
  opened.push({ editor: saved, container });
  expect(saved.surface!.session.bodyText()).toBe(alice.surface!.session.bodyText());
  bob.destroy();
  harness.leave(peers.bob);
  const joined = open(await harness.join(peers.alice, 'joined'));
  expect(packageFingerprint(joined.surface!.session.currentPackage())).toBe(
    packageFingerprint(alice.surface!.session.currentPackage())
  );
});

test('concurrent image movement and deletion converge without duplicating the image', async () => {
  const peers = await harness.pair(source());
  const alice = open(peers.alice);
  const bob = open(peers.bob);
  select(alice, 0, 1);
  expect((await alice.executeImageCommand(image)).ok).toBe(true);
  peers.alice.room.session.flushPendingJournals();
  const drawingId = opened[0]!.container
    .querySelector('[data-drawing-node-id]')!
    .getAttribute('data-drawing-node-id')!;
  peers.pause();
  expect(
    alice.surface!.applyDrawingOps([
      {
        op: 'moveInlineDrawing',
        drawingNodeId: drawingId,
        paragraphId: alice.surface!.session.paragraphIds()[1]!,
        offset: 2,
      },
    ]).committed
  ).toBe(true);
  expect(
    bob.surface!.applyDrawingOps([
      {
        op: 'deleteDrawing',
        drawingNodeId: opened[1]!.container
          .querySelector('[data-drawing-node-id]')!
          .getAttribute('data-drawing-node-id')!,
      },
    ]).committed
  ).toBe(true);
  peers.resume();
  peers.alice.room.session.flushPendingJournals();
  peers.bob.room.session.flushPendingJournals();
  expect(packageFingerprint(alice.surface!.session.currentPackage())).toBe(
    packageFingerprint(bob.surface!.session.currentPackage())
  );
  expect(saveReopenDigest(alice.surface!.session.currentPackage())).toEqual(
    saveReopenDigest(bob.surface!.session.currentPackage())
  );
  expect(alice.surface!.session.bodyText().split('\uFFFC').length).toBeLessThanOrEqual(2);
});

test('an image move keeps concurrent metadata edits', async () => {
  const peers = await harness.pair(source());
  const alice = open(peers.alice);
  const bob = open(peers.bob);
  select(alice, 0, 1);
  expect((await alice.executeImageCommand(image)).ok).toBe(true);
  peers.alice.room.session.flushPendingJournals();
  const id = (index: number) =>
    opened[index]!.container.querySelector('[data-drawing-node-id]')!.getAttribute(
      'data-drawing-node-id'
    )!;
  peers.pause();
  expect(
    alice.surface!.applyDrawingOps([
      {
        op: 'moveInlineDrawing',
        drawingNodeId: id(0),
        paragraphId: alice.surface!.session.paragraphIds()[1]!,
        offset: 2,
      },
    ]).committed
  ).toBe(true);
  expect(
    bob.surface!.applyDrawingOps([
      {
        op: 'setDrawingMetadata',
        drawingNodeId: id(1),
        title: 'Shared title',
        description: 'Shared description',
      },
    ]).committed
  ).toBe(true);
  peers.resume();
  peers.alice.room.session.flushPendingJournals();
  peers.bob.room.session.flushPendingJournals();
  expect(packageFingerprint(alice.surface!.session.currentPackage())).toBe(
    packageFingerprint(bob.surface!.session.currentPackage())
  );
  expect(alice.surface!.session.bodyText()).toBe('Alpha\nBr\uFFFCavo');
  const xml = strFromU8(unzipSync(new Uint8Array(await alice.save()))['word/document.xml']!);
  expect(xml).toContain('Shared title');
  expect(xml).toContain('Shared description');
});
