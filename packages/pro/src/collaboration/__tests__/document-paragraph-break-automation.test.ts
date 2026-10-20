/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Paragraph breaks written with the document API's insertText on two collaborating editors.
//
// A line feed in the text splits the paragraph with the same op a multi-line paste uses, so it
// replicates as an ordinary paragraph split. Tracked, each new paragraph mark is a proposed
// insertion that the other peer can reject. Each test makes the peers diverge or decide, then
// checks that they converge on the same text and save the same bytes.

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

const CLAUSES =
  '<w:p><w:r><w:t xml:space="preserve">The supplier delivers the goods. The buyer pays on receipt.</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>Signed</w:t></w:r></w:p>';
const ORIGINAL = ['The supplier delivers the goods. The buyer pays on receipt.', 'Signed'];
const SPLIT = ['The supplier delivers the goods.', 'The buyer pays on receipt.', 'Signed'];

/** Paragraph marks proposed as insertions: `w:ins` inside the mark's `w:rPr`. */
const proposedMarks = (xml: string) =>
  xml.match(/<w:rPr><w:ins\b[^>]*\/><\/w:rPr><\/w:pPr>/g)?.length ?? 0;

async function room() {
  const harness = createPeerHarness('paragraph-break-automation', { offlineEditing: true });
  const pair = await harness.pair(zipDocument(CLAUSES));
  const peers = [
    { peer: pair.alice, author: 'Alice' },
    { peer: pair.bob, author: 'Bob' },
  ].map(({ peer, author }) => {
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
      runtime: DocxEditor.createBrowser(editor, { author }),
      container,
    };
  });
  return {
    pair,
    peers,
    sync() {
      for (const peer of peers) peer.room.session.flushPendingJournals();
    },
    async saved() {
      return Promise.all(peers.map(async (peer) => new Uint8Array(await peer.editor.save())));
    },
    async savedXml() {
      return (await this.saved()).map((bytes) => strFromU8(unzipSync(bytes)['word/document.xml']!));
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

type Room = Awaited<ReturnType<typeof room>>;
type Runtime = ReturnType<typeof DocxEditor.createBrowser>;

async function texts(runtime: Runtime | Awaited<ReturnType<typeof DocxEditor.createServer>>) {
  return runtime.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load('items/text');
    await context.sync();
    return paragraphs.items.map((paragraph) => paragraph.text);
  });
}

/** Splits the first clause from the second, the way an agent proposes it. */
async function splitClauses(runtime: Runtime, tracked: boolean): Promise<string> {
  return runtime.run(async (context) => {
    if (tracked) context.document.changeTrackingMode = 'TrackMineOnly';
    const found = context.document.body.search(' The buyer').getFirst();
    await context.sync();
    const written = found.insertText('\nThe buyer', 'Replace');
    await context.sync();
    written.load('text');
    await context.sync();
    return written.text;
  });
}

/** A paragraph split that only inserts: no struck text to read past. */
async function breakBefore(runtime: Runtime, find: string, tracked: boolean) {
  await runtime.run(async (context) => {
    if (tracked) context.document.changeTrackingMode = 'TrackMineOnly';
    const found = context.document.body.search(find).getFirst();
    await context.sync();
    found.insertText('\n', 'Before');
    await context.sync();
  });
}

async function expectConverged(r: Room, expected?: readonly string[]) {
  for (const peer of r.peers) expect(peer.room.session.statusSnapshot().status).toBe('ready');
  const [left, right] = await Promise.all(r.peers.map((peer) => texts(peer.runtime)));
  expect(left).toEqual(right!);
  if (expected) expect(left).toEqual([...expected]);
  const xml = await r.savedXml();
  expect(xml[0]).toBe(xml[1]!);
  return xml[0]!;
}

async function decidedOnReopen(bytes: Uint8Array, decision: 'acceptAll' | 'rejectAll') {
  const reopened = await DocxEditor.createServer(bytes);
  try {
    await reopened.run(async (context) => {
      context.document.body.revisions[decision]();
      await context.sync();
    });
    return await texts(reopened);
  } finally {
    reopened.dispose();
  }
}

