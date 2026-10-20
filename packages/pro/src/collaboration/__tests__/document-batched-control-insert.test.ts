/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import { expect, test } from 'bun:test';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '@docx-editor.dev/editor-api/browser';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

test('batched control handles stay distinct across peers, history, reconnect, and reopen', async () => {
  const harness = createPeerHarness('batched-control-insert', { offlineEditing: true });
  const pair = await harness.pair(zipDocument(p('First') + p('Second') + p('Third')));
  const peers = [pair.alice, pair.bob].map((peer) => {
    peer.detach();
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({
      container,
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
    return { ...peer, editor, container, runtime: DocxEditor.createBrowser(editor) };
  });
  const [alice, bob] = peers;
  const sync = () => {
    for (const peer of peers) peer.room.session.flushPendingJournals();
    expect(packageFingerprint(alice!.editor.surface!.session.currentPackage())).toBe(
      packageFingerprint(bob!.editor.surface!.session.currentPackage())
    );
  };
  try {
    pair.pause();
    await alice!.runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load('items');
      await context.sync();
      const first = paragraphs.items[0]!.getRange('Content').insertContentControl('PlainText');
      const second = paragraphs.items[1]!.getRange('Content').insertContentControl('PlainText');
      await context.sync();
      first.tag = 'first';
      second.tag = 'second';
      await context.sync();
    });
    await bob!.runtime.run(async (context) => {
      context.document.body.search('Third').getFirst().insertText('Other', 'Replace');
      await context.sync();
    });
    for (const peer of peers) peer.room.session.flushPendingJournals();
    pair.resume();
    sync();
    for (const peer of peers) {
      await peer.runtime.run(async (context) => {
        const first = context.document.contentControls.getByTag('first').getFirst();
        const second = context.document.contentControls.getByTag('second').getFirst();
        first.load('text');
        second.load('text');
        await context.sync();
        expect([first.text, second.text]).toEqual(['First', 'Second']);
      });
    }
    expect(alice!.editor.exec({ type: 'undo' }).ok).toBe(true);
    sync();
    expect(alice!.editor.exec({ type: 'redo' }).ok).toBe(true);
    sync();
    pair.pause();
    await alice!.runtime.run(async (context) => {
      context.document.contentControls.getByTag('first').getFirst().delete(false);
      await context.sync();
    });
    await bob!.runtime.run(async (context) => {
      context.document.contentControls.getByTag('first').getFirst().insertText('Edited', 'Replace');
      await context.sync();
    });
    for (const peer of peers) peer.room.session.flushPendingJournals();
    pair.resume();
    sync();
    const reopened = createDocxEditor({ document: new Uint8Array(await bob!.editor.save()) });
    try {
      const container = document.createElement('div');
      reopened.attach(container);
      expect(saveReopenDigest(reopened.surface!.session.currentPackage())).toEqual(
        saveReopenDigest(bob!.editor.surface!.session.currentPackage())
      );
    } finally {
      reopened.destroy();
    }
  } finally {
    for (const peer of peers) {
      peer.runtime.dispose();
      peer.editor.destroy();
      peer.container.remove();
    }
    harness.cleanup();
  }
});
