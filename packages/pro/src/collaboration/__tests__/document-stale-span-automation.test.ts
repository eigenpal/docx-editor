/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A range across several paragraphs, read by one participant, while another participant edits
// between its endpoints. Deleting the old range would remove the peer's paragraph, so the
// document API refuses it with `StaleDocument`, and both replicas keep the peer's text.

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

const THREE =
  '<w:p><w:r><w:t>First clause</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>Second clause</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>Third clause</w:t></w:r></w:p>';

async function room() {
  const harness = createPeerHarness('stale-span-automation', { offlineEditing: true });
  const pair = await harness.pair(zipDocument(THREE));
  const peers = [pair.alice, pair.bob].map((peer, index) => {
    peer.detach();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = createDocxEditor({
      container,
      document: peer.room.document,
      modules: [reviewModule(), collaborationModule({ session: peer.room.session })],
    });
    return {
      editor,
      runtime: DocxEditor.createBrowser(editor, { author: index === 0 ? 'Alice' : 'Bob' }),
      container,
      room: peer.room,
    };
  });
  return {
    peers,
    sync() {
      for (const peer of peers) peer.room.session.flushPendingJournals();
    },
    close() {
      for (const peer of peers) {
        peer.runtime.dispose();
        peer.editor.destroy();
        peer.container.remove();
      }
      harness.cleanup();
    },
  };
}

type Runtime = ReturnType<typeof DocxEditor.createBrowser>;

async function texts(runtime: Runtime): Promise<string[]> {
  return runtime.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load();
    await context.sync();
    for (const paragraph of paragraphs.items) paragraph.load('text');
    await context.sync();
    return paragraphs.items.map((paragraph) => paragraph.text);
  });
}

for (const edit of ['insert', 'change'] as const) {
  test(`a peer that ${edit}s a paragraph between a range's endpoints makes it stale`, async () => {
    const r = await room();
    try {
      const [alice, bob] = r.peers;
      await alice!.runtime.run(async (context) => {
        const whole = context.document.body.getRange('Whole');
        whole.load('text');
        await context.sync();

        await bob!.runtime.run(async (peer) => {
          const paragraphs = peer.document.body.paragraphs;
          paragraphs.load();
          await peer.sync();
          if (edit === 'insert') paragraphs.items[0]!.insertParagraph('Peer clause', 'After');
          else paragraphs.items[1]!.insertText(' amended', 'End');
          await peer.sync();
        });
        r.sync();

        whole.delete();
        await expect(context.sync()).rejects.toMatchObject({ code: 'StaleDocument' });
      });
      r.sync();
      const expected =
        edit === 'insert'
          ? ['First clause', 'Peer clause', 'Second clause', 'Third clause']
          : ['First clause', 'Second clause amended', 'Third clause'];
      for (const peer of r.peers) expect(await texts(peer.runtime)).toEqual(expected);
    } finally {
      r.close();
    }
  });
}

test('without a peer edit, the same range deletes on both replicas', async () => {
  const r = await room();
  try {
    const [alice] = r.peers;
    await alice!.runtime.run(async (context) => {
      const whole = context.document.body.getRange('Whole');
      whole.load('text');
      await context.sync();
      whole.delete();
      await context.sync();
    });
    r.sync();
    for (const peer of r.peers) expect((await texts(peer.runtime)).join('')).toBe('');
  } finally {
    r.close();
  }
});
