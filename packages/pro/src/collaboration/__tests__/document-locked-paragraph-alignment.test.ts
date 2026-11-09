/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, expect, test } from 'bun:test';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { caretAt } from '@docx-editor.dev/core/layout';
import {
  contentControlsIn,
  contentControlTextOf,
  serializeOoxmlPart,
} from '@docx-editor.dev/core/store';
import { reviewModule } from '../../review/review-module.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';
import { mainPart, packageFingerprint, saveReopenDigest } from './document-support.ts';

const harness = createPeerHarness('locked-paragraph-alignment', { offlineEditing: true });
const editors: DocxEditorInstance[] = [];
const containers: HTMLElement[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  for (const container of containers.splice(0)) container.remove();
  harness.cleanup();
});

const fixture = () =>
  zipDocument(
    '<w:sdt><w:sdtPr><w:tag w:val="locked"/><w:lock w:val="contentLocked"/></w:sdtPr>' +
      '<w:sdtContent><w:p><w:pPr><w:ind w:left="240"/><w:jc w:val="left"/></w:pPr>' +
      '<w:r><w:t>LOCKED</w:t></w:r></w:p></w:sdtContent></w:sdt>' +
      '<w:p><w:r><w:t>outside</w:t></w:r></w:p><w:sectPr/>'
  );

function mount(peer: Peer, author: string, tracked: boolean) {
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

function select(editor: DocxEditorInstance, index: number, start: number, end = start) {
  const paragraphId = editor.surface!.session.paragraphIds()[index]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset: start },
    head: { paragraphId, offset: end },
  });
}

function xml(editor: DocxEditorInstance) {
  return serializeOoxmlPart(mainPart(editor.surface!.session.currentPackage()));
}

function controlText(editor: DocxEditorInstance) {
  const control = contentControlsIn(mainPart(editor.surface!.session.currentPackage()).root)[0];
  return control ? contentControlTextOf(control.node) : null;
}

