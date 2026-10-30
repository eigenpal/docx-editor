/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, expect, test } from 'bun:test';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { reviewModule } from '../../review/review-module.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';
import { mainPart, packageFingerprint, saveReopenDigest } from './document-support.ts';

const harness = createPeerHarness('caret-word-format', { offlineEditing: true });
const editors: DocxEditorInstance[] = [],
  containers: HTMLElement[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  for (const container of containers.splice(0)) container.remove();
  harness.cleanup();
});
function mount(peer: Peer, author: string, tracked = false) {
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
  if (tracked) expect(editor.exec({ type: 'setEditingMode', mode: 'suggesting' }).ok).toBe(true);
  return editor;
}
function caret(editor: DocxEditorInstance, offset: number) {
  const paragraphId = editor.surface!.session.paragraphIds()[0]!;
  editor.surface!.setSelection({ anchor: { paragraphId, offset }, head: { paragraphId, offset } });
}

for (const tracked of [false, true]) {
  test(`${tracked ? 'tracked' : 'plain'} caret word format converges with typing in the word`, async () => {
    const pair = await harness.pair(
      zipDocument('<w:p><w:r><w:t xml:space="preserve">abcd efgh</w:t></w:r></w:p><w:sectPr/>')
    );
    const alice = mount(pair.alice, 'Alice', tracked),
      bob = mount(pair.bob, 'Bob');
    const converge = () => {
      pair.alice.room.session.flushPendingJournals();
      pair.bob.room.session.flushPendingJournals();
      expect(packageFingerprint(alice.surface!.session.currentPackage())).toBe(
        packageFingerprint(bob.surface!.session.currentPackage())
      );
      expect(saveReopenDigest(alice.surface!.session.currentPackage())).toEqual(
        saveReopenDigest(bob.surface!.session.currentPackage())
      );
    };
    const xml = () => serializeOoxmlPart(mainPart(alice.surface!.session.currentPackage()));
    // Alice bolds the word at her caret while Bob types inside the same word.
    pair.pause();
    caret(alice, 2);
    caret(bob, 3);
    expect(alice.exec({ type: 'toggleMark', mark: 'bold' }).ok).toBe(true);
    bob.surface!.type('X');
    pair.resume();
    converge();
    expect(bob.surface!.session.bodyText()).toBe('abcXd efgh');
    expect(xml()).toContain('<w:b/>');
    if (tracked) expect(xml()).toContain('w:rPrChange');
    // Undo takes back the bold and keeps Bob's letter.
    expect(alice.exec({ type: 'undo' }).ok).toBe(true);
    converge();
    expect(xml()).not.toContain('<w:b/>');
    expect(bob.surface!.session.bodyText()).toBe('abcXd efgh');
    expect(alice.exec({ type: 'redo' }).ok).toBe(true);
    converge();
    expect(xml()).toContain('<w:b/>');
    // Bob deletes the word while Alice formats it again.
    pair.pause();
    const paragraphId = bob.surface!.session.paragraphIds()[0]!;
    bob.surface!.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 6 },
    });
    bob.surface!.deleteBackward();
    caret(alice, 1);
    alice.exec({ type: 'toggleMark', mark: 'italic' });
    pair.resume();
    converge();
    const container = document.createElement('div');
    document.body.append(container);
    containers.push(container);
    const reopened = createDocxEditor({
      container,
      document: new Uint8Array(await alice.save()),
      modules: [reviewModule()],
    });
    editors.push(reopened);
    expect(saveReopenDigest(reopened.surface!.session.currentPackage())).toEqual(
      saveReopenDigest(alice.surface!.session.currentPackage())
    );
  });
}
