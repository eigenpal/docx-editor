/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, expect, test } from 'bun:test';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { caretAt } from '@docx-editor.dev/core/layout';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('row-resize-minimum-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
const containers: HTMLElement[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  for (const container of containers.splice(0)) container.remove();
  harness.cleanup();
});
const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const row = (text: string) => `<w:tr><w:tc>${p(text)}</w:tc></w:tr>`;
const body =
  '<w:tbl><w:tblGrid><w:gridCol w:w="6000"/></w:tblGrid>' +
  row('First') +
  row('Second') +
  '</w:tbl>' +
  p('After');
const xml = (editor: Editor) => serializeOoxmlPart(editor.surface!.session.part());
const table = (editor: Editor) => {
  const result = editor
    .surface!.layout()
    .pages[0]!.fragments.find((block) => block.kind === 'table');
  if (!result || result.kind !== 'table') throw new Error('missing table');
  return result;
};
const pointer = (type: string, x: number, y: number, buttons = 0) =>
  new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons,
    pointerId: 1,
    pointerType: 'mouse',
    clientX: 100 + 72 + x,
    clientY: 50 + 72 + y,
  });

test('minimum row drag converges with a concurrent cell edit and supports undo and redo', async () => {
  const peers = await harness.pair(zipDocument(body));
  const [alice, bob] = [peers.alice, peers.bob].map((peer) => {
    peer.detach();
    const container = document.createElement('div');
    document.body.append(container);
    containers.push(container);
    const editor = createDocxEditor({
      container,
      zoom: 0.75,
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
    editors.push(editor);
    return editor;
  }) as [Editor, Editor];
  const sync = () => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
  };
  const converged = () => {
    sync();
    const left = alice.surface!.session.currentPackage();
    const right = bob.surface!.session.currentPackage();
    expect(packageFingerprint(right)).toBe(packageFingerprint(left));
    expect(saveReopenDigest(right)).toEqual(saveReopenDigest(left));
  };
  const pages = containers[0]!.querySelector<HTMLElement>('.docx-pages')!;
  Object.defineProperty(pages, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: 100,
      top: 50,
      right: 1100,
      bottom: 1050,
      width: 1000,
      height: 1000,
      x: 100,
      y: 50,
    }),
  });
  const before = table(alice);
  const resized = before.rows[1]!;
  const x = before.box.x + before.box.width / 4;
  const bottom = resized.box.y + resized.box.height;
  peers.pause();
  pages.dispatchEvent(pointer('pointermove', x, bottom));
  const handle = containers[0]!.querySelector<HTMLElement>('.docx-table-row-divider-handle');
  expect(handle).not.toBeNull();
  handle!.dispatchEvent(pointer('pointerdown', x, bottom));
  document.dispatchEvent(pointer('pointermove', x, bottom - 200, 1));
  document.dispatchEvent(pointer('pointerup', x, bottom - 200));
  expect(xml(alice)).toContain('w:val="160"');
  const block = table(bob).rows[1]!.cells[0]!.blocks[0]!;
  if (block.kind !== 'paragraph') throw new Error('missing cell paragraph');
  const position = { paragraphId: block.paragraphId, offset: 0 };
  bob.surface!.setSelection({ anchor: position, head: position });
  expect(bob.exec({ type: 'insertText', text: 'Remote ' }).ok).toBe(true);
  sync();
  peers.resume();
  converged();
  expect(table(bob).rows[1]!.box.height).toBeCloseTo(8);
  expect(xml(alice)).toContain('Remote ');
  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  converged();
  expect(xml(bob)).not.toContain('w:val="160"');
  expect(xml(bob)).toContain('Remote ');
  expect(alice.exec({ type: 'redo' }).ok).toBe(true);
  converged();
  expect(table(bob).rows[1]!.box.height).toBeCloseTo(8);
  // The 8pt exact row clips its text line. Check the visible caret after the table,
  // whose position changes with the resized row.
  const afterTable = alice
    .surface!.layout()
    .pages[0]!.fragments.find((fragment) => fragment.kind === 'paragraph');
  if (!afterTable || afterTable.kind !== 'paragraph') throw new Error('missing body paragraph');
  const visiblePosition = { paragraphId: afterTable.paragraphId, offset: 0 };
  alice.surface!.setSelection({ anchor: visiblePosition, head: visiblePosition });
  applyAwarenessUpdate(
    peers.bob.awareness,
    encodeAwarenessUpdate(peers.alice.awareness, [peers.alice.awareness.clientID]),
    'test'
  );
  const remote = peers.bob.room.session.remoteSelections()[0]!;
  expect(remote).toBeDefined();
  const localCaret = caretAt(alice.surface!.layout(), visiblePosition);
  expect(localCaret).not.toBeNull();
  expect(
    caretAt(bob.surface!.layout(), { paragraphId: remote.head.nodeId, offset: remote.head.offset })
  ).toEqual(localCaret);

  // A deletion and an insertion in the resized cell converge when delayed updates arrive.
  peers.pause();
  bob.surface!.setSelection({ anchor: position, head: { ...position, offset: 7 } });
  expect(bob.surface!.deleteSelection()).toBe(true);
  const end = { ...position, offset: 13 };
  alice.surface!.setSelection({ anchor: end, head: end });
  expect(alice.exec({ type: 'insertText', text: '!' }).ok).toBe(true);
  sync();
  peers.resume();
  converged();
  expect(xml(alice)).toContain('Second!');
  expect(xml(alice)).not.toContain('Remote ');
  const reopened = createDocxEditor({
    container: document.createElement('div'),
    document: await alice.save(),
  });
  editors.push(reopened);
  expect(table(reopened).rows[1]!.box.height).toBeCloseTo(8);
  expect(xml(reopened)).toContain('Second!');
});