async function settle(...open: DocxEditorInstance[]) {
  // Remote commits schedule layout on a timer; assert the published revision before reading geometry.
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (
      open.every(
        (editor) => editor.surface!.layout().revision === editor.surface!.session.packageRevision()
      )
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  for (const editor of open)
    expect(editor.surface!.layout().revision).toBe(editor.surface!.session.packageRevision());
}

for (const tracked of [false, true]) {
  test(`${tracked ? 'tracked' : 'plain'} alignment converges through history, typing, presence, and reconnect`, async () => {
    const pair = await harness.pair(fixture());
    const alice = mount(pair.alice, 'Alice', tracked),
      bob = mount(pair.bob, 'Bob', false);
    const flush = () => {
      pair.alice.room.session.flushPendingJournals();
      pair.bob.room.session.flushPendingJournals();
    };
    const converge = async () => {
      flush();
      await settle(alice, bob);
      expect(packageFingerprint(alice.surface!.session.currentPackage())).toBe(
        packageFingerprint(bob.surface!.session.currentPackage())
      );
      expect(saveReopenDigest(alice.surface!.session.currentPackage())).toEqual(
        saveReopenDigest(bob.surface!.session.currentPackage())
      );
      expect(controlText(alice)).toBe('LOCKED');
      expect(controlText(bob)).toBe('LOCKED');
      expect(xml(bob)).toContain('<w:ind w:left="240"/>');
      expect(xml(bob)).toContain('<w:lock w:val="contentLocked"/>');
    };
    select(alice, 0, 2);
    expect(alice.can({ type: 'setAlignment', align: 'center' }).ok).toBe(true);
    pair.pause();
    const result = alice.exec({ type: 'setAlignment', align: 'center' });
    expect(result.ok).toBe(true);
    select(bob, 1, 0);
    expect(bob.exec({ type: 'insertText', text: 'Z' }).ok).toBe(true);
    flush();
    pair.resume();
    await converge();
    select(bob, 0, 1, 4);
    expect(bob.surface!.formatting().alignment).toBe('center');
    expect(xml(bob).includes('<w:pPrChange ')).toBe(tracked);
    const aligned = packageFingerprint(bob.surface!.session.currentPackage());
    expect(bob.exec({ type: 'toggleMark', mark: 'bold' }).ok).toBe(false);
    bob.surface!.type('X');
    expect(bob.surface!.state().lastRejection).toBe('this content is locked');
    expect(packageFingerprint(bob.surface!.session.currentPackage())).toBe(aligned);
    expect(alice.exec({ type: 'undo' }).ok).toBe(true);
    await converge();
    select(bob, 0, 2);
    expect(bob.surface!.formatting().alignment).toBe('left');
    expect(bob.surface!.session.bodyText()).toBe('LOCKED\nZoutside');
    expect(alice.exec({ type: 'redo' }).ok).toBe(true);
    await converge();
    select(bob, 0, 2);
    expect(bob.surface!.formatting().alignment).toBe('center');

    const local = bob.surface!.state().selection;
    const beforePresence = packageFingerprint(bob.surface!.session.currentPackage());
    select(alice, 0, 1, 4);
    applyAwarenessUpdate(
      pair.bob.awareness,
      encodeAwarenessUpdate(pair.alice.awareness, [pair.alice.ydoc.clientID]),
      'alignment-test'
    );
    const remote = pair.bob.room.session.remoteSelections()[0];
    expect(remote).toBeDefined();
    if (!remote) throw Error('The remote selection is missing');
    expect(remote.anchor.offset).toBe(1);
    expect(remote.head.offset).toBe(4);
    expect(caretAt(bob.surface!.layout(), { paragraphId: remote.head.nodeId, offset: 4 })).toEqual(
      caretAt(alice.surface!.layout(), alice.surface!.state().selection.head)
    );
    expect(bob.surface!.state().selection).toEqual(local);
    expect(packageFingerprint(bob.surface!.session.currentPackage())).toBe(beforePresence);

    const container = document.createElement('div');
    document.body.append(container);
    containers.push(container);
    const reopened = createDocxEditor({
      container,
      document: new Uint8Array(await bob.save()),
      modules: [reviewModule()],
    });
    editors.push(reopened);
    expect(saveReopenDigest(reopened.surface!.session.currentPackage())).toEqual(
      saveReopenDigest(bob.surface!.session.currentPackage())
    );
    expect(controlText(reopened)).toBe('LOCKED');
    bob.destroy();
    const returning = mount(await harness.remount(pair.bob), 'Bob', false);
    expect(packageFingerprint(returning.surface!.session.currentPackage())).toBe(
      packageFingerprint(alice.surface!.session.currentPackage())
    );
    select(returning, 0, 2);
    expect(returning.surface!.formatting().alignment).toBe('center');
  });

  test(`${tracked ? 'tracked' : 'plain'} alignment does not restore a control a peer deletes`, async () => {
    const pair = await harness.pair(fixture());
    const alice = mount(pair.alice, 'Alice', tracked),
      bob = mount(pair.bob, 'Bob', false);
    pair.pause();
    select(alice, 0, 2);
    expect(alice.exec({ type: 'setAlignment', align: 'center' }).ok).toBe(true);
    const control = contentControlsIn(mainPart(bob.surface!.session.currentPackage()).root)[0]!;
    expect(
      bob.surface!.session.applyTreeOps([
        { op: 'removeContentControl', controlId: control.node.id, keepContent: false },
      ]).committed
    ).toBe(true);
    pair.alice.room.session.flushPendingJournals();
    pair.bob.room.session.flushPendingJournals();
    pair.resume();
    expect(packageFingerprint(alice.surface!.session.currentPackage())).toBe(
      packageFingerprint(bob.surface!.session.currentPackage())
    );
    expect(controlText(alice)).toBeNull();
    expect(controlText(bob)).toBeNull();
    expect(bob.surface!.session.bodyText()).toBe('outside');
    expect(saveReopenDigest(alice.surface!.session.currentPackage())).toEqual(
      saveReopenDigest(bob.surface!.session.currentPackage())
    );
  });
}
