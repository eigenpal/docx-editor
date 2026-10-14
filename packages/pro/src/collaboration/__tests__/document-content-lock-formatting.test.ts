/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// `contentLockPolicy.allowFormattingInLockedContent` is local validation only. A peer that opted
// in restyles a content-locked chip; a peer that did not still receives and applies the change,
// because remote updates do not pass local lock checks. Both must converge with the chip's text
// and lock untouched, through concurrent edits, undo, redo and a save/reopen.

import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { contentControlTextOf, contentControlsIn } from '@docx-editor.dev/core/store';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { mainPart, packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('content-lock-formatting', { offlineEditing: true });
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

function select(editor: Editor, start: number, end: number) {
  const paragraphId = editor.surface!.session.paragraphIds()[0]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset: start },
    head: { paragraphId, offset: end },
  });
}

function chipText(editor: Editor): string | null {
  const control = contentControlsIn(mainPart(editor.surface!.session.currentPackage()).root)[0];
  return control ? contentControlTextOf(control.node) : null;
}

function mainXml(editor: Editor): string {
  return JSON.stringify(mainPart(editor.surface!.session.currentPackage()).root);
}

const isBold = (editor: Editor) => mainXml(editor).includes('"localName":"b"');

const chip = (lock: string) =>
  '<w:p><w:r><w:t xml:space="preserve">head </w:t></w:r>' +
  `<w:sdt><w:sdtPr><w:tag w:val="t"/><w:lock w:val="${lock}"/></w:sdtPr>` +
  '<w:sdtContent><w:r><w:t>TOKEN</w:t></w:r></w:sdtContent></w:sdt>' +
  '<w:r><w:t xml:space="preserve"> tail</w:t></w:r></w:p>';

/** Alice opted in to formatting locked content; Bob did not. */
async function peers(lock = 'sdtContentLocked') {
  const pair = await harness.pair(zipDocument(chip(lock)));
  const open = (peer: typeof pair.alice, withPolicy: boolean) => {
    peer.detach();
    return mount({
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
      ...(withPolicy ? { contentLockPolicy: { allowFormattingInLockedContent: true } } : {}),
    });
  };
  const alice = open(pair.alice, true);
  const bob = open(pair.bob, false);
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

test('a peer without the policy receives formatting of a locked chip, through undo and reopen', async () => {
  const { alice, bob, converge } = await peers();
  // Bob's own attempt is refused locally: he did not opt in.
  select(bob, 5, 10);
  expect(bob.exec({ type: 'toggleMark', mark: 'bold' })).not.toEqual({ ok: true, changed: true });
  expect(isBold(bob)).toBe(false);

  select(alice, 5, 10);
  expect(alice.exec({ type: 'toggleMark', mark: 'bold' })).toEqual({ ok: true, changed: true });
  converge();
  expect(isBold(bob)).toBe(true);
  expect(chipText(bob)).toBe('TOKEN');
  expect(mainXml(bob)).toContain('sdtContentLocked');

  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  converge();
  expect(isBold(bob)).toBe(false);
  expect(alice.exec({ type: 'redo' }).ok).toBe(true);
  converge();
  expect(isBold(bob)).toBe(true);

  const reopened = mount({ document: new Uint8Array(await bob.save()) });
  expect(saveReopenDigest(reopened.surface!.session.currentPackage())).toEqual(
    saveReopenDigest(bob.surface!.session.currentPackage())
  );
  expect(chipText(reopened)).toBe('TOKEN');
});

test('formatting a chip while the other peer types beside it converges', async () => {
  const { pair, alice, bob, flush, converge } = await peers();
  pair.pause();
  select(alice, 5, 10);
  expect(alice.exec({ type: 'toggleMark', mark: 'bold' })).toEqual({ ok: true, changed: true });
  select(bob, 0, 0);
  bob.surface!.type('X');
  expect(bob.surface!.state().lastRejection).toBeNull();
  flush();
  pair.resume();
  converge();
  expect(alice.surface!.session.bodyText()).toBe('Xhead TOKEN tail');
  expect(chipText(alice)).toBe('TOKEN');
  expect(isBold(bob)).toBe(true);
});

test('formatting a chip while the other peer deletes text beside it converges', async () => {
  const { pair, alice, bob, flush, converge } = await peers();
  pair.pause();
  select(alice, 5, 10);
  expect(alice.exec({ type: 'toggleMark', mark: 'bold' })).toEqual({ ok: true, changed: true });
  // sdtContentLocked forbids removing the chip too, so Bob deletes the text after it.
  select(bob, 10, 15);
  bob.surface!.deleteBackward();
  flush();
  pair.resume();
  converge();
  expect(chipText(alice)).toBe('TOKEN');
  expect(chipText(bob)).toBe('TOKEN');
  expect(alice.surface!.session.bodyText()).toBe(bob.surface!.session.bodyText());
});

test('formatting a chip while the other peer deletes the chip converges, through undo and reopen', async () => {
  // `contentLocked` protects the text but not the wrapper, so Bob may remove the chip whole.
  const { pair, alice, bob, flush, converge } = await peers('contentLocked');
  pair.pause();
  select(alice, 5, 10);
  expect(alice.exec({ type: 'toggleMark', mark: 'bold' })).toEqual({ ok: true, changed: true });
  select(bob, 10, 10);
  bob.surface!.deleteBackward();
  expect(chipText(bob)).toBeNull();
  flush();
  pair.resume();
  converge();
  expect(chipText(alice)).toBeNull();
  expect(alice.surface!.session.bodyText()).toBe('head  tail');

  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  converge();
  expect(bob.exec({ type: 'undo' }).ok).toBe(true);
  converge();
  expect(chipText(alice)).toBe('TOKEN');
  expect(chipText(bob)).toBe('TOKEN');

  const reopened = mount({ document: new Uint8Array(await alice.save()) });
  expect(saveReopenDigest(reopened.surface!.session.currentPackage())).toEqual(
    saveReopenDigest(alice.surface!.session.currentPackage())
  );
  expect(chipText(reopened)).toBe('TOKEN');
});

test('session remount keeps received formatting while the local default still refuses changes', async () => {
  const { pair, alice, bob, converge } = await peers();
  select(alice, 5, 10);
  expect(alice.exec({ type: 'toggleMark', mark: 'bold' }).ok).toBe(true);
  converge();
  bob.destroy();
  const next = await harness.remount(pair.bob);
  next.detach();
  const reconnected = mount({
    document: next.room.document,
    modules: [collaborationModule({ session: next.room.session })],
  });
  expect(isBold(reconnected)).toBe(true);
  select(reconnected, 5, 10);
  const before = mainXml(reconnected);
  reconnected.exec({ type: 'toggleMark', mark: 'bold' });
  expect(mainXml(reconnected)).toBe(before);
  expect(chipText(reconnected)).toBe('TOKEN');
});
