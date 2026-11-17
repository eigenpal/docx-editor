/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A selection across footnotes (issue #2010) on two collaborating editors.
//
// The selection is local, but what it does is shared: bold across notes must replicate and
// undo on both peers, a refused deletion must send nothing, and the presence of a cross-note
// range must reach the other participant while it edits one of those notes.
import { afterEach, expect, test } from 'bun:test';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import type { SemanticPosition } from '@docx-editor.dev/core/layout';
import { reviewModule } from '../../review/review-module.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument, W, R, REL, type Peer } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

const harness = createPeerHarness('note-story-selection', { offlineEditing: true });
const editors: DocxEditorInstance[] = [];
const containers: HTMLElement[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  for (const container of containers.splice(0)) container.remove();
  harness.cleanup();
});

const TEXTS = ['Alpha note.', 'Bravo note.', 'Charlie note.'];

function fixture(): Uint8Array {
  const body = TEXTS.map(
    (_, i) =>
      `<w:p><w:r><w:t>Body ${i + 1}</w:t></w:r><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr>` +
      `<w:footnoteReference w:id="${i + 1}"/></w:r></w:p>`
  ).join('');
  const notes =
    `<w:footnotes xmlns:w="${W}" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">` +
    TEXTS.map(
      (text, i) =>
        `<w:footnote w:id="${i + 1}"><w:p w14:paraId="0000001${i}"><w:r><w:footnoteRef/></w:r>` +
        `<w:r><w:t xml:space="preserve"> ${text}</w:t></w:r></w:p></w:footnote>`
    ).join('') +
    '</w:footnotes>';
  return zipDocument(body + '<w:sectPr/>', {
    overrides:
      '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>',
    documentRels: `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`,
    extraXml: { 'word/footnotes.xml': notes },
  });
}

function mount(peer: Peer, author: string): DocxEditorInstance {
  peer.detach();
  const container = document.createElement('div');
  document.body.append(container);
  containers.push(container);
  const editor = createDocxEditor({
    container,
    document: peer.room.document,
    author,
    modules: [reviewModule(), collaborationModule({ session: peer.room.session })],
  });
  editors.push(editor);
  expect(editor.surface).toBeDefined();
  return editor;
}

function noteParagraphId(editor: DocxEditorInstance, index: number): string {
  const note = editor
    .surface!.layout()
    .pages.flatMap((page) => page.footnotes?.notes ?? [])
    .find((candidate) => candidate.scopeId === `footnote:${index + 1}`);
  const fragment = note?.fragments.find((block) => block.kind === 'paragraph');
  if (!fragment || fragment.kind !== 'paragraph') throw Error(`footnote ${index + 1} is missing`);
  return fragment.paragraphId;
}

/** A position in a note's text, past its leading mark. */
function at(editor: DocxEditorInstance, index: number, offset: number): SemanticPosition {
  return { paragraphId: noteParagraphId(editor, index), offset: 1 + offset };
}

function footnotes(editor: DocxEditorInstance): string {
  return editor.surface!.session.storyText({ kind: 'notesPart', noteKind: 'footnote' }) ?? '';
}

function boldAt(editor: DocxEditorInstance, index: number): boolean {
  const caret = at(editor, index, 3);
  editor.surface!.setSelection({ anchor: caret, head: caret });
  return editor.surface!.formatting().bold === true;
}

