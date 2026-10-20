/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('textbox-editor-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});
async function pair() {
  const peers = await harness.pair(zipDocument('<w:p><w:r><w:t>Body</w:t></w:r></w:p><w:sectPr/>'));
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
  async function join() {
    const peer = await harness.join(peers.alice, 'late-peer');
    peer.detach();
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
    editors.push(editor);
    return editor;
  }
  return { alice, bob, sync, converged, join, pause: peers.pause, resume: peers.resume };
}

test('textbox insertion, editing, formatting, geometry, deletion and undo replicate', async () => {
  const { alice, bob, converged } = await pair();
  expect(alice.exec({ type: 'insertTextBox' }).ok).toBe(true);
  converged();
  expect(alice.exec({ type: 'insertText', text: 'Shared box' }).ok).toBe(true);
  converged();
  expect(bob.findMatches('Shared box')).toHaveLength(1);
  alice.surface!.splitParagraph();
  alice.exec({ type: 'insertText', text: 'Second' });
  converged();
  alice.surface!.selectAll();
  expect(alice.exec({ type: 'toggleMark', mark: 'bold' }).ok).toBe(true);
  converged();
  expect(alice.surface!.pasteRich('Pasted\nText', null)).toBe(true);
  converged();
  expect(bob.findMatches('Pasted')).toHaveLength(1);
  const scope = alice.surface!.activeScope();
  expect(scope.kind).toBe('frame');
  if (scope.kind !== 'frame') throw new Error('Missing textbox scope');
  expect(alice.surface!.selectDrawing(scope.drawingNodeId, scope.hostParagraphId)).toBe(true);
  expect(
    alice.exec({ type: 'setImageProperties', widthEmu: 1828800, heightEmu: 914400 })
  ).toMatchObject({ ok: true });
  converged();
  expect(
    alice.exec({
      type: 'setImagePosition',
      horizontalEmu: 914400,
      verticalEmu: 914400,
      relativeToH: 'page',
      relativeToV: 'page',
    }).ok
  ).toBe(true);
  converged();
  expect(
    alice.exec({
      type: 'setImageProperties',
      title: 'Shared title',
      description: 'Shared description',
    }).ok
  ).toBe(true);
  converged();
  // Separate deletion from the session's five-second typing capture window.
  await new Promise((resolve) => setTimeout(resolve, 5100));
  expect(alice.exec({ type: 'deleteImage' }).ok).toBe(true);
  converged();
  expect(bob.findMatches('Pasted')).toHaveLength(0);
  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  converged();
  expect(bob.findMatches('Pasted')).toHaveLength(1);
  expect(alice.exec({ type: 'redo' }).ok).toBe(true);
  converged();
  expect(bob.findMatches('Pasted')).toHaveLength(0);
}, 10000);

test('concurrent textbox typing preserves both edits', async () => {
  const { alice, bob, sync, converged, pause, resume } = await pair();
  expect(alice.exec({ type: 'insertTextBox' }).ok).toBe(true);
  alice.exec({ type: 'insertText', text: 'Shared' });
  converged();
  expect(bob.surface!.setActiveScope(bob.findMatches('Shared')[0]!.scope!)).toBe(true);
  bob.surface!.setSelection({
    anchor: { ...bob.surface!.state().selection.head },
    head: { ...bob.surface!.state().selection.head },
  });
  pause();
  expect(alice.exec({ type: 'insertText', text: ' Alice' }).ok).toBe(true);
  expect(bob.exec({ type: 'insertText', text: ' Bob' }).ok).toBe(true);
  sync();
  resume();
  converged();
  expect(alice.findMatches('Alice')).toHaveLength(1);
  expect(alice.findMatches('Bob')).toHaveLength(1);
  expect(alice.findMatches('Alice')[0]!.scope?.kind).toBe('frame');
  expect(alice.findMatches('Bob')[0]!.scope?.kind).toBe('frame');
});

test('concurrent textbox insertion preserves separate editable stories', async () => {
  const { alice, bob, sync, converged, pause, resume } = await pair();
  pause();
  for (const [editor, text] of [
    [alice, 'Alice box'],
    [bob, 'Bob box'],
  ] as const) {
    expect(editor.exec({ type: 'insertTextBox' }).ok).toBe(true);
    expect(editor.exec({ type: 'insertText', text }).ok).toBe(true);
  }
  sync();
  resume();
  converged();
  for (const editor of [alice, bob]) {
    expect(editor.findMatches('Alice box')).toHaveLength(1);
    expect(editor.findMatches('Bob box')).toHaveLength(1);
    expect(editor.findMatches('Alice box')[0]!.scope).not.toEqual(
      editor.findMatches('Bob box')[0]!.scope
    );
  }
});

test('remote deletion exits an active textbox without leaving a stale editor', async () => {
  const { alice, bob, converged } = await pair();
  alice.exec({ type: 'insertTextBox' });
  alice.exec({ type: 'insertText', text: 'Delete me' });
  converged();
  expect(bob.surface!.setActiveScope(bob.findMatches('Delete me')[0]!.scope!)).toBe(true);
  const scope = alice.surface!.activeScope();
  if (scope.kind !== 'frame') throw new Error('Missing textbox');
  alice.surface!.selectDrawing(scope.drawingNodeId, scope.hostParagraphId);
  expect(alice.exec({ type: 'deleteImage' }).ok).toBe(true);
  converged();
  expect(bob.findMatches('Delete me')).toHaveLength(0);
  expect(bob.surface!.activeScope().kind).toBe('body');
  expect(bob.exec({ type: 'insertText', text: 'Still editable' }).ok).toBe(true);
  converged();
  expect(alice.findMatches('Still editable')).toHaveLength(1);
});

test('a late participant can edit a saved textbox story', async () => {
  const { alice, converged, join } = await pair();
  alice.exec({ type: 'insertTextBox' });
  alice.exec({ type: 'insertText', text: 'Existing textbox' });
  converged();
  const late = await join();
  expect(late.surface!.setActiveScope(late.findMatches('Existing textbox')[0]!.scope!)).toBe(true);
  expect(late.exec({ type: 'insertText', text: 'Joined ' }).ok).toBe(true);
  late.surface!.collaborationSession()!.flushPendingJournals();
  converged();
  expect(alice.findMatches('Joined Existing textbox')).toHaveLength(1);
  expect(saveReopenDigest(late.surface!.session.currentPackage())).toEqual(
    saveReopenDigest(alice.surface!.session.currentPackage())
  );
});
