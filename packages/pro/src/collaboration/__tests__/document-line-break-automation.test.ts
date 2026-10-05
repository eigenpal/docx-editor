/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Manual line breaks written through the document API on two collaborating editors (#1124).
//
// A line break is the same inline `w:br` the editor writes for a soft return, so it replicates
// as an ordinary paragraph edit. Each test makes the peers diverge, then checks that they
// converge on the same text and save the same bytes.

import { afterAll, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
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

const ADDRESS =
  '<w:p><w:r><w:t xml:space="preserve">Acme Ltd 1 Main Street</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>Signed</w:t></w:r></w:p>';

async function room() {
  const harness = createPeerHarness('line-break-automation', { offlineEditing: true });
  const pair = await harness.pair(zipDocument(ADDRESS));
  const peers = [pair.alice, pair.bob].map((peer) => {
    peer.detach();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = createDocxEditor({
      container,
      document: peer.room.document,
      modules: [reviewModule(), collaborationModule({ session: peer.room.session })],
    });
    return {
      ...peer,
      editor,
      runtime: DocxEditor.createBrowser(editor, { author: 'Writer' }),
      container,
    };
  });
  return {
    pair,
    peers,
    sync() {
      for (const peer of peers) peer.room.session.flushPendingJournals();
    },
    async savedXml() {
      const saved = await Promise.all(
        peers.map(async (peer) => new Uint8Array(await peer.editor.save()))
      );
      return saved.map((bytes) => strFromU8(unzipSync(bytes)['word/document.xml']!));
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

async function breakBefore(runtime: Runtime, find: string, tracked = false): Promise<void> {
  await runtime.run(async (context) => {
    const found = context.document.body.search(find);
    found.load('items');
    await context.sync();
    if (tracked) context.document.changeTrackingMode = 'TrackMineOnly';
    found.items[0]!.insertBreak('Line', 'Before');
    await context.sync();
  });
}

// A concurrent append to the SAME run as a new break is a separate defect of run replication
// (#1129), which a break typed with Shift+Enter shares. These tests keep concurrent edits in
// different paragraphs and make same-paragraph edits in turn.
test('line breaks made at once in different paragraphs both survive', async () => {
  const r = await room();
  try {
    const [alice, bob] = r.peers;
    r.pair.pause();
    await breakBefore(alice!.runtime, '1 Main');
    await bob!.runtime.run(async (context) => {
      context.document.body.paragraphs.getLast().insertText('\vName', 'End');
      await context.sync();
    });
    r.pair.resume();
    r.sync();
    for (const peer of r.peers)
      expect(await texts(peer.runtime)).toEqual(['Acme Ltd \n1 Main Street', 'Signed\nName']);
    const xml = await r.savedXml();
    expect(xml[0]).toBe(xml[1]!);
    expect(xml[0]!.match(/<w:br\/>/g)).toHaveLength(2);
  } finally {
    r.close();
  }
});

test('an edit after a replicated line break in the same paragraph keeps both', async () => {
  const r = await room();
  try {
    const [alice, bob] = r.peers;
    await breakBefore(alice!.runtime, '1 Main');
    r.sync();
    await bob!.runtime.run(async (context) => {
      context.document.body.paragraphs.getFirst().insertText(', London', 'End');
      await context.sync();
    });
    r.sync();
    for (const peer of r.peers)
      expect((await texts(peer.runtime))[0]).toBe('Acme Ltd \n1 Main Street, London');
    const xml = await r.savedXml();
    expect(xml[0]).toBe(xml[1]!);
  } finally {
    r.close();
  }
});

test('deleting the paragraph while the other peer breaks it converges', async () => {
  const r = await room();
  try {
    const [alice, bob] = r.peers;
    r.pair.pause();
    await alice!.runtime.run(async (context) => {
      context.document.body.paragraphs.getFirst().delete();
      await context.sync();
    });
    await breakBefore(bob!.runtime, '1 Main');
    r.pair.resume();
    r.sync();
    const [left, right] = await Promise.all(r.peers.map((peer) => texts(peer.runtime)));
    expect(left).toEqual(right!);
    const xml = await r.savedXml();
    expect(xml[0]).toBe(xml[1]!);
  } finally {
    r.close();
  }
});

test('a tracked line break replicates, and its rejection on the other peer replicates back', async () => {
  const r = await room();
  try {
    const [alice, bob] = r.peers;
    await breakBefore(alice!.runtime, '1 Main', true);
    r.sync();
    expect((await r.savedXml())[1]).toMatch(/<w:ins [^>]*><w:r><w:br\/><\/w:r><\/w:ins>/);
    await bob!.runtime.run(async (context) => {
      const revisions = context.document.body.revisions;
      revisions.load('items');
      await context.sync();
      expect(revisions.items).toHaveLength(1);
      revisions.rejectAll();
      await context.sync();
    });
    r.sync();
    for (const peer of r.peers)
      expect(await texts(peer.runtime)).toEqual(['Acme Ltd 1 Main Street', 'Signed']);
    const xml = await r.savedXml();
    expect(xml[0]).toBe(xml[1]!);
    expect(xml[0]).not.toContain('<w:br');
  } finally {
    r.close();
  }
});

test('undo and redo of a line break replicate to the other peer', async () => {
  const r = await room();
  try {
    const [alice, bob] = r.peers;
    await breakBefore(alice!.runtime, '1 Main');
    r.sync();
    expect((await texts(bob!.runtime))[0]).toBe('Acme Ltd \n1 Main Street');
    expect(alice!.editor.exec({ type: 'undo' }).ok).toBe(true);
    r.sync();
    expect((await texts(bob!.runtime))[0]).toBe('Acme Ltd 1 Main Street');
    expect(alice!.editor.exec({ type: 'redo' }).ok).toBe(true);
    r.sync();
    expect((await texts(bob!.runtime))[0]).toBe('Acme Ltd \n1 Main Street');
    const xml = await r.savedXml();
    expect(xml[0]).toBe(xml[1]!);
  } finally {
    r.close();
  }
});
