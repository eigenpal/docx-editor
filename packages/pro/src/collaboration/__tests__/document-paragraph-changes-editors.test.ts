/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// `paragraphsChange` on collaborating editors. A peer's edit reaches the other editor as a
// `remote` event, and a host that re-reads only the listed paragraphs holds the same text as
// a full read, through splits, merges, undo, concurrent edits and a reconnect.
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import type { ParagraphsChangeEvent } from '@docx-editor.dev/core/contracts/editor';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('paragraph-changes-room', { offlineEditing: true });
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
  '<w:p><w:r><w:t xml:space="preserve">First line here.</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t xml:space="preserve">Second line here.</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t xml:space="preserve">Third line here.</w:t></w:r></w:p><w:sectPr/>';

/** A host that keeps one checked text per paragraph and re-reads only what events list. */
function follow(editor: Editor) {
  const events: ParagraphsChangeEvent[] = [];
  const checked = new Map(editor.getParagraphs().map((p) => [p.blockId, p.acceptedText]));
  editor.on('paragraphsChange', (event) => {
    events.push(event);
    for (const id of event.deleted) checked.delete(id);
    for (const id of [...event.added, ...event.changed]) {
      const paragraph = editor.getParagraphText(id);
      expect(paragraph).not.toBeNull();
      checked.set(id, paragraph!.acceptedText);
    }
  });
  return {
    events,
    /** The followed texts equal a full read of the document. */
    expectCurrent() {
      const full = new Map(editor.getParagraphs().map((p) => [p.blockId, p.acceptedText]));
      expect(checked).toEqual(full);
    },
  };
}

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
  return { editor, container, ...follow(editor) };
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
    alice.expectCurrent();
    bob.expectCurrent();
  }
  return { alice, bob, sync, converged, pause: peers.pause, resume: peers.resume };
}

function caret(editor: Editor, text: string, offset: number): string {
  const match = editor.findMatches(text)[0]!;
  const at = { paragraphId: match.blockId, offset: match.start + offset };
  expect(editor.exec({ type: 'setSelection', range: { anchor: at, head: at } }).ok).toBe(true);
  return match.blockId;
}

const ids = (editor: Editor) => editor.getParagraphs().map((p) => p.blockId);

test('a peer types: the other editor gets a remote change for that paragraph', async () => {
  const { alice, bob, converged } = await pair();
  const second = alice.editor.findMatches('Second')[0]!.blockId;
  caret(bob.editor, 'Second', 6);
  expect(bob.editor.exec({ type: 'insertText', text: 'X' }).ok).toBe(true);
  converged();
  expect(bob.events.at(-1)).toMatchObject({ source: 'local' });
  const remote = alice.events.filter((event) => event.source === 'remote');
  expect(remote.length).toBeGreaterThan(0);
  expect(remote.flatMap((event) => event.changed)).toContain(second);
  expect(remote.flatMap((event) => [...event.added, ...event.deleted])).toEqual([]);
  expect(alice.events.every((event) => event.source === 'remote')).toBe(true);
});

test('remote split, merge, undo and redo keep the followed paragraphs current', async () => {
  const { alice, bob, converged } = await pair();
  caret(bob.editor, 'Second line', 6);
  expect(bob.editor.exec({ type: 'splitParagraph' }).ok).toBe(true);
  converged();
  expect(ids(alice.editor)).toHaveLength(4);
  const added = alice.events.flatMap((event) => event.added);
  expect(added.length).toBe(1);
  expect(ids(alice.editor)).toContain(added[0]!);

  // Bob merges the split back by deleting across the boundary, then undoes and redoes it.
  const head = bob.editor.findMatches('Second')[0]!;
  const tail = bob.editor.findMatches(' line here.')[1]!;
  expect(
    bob.editor.exec({
      type: 'setSelection',
      range: {
        anchor: { paragraphId: head.blockId, offset: 6 },
        head: { paragraphId: tail.blockId, offset: 0 },
      },
    }).ok
  ).toBe(true);
  expect(bob.editor.exec({ type: 'deleteText' }).ok).toBe(true);
  converged();
  expect(ids(alice.editor)).toHaveLength(3);
  expect(alice.events.flatMap((event) => event.deleted).length).toBeGreaterThan(0);

  expect(bob.editor.exec({ type: 'undo' }).ok).toBe(true);
  expect(bob.events.at(-1)!.source).toBe('local');
  converged();
  expect(ids(alice.editor)).toHaveLength(4);
  expect(bob.editor.exec({ type: 'redo' }).ok).toBe(true);
  converged();
  expect(ids(alice.editor)).toHaveLength(3);
  expect(alice.events.every((event) => event.source === 'remote')).toBe(true);
});

