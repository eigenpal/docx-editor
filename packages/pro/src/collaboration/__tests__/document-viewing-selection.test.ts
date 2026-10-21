/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Selection in viewing is local behaviour. A viewing peer that selects text publishes
// that range like any other selection, its selection follows the other peer's edits, and
// every write it tries stays refused, so both replicas converge on the editor's edits alone.

import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('viewing-selection', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
const containers: HTMLElement[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  for (const container of containers.splice(0)) container.remove();
  harness.cleanup();
});

function mount(options: Parameters<typeof createDocxEditor>[0]) {
  const container = document.createElement('div');
  document.body.append(container);
  containers.push(container);
  const editor = createDocxEditor({ ...options, container });
  editors.push(editor);
  return { editor, container };
}

function key(container: HTMLElement, init: KeyboardEventInit): void {
  container
    .querySelector('.docx-pages')!
    .dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
}

function caret(editor: Editor, paragraph: number, offset: number) {
  const position = { paragraphId: editor.surface!.session.paragraphIds()[paragraph]!, offset };
  editor.surface!.setSelection({ anchor: position, head: position });
}

function syncPresence(from: Peer, to: Peer) {
  const ids = [...from.awareness.getStates().keys()];
  applyAwarenessUpdate(to.awareness, encodeAwarenessUpdate(from.awareness, ids), 'relay');
}

const BODY =
  '<w:p><w:r><w:t xml:space="preserve">alpha beta</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t xml:space="preserve">gamma delta</w:t></w:r></w:p>';

/** Alice reads in viewing mode; Bob edits. */
async function peers() {
  const pair = await harness.pair(zipDocument(BODY));
  const open = (peer: Peer, viewer: boolean) => {
    peer.detach();
    return mount({
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
      ...(viewer ? { mode: 'view' as const } : {}),
    });
  };
  const alice = open(pair.alice, true);
  const bob = open(pair.bob, false);
  const converge = () => {
    pair.alice.room.session.flushPendingJournals();
    pair.bob.room.session.flushPendingJournals();
    expect(packageFingerprint(alice.editor.surface!.session.currentPackage())).toBe(
      packageFingerprint(bob.editor.surface!.session.currentPackage())
    );
  };
  return { pair, alice, bob, converge };
}

test('a viewing selection is published as that range', async () => {
  const { pair, alice } = await peers();
  caret(alice.editor, 0, 0);
  key(alice.container, { key: 'End', shiftKey: true });
  const { anchor, head } = alice.editor.surface!.state().selection;
  expect([anchor.offset, head.offset]).toEqual([0, 10]);
  expect(alice.editor.query({ type: 'selectedText' })).toBe('alpha beta');
  syncPresence(pair.alice, pair.bob);
  expect(pair.bob.room.session.remoteSelections()).toMatchObject([
    { actorId: expect.any(String), anchor: { offset: 0 }, head: { offset: 10 } },
  ]);
});

test('edits from the editing peer reach a viewer holding a selection, and its writes refuse', async () => {
  const { pair, alice, bob, converge } = await peers();
  caret(alice.editor, 1, 0);
  key(alice.container, { key: 'End', shiftKey: true });
  expect(alice.editor.query({ type: 'selectedText' })).toBe('gamma delta');

  pair.pause();
  caret(bob.editor, 1, 0);
  bob.editor.surface!.type('X');
  expect(alice.editor.exec({ type: 'toggleMark', mark: 'bold' })).toMatchObject({
    ok: false,
    code: 'locked',
  });
  key(alice.container, { key: 'Backspace' });
  alice.editor.surface!.type('Y');
  pair.alice.room.session.flushPendingJournals();
  pair.bob.room.session.flushPendingJournals();
  pair.resume();
  converge();
  expect(alice.editor.surface!.session.bodyText()).toBe('alpha beta\nXgamma delta');
  // The viewer's range followed the insertion in front of it.
  expect(alice.editor.query({ type: 'selectedText' })).toBe('gamma delta');

  // Undo and redo on the editing peer move the viewer's text too.
  expect(bob.editor.exec({ type: 'undo' }).ok).toBe(true);
  converge();
  expect(alice.editor.surface!.session.bodyText()).toBe('alpha beta\ngamma delta');
  expect(bob.editor.exec({ type: 'redo' }).ok).toBe(true);
  converge();

  const reopened = mount({ document: new Uint8Array(await bob.editor.save()) });
  expect(saveReopenDigest(reopened.editor.surface!.session.currentPackage())).toEqual(
    saveReopenDigest(alice.editor.surface!.session.currentPackage())
  );
});

test('the editing peer deletes the text a viewer has selected', async () => {
  const { pair, alice, bob, converge } = await peers();
  key(alice.container, { key: 'a', ctrlKey: true });
  expect(alice.editor.query({ type: 'selectedText' })).toBe('alpha beta\ngamma delta');

  const second = bob.editor.surface!.session.paragraphIds()[1]!;
  bob.editor.surface!.setSelection({
    anchor: { paragraphId: bob.editor.surface!.session.paragraphIds()[0]!, offset: 5 },
    head: { paragraphId: second, offset: 11 },
  });
  bob.editor.surface!.deleteSelection();
  converge();
  expect(alice.editor.surface!.session.bodyText()).toBe('alpha');
  // The viewer can still select what is left.
  key(alice.container, { key: 'a', ctrlKey: true });
  expect(alice.editor.query({ type: 'selectedText' })).toBe('alpha');
  syncPresence(pair.alice, pair.bob);
  expect(pair.bob.room.session.remoteSelections()).toMatchObject([
    { anchor: { offset: 0 }, head: { offset: 5 } },
  ]);
});
