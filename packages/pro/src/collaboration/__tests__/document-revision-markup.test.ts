/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { paragraphTextOf, serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { collaborationModule, reviewModule } from '../../index';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support';
import { packageFingerprint, saveReopenDigest } from './document-support';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('revision-markup', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
const containers: HTMLElement[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  for (const container of containers.splice(0)) container.remove();
  harness.cleanup();
});
function mount(peer: Peer, author: string, trackFormatting: boolean) {
  peer.detach();
  const container = document.createElement('div');
  document.body.append(container);
  containers.push(container);
  const editor = createDocxEditor({
    container,
    document: peer.room.document,
    author,
    mode: 'suggesting',
    reviewDisplayMode: 'all-markup',
    revisionMarkup: { trackFormatting },
    modules: [reviewModule(), collaborationModule({ session: peer.room.session })],
  });
  editors.push(editor);
  return { editor, container };
}
function select(editor: Editor, start: number, end = start) {
  const paragraphId = editor.surface!.session.paragraphIds()[0]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset: start },
    head: { paragraphId, offset: end },
  });
}
function xml(editor: Editor) {
  return serializeOoxmlPart(editor.surface!.session.part());
}

test('local markup stays private while tracked edits converge, undo, reconnect, and reopen', async () => {
  const cells = ['Alice', 'Bob']
    .map(
      (author, index) =>
        `<w:tc><w:tcPr><w:cellIns w:id="${index + 30}" w:author="${author}"/></w:tcPr><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc>`
    )
    .join('');
  const pair = await harness.pair(
    zipDocument(
      `<w:p><w:r><w:t>Anchor</w:t></w:r></w:p><w:tbl><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid><w:tr>${cells}</w:tr></w:tbl>`
    )
  );
  const alice = mount(pair.alice, 'Alice', false);
  const bob = mount(pair.bob, 'Bob', true);
  const sync = () => {
    pair.alice.room.session.flushPendingJournals();
    pair.bob.room.session.flushPendingJournals();
  };
  const converge = () => {
    sync();
    expect(packageFingerprint(alice.editor.surface!.session.currentPackage())).toBe(
      packageFingerprint(bob.editor.surface!.session.currentPackage())
    );
  };
  const before = xml(alice.editor);
  alice.editor.setRevisionMarkup({
    insertions: { mark: 'doubleUnderline', color: 'red' },
    cells: { inserted: 'byAuthor', merged: 'lightPurple', split: 'lightGreen', deleted: 'gray' },
  });
  const aliceCells = alice.container.querySelectorAll<HTMLElement>('[data-revision-cell]');
  expect(aliceCells[0]!.style.backgroundColor).toBe('var(--doc-review-author-0)');
  expect(aliceCells[1]!.style.backgroundColor).toBe('var(--doc-review-author-1)');
  expect(
    bob.container.querySelector<HTMLElement>('[data-revision-cell]')!.style.backgroundColor
  ).toBe('var(--doc-revision-color-lightBlue)');
  expect(xml(alice.editor)).toBe(before);
  expect(xml(bob.editor)).toBe(before);
  expect(bob.editor.snapshot().revisionMarkup.insertions.mark).toBe('underline');
  select(alice.editor, 0, 6);
  alice.editor.surface!.toggleRunProperty('b');
  converge();
  expect(xml(bob.editor)).toContain('<w:b');
  expect(xml(bob.editor)).not.toContain('rPrChange');
  alice.editor.surface!.setParagraphProperty('jc', { val: 'center' });
  converge();
  expect(xml(bob.editor)).not.toContain('pPrChange');
  expect(alice.editor.getEditingMode()).toBe('suggesting');

  select(alice.editor, 2);
  applyAwarenessUpdate(
    pair.bob.awareness,
    encodeAwarenessUpdate(pair.alice.awareness, [pair.alice.awareness.clientID]),
    'test'
  );
  expect(bob.container.querySelector('.docx-remote-caret')).not.toBeNull();
  pair.pause();
  select(alice.editor, 6);
  alice.editor.surface!.type(' A');
  select(bob.editor, 0);
  bob.editor.surface!.type('B ');
  sync();
  pair.resume();
  converge();
  expect(xml(bob.editor)).toContain('w:author="Alice"');
  expect(xml(bob.editor)).toContain('w:author="Bob"');
  expect(alice.editor.exec({ type: 'undo' }).ok).toBe(true);
  converge();
  expect(alice.editor.exec({ type: 'redo' }).ok).toBe(true);
  converge();

  pair.pause();
  select(alice.editor, 2, 4);
  alice.editor.surface!.deleteBackward();
  select(bob.editor, 3);
  bob.editor.surface!.type('X');
  sync();
  pair.resume();
  converge();
  expect(xml(bob.editor)).toContain('w:del');
  expect(alice.editor.snapshot().revisionMarkup.trackFormatting).toBe(false);
  expect(bob.editor.snapshot().revisionMarkup.trackFormatting).toBe(true);

  bob.editor.setRevisionMarkup({ trackFormatting: false });
  select(bob.editor, 0, 1);
  bob.editor.surface!.toggleRunProperty('i');
  converge();
  expect(xml(alice.editor)).not.toContain('rPrChange');
  bob.editor.setRevisionMarkup({ trackFormatting: true });
  // Concurrent insertions can occupy offset two. Format surviving original text.
  const originalOffset = paragraphTextOf(
    bob.editor.surface!.session.part(),
    bob.editor.surface!.session.paragraphIds()[0]!
  )!.indexOf('chor');
  expect(originalOffset).toBeGreaterThanOrEqual(0);
  select(bob.editor, originalOffset, originalOffset + 1);
  bob.editor.surface!.toggleRunProperty('i');
  converge();
  expect(xml(alice.editor)).toContain('rPrChange');

  const rejoined = await harness.join(pair.alice, 'rejoined');
  const joined = mount(rejoined, 'Returning', true);
  expect(packageFingerprint(joined.editor.surface!.session.currentPackage())).toBe(
    packageFingerprint(alice.editor.surface!.session.currentPackage())
  );
  expect(joined.editor.snapshot().revisionMarkup.insertions.mark).toBe('underline');
  expect(joined.editor.snapshot().revisionMarkup.cells.inserted).toBe('lightBlue');
  expect(alice.editor.snapshot().revisionMarkup.cells.inserted).toBe('byAuthor');
  const saved = new Uint8Array(await alice.editor.save());
  const reopened = createDocxEditor({ document: saved, modules: [reviewModule()] });
  editors.push(reopened);
  const container = document.createElement('div');
  document.body.append(container);
  containers.push(container);
  reopened.attach(container);
  expect(saveReopenDigest(reopened.surface!.session.currentPackage())).toEqual(
    saveReopenDigest(alice.editor.surface!.session.currentPackage())
  );
});