test('concurrent edits and a deletion during a disconnect converge after reconnect', async () => {
  const { alice, bob, sync, converged, pause, resume } = await pair();
  pause();
  // Alice types in the third paragraph while Bob deletes the second one and edits the first.
  caret(alice.editor, 'Third', 5);
  expect(alice.editor.exec({ type: 'insertText', text: ' typed' }).ok).toBe(true);
  caret(alice.editor, 'Second', 0);
  expect(alice.editor.exec({ type: 'insertText', text: 'Alice ' }).ok).toBe(true);
  const first = bob.editor.findMatches('First line here.')[0]!;
  const second = bob.editor.findMatches('Second line here.')[0]!;
  expect(
    bob.editor.exec({
      type: 'setSelection',
      range: {
        anchor: { paragraphId: first.blockId, offset: first.length },
        head: { paragraphId: second.blockId, offset: second.length },
      },
    }).ok
  ).toBe(true);
  expect(bob.editor.exec({ type: 'deleteText' }).ok).toBe(true);
  caret(bob.editor, 'First', 0);
  expect(bob.editor.exec({ type: 'insertText', text: 'Bob ' }).ok).toBe(true);
  sync();
  resume();
  converged();
  expect(alice.events.some((event) => event.source === 'remote')).toBe(true);
  expect(bob.events.some((event) => event.source === 'remote')).toBe(true);
  // A local undo after the reconnect is local on its own editor and remote on the other.
  const before = alice.events.length;
  expect(alice.editor.exec({ type: 'undo' }).ok).toBe(true);
  expect(alice.events.slice(before).every((event) => event.source === 'local')).toBe(true);
  converged();
});

test("one participant's split, merge, paste, undo and redo are local to it and remote to the peer", async () => {
  const { alice, bob, converged } = await pair();
  const before = { alice: alice.events.length, bob: bob.events.length };
  caret(bob.editor, 'Second line', 6);
  expect(bob.editor.exec({ type: 'splitParagraph' }).ok).toBe(true);
  converged();
  const head = bob.editor.findMatches('Second')[0]!;
  const tail = bob.editor.findMatches(' line here.')[1]!;
  expect(
    bob.editor.exec({
      type: 'setSelection',
      range: {
        anchor: { paragraphId: head.blockId, offset: 6 },
        head: { paragraphId: tail.blockId, offset: 0 },
      },
    }).ok
  ).toBe(true);
  expect(bob.editor.exec({ type: 'deleteText' }).ok).toBe(true);
  converged();
  caret(bob.editor, 'Third', 5);
  expect(
    bob.editor.exec({ type: 'paste', text: 'One\nTwo', html: '<p>One</p><p>Two</p>' }).ok
  ).toBe(true);
  converged();
  expect(bob.editor.exec({ type: 'undo' }).ok).toBe(true);
  converged();
  expect(bob.editor.exec({ type: 'redo' }).ok).toBe(true);
  converged();
  const own = bob.events.slice(before.bob);
  const seen = alice.events.slice(before.alice);
  expect(own.length).toBeGreaterThan(0);
  expect(own.filter((event) => event.source !== 'local')).toEqual([]);
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.filter((event) => event.source !== 'remote')).toEqual([]);
});
