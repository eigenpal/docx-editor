/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A participant's range selection beside a change another participant proposes.
//
// The active card is local to each participant. A remote tracked insertion that lands at the
// end of a local selection shares no characters with it, so it must not open on the local
// screen. Typing, undo, redo, reconnect and reopen keep that answer.

import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule, reviewModule } from '../../index';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support';
import { packageFingerprint, saveReopenDigest } from './document-support';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('selection-beside-revision', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
const containers: HTMLElement[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  for (const container of containers.splice(0)) container.remove();
  harness.cleanup();
});

// Offsets: "alpha " 0..6, "beta" 6..10, " gamma" 10..16.
const BODY = '<w:p><w:r><w:t xml:space="preserve">alpha beta gamma</w:t></w:r></w:p>';

function mount(document: Uint8Array, author: string, peer?: Peer) {
  peer?.detach();
  const container = window.document.createElement('div');
  window.document.body.append(container);
  containers.push(container);
  const editor = createDocxEditor({
    container,
    document,
    author,
    modules: [
      reviewModule(),
      ...(peer ? [collaborationModule({ session: peer.room.session })] : []),
    ],
  });
  editors.push(editor);
  return { editor, container };
}

function paragraphId(editor: Editor): string {
  return editor.surface!.state().selection.head.paragraphId;
}

function select(editor: Editor, anchor: number, head: number): void {
  const id = paragraphId(editor);
  editor.exec({
    type: 'setSelection',
    range: { anchor: { paragraphId: id, offset: anchor }, head: { paragraphId: id, offset: head } },
  });
}

const active = (editor: Editor) => editor.getReviewItems().find((item) => item.isActive) ?? null;
const insertions = (editor: Editor) =>
  editor
    .getReviewItems()
    .filter((item) => item.kind === 'revision' && item.revisionKind === 'insert');
const activeBands = (container: HTMLElement) =>
  container.querySelectorAll('.docx-revision-band--active').length;

/** A remote edit's repaint, which the surface schedules for the next frame. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

async function peers() {
  const pair = await harness.pair(zipDocument(BODY));
  const alice = mount(pair.alice.room.document, 'Alice', pair.alice);
  const bob = mount(pair.bob.room.document, 'Bob', pair.bob);
  const converge = () => {
    pair.alice.room.session.flushPendingJournals();
    pair.bob.room.session.flushPendingJournals();
    expect(packageFingerprint(alice.editor.surface!.session.currentPackage())).toBe(
      packageFingerprint(bob.editor.surface!.session.currentPackage())
    );
  };
  return { pair, alice, bob, converge };
}

/** Bob proposes " new" at the end of "beta", where Alice's selection ends. */
function proposeAtSelectionEnd(bob: Editor): void {
  expect(bob.exec({ type: 'setEditingMode', mode: 'suggesting' }).ok).toBe(true);
  select(bob, 10, 10);
  expect(bob.exec({ type: 'insertText', text: ' new' }).ok).toBe(true);
}

test('a remote insertion at the end of a local selection does not open', async () => {
  const { pair, alice, bob, converge } = await peers();
  select(alice.editor, 6, 10);
  proposeAtSelectionEnd(bob.editor);
  converge();

  expect(alice.editor.surface!.session.bodyText()).toContain('alpha beta new gamma');
  expect(insertions(alice.editor)).toHaveLength(1);
  const { anchor, head } = alice.editor.surface!.state().selection;
  expect(anchor.offset).toBe(6);
  // Alice's selection still holds "beta" only, so Bob's change is not hers to look at.
  expect(head.offset).toBe(10);
  expect(active(alice.editor)).toBeNull();
  await settle();
  expect(activeBands(alice.container)).toBe(0);

  // Alice reaches one character into the proposal: now it is open.
  select(alice.editor, 6, 11);
  expect(active(alice.editor)?.key).toBe(insertions(alice.editor)[0]!.key);
  expect(activeBands(alice.container)).toBeGreaterThan(0);
  // And backing off to the boundary closes it again.
  select(alice.editor, 6, 10);
  expect(active(alice.editor)).toBeNull();
  expect(activeBands(alice.container)).toBe(0);

  // Undo and redo on Bob's side keep Alice's answer.
  expect(bob.editor.exec({ type: 'undo' }).ok).toBe(true);
  converge();
  expect(insertions(alice.editor)).toHaveLength(0);
  expect(active(alice.editor)).toBeNull();
  expect(bob.editor.exec({ type: 'redo' }).ok).toBe(true);
  converge();
  expect(insertions(alice.editor)).toHaveLength(1);
  select(alice.editor, 6, 10);
  expect(active(alice.editor)).toBeNull();

  // A returning participant and a reopened save read the same change, beside the same word.
  const rejoined = await harness.join(pair.alice, 'returning');
  const returning = mount(rejoined.room.document, 'Alice', rejoined);
  expect(insertions(returning.editor)).toHaveLength(1);
  select(returning.editor, 6, 10);
  expect(active(returning.editor)).toBeNull();
  select(returning.editor, 14, 10);
  expect(active(returning.editor)?.key).toBe(insertions(returning.editor)[0]!.key);

  const reopened = mount(new Uint8Array(await bob.editor.save()), 'Reader');
  expect(saveReopenDigest(reopened.editor.surface!.session.currentPackage())).toEqual(
    saveReopenDigest(bob.editor.surface!.session.currentPackage())
  );
  select(reopened.editor, 6, 10);
  expect(active(reopened.editor)).toBeNull();
});

test('a remote deletion of the selected proposal leaves nothing open', async () => {
  const { alice, bob, converge } = await peers();
  proposeAtSelectionEnd(bob.editor);
  converge();
  select(alice.editor, 6, 12);
  expect(active(alice.editor)).not.toBeNull();

  // Bob withdraws his own proposal while Alice holds part of it.
  const proposal = insertions(bob.editor)[0]!;
  expect(bob.editor.rejectReviewItem(proposal.key).ok).toBe(true);
  converge();
  expect(alice.editor.surface!.session.bodyText()).toContain('alpha beta gamma');
  expect(insertions(alice.editor)).toHaveLength(0);
  expect(active(alice.editor)).toBeNull();
  // A remote edit repaints on the next frame, not inside the sync.
  await settle();
  expect(activeBands(alice.container)).toBe(0);
});