test('hidden cell marks keep shared row geometry and remote caret positions', async () => {
  const documentBody =
    '<w:tbl><w:tblGrid><w:gridCol w:w="6000"/></w:tblGrid>' +
    '<w:tr><w:tc><w:tcPr><w:hideMark/></w:tcPr>' +
    p('Shared') +
    '<w:p/>' +
    '</w:tc></w:tr></w:tbl>' +
    p('After');
  const peers = await harness.pair(zipDocument(documentBody));
  const [alice, bob] = [peers.alice, peers.bob].map((peer) => {
    peer.detach();
    const container = document.createElement('div');
    document.body.append(container);
    containers.push(container);
    const editor = createDocxEditor({
      container,
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
    editors.push(editor);
    return editor;
  }) as [Editor, Editor];
  const cells = (editor: Editor) => table(editor).rows[0]!.cells[0]!.blocks;
  const textBlock = cells(alice)[0]!;
  const mark = cells(alice)[1]!;
  if (textBlock.kind !== 'paragraph' || mark.kind !== 'paragraph')
    throw new Error('missing paragraphs');
  const position = { paragraphId: textBlock.paragraphId, offset: 0 };
  const markPosition = { paragraphId: mark.paragraphId, offset: 0 };
  const verify = () => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
    expect(cells(alice)[1]!.box.height).toBe(0);
    expect(table(bob).rows[0]!.box).toEqual(table(alice).rows[0]!.box);
    expect(saveReopenDigest(bob.surface!.session.currentPackage())).toEqual(
      saveReopenDigest(alice.surface!.session.currentPackage())
    );
    alice.surface!.setSelection({ anchor: markPosition, head: markPosition });
    applyAwarenessUpdate(
      peers.bob.awareness,
      encodeAwarenessUpdate(peers.alice.awareness, [peers.alice.awareness.clientID]),
      'test'
    );
    const remote = peers.bob.room.session.remoteSelections()[0]!;
    const localCaret = caretAt(alice.surface!.layout(), markPosition);
    expect(localCaret).not.toBeNull();
    expect(
      caretAt(bob.surface!.layout(), {
        paragraphId: remote.head.nodeId,
        offset: remote.head.offset,
      })
    ).toEqual(localCaret);
  };
  verify();
  peers.pause();
  alice.surface!.setSelection({ anchor: position, head: position });
  expect(alice.exec({ type: 'insertText', text: 'New ' }).ok).toBe(true);
  bob.surface!.setSelection({ anchor: position, head: { ...position, offset: 1 } });
  expect(bob.surface!.deleteSelection()).toBe(true);
  peers.alice.room.session.flushPendingJournals();
  peers.bob.room.session.flushPendingJournals();
  peers.resume();
  verify();
  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  verify();
  expect(alice.exec({ type: 'redo' }).ok).toBe(true);
  verify();
});
