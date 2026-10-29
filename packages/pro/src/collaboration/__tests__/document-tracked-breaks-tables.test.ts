/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Page breaks, section breaks, and tables proposed through the document API on two
// collaborating editors. Each proposal replicates, survives a concurrent edit elsewhere, and
// a decision on the other peer replicates back; both peers then save the same bytes.

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

const TEXTS = ['Opening line.', 'Middle line here.', 'Closing line.'];
const BODY =
  TEXTS.map((text) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`).join('') +
  '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>';

async function room() {
  const harness = createPeerHarness('tracked-breaks-tables', { offlineEditing: true });
  const pair = await harness.pair(zipDocument(BODY));
  const peers = [pair.alice, pair.bob].map((peer, index) => {
    peer.detach();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = createDocxEditor({
      container,
      document: peer.room.document,
      modules: [reviewModule(), collaborationModule({ session: peer.room.session })],
    });
    const author = index === 0 ? 'Alice' : 'Bob';
    return { ...peer, editor, runtime: DocxEditor.createBrowser(editor, { author }), container };
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
type Proposal = 'page' | 'section' | 'table';

async function texts(runtime: Runtime): Promise<string[]> {
  return runtime.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load('items/text');
    await context.sync();
    return paragraphs.items.map((paragraph) => paragraph.text);
  });
}

async function propose(runtime: Runtime, proposal: Proposal): Promise<void> {
  await runtime.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load('items');
    await context.sync();
    context.document.changeTrackingMode = 'TrackMineOnly';
    const middle = paragraphs.items[1]!;
    if (proposal === 'table') middle.getRange('End').insertTable(1, 2, 'After', [['A', 'B']]);
    else
      middle.getRange('Start').insertBreak(proposal === 'page' ? 'Page' : 'SectionNext', 'After');
    await context.sync();
  });
}

async function decideAll(runtime: Runtime, decision: 'accept' | 'reject'): Promise<void> {
  await runtime.run(async (context) => {
    const revisions = context.document.body.revisions;
    if (decision === 'accept') revisions.acceptAll();
    else revisions.rejectAll();
    await context.sync();
  });
}

const PROPOSED: Record<Proposal, RegExp> = {
  page: /<w:ins [^>]*><w:r><w:br w:type="page"\/><\/w:r><\/w:ins>/,
  section: /<w:pPr><w:rPr><w:ins [^>]*\/><\/w:rPr><w:sectPr>/,
  table: /<w:trPr><w:ins [^>]*\/><\/w:trPr>/,
};

for (const proposal of ['page', 'section', 'table'] as const) {
  test(`a tracked ${proposal} survives a concurrent edit, and a rejection replicates back`, async () => {
    const r = await room();
    try {
      const [alice, bob] = r.peers;
      r.pair.pause();
      await propose(alice!.runtime, proposal);
      await bob!.runtime.run(async (context) => {
        context.document.body.paragraphs.getLast().insertText(' Added', 'End');
        await context.sync();
      });
      r.pair.resume();
      r.sync();
      const proposed = await r.savedXml();
      expect(proposed[0]).toBe(proposed[1]!);
      expect(proposed[1]).toMatch(PROPOSED[proposal]);
      await decideAll(bob!.runtime, 'reject');
      r.sync();
      const expected = [TEXTS[0], TEXTS[1], `${TEXTS[2]} Added`];
      for (const peer of r.peers) expect(await texts(peer.runtime)).toEqual(expected);
      const decided = await r.savedXml();
      expect(decided[0]).toBe(decided[1]!);
      expect(decided[0]).not.toMatch(/<w:ins |<w:tbl>|w:type="page"/);
    } finally {
      r.close();
    }
  });

  test(`accepting a tracked ${proposal} on the other peer replicates back`, async () => {
    const r = await room();
    try {
      const [alice, bob] = r.peers;
      await propose(alice!.runtime, proposal);
      r.sync();
      await decideAll(bob!.runtime, 'accept');
      r.sync();
      const xml = await r.savedXml();
      expect(xml[0]).toBe(xml[1]!);
      expect(xml[0]).not.toMatch(/<w:(ins|del) /);
    } finally {
      r.close();
    }
  });

  test(`undo and redo of a tracked ${proposal} replicate`, async () => {
    const r = await room();
    try {
      const [alice, bob] = r.peers;
      const before = (await r.savedXml())[1]!;
      await propose(alice!.runtime, proposal);
      r.sync();
      const proposed = (await r.savedXml())[1]!;
      expect(proposed).toMatch(PROPOSED[proposal]);
      expect(alice!.editor.exec({ type: 'undo' }).ok).toBe(true);
      r.sync();
      expect(await texts(bob!.runtime)).toEqual(TEXTS);
      expect((await r.savedXml())[1]).not.toMatch(PROPOSED[proposal]);
      expect(before).not.toMatch(PROPOSED[proposal]);
      expect(alice!.editor.exec({ type: 'redo' }).ok).toBe(true);
      r.sync();
      const redone = await r.savedXml();
      expect(redone[0]).toBe(redone[1]!);
      expect(redone[1]).toMatch(PROPOSED[proposal]);
    } finally {
      r.close();
    }
  });

  test(`deleting the anchor paragraph while the other peer proposes a ${proposal} converges`, async () => {
    const r = await room();
    try {
      const [alice, bob] = r.peers;
      r.pair.pause();
      await propose(alice!.runtime, proposal);
      await bob!.runtime.run(async (context) => {
        const paragraphs = context.document.body.paragraphs;
        paragraphs.load('items');
        await context.sync();
        paragraphs.items[1]!.delete();
        await context.sync();
      });
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
}

test('deleting the paragraph a tracked table goes in front of converges and rejects cleanly', async () => {
  const r = await room();
  try {
    const [alice, bob] = r.peers;
    r.pair.pause();
    await propose(alice!.runtime, 'table');
    await bob!.runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load('items');
      await context.sync();
      paragraphs.items[2]!.delete();
      await context.sync();
    });
    r.pair.resume();
    r.sync();
    const [left, right] = await Promise.all(r.peers.map((peer) => texts(peer.runtime)));
    expect(left).toEqual(right!);
    const merged = await r.savedXml();
    expect(merged[0]).toBe(merged[1]!);
    await decideAll(bob!.runtime, 'reject');
    r.sync();
    const decided = await r.savedXml();
    expect(decided[0]).toBe(decided[1]!);
    expect(decided[0]).not.toMatch(/<w:ins |<w:tbl>/);
    for (const peer of r.peers) expect(await texts(peer.runtime)).toEqual(TEXTS.slice(0, 2));
  } finally {
    r.close();
  }
});
