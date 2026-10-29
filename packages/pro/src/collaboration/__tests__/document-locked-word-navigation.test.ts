/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, expect, test } from 'bun:test';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import type { StoryScope } from '@docx-editor.dev/core/store';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

const harness = createPeerHarness('locked-word-navigation');
const editors: DocxEditorInstance[] = [],
  containers: HTMLElement[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  for (const container of containers.splice(0)) container.remove();
  harness.cleanup();
});
function mount(peer: Peer) {
  peer.detach();
  const container = document.createElement('div');
  document.body.append(container);
  containers.push(container);
  const editor = createDocxEditor({
    container,
    document: peer.room.document,
    modules: [collaborationModule({ session: peer.room.session })],
  });
  editors.push(editor);
  return editor;
}
const paragraph =
  '<w:p><w:r><w:t>aa</w:t></w:r><w:sdt><w:sdtPr><w:lock w:val="sdtContentLocked"/><w:text/></w:sdtPr><w:sdtContent><w:r><w:t>TOKEN</w:t></w:r></w:sdtContent></w:sdt><w:r><w:t>zz</w:t></w:r></w:p>';
for (const header of [false, true]) {
  test(`${header ? 'header' : 'body'} word navigation preserves peer edits and history`, async () => {
    const pair = await harness.pair(
      header
        ? zipDocument(
            '<w:p><w:r><w:t>body</w:t></w:r></w:p><w:sectPr><w:headerReference w:type="default" r:id="rHdr"/></w:sectPr>',
            {
              overrides:
                '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>',
              documentRels:
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rHdr" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/></Relationships>',
              extraXml: {
                'word/header1.xml': `<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${paragraph}</w:hdr>`,
              },
            }
          )
        : zipDocument(paragraph)
    );
    const alice = mount(pair.alice),
      bob = mount(pair.bob);
    const scope: StoryScope = header ? { kind: 'headerFooter', rId: 'rHdr' } : { kind: 'body' };
    if (header)
      for (const editor of [alice, bob])
        expect(editor.surface!.enterHeaderFooter!({ rId: 'rHdr' })).toBe(true);
    const paragraphId = alice.surface!.session.paragraphIdsIn(scope)[0]!;
    const select = (editor: DocxEditorInstance, from: number, to = from) =>
      editor.surface!.setSelection({
        anchor: { paragraphId, offset: from },
        head: { paragraphId, offset: to },
      });
    const text = () => alice.surface!.session.storyText(scope);
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
    const before = packageFingerprint(alice.surface!.session.currentPackage());
    select(alice, 0);
    select(bob, 9);
    const bobSelection = bob.surface!.state().selection;
    alice.surface!.navigate('wordRight');
    expect(alice.surface!.state().selection.head.offset).toBe(2);
    applyAwarenessUpdate(
      pair.bob.awareness,
      encodeAwarenessUpdate(pair.alice.awareness, [pair.alice.ydoc.clientID]),
      'word-navigation-test'
    );
    expect(pair.bob.room.session.remoteSelections()[0]?.head.offset).toBe(2);
    expect(bob.surface!.state().selection).toEqual(bobSelection);
    expect(packageFingerprint(alice.surface!.session.currentPackage())).toBe(before);
    expect(packageFingerprint(bob.surface!.session.currentPackage())).toBe(before);
    pair.pause();
    select(alice, 0);
    select(bob, 9);
    alice.surface!.type('A');
    bob.surface!.type('B');
    flush();
    pair.resume();
    converge();
    expect(text()).toBe('AaaTOKENzzB');
    expect(alice.exec({ type: 'undo' }).ok).toBe(true);
    converge();
    expect(text()).toBe('aaTOKENzzB');
    expect(alice.exec({ type: 'redo' }).ok).toBe(true);
    converge();
    expect(text()).toBe('AaaTOKENzzB');
    select(alice, 0);
    alice.surface!.navigate('wordRight');
    expect(alice.surface!.state().selection.head.offset).toBe(3);
    alice.surface!.navigate('wordRight');
    expect(alice.surface!.state().selection.head.offset).toBe(8);
    pair.pause();
    select(alice, 8, 10);
    select(bob, 10);
    alice.surface!.deleteBackward();
    bob.surface!.type('C');
    flush();
    pair.resume();
    converge();
    expect(text()).toBe('AaaTOKENCB');
    if (header) expect(alice.surface!.session.bodyText()).toBe('body');
    const container = document.createElement('div');
    document.body.append(container);
    containers.push(container);
    const reopened = createDocxEditor({ container, document: new Uint8Array(await alice.save()) });
    editors.push(reopened);
    expect(saveReopenDigest(reopened.surface!.session.currentPackage())).toEqual(
      saveReopenDigest(alice.surface!.session.currentPackage())
    );
  });
}