test('an untracked paragraph split replicates to the other peer', async () => {
  const r = await room();
  try {
    await breakBefore(r.peers[0]!.runtime, 'The buyer', false);
    r.sync();
    const xml = await expectConverged(r, [
      'The supplier delivers the goods. ',
      'The buyer pays on receipt.',
      'Signed',
    ]);
    expect(xml).not.toContain('<w:ins');
  } finally {
    r.close();
  }
});

test('a tracked paragraph split converges, and saved bytes keep the proposed mark', async () => {
  const r = await room();
  try {
    const [alice] = r.peers;
    expect(await splitClauses(alice!.runtime, true)).toBe('\rThe buyer');
    r.sync();
    const xml = await expectConverged(r, [
      'The supplier delivers the goods. The buyer',
      'The buyer pays on receipt.',
      'Signed',
    ]);
    expect(proposedMarks(xml)).toBe(1);
    expect(xml).toContain('w:author="Alice"');
    for (const bytes of await r.saved()) {
      expect(await decidedOnReopen(bytes, 'rejectAll')).toEqual(ORIGINAL);
      expect(await decidedOnReopen(bytes, 'acceptAll')).toEqual(SPLIT);
    }
  } finally {
    r.close();
  }
});

test('reject all on the other peer restores the paragraph on both peers', async () => {
  const r = await room();
  try {
    const [alice, bob] = r.peers;
    await breakBefore(alice!.runtime, 'The buyer', true);
    r.sync();
    await bob!.runtime.run(async (context) => {
      context.document.body.revisions.rejectAll();
      await context.sync();
    });
    r.sync();
    const xml = await expectConverged(r, ORIGINAL);
    expect(xml).not.toContain('<w:ins');
  } finally {
    r.close();
  }
});

test('a concurrent edit in the same paragraph survives a tracked split made offline, after reconnect', async () => {
  const r = await room();
  try {
    const [alice, bob] = r.peers;
    r.pair.pause();
    await breakBefore(alice!.runtime, 'The buyer', true);
    await bob!.runtime.run(async (context) => {
      context.document.body.paragraphs.getFirst().insertText('Delivery: ', 'Start');
      await context.sync();
    });
    r.sync();
    r.pair.resume();
    r.sync();
    const xml = await expectConverged(r, [
      'Delivery: The supplier delivers the goods. ',
      'The buyer pays on receipt.',
      'Signed',
    ]);
    expect(proposedMarks(xml)).toBe(1);
    const [bytes] = await r.saved();
    expect(await decidedOnReopen(bytes!, 'rejectAll')).toEqual([
      'Delivery: The supplier delivers the goods. The buyer pays on receipt.',
      'Signed',
    ]);
  } finally {
    r.close();
  }
});

test('deleting the paragraph while the other peer splits it converges', async () => {
  const r = await room();
  try {
    const [alice, bob] = r.peers;
    r.pair.pause();
    await breakBefore(alice!.runtime, 'The buyer', true);
    await bob!.runtime.run(async (context) => {
      context.document.body.paragraphs.getFirst().delete();
      await context.sync();
    });
    r.sync();
    r.pair.resume();
    r.sync();
    await expectConverged(r);
  } finally {
    r.close();
  }
});

test('undo and redo of a tracked split replicate to the other peer', async () => {
  const r = await room();
  try {
    const [alice, bob] = r.peers;
    await breakBefore(alice!.runtime, 'The buyer', true);
    r.sync();
    expect(await texts(bob!.runtime)).toHaveLength(3);
    expect(alice!.editor.exec({ type: 'undo' }).ok).toBe(true);
    r.sync();
    expect(await texts(bob!.runtime)).toEqual(ORIGINAL);
    expect(alice!.editor.exec({ type: 'redo' }).ok).toBe(true);
    r.sync();
    const xml = await expectConverged(r, [
      'The supplier delivers the goods. ',
      'The buyer pays on receipt.',
      'Signed',
    ]);
    expect(proposedMarks(xml)).toBe(1);
  } finally {
    r.close();
  }
});
