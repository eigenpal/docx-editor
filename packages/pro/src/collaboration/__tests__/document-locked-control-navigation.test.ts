/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// `lockedControlNavigation: 'atomic'` is local caret behaviour. A peer that selects a locked
// chip whole publishes that range like any other selection, a peer without the option sees it,
// and edits beside the chip from either side converge with the chip's text untouched.

import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { contentControlTextOf, contentControlsIn } from '@docx-editor.dev/core/store';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';
import { mainPart, packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('locked-control-navigation', { offlineEditing: true });
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
  return editor;
}

function caret(editor: Editor, offset: number) {
  const position = { paragraphId: editor.surface!.session.paragraphIds()[0]!, offset };
  editor.surface!.setSelection({ anchor: position, head: position });
}

function chipText(editor: Editor): string | null {
  const control = contentControlsIn(mainPart(editor.surface!.session.currentPackage()).root)[0];
  return control ? contentControlTextOf(control.node) : null;
}

function syncPresence(from: Peer, to: Peer) {
  const ids = [...from.awareness.getStates().keys()];
  applyAwarenessUpdate(to.awareness, encodeAwarenessUpdate(from.awareness, ids), 'relay');
}

const CHIP =
  '<w:p><w:r><w:t xml:space="preserve">head </w:t></w:r>' +
  '<w:sdt><w:sdtPr><w:tag w:val="t"/><w:lock w:val="sdtContentLocked"/></w:sdtPr>' +
  '<w:sdtContent><w:r><w:t>TOKEN</w:t></w:r></w:sdtContent></w:sdt>' +
  '<w:r><w:t xml:space="preserve"> tail</w:t></w:r></w:p>';

/** Alice moves over locked chips as units; Bob keeps Word's character-by-character caret. */
async function peers(body = CHIP) {
  const pair = await harness.pair(zipDocument(body));
  const open = (peer: Peer, atomic: boolean) => {
    peer.detach();
    return mount({
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
      ...(atomic ? { lockedControlNavigation: 'atomic' as const } : {}),
    });
  };
  const alice = open(pair.alice, true);
  const bob = open(pair.bob, false);
  const converge = () => {
    pair.alice.room.session.flushPendingJournals();
    pair.bob.room.session.flushPendingJournals();
    expect(packageFingerprint(alice.surface!.session.currentPackage())).toBe(
      packageFingerprint(bob.surface!.session.currentPackage())
    );
  };
  return { pair, alice, bob, converge };
}

test('a chip selected whole is published as that range, and a peer without the option sees it', async () => {
  const { pair, alice } = await peers();
  caret(alice, 5);
  alice.surface!.navigate('right', true);
  const { anchor, head } = alice.surface!.state().selection;
  expect([anchor.offset, head.offset]).toEqual([5, 10]);
  syncPresence(pair.alice, pair.bob);
  expect(pair.bob.room.session.remoteSelections()).toMatchObject([
    { actorId: expect.any(String), anchor: { offset: 5 }, head: { offset: 10 } },
  ]);
});

test('typing beside a chip on one peer while the other steps over it converges', async () => {
  const { pair, alice, bob, converge } = await peers();
  pair.pause();
  caret(bob, 0);
  bob.surface!.type('X');
  caret(alice, 5);
  alice.surface!.navigate('right');
  expect(alice.surface!.state().selection.head.offset).toBe(10);
  alice.surface!.type('Y');
  pair.alice.room.session.flushPendingJournals();
  pair.bob.room.session.flushPendingJournals();
  pair.resume();
  converge();
  expect(alice.surface!.session.bodyText()).toBe('Xhead TOKENY tail');
  expect(chipText(alice)).toBe('TOKEN');
  expect(chipText(bob)).toBe('TOKEN');

  // The local caret followed Bob's insertion, so the next step still crosses the chip whole.
  caret(alice, 6);
  alice.surface!.navigate('right');
  expect(alice.surface!.state().selection.head.offset).toBe(11);

  const reopened = mount({ document: new Uint8Array(await bob.save()) });
  expect(saveReopenDigest(reopened.surface!.session.currentPackage())).toEqual(
    saveReopenDigest(bob.surface!.session.currentPackage())
  );
});

test('atomic navigation remains correct through undo, redo, and session remount', async () => {
  const { pair, alice, bob, converge } = await peers();
  caret(alice, 5);
  alice.surface!.navigate('right');
  alice.surface!.type('X');
  converge();
  expect(bob.surface!.session.bodyText()).toBe('head TOKENX tail');
  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  converge();
  expect(bob.surface!.session.bodyText()).toBe('head TOKEN tail');
  expect(alice.exec({ type: 'redo' }).ok).toBe(true);
  converge();
  bob.destroy();
  const next = await harness.remount(pair.bob);
  next.detach();
  const reconnected = mount({
    document: next.room.document,
    lockedControlNavigation: 'atomic',
    modules: [collaborationModule({ session: next.room.session })],
  });
  expect(reconnected.surface!.session.bodyText()).toBe('head TOKENX tail');
  caret(reconnected, 5);
  reconnected.surface!.navigate('right');
  expect(reconnected.surface!.state().selection.head.offset).toBe(10);
});

test('deletion by a peer while atomic navigation edits beside the control converges', async () => {
  const { pair, alice, bob, converge } = await peers(
    CHIP.replace('sdtContentLocked', 'contentLocked')
  );
  pair.pause();
  caret(alice, 5);
  alice.surface!.navigate('right');
  alice.surface!.type('X');
  caret(bob, 10);
  bob.surface!.deleteBackward();
  expect(chipText(bob)).toBeNull();
  pair.alice.room.session.flushPendingJournals();
  pair.bob.room.session.flushPendingJournals();
  pair.resume();
  converge();
  expect(chipText(alice)).toBeNull();
  expect(alice.surface!.session.bodyText()).toBe('head X tail');
  expect(alice.surface!.layout().contentControls ?? []).toHaveLength(0);
  caret(alice, 5);
  alice.surface!.navigate('right');
  expect(alice.surface!.state().selection.head.offset).toBe(6);
});
