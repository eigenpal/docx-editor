/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Text highlights on collaborating editors. Highlights are local view state: they never enter
// the shared document, and remote edits move or hide them by the same text check as local ones.
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { loadPackage, packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('text-highlight-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: { editor: Editor; container: HTMLElement }[] = [];
afterEach(() => {
  for (const { editor, container } of editors.splice(0)) {
    editor.destroy();
    container.remove();
  }
  harness.cleanup();
});

const BODY =
  '<w:p><w:r><w:t xml:space="preserve">Supplier pays Supplier.</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t xml:space="preserve">The Supplier signs.</w:t></w:r></w:p><w:sectPr/>';

function mount(
  document_: Uint8Array,
  session: Parameters<typeof collaborationModule>[0]['session']
) {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: document_,
    modules: [collaborationModule({ session })],
  });
  editors.push({ editor, container });
  return { editor, container };
}

async function pair() {
  const peers = await harness.pair(zipDocument(BODY));
  const [alice, bob] = [peers.alice, peers.bob].map((peer) => {
    peer.detach();
    return mount(peer.room.document, peer.room.session);
  }) as [ReturnType<typeof mount>, ReturnType<typeof mount>];
  function sync() {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
  }
  function converged() {
    sync();
    alice.editor.surface!.layout();
    bob.editor.surface!.layout();
    const left = alice.editor.surface!.session.currentPackage();
    const right = bob.editor.surface!.session.currentPackage();
    expect(packageFingerprint(right)).toBe(packageFingerprint(left));
    expect(saveReopenDigest(right)).toEqual(saveReopenDigest(left));
  }
  async function join() {
    const peer = await harness.join(peers.alice, 'late-peer');
    peer.detach();
    return mount(peer.room.document, peer.room.session);
  }
  return { alice, bob, sync, converged, join, pause: peers.pause, resume: peers.resume };
}

function marked(container: HTMLElement, set = 'search'): number[] {
  const elements = container.querySelectorAll<HTMLElement>(
    `[data-highlight-set="${set}"] .docx-text-highlight`
  );
  return [...new Set([...elements].map((element) => Number(element.dataset.highlightIndex)))].sort(
    (a, b) => a - b
  );
}

function placeCaret(editor: Editor, blockId: string, offset: number): void {
  const caret = { paragraphId: blockId, offset };
  expect(editor.exec({ type: 'setSelection', range: { anchor: caret, head: caret } }).ok).toBe(
    true
  );
}

test('highlights stay local and never change the shared document', async () => {
  const { alice, bob, converged, join } = await pair();
  const before = packageFingerprint(bob.editor.surface!.session.currentPackage());
  expect(alice.editor.setHighlights('search', alice.editor.findMatches('Supplier'))).toEqual({
    applied: 3,
    unavailable: 0,
  });
  converged();
  expect(marked(alice.container)).toEqual([0, 1, 2]);
  expect(marked(bob.container)).toEqual([]);
  expect(packageFingerprint(bob.editor.surface!.session.currentPackage())).toBe(before);
  const late = await join();
  expect(marked(late.container)).toEqual([]);
  // Saving with marks on screen writes the same document the unmarked peer saves.
  const withMarks = loadPackage(new Uint8Array(await alice.editor.save()));
  const unmarked = loadPackage(new Uint8Array(await bob.editor.save()));
  expect(saveReopenDigest(withMarks)).toEqual(saveReopenDigest(unmarked));
});

test('a remote edit inside a marked word hides that mark; edits elsewhere keep the others', async () => {
  const { alice, bob, converged } = await pair();
  alice.editor.setHighlights('search', alice.editor.findMatches('Supplier'));
  const target = bob.editor.findMatches('Supplier')[2]!;
  placeCaret(bob.editor, target.blockId, target.start + 3);
  expect(bob.editor.exec({ type: 'insertText', text: 'X' }).ok).toBe(true);
  converged();
  expect(marked(alice.container)).toEqual([0, 1]);
  // Searching again marks what the document says now.
  expect(alice.editor.setHighlights('search', alice.editor.findMatches('Supplier')).applied).toBe(
    2
  );
});

test('remote undo and redo bring a mark back and hide it again', async () => {
  const { alice, bob, converged } = await pair();
  alice.editor.setHighlights('search', alice.editor.findMatches('Supplier'));
  const target = bob.editor.findMatches('signs')[0]!;
  // Bob rewrites the text inside Alice's last mark.
  const supplier = bob.editor.findMatches('Supplier')[2]!;
  bob.editor.exec({
    type: 'setSelection',
    range: {
      anchor: { paragraphId: supplier.blockId, offset: supplier.start },
      head: { paragraphId: supplier.blockId, offset: supplier.start + supplier.length },
    },
  });
  expect(bob.editor.exec({ type: 'insertText', text: 'Vendor' }).ok).toBe(true);
  converged();
  expect(marked(alice.container)).toEqual([0, 1]);
  expect(target.blockId).toBe(supplier.blockId);

  expect(bob.editor.exec({ type: 'undo' }).ok).toBe(true);
  converged();
  expect(marked(alice.container)).toEqual([0, 1, 2]);

  expect(bob.editor.exec({ type: 'redo' }).ok).toBe(true);
  converged();
  expect(marked(alice.container)).toEqual([0, 1]);
});

test('a concurrent paragraph deletion while marking converges and hides its marks', async () => {
  const { alice, bob, sync, converged, pause, resume } = await pair();
  const matches = alice.editor.findMatches('Supplier');
  pause();
  // Bob deletes the second paragraph's text while Alice marks it offline.
  const second = bob.editor.findMatches('The Supplier signs.')[0]!;
  bob.editor.exec({
    type: 'setSelection',
    range: {
      anchor: { paragraphId: second.blockId, offset: 0 },
      head: { paragraphId: second.blockId, offset: second.length },
    },
  });
  expect(bob.editor.exec({ type: 'insertText', text: 'Removed.' }).ok).toBe(true);
  expect(alice.editor.setHighlights('search', matches, { activeIndex: 2 }).applied).toBe(3);
  expect(marked(alice.container)).toEqual([0, 1, 2]);
  sync();
  resume();
  converged();
  expect(marked(alice.container)).toEqual([0, 1]);
  expect(alice.editor.findMatches('Supplier')).toHaveLength(2);
  expect(bob.editor.findMatches('Removed.')).toHaveLength(1);
});
