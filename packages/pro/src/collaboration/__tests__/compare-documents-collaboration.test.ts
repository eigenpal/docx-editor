/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '@docx-editor.dev/editor-api/browser';
import { collaborationModule, reviewModule } from '../../index';
import { createPeerHarness, zipDocument } from './document-peer-support';

const registered = !GlobalRegistrator.isRegistered;
if (registered) GlobalRegistrator.register();
afterAll(() => {
  if (registered) GlobalRegistrator.unregister();
});

const REVISED = zipDocument('<w:p><w:r><w:t>Revised body text</w:t></w:r></w:p>');

test('compare refuses in a collaborative session and peers keep converging', async () => {
  const harness = createPeerHarness('compare-documents', { offlineEditing: true });
  const pair = await harness.pair(zipDocument('<w:p><w:r><w:t>Body text</w:t></w:r></w:p>'));
  const peers = [pair.alice, pair.bob].map((peer) => {
    peer.detach();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = createDocxEditor({
      container,
      document: peer.room.document,
      modules: [reviewModule(), collaborationModule({ session: peer.room.session })],
    });
    return { editor, container, runtime: DocxEditor.createBrowser(editor) };
  });
  const flush = () => {
    pair.alice.room.session.flushPendingJournals();
    pair.bob.room.session.flushPendingJournals();
  };
  const text = (index: number) =>
    peers[index]!.runtime.run(async (c) => {
      const body = c.document.body;
      body.load('text');
      await c.sync();
      return body.text;
    });
  try {
    const revised = Buffer.from(REVISED).toString('base64');
    for (const peer of peers) {
      const before = new Uint8Array(await peer.editor.save());
      await expect(
        peer.runtime.run(async (c) => {
          c.document.compareFromBase64(revised);
          await c.sync();
        })
      ).rejects.toMatchObject({ code: 'NotSupported' });
      expect(new Uint8Array(await peer.editor.save())).toEqual(before);
    }
    await peers[0]!.runtime.run(async (c) => {
      c.document.body.insertText(' from Alice', 'End');
      await c.sync();
    });
    flush();
    expect((await text(1)).trim()).toBe('Body text from Alice');
    expect(await text(0)).toBe(await text(1));
  } finally {
    for (const peer of peers) {
      peer.runtime.dispose();
      peer.editor.destroy();
      peer.container.remove();
    }
  }
});
