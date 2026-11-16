/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A rich paste leaves the pasting peer's caret after the pasted content, and the other peer
// shows that caret there, under concurrent typing and deletion, undo and redo, and a reopen.

import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('rich-paste-caret', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
const containers: HTMLElement[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  for (const container of containers.splice(0)) container.remove();
  harness.cleanup();
});

const DOCUMENT = '<w:p><w:r><w:t xml:space="preserve">Hello world</w:t></w:r></w:p><w:sectPr/>';

async function pairOfEditors() {
  const pair = await harness.pair(zipDocument(DOCUMENT));
  const open = (peer: Peer, author: string) => {
    peer.detach();
    const container = document.createElement('div');
    document.body.append(container);
    containers.push(container);
    const editor = createDocxEditor({
      container,
      document: peer.room.document,
      author,
      modules: [collaborationModule({ session: peer.room.session })],
    });
    editors.push(editor);
    return editor;
  };
  const alice = open(pair.alice, 'Alice');
  const bob = open(pair.bob, 'Bob');
  const flush = () => {
    pair.alice.room.session.flushPendingJournals();
    pair.bob.room.session.flushPendingJournals();
  };
  const converge = (text: string) => {
    flush();
    expect(packageFingerprint(alice.surface!.session.currentPackage())).toBe(
      packageFingerprint(bob.surface!.session.currentPackage())
    );
    expect(saveReopenDigest(alice.surface!.session.currentPackage())).toEqual(
      saveReopenDigest(bob.surface!.session.currentPackage())
    );
    for (const editor of [alice, bob]) expect(editor.surface!.session.bodyText()).toBe(text);
  };
  const concurrently = (edits: () => void) => {
    pair.pause();
    edits();
    flush();
    pair.resume();
  };
  /** Alice's caret as Bob's replica shows it. */
  const aliceAsBobSeesIt = () => {
    applyAwarenessUpdate(
      pair.bob.awareness,
      encodeAwarenessUpdate(pair.alice.awareness, [pair.alice.ydoc.clientID]),
      'rich-paste-caret-test'
    );
    const remote = pair.bob.room.session.remoteSelections()[0];
    if (!remote) throw Error('The remote selection is missing');
    return {
      anchor: { paragraphId: remote.anchor.nodeId, offset: remote.anchor.offset },
      head: { paragraphId: remote.head.nodeId, offset: remote.head.offset },
    };
  };
  return { alice, bob, converge, concurrently, aliceAsBobSeesIt };
}

function caret(editor: Editor, offset: number, paragraphIndex = 0) {
  const paragraphId = editor.surface!.session.paragraphIds()[paragraphIndex]!;
  editor.surface!.setSelection({ anchor: { paragraphId, offset }, head: { paragraphId, offset } });
}

const at = (editor: Editor, paragraphIndex: number, offset: number) => {
  const paragraphId = editor.surface!.session.paragraphIds()[paragraphIndex]!;
  return { anchor: { paragraphId, offset }, head: { paragraphId, offset } };
};

test('the caret follows a rich paste while a peer types after it', async () => {
  const { alice, bob, converge, concurrently, aliceAsBobSeesIt } = await pairOfEditors();
  concurrently(() => {
    caret(alice, 5);
    expect(alice.surface!.pasteRich('XY', '<p><b>XY</b></p>')).toBe(true);
    caret(bob, 11);
    bob.surface!.type('!');
  });
  converge('HelloXY world!');
  expect(alice.surface!.state().selection).toEqual(at(alice, 0, 7));
  expect(aliceAsBobSeesIt()).toEqual(at(bob, 0, 7));

  // The caret keeps its place for the next keystroke.
  alice.surface!.type('Z');
  converge('HelloXYZ world!');

  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  converge('Hello world!');
  expect(alice.exec({ type: 'redo' }).ok).toBe(true);
  converge('HelloXY world!');
});

test('the caret ends a multi-paragraph rich paste while a peer types before it', async () => {
  const { alice, bob, converge, concurrently, aliceAsBobSeesIt } = await pairOfEditors();
  concurrently(() => {
    caret(alice, 5);
    expect(alice.surface!.pasteRich('one\ntwo', '<p>one</p><p>two</p>')).toBe(true);
    caret(bob, 0);
    bob.surface!.type('>');
  });
  converge('>Helloone\ntwo world');
  expect(alice.surface!.session.paragraphIds()).toHaveLength(2);
  expect(alice.surface!.state().selection).toEqual(at(alice, 1, 3));
  expect(aliceAsBobSeesIt()).toEqual(at(bob, 1, 3));

  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  converge('>Hello world');
  expect(alice.exec({ type: 'redo' }).ok).toBe(true);
  converge('>Helloone\ntwo world');
});

test('a rich paste converges while a peer deletes the text after it', async () => {
  const { alice, bob, converge, concurrently, aliceAsBobSeesIt } = await pairOfEditors();
  concurrently(() => {
    caret(alice, 5);
    expect(alice.surface!.pasteRich('XY', '<p><b>XY</b></p>')).toBe(true);
    const paragraphId = bob.surface!.session.paragraphIds()[0]!;
    bob.surface!.setSelection({
      anchor: { paragraphId, offset: 5 },
      head: { paragraphId, offset: 11 },
    });
    bob.surface!.deleteBackward();
  });
  converge('HelloXY');
  expect(alice.surface!.state().selection).toEqual(at(alice, 0, 7));
  expect(aliceAsBobSeesIt()).toEqual(at(bob, 0, 7));

  // Save and reopen keep the pasted formatting on both replicas.
  for (const editor of [alice, bob]) {
    const container = document.createElement('div');
    document.body.append(container);
    containers.push(container);
    const reopened = createDocxEditor({ container, document: await editor.save() });
    editors.push(reopened);
    expect(reopened.surface!.session.bodyText()).toBe('HelloXY');
  }
});
