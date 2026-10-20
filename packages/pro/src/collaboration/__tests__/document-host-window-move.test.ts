/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A collaborating editor that moves to another window (a pop-out, an iframe) or waits detached
// keeps its replica: it goes on receiving and sending edits, its shared undo still reverses its
// own steps, and the peers converge and survive save and reopen.
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('host-window-move');
const offlineHarness = createPeerHarness('host-window-move-offline', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
type Mounted = { readonly editor: Editor; container: HTMLElement };
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  harness.cleanup();
  offlineHarness.cleanup();
});

/** A second window with its own document and constructors, as `window.open` would give. */
function popout(): Window & typeof globalThis {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  cleanups.push(() => frame.remove());
  const view = frame.contentWindow as (Window & typeof globalThis) | null;
  if (!view || view.document === document) throw new Error('no second window');
  return view;
}

function slotIn(doc: Document): HTMLElement {
  const slot = doc.createElement('div');
  doc.body.append(slot);
  cleanups.push(() => slot.remove());
  return slot;
}

function mount(options: Parameters<typeof createDocxEditor>[0]): Mounted {
  const container = slotIn(document);
  const editor = createDocxEditor({ ...options, container });
  cleanups.push(() => editor.destroy());
  return { editor, container };
}

function caret(editor: Editor, paragraphIndex: number, offset: number): void {
  const paragraphId = editor.surface!.session.paragraphIds()[paragraphIndex]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset },
    head: { paragraphId, offset },
  });
}

/** Type one key per task into the pages, in whatever window they are mounted in now. */
async function typeSlowly(peer: Mounted, text: string): Promise<void> {
  const pages = peer.container.querySelector<HTMLElement>('.docx-pages')!;
  const view = pages.ownerDocument.defaultView as Window & typeof globalThis;
  for (const data of text) {
    pages.dispatchEvent(
      new view.InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data,
      })
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const TWO_PARAGRAPHS = zipDocument(
  '<w:p><w:r><w:t>one</w:t></w:r></w:p><w:p><w:r><w:t>two</w:t></w:r></w:p>'
);

async function pair(peerHarness = harness) {
  const peers = await peerHarness.pair(TWO_PARAGRAPHS);
  const [alice, bob] = [peers.alice, peers.bob].map((peer) => {
    peer.detach();
    return mount({
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
  }) as [Mounted, Mounted];
  const text = (peer: Mounted) => peer.editor.surface!.session.bodyText();
  const converge = () => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
    expect(packageFingerprint(alice.editor.surface!.session.currentPackage())).toBe(
      packageFingerprint(bob.editor.surface!.session.currentPackage())
    );
    expect(text(alice)).toBe(text(bob));
  };
  /** Move `peer` into `slot` the way an adapter does: detach, then attach. */
  const move = (peer: Mounted, slot: HTMLElement) => {
    peer.editor.detach();
    peer.editor.attach(slot);
    peer.container = slot;
  };
  return { alice, bob, text, converge, move, peers };
}

test('concurrent typing converges while one peer types in a pop-out, and its undo stays shared', async () => {
  const { alice, bob, text, converge, move } = await pair();
  caret(alice.editor, 0, 3);
  await typeSlowly(alice, ' A');
  const view = popout();
  move(alice, slotIn(view.document));
  expect(alice.container.querySelector('.docx-pages')!.ownerDocument).toBe(view.document);

  caret(bob.editor, 1, 3);
  await Promise.all([typeSlowly(alice, 'B'), typeSlowly(bob, ' beta')]);
  converge();
  expect(text(bob)).toBe('one AB\ntwo beta');

  // Alice's typing before and after the move is one run of hers; Bob's stays.
  expect(alice.editor.exec({ type: 'undo' }).ok).toBe(true);
  converge();
  expect(text(bob)).not.toContain('A');
  expect(text(bob)).toContain('two beta');
  expect(alice.editor.exec({ type: 'redo' }).ok).toBe(true);
  converge();
  expect(text(bob)).toBe('one AB\ntwo beta');

  // Bob's caret paints in Alice's pop-out, on her remote-selection layer there.
  caret(bob.editor, 1, 0);
  converge();
  const remote = alice.container.querySelector('.docx-remote-selection-overlay');
  expect(remote?.ownerDocument).toBe(view.document);

  const reopened = mount({ document: new Uint8Array(await alice.editor.save()) });
  expect(saveReopenDigest(reopened.editor.surface!.session.currentPackage())).toEqual(
    saveReopenDigest(bob.editor.surface!.session.currentPackage())
  );
});

test('a detached peer keeps receiving edits, including a deletion of its own paragraph', async () => {
  const { alice, bob, text, converge, move } = await pair();
  caret(alice.editor, 1, 3);
  await typeSlowly(alice, '!');
  converge();
  alice.editor.detach();

  // While Alice is detached, Bob edits and deletes the paragraph her caret was in.
  caret(bob.editor, 0, 3);
  await typeSlowly(bob, ' bob');
  bob.editor.surface!.setSelection({
    anchor: { paragraphId: bob.editor.surface!.session.paragraphIds()[0]!, offset: 7 },
    head: { paragraphId: bob.editor.surface!.session.paragraphIds()[1]!, offset: 4 },
  });
  bob.container.querySelector('.docx-pages')!.dispatchEvent(
    new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'deleteContentBackward',
    })
  );
  converge();
  expect(text(alice)).toBe('one bob');

  const view = popout();
  move(alice, slotIn(view.document));
  expect(alice.container.textContent).toContain('one bob');
  caret(alice.editor, 0, 7);
  await typeSlowly(alice, '.');
  converge();
  expect(text(bob)).toBe('one bob.');
});

test('a peer that moves while offline sends its edits after reconnect', async () => {
  const { alice, bob, text, converge, move, peers } = await pair(offlineHarness);
  peers.pause();
  peers.alice.room.session.setTransportStatus('disconnected', 'transport-disconnected', 'drop');
  caret(alice.editor, 0, 3);
  await typeSlowly(alice, ' x');
  const view = popout();
  move(alice, slotIn(view.document));
  await typeSlowly(alice, 'y');
  caret(bob.editor, 1, 3);
  await typeSlowly(bob, '!');
  peers.alice.room.session.setTransportStatus('ready');
  peers.resume();
  converge();
  expect(text(bob)).toBe('one xy\ntwo!');
  expect(alice.editor.exec({ type: 'undo' }).ok).toBe(true);
  converge();
  expect(text(bob)).toBe('one\ntwo!');
});
