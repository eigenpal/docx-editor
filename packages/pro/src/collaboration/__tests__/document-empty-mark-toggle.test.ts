/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, expect, test } from 'bun:test';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { caretAt } from '@docx-editor.dev/core/layout';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { reviewModule } from '../../review/review-module.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';
import { mainPart, packageFingerprint, saveReopenDigest } from './document-support.ts';

const harness = createPeerHarness('empty-mark-toggle', { offlineEditing: true });
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
function caret(editor: DocxEditorInstance, offset = 0) {
  const paragraphId = editor.surface!.session.paragraphIds()[0]!;
  editor.surface!.setSelection({ anchor: { paragraphId, offset }, head: { paragraphId, offset } });
}
for (const tracked of [false, true]) {
  test(`${tracked ? 'tracked' : 'plain'} empty-mark toggle preserves peer input, history, and saved formatting`, async () => {
    const pair = await harness.pair(
      zipDocument('<w:p><w:pPr><w:rPr><w:b/></w:rPr></w:pPr></w:p><w:sectPr/>')
    );
    const alice = mount(pair.alice, 'Alice', tracked),
      bob = mount(pair.bob, 'Bob');
    const flush = () => {
      pair.alice.room.session.flushPendingJournals();
      pair.bob.room.session.flushPendingJournals();
    };
    const converge = () => {
      flush();
      expect(packageFingerprint(alice.surface!.session.currentPackage())).toBe(
        packageFingerprint(bob.surface!.session.currentPackage())
      );
      expect(saveReopenDigest(alice.surface!.session.currentPackage())).toEqual(
        saveReopenDigest(bob.surface!.session.currentPackage())
      );
    };
    caret(alice);
    caret(bob);
    const before = packageFingerprint(alice.surface!.session.currentPackage());
    expect(alice.getSelectionFormatting()?.bold).toBe(true);
    expect(alice.exec({ type: 'toggleMark', mark: 'bold' }).ok).toBe(true);
    expect(alice.getSelectionFormatting()?.bold).toBe(false);
    expect(packageFingerprint(alice.surface!.session.currentPackage())).toBe(before);
    expect(bob.getSelectionFormatting()?.bold).toBe(true);
    pair.pause();
    alice.surface!.type('A');
    bob.surface!.type('B');
    flush();
    pair.resume();
    converge();
    expect(alice.surface!.session.bodyText()).toMatch(/^(AB|BA)$/);
    const xml = serializeOoxmlPart(mainPart(alice.surface!.session.currentPackage()));
    expect(xml).toContain('<w:b w:val="0"/>');
    expect(xml).toContain('<w:pPr><w:rPr><w:b/></w:rPr></w:pPr>');
    expect(alice.exec({ type: 'undo' }).ok).toBe(true);
    converge();
    expect(bob.surface!.session.bodyText()).toBe('B');
    expect(alice.exec({ type: 'redo' }).ok).toBe(true);
    converge();
    expect(alice.surface!.session.bodyText()).toMatch(/^(AB|BA)$/);
    pair.pause();
    const text = alice.surface!.session.bodyText();
    caret(alice, text.indexOf('A') + 1);
    const paragraphId = bob.surface!.session.paragraphIds()[0]!;
    bob.surface!.setSelection({
      anchor: { paragraphId, offset: text.indexOf('B') },
      head: { paragraphId, offset: text.indexOf('B') + 1 },
    });
    alice.surface!.type('C');
    bob.surface!.deleteBackward();
    flush();
    pair.resume();
    converge();
    expect(alice.surface!.session.bodyText()).toBe('AC');
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (
        [alice, bob].every(
          (editor) =>
            editor.surface!.layout().revision === editor.surface!.session.packageRevision()
        )
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    for (const editor of [alice, bob])
      expect(editor.surface!.layout().revision).toBe(editor.surface!.session.packageRevision());
    const local = bob.surface!.state().selection;
    const beforePresence = packageFingerprint(bob.surface!.session.currentPackage());
    alice.surface!.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 1 },
    });
    applyAwarenessUpdate(
      pair.bob.awareness,
      encodeAwarenessUpdate(pair.alice.awareness, [pair.alice.ydoc.clientID]),
      'empty-mark-test'
    );
    const remote = pair.bob.room.session.remoteSelections()[0];
    expect(remote).toBeDefined();
    if (!remote) throw Error('The remote selection is missing');
    expect(remote.anchor.offset).toBe(0);
    expect(remote.head.offset).toBe(1);
    expect(caretAt(bob.surface!.layout(), { paragraphId: remote.head.nodeId, offset: 1 })).toEqual(
      caretAt(alice.surface!.layout(), alice.surface!.state().selection.head)
    );
    expect(bob.surface!.state().selection).toEqual(local);
    expect(packageFingerprint(bob.surface!.session.currentPackage())).toBe(beforePresence);
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
    bob.destroy();
    const returning = mount(await harness.remount(pair.bob), 'Bob');
    expect(packageFingerprint(returning.surface!.session.currentPackage())).toBe(
      packageFingerprint(alice.surface!.session.currentPackage())
    );
  });
}