test('a cross-note selection formats, refuses deletion and shows presence on two editors', async () => {
  const peers = await harness.pair(fixture());
  const alice = mount(peers.alice, 'Alice');
  const bob = mount(peers.bob, 'Bob');
  const sync = () => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
    const a = alice.surface!.session.currentPackage();
    const b = bob.surface!.session.currentPackage();
    expect(packageFingerprint(a)).toBe(packageFingerprint(b));
    expect(saveReopenDigest(a)).toEqual(saveReopenDigest(b));
  };

  // Alice selects from footnote 1 into footnote 3 while Bob types in footnote 2.
  expect(alice.surface!.enterNote('footnote:1')).toBe(true);
  expect(bob.surface!.enterNote('footnote:2')).toBe(true);
  peers.pause();
  alice.surface!.setSelection({ anchor: at(alice, 0, 2), head: at(alice, 2, 4) });
  const bobCaret = at(bob, 1, 6);
  bob.surface!.setSelection({ anchor: bobCaret, head: bobCaret });
  bob.surface!.type('Z');
  peers.alice.room.session.flushPendingJournals();
  peers.bob.room.session.flushPendingJournals();
  peers.resume();
  sync();
  expect(footnotes(alice)).toContain('BravoZ note.');
  expect(alice.surface!.activeScope()).toEqual({ kind: 'note', id: 'footnote:3' });

  // The range still spans the notes after the remote edit, and deleting it is refused on
  // Alice's side without sending anything to Bob.
  const selection = alice.surface!.state().selection;
  expect(selection.anchor.paragraphId).toBe(noteParagraphId(alice, 0));
  expect(selection.head.paragraphId).toBe(noteParagraphId(alice, 2));
  const before = packageFingerprint(bob.surface!.session.currentPackage());
  alice.surface!.deleteBackward();
  alice.surface!.type('x');
  sync();
  expect(packageFingerprint(bob.surface!.session.currentPackage())).toBe(before);
  for (const text of ['Alpha', 'BravoZ', 'Charlie']) expect(footnotes(bob)).toContain(text);

  // Presence: Bob receives Alice's range with its ends in footnote 1 and footnote 3, and his
  // own caret and document stay as they were.
  const bobSelection = bob.surface!.state().selection;
  applyAwarenessUpdate(
    peers.bob.awareness,
    encodeAwarenessUpdate(peers.alice.awareness, [peers.alice.ydoc.clientID]),
    'note-story-presence'
  );
  const remote = peers.bob.room.session.remoteSelections()[0];
  expect(remote?.anchor.nodeId).toBe(noteParagraphId(bob, 0));
  expect(remote?.head.nodeId).toBe(noteParagraphId(bob, 2));
  expect(bob.surface!.state().selection).toEqual(bobSelection);
  expect(packageFingerprint(bob.surface!.session.currentPackage())).toBe(before);

  // Bold across the notes replicates, and so does its undo.
  expect(alice.surface!.toggleRunProperty('b')).toBeNull();
  sync();
  expect(TEXTS.map((_, index) => boldAt(bob, index))).toEqual([true, true, true]);
  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  sync();
  expect(TEXTS.map((_, index) => boldAt(bob, index))).toEqual([false, false, false]);
  expect(alice.exec({ type: 'redo' }).ok).toBe(true);
  sync();
  expect(boldAt(bob, 1)).toBe(true);

  // Bob deletes footnote 2's text while Alice's range still covers it: both converge.
  peers.pause();
  bob.surface!.setSelection({ anchor: at(bob, 1, 0), head: at(bob, 1, 6) });
  bob.surface!.deleteBackward();
  alice.surface!.setSelection({ anchor: at(alice, 0, 2), head: at(alice, 2, 4) });
  expect(alice.surface!.toggleRunProperty('i')).toBeNull();
  peers.alice.room.session.flushPendingJournals();
  peers.bob.room.session.flushPendingJournals();
  peers.resume();
  sync();
  expect(footnotes(alice)).not.toContain('BravoZ');

  // Save and reopen keeps three notes, each with its own mark and text.
  const saved = await alice.save();
  const restored = createDocxEditor({
    container: document.createElement('div'),
    document: saved,
    modules: [reviewModule()],
  });
  editors.push(restored);
  expect(saveReopenDigest(restored.surface!.session.currentPackage())).toEqual(
    saveReopenDigest(alice.surface!.session.currentPackage())
  );
  expect(footnotes(restored)).toContain('Alpha');
  expect(footnotes(restored)).toContain('Charlie');

  // Reconnect: Bob rejoins and lands on the same document.
  bob.destroy();
  const rejoined = await harness.remount(peers.bob);
  const back = mount(rejoined, 'Bob');
  expect(packageFingerprint(back.surface!.session.currentPackage())).toBe(
    packageFingerprint(alice.surface!.session.currentPackage())
  );
});
