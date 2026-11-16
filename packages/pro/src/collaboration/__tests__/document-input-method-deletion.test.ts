/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Deletions from a keyboard that deletes through the platform's text service (#1896): a range
// of several characters in one `beforeinput`, and a composition that erases a whole word. Both
// reach the document through the ordinary deletion and readback lanes, so they replicate,
// converge with a peer's concurrent edits, undo as one user's edits, and survive a reopen.
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('input-method-deletion', { offlineEditing: true });
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
type Mounted = ReturnType<typeof mount>;

function caret(peer: Mounted, offset: number) {
  const position = { paragraphId: peer.editor.surface!.session.paragraphIds()[0]!, offset };
  peer.editor.surface!.setSelection({ anchor: position, head: position });
  return position;
}

/** The painted text node holding model `offset`, and the offset inside it. */
function domPoint(peer: Mounted, offset: number): { node: Node; offset: number } {
  const paragraphId = peer.editor.surface!.session.paragraphIds()[0]!;
  for (const element of peer.container.querySelectorAll<HTMLElement>(
    '[data-paragraph-id][data-start]'
  )) {
    if (element.dataset.paragraphId !== paragraphId) continue;
    const start = Number(element.dataset.start);
    const text = element.firstChild as Text | null;
    if (!text || text.nodeType !== Node.TEXT_NODE) continue;
    if (offset >= start && offset <= start + text.data.length)
      return { node: text, offset: offset - start };
  }
  throw new Error(`no painted text at ${offset}`);
}

/** One keyboard deletion naming the characters `[from, to)` before the caret. */
function deleteRange(peer: Mounted, from: number, to: number): void {
  const start = domPoint(peer, from);
  const end = domPoint(peer, to);
  const event = new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    inputType: 'deleteContentBackward',
  });
  const range = {
    startContainer: start.node,
    startOffset: start.offset,
    endContainer: end.node,
    endOffset: end.offset,
    collapsed: false,
  };
  Object.defineProperty(event, 'getTargetRanges', { value: () => [range] });
  peer.container.querySelector('.docx-pages')!.dispatchEvent(event);
}

async function pair(body: string): Promise<{
  alice: Mounted;
  bob: Mounted;
  peers: Awaited<ReturnType<typeof harness.pair>>;
  converge: () => void;
}> {
  const peers = await harness.pair(zipDocument(body));
  const [alice, bob] = [peers.alice, peers.bob].map((peer) => {
    peer.detach();
    return mount({
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
  }) as [Mounted, Mounted];
  const converge = () => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
    expect(packageFingerprint(alice.editor.surface!.session.currentPackage())).toBe(
      packageFingerprint(bob.editor.surface!.session.currentPackage())
    );
  };
  return { alice, bob, peers, converge };
}

test('a multi-character deletion converges with a concurrent edit, undoes, and reopens', async () => {
  const { alice, bob, peers, converge } = await pair(
    '<w:p><w:r><w:t xml:space="preserve">Hello world</w:t></w:r></w:p>'
  );
  peers.pause();
  caret(alice, 11);
  deleteRange(alice, 9, 11);
  expect(alice.editor.surface!.session.bodyText()).toBe('Hello wor');
  caret(bob, 0);
  expect(bob.editor.exec({ type: 'insertText', text: 'peer ' }).ok).toBe(true);
  peers.alice.room.session.flushPendingJournals();
  peers.bob.room.session.flushPendingJournals();
  peers.resume();
  converge();
  expect(bob.editor.surface!.session.bodyText()).toBe('peer Hello wor');

  // Undo takes back only this user's deletion, on both sides, one step per character, as
  // the same presses on a hardware Backspace would.
  expect(alice.editor.exec({ type: 'undo' }).ok).toBe(true);
  expect(alice.editor.exec({ type: 'undo' }).ok).toBe(true);
  converge();
  expect(bob.editor.surface!.session.bodyText()).toBe('peer Hello world');
  expect(alice.editor.exec({ type: 'redo' }).ok).toBe(true);
  expect(alice.editor.exec({ type: 'redo' }).ok).toBe(true);
  converge();
  expect(bob.editor.surface!.session.bodyText()).toBe('peer Hello wor');

  const reopened = mount({ document: new Uint8Array(await bob.editor.save()) });
  expect(saveReopenDigest(reopened.editor.surface!.session.currentPackage())).toEqual(
    saveReopenDigest(bob.editor.surface!.session.currentPackage())
  );
});

test('a deletion over text a peer removes meanwhile converges', async () => {
  const { alice, bob, peers, converge } = await pair(
    '<w:p><w:r><w:t xml:space="preserve">Hello world</w:t></w:r></w:p>'
  );
  peers.pause();
  caret(alice, 11);
  deleteRange(alice, 9, 11);
  // The peer deletes the whole word the keyboard was deleting from.
  bob.editor.surface!.setSelection({
    anchor: { paragraphId: bob.editor.surface!.session.paragraphIds()[0]!, offset: 5 },
    head: { paragraphId: bob.editor.surface!.session.paragraphIds()[0]!, offset: 11 },
  });
  bob.editor.surface!.deleteBackward();
  peers.alice.room.session.flushPendingJournals();
  peers.bob.room.session.flushPendingJournals();
  peers.resume();
  converge();
  expect(alice.editor.surface!.session.bodyText()).toBe('Hello');
});

test('a composition that erases a word converges and stays erased', async () => {
  const { alice, bob, peers, converge } = await pair(
    '<w:p><w:r><w:t xml:space="preserve">Hello </w:t></w:r>' +
      '<w:r><w:rPr><w:b/></w:rPr><w:t>world</w:t></w:r></w:p>'
  );
  peers.pause();
  caret(alice, 11);
  const pages = alice.container.querySelector('.docx-pages')!;
  pages.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  (domPoint(alice, 11).node.parentNode as HTMLElement).remove();
  const end = new CompositionEvent('compositionend', { bubbles: true });
  Object.defineProperty(end, 'data', { value: '' });
  pages.dispatchEvent(end);
  expect(alice.editor.surface!.session.bodyText()).toBe('Hello ');
  caret(bob, 0);
  expect(bob.editor.exec({ type: 'insertText', text: 'Oh. ' }).ok).toBe(true);
  peers.alice.room.session.flushPendingJournals();
  peers.bob.room.session.flushPendingJournals();
  peers.resume();
  converge();
  expect(bob.editor.surface!.session.bodyText()).toBe('Oh. Hello ');
});
