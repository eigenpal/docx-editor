/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Typing at the leading edge of a content-locked chip lands beside the chip (#1121). Two peers
// doing that at once, or one doing it while the other removes the chip, must converge with the
// chip's own text untouched, through undo, redo and a save/reopen.

import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { contentControlTextOf, contentControlsIn } from '@docx-editor.dev/core/store';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { mainPart, packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('locked-control-edges', { offlineEditing: true });
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

/** The chip's own text, or null once it is gone. */
function chipText(editor: Editor): string | null {
  const control = contentControlsIn(mainPart(editor.surface!.session.currentPackage()).root)[0];
  return control ? contentControlTextOf(control.node) : null;
}

const CHIP =
  '<w:p><w:sdt><w:sdtPr><w:tag w:val="acme:igloo?x=1"/><w:lock w:val="contentLocked"/></w:sdtPr>' +
  '<w:sdtContent><w:r><w:t>IGLOO</w:t></w:r></w:sdtContent></w:sdt>' +
  '<w:r><w:t xml:space="preserve"> tail</w:t></w:r></w:p>';

async function peers() {
  const pair = await harness.pair(zipDocument(CHIP));
  const [alice, bob] = [pair.alice, pair.bob].map((peer) => {
    peer.detach();
    return mount({
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
  }) as [Editor, Editor];
  const flush = () => {
    pair.alice.room.session.flushPendingJournals();
    pair.bob.room.session.flushPendingJournals();
  };
  const converge = () => {
    flush();
    expect(packageFingerprint(alice.surface!.session.currentPackage())).toBe(
      packageFingerprint(bob.surface!.session.currentPackage())
    );
  };
  return { pair, alice, bob, flush, converge };
}

test('concurrent typing before a locked chip converges beside it, through undo and reopen', async () => {
  const { pair, alice, bob, flush, converge } = await peers();
  pair.pause();
  caret(alice, 0);
  alice.surface!.type('A');
  caret(bob, 0);
  bob.surface!.type('B');
  expect(alice.surface!.state().lastRejection).toBeNull();
  expect(bob.surface!.state().lastRejection).toBeNull();
  flush();
  pair.resume();
  converge();
  const text = alice.surface!.session.bodyText();
  expect(text.endsWith('IGLOO tail')).toBe(true);
  expect(text.slice(0, 2).split('').sort().join('')).toBe('AB');
  expect(chipText(alice)).toBe('IGLOO');
  expect(chipText(bob)).toBe('IGLOO');

  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  converge();
  expect(bob.surface!.session.bodyText()).toBe('BIGLOO tail');
  expect(alice.exec({ type: 'redo' }).ok).toBe(true);
  converge();
  expect(chipText(bob)).toBe('IGLOO');

  const reopened = mount({ document: new Uint8Array(await bob.save()) });
  expect(saveReopenDigest(reopened.surface!.session.currentPackage())).toEqual(
    saveReopenDigest(bob.surface!.session.currentPackage())
  );
  expect(reopened.surface!.session.bodyText()).toBe(bob.surface!.session.bodyText());
});

test('typing before a chip while the other peer deletes the chip keeps the typed text', async () => {
  const { pair, alice, bob, flush, converge } = await peers();
  pair.pause();
  caret(alice, 0);
  alice.surface!.type('A');
  // Bob removes the chip whole: Backspace after it deletes the node as one unit.
  caret(bob, 5);
  bob.surface!.deleteBackward();
  expect(chipText(bob)).toBeNull();
  flush();
  pair.resume();
  converge();
  // The typed character sat beside the chip, not inside it, so it outlives the deletion.
  expect(alice.surface!.session.bodyText()).toBe('A tail');
  expect(chipText(alice)).toBeNull();
});
