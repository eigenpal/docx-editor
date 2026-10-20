/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Backspace beside a content-locked control selects it first and removes it on the second press
// (#1299). Over a collaboration session the selecting press writes nothing, the removing press
// converges with a peer's concurrent edits, and one undo brings the control back everywhere.

import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { contentControlTextOf, contentControlsIn } from '@docx-editor.dev/core/store';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { mainPart, packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('locked-control-delete', { offlineEditing: true });
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

function caret(editor: Editor, offset: number, paragraph = 0) {
  const position = { paragraphId: editor.surface!.session.paragraphIds()[paragraph]!, offset };
  editor.surface!.setSelection({ anchor: position, head: position });
}

/** The chip's own text, or null once it is gone. */
function chipText(editor: Editor): string | null {
  const control = contentControlsIn(mainPart(editor.surface!.session.currentPackage()).root)[0];
  return control ? contentControlTextOf(control.node) : null;
}

/** "head " [5,10) "IGLOO" " tail", then a second paragraph the other peer types into. */
const chip = (lock: string) =>
  '<w:p><w:r><w:t xml:space="preserve">head </w:t></w:r>' +
  `<w:sdt><w:sdtPr><w:tag w:val="acme:igloo?x=1"/><w:lock w:val="${lock}"/></w:sdtPr>` +
  '<w:sdtContent><w:r><w:t>IGLOO</w:t></w:r></w:sdtContent></w:sdt>' +
  '<w:r><w:t xml:space="preserve"> tail</w:t></w:r></w:p><w:p><w:r><w:t>other</w:t></w:r></w:p>';

async function peers(lock = 'contentLocked') {
  const pair = await harness.pair(zipDocument(chip(lock)));
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

const offsets = (editor: Editor) => {
  const { anchor, head } = editor.surface!.state().selection;
  return [anchor.offset, head.offset];
};

test('two Backspaces remove the control while the other peer types elsewhere', async () => {
  const { pair, alice, bob, flush, converge } = await peers();
  pair.pause();
  caret(alice, 10);
  alice.surface!.deleteBackward();
  expect(chipText(alice)).toBe('IGLOO');
  expect(offsets(alice)).toEqual([10, 5]);
  alice.surface!.deleteBackward();
  expect(chipText(alice)).toBeNull();
  caret(bob, 5, 1);
  bob.surface!.type('!');
  flush();
  pair.resume();
  converge();
  expect(chipText(bob)).toBeNull();
  const after = bob.surface!.session.bodyText();
  expect(after).toContain('head  tail');
  expect(after).toContain('other!');

  // One undo restores the whole control; redo removes it again.
  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  converge();
  expect(chipText(bob)).toBe('IGLOO');
  expect(bob.surface!.session.bodyText()).toContain('head IGLOO tail');
  expect(bob.surface!.session.bodyText()).toContain('other!');
  expect(alice.exec({ type: 'redo' }).ok).toBe(true);
  converge();
  expect(chipText(bob)).toBeNull();

  const reopened = mount({ document: new Uint8Array(await bob.save()) });
  expect(saveReopenDigest(reopened.surface!.session.currentPackage())).toEqual(
    saveReopenDigest(bob.surface!.session.currentPackage())
  );
  expect(reopened.surface!.session.bodyText()).toBe(bob.surface!.session.bodyText());
});

test('the selecting press writes nothing to the session', async () => {
  const { alice, bob, converge } = await peers();
  const before = packageFingerprint(bob.surface!.session.currentPackage());
  caret(alice, 5);
  alice.surface!.deleteForward();
  expect(offsets(alice)).toEqual([5, 10]);
  converge();
  expect(packageFingerprint(bob.surface!.session.currentPackage())).toBe(before);
  expect(chipText(bob)).toBe('IGLOO');
});

test('a peer removing the control while the other has it selected does not throw', async () => {
  const { pair, alice, bob, flush, converge } = await peers();
  pair.pause();
  caret(alice, 10);
  alice.surface!.deleteBackward();
  caret(bob, 10);
  bob.surface!.deleteBackward();
  bob.surface!.deleteBackward();
  expect(chipText(bob)).toBeNull();
  flush();
  pair.resume();
  converge();
  expect(chipText(alice)).toBeNull();
  // Alice's selection named the removed control. Her second press must not throw.
  expect(() => alice.surface!.deleteBackward()).not.toThrow();
  converge();
  expect(alice.surface!.session.bodyText()).toBe(bob.surface!.session.bodyText());
});

test('an sdtContentLocked control is selected, then refused, for both peers', async () => {
  const { pair, alice, bob, flush, converge } = await peers('sdtContentLocked');
  pair.pause();
  caret(alice, 10);
  alice.surface!.deleteBackward();
  alice.surface!.deleteBackward();
  expect(alice.surface!.state().lastRejection).not.toBeNull();
  caret(bob, 0, 1);
  bob.surface!.type('B');
  flush();
  pair.resume();
  converge();
  expect(chipText(alice)).toBe('IGLOO');
  expect(chipText(bob)).toBe('IGLOO');
  expect(alice.surface!.session.bodyText()).toContain('head IGLOO tail');
  expect(alice.surface!.session.bodyText()).toContain('Bother');
});

test('a suggested deletion of the control converges and either decision lands everywhere', async () => {
  for (const decision of ['reject', 'accept'] as const) {
    const { pair, alice, bob, flush, converge } = await peers();
    alice.surface!.setEditingMode('suggest');
    alice.surface!.setAuthor('Alice');
    pair.pause();
    const first = alice.surface!.session.paragraphIds()[0]!;
    alice.surface!.setSelection({
      anchor: { paragraphId: first, offset: 4 },
      head: { paragraphId: first, offset: 11 },
    });
    alice.surface!.deleteBackward();
    expect(alice.surface!.state().lastRejection ?? null).toBeNull();
    caret(bob, 0, 1);
    bob.surface!.type('B');
    flush();
    pair.resume();
    converge();
    // Proposed, not gone: the chip stays, its text struck.
    expect(chipText(bob)).not.toBeNull();
    expect(
      bob.surface!.session.applyTreeOps([
        { op: decision === 'accept' ? 'acceptAllRevisions' : 'rejectAllRevisions' },
      ]).committed
    ).toBe(true);
    converge();
    expect(chipText(alice)).toBe(decision === 'accept' ? null : 'IGLOO');
    expect(alice.surface!.session.bodyText()).toContain('Bother');
  }
});

test('a range across paragraphs removes the control and converges with a peer edit', async () => {
  const { pair, alice, bob, flush, converge } = await peers();
  pair.pause();
  const [first, second] = alice.surface!.session.paragraphIds();
  alice.surface!.setSelection({
    anchor: { paragraphId: first!, offset: 3 },
    head: { paragraphId: second!, offset: 2 },
  });
  alice.surface!.deleteBackward();
  expect(alice.surface!.state().lastRejection ?? null).toBeNull();
  expect(chipText(alice)).toBeNull();
  caret(bob, 15);
  bob.surface!.type('!');
  flush();
  pair.resume();
  converge();
  expect(chipText(bob)).toBeNull();

  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  converge();
  expect(chipText(bob)).toBe('IGLOO');
  expect(bob.surface!.session.paragraphIds()).toHaveLength(2);

  const reopened = mount({ document: new Uint8Array(await bob.save()) });
  expect(reopened.surface!.session.bodyText()).toBe(bob.surface!.session.bodyText());
});

test('Backspace joins the next paragraph to the control line for both peers', async () => {
  const { pair, alice, bob, flush, converge } = await peers('sdtContentLocked');
  pair.pause();
  caret(alice, 0, 1);
  alice.surface!.deleteBackward();
  expect(alice.surface!.state().lastRejection ?? null).toBeNull();
  caret(bob, 0);
  bob.surface!.type('>');
  flush();
  pair.resume();
  converge();
  expect(bob.surface!.session.paragraphIds()).toHaveLength(1);
  expect(chipText(bob)).toBe('IGLOO');
  expect(bob.surface!.session.bodyText()).toContain('>head IGLOO tailother');
});
