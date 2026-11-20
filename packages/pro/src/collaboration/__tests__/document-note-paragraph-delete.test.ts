/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Deleting one paragraph of a footnote (issue #2039) on two collaborating editors.
//
// The deletion replicates, converges with typing in the same note, undoes and redoes on both
// peers, and survives save and reopen. The last paragraph of a note is refused and sends nothing.
import { afterEach, expect, test } from 'bun:test';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '@docx-editor.dev/editor-api/browser';
import { reviewModule } from '../../review/review-module.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument, W, R, REL, type Peer } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

const harness = createPeerHarness('note-paragraph-delete', { offlineEditing: true });
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  harness.cleanup();
});

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

function fixture(): Uint8Array {
  const notes =
    `<w:footnotes xmlns:w="${W}">` +
    `<w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> Alpha.</w:t></w:r></w:p>` +
    `${p('Bravo.')}${p('Charlie.')}</w:footnote>` +
    `<w:footnote w:id="2">${p('Solo.')}</w:footnote></w:footnotes>`;
  return zipDocument(
    `<w:p><w:r><w:t>Body</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r>` +
      `<w:r><w:footnoteReference w:id="2"/></w:r></w:p><w:sectPr/>`,
    {
      overrides:
        '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>',
      documentRels: `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`,
      extraXml: { 'word/footnotes.xml': notes },
    }
  );
}

function mount(peer: Peer, author: string) {
  peer.detach();
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: peer.room.document,
    author,
    modules: [reviewModule(), collaborationModule({ session: peer.room.session })],
  });
  const runtime = DocxEditor.createBrowser(editor, { author });
  cleanups.push(() => {
    runtime.dispose();
    editor.destroy();
    container.remove();
  });
  return { editor, runtime };
}

type Mounted = ReturnType<typeof mount>;

/** The paragraph texts of footnote `index`, through the editing API. */
function noteTexts({ runtime }: Mounted, index = 0): Promise<string[]> {
  return runtime.run(async (context) => {
    const notes = context.document.body.footnotes;
    notes.load('items');
    await context.sync();
    const paragraphs = notes.items[index]!.body.paragraphs;
    paragraphs.load('items/text');
    await context.sync();
    return paragraphs.items.map((paragraph) => paragraph.text.replace('￼', '').trim());
  });
}

/** Delete paragraph `index` of footnote 1; answers the error code, or null when it applied. */
function deleteNoteParagraph({ runtime }: Mounted, index: number, note = 0) {
  return runtime.run(async (context) => {
    const notes = context.document.body.footnotes;
    notes.load('items');
    await context.sync();
    const paragraphs = notes.items[note]!.body.paragraphs;
    paragraphs.load('items');
    await context.sync();
    paragraphs.items[index]!.delete();
    return context.sync().then(
      () => null,
      (error: { code: string; debugInfo: { innerError?: { code: string } } }) =>
        `${error.code}/${error.debugInfo.innerError?.code ?? ''}`
    );
  });
}

/** Type `text` at `offset` in paragraph `index` of footnote 1, through the surface. */
function typeInNote({ editor }: Mounted, index: number, offset: number, text: string) {
  expect(editor.surface!.enterNote('footnote:1')).toBe(true);
  const note = editor
    .surface!.layout()
    .pages.flatMap((page) => page.footnotes?.notes ?? [])
    .find((candidate) => candidate.scopeId === 'footnote:1');
  const ids = [
    ...new Set(
      (note?.fragments ?? []).flatMap((block) =>
        block.kind === 'paragraph' ? [block.paragraphId] : []
      )
    ),
  ];
  const caret = { paragraphId: ids[index]!, offset };
  editor.surface!.setSelection({ anchor: caret, head: caret });
  editor.surface!.type(text);
}

test('a note paragraph deletion replicates, converges, undoes, and survives reopen', async () => {
  const peers = await harness.pair(fixture());
  const alice = mount(peers.alice, 'Alice');
  const bob = mount(peers.bob, 'Bob');
  const sync = () => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
    const a = alice.editor.surface!.session.currentPackage();
    const b = bob.editor.surface!.session.currentPackage();
    expect(packageFingerprint(a)).toBe(packageFingerprint(b));
    expect(saveReopenDigest(a)).toEqual(saveReopenDigest(b));
  };

  // Alice deletes Bravo while Bob types at the end of Charlie, concurrently.
  peers.pause();
  expect(await deleteNoteParagraph(alice, 1)).toBeNull();
  typeInNote(bob, 2, 'Charlie.'.length, ' typed');
  peers.alice.room.session.flushPendingJournals();
  peers.bob.room.session.flushPendingJournals();
  peers.resume();
  sync();
  expect(await noteTexts(alice)).toEqual(['Alpha.', 'Charlie. typed']);
  expect(await noteTexts(bob)).toEqual(['Alpha.', 'Charlie. typed']);
  expect(await noteTexts(bob, 1)).toEqual(['Solo.']);

  // Undo on Alice restores Bravo on both peers; redo removes it again.
  expect(alice.editor.exec({ type: 'undo' }).ok).toBe(true);
  sync();
  expect(await noteTexts(bob)).toEqual(['Alpha.', 'Bravo.', 'Charlie. typed']);
  expect(alice.editor.exec({ type: 'redo' }).ok).toBe(true);
  sync();
  expect(await noteTexts(bob)).toEqual(['Alpha.', 'Charlie. typed']);

  // Bob deletes Charlie while Alice types into it: both peers land on one document.
  peers.pause();
  typeInNote(alice, 1, 'Charlie.'.length, '!');
  expect(await deleteNoteParagraph(bob, 1)).toBeNull();
  peers.alice.room.session.flushPendingJournals();
  peers.bob.room.session.flushPendingJournals();
  peers.resume();
  sync();
  expect(await noteTexts(alice)).toEqual(await noteTexts(bob));
  expect((await noteTexts(alice))[0]).toBe('Alpha.');

  // Save and reopen keeps the note as the peers see it.
  const restored = createDocxEditor({
    container: document.createElement('div'),
    document: await alice.editor.save(),
    modules: [reviewModule()],
  });
  cleanups.push(() => restored.destroy());
  expect(saveReopenDigest(restored.surface!.session.currentPackage())).toEqual(
    saveReopenDigest(alice.editor.surface!.session.currentPackage())
  );

  // Reconnect: Bob rejoins and lands on the same document.
  bob.editor.destroy();
  const back = mount(await harness.remount(peers.bob), 'Bob');
  expect(packageFingerprint(back.editor.surface!.session.currentPackage())).toBe(
    packageFingerprint(alice.editor.surface!.session.currentPackage())
  );
});

test('the last paragraph of a note is refused and sends nothing', async () => {
  const peers = await harness.pair(fixture());
  const alice = mount(peers.alice, 'Alice');
  const bob = mount(peers.bob, 'Bob');
  const before = packageFingerprint(bob.editor.surface!.session.currentPackage());

  expect(await deleteNoteParagraph(alice, 0, 1)).toBe('NotSupported/edit.content-required');
  peers.alice.room.session.flushPendingJournals();

  expect(packageFingerprint(bob.editor.surface!.session.currentPackage())).toBe(before);
  expect(await noteTexts(bob, 1)).toEqual(['Solo.']);
});
