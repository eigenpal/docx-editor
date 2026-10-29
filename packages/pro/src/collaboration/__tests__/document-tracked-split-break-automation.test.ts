/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// `Paragraph.split` and `Range.insertBreak` with TrackMineOnly on two collaborating editors.
//
// One peer proposes a split or a break through the document API while the other edits the same
// paragraph, decides the proposal, or undoes it. Each test checks that both peers converge on
// the same text and save the same bytes, and that accept and reject still resolve after reopen.

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

const BODY =
  '<w:p><w:r><w:t xml:space="preserve">One; two; three</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>Signed</w:t></w:r></w:p>';
const ORIGINAL = ['One; two; three', 'Signed'];
const SPLIT = ['One; ', 'two; ', 'three', 'Signed'];

/** Paragraph marks proposed as insertions: `w:ins` inside the mark's `w:rPr`. */
const proposedMarks = (xml: string) =>
  xml.match(/<w:pPr><w:rPr><w:ins\b[^>]*\/><\/w:rPr>/g)?.length ?? 0;

async function room() {
  const harness = createPeerHarness('tracked-split-break-automation', { offlineEditing: true });
  const pair = await harness.pair(zipDocument(BODY));
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
    return { ...peer, editor, runtime: DocxEditor.createBrowser(editor, { author }), container };
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

/** The proposal under test: a tracked split of the first paragraph at each "; ". */
async function trackedSplit(runtime: Runtime) {
  await runtime.run(async (context) => {
    context.document.changeTrackingMode = 'TrackMineOnly';
    const paragraph = context.document.body.paragraphs.getFirst();
    await context.sync();
    paragraph.split(['; ']);
    await context.sync();
  });
}

async function trackedBreak(runtime: Runtime, find: string, type: 'Page' | 'SectionNext') {
  await runtime.run(async (context) => {
    context.document.changeTrackingMode = 'TrackMineOnly';
    const found = context.document.body.search(find).getFirst();
    await context.sync();
    found.insertBreak(type, 'After');
    await context.sync();
  });
}

async function decide(runtime: Runtime, decision: 'acceptAll' | 'rejectAll') {
  await runtime.run(async (context) => {
    context.document.body.revisions[decision]();
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
    const xml = strFromU8(unzipSync(await reopened.save())['word/document.xml']!);
    return { texts: await texts(reopened), xml };
  } finally {
    reopened.dispose();
  }
}

test('a tracked split converges, and saved bytes accept and reject after reopen', async () => {
  const r = await room();
  try {
    await trackedSplit(r.peers[0]!.runtime);
    r.sync();
    const xml = await expectConverged(r, SPLIT);
    expect(proposedMarks(xml)).toBe(2);
    expect(xml).toContain('w:author="Alice"');
    for (const bytes of await r.saved()) {
      expect((await decidedOnReopen(bytes, 'rejectAll')).texts).toEqual(ORIGINAL);
      expect((await decidedOnReopen(bytes, 'acceptAll')).texts).toEqual(SPLIT);
    }
  } finally {
    r.close();
  }
});

test('the other peer accepts or rejects a tracked split, on both peers', async () => {
  for (const decision of ['acceptAll', 'rejectAll'] as const) {
    const r = await room();
    try {
      const [alice, bob] = r.peers;
      await trackedSplit(alice!.runtime);
      r.sync();
      await decide(bob!.runtime, decision);
      r.sync();
      const xml = await expectConverged(r, decision === 'acceptAll' ? SPLIT : ORIGINAL);
      expect(xml).not.toContain('<w:ins');
    } finally {
      r.close();
    }
  }
});

test('an offline edit in the same paragraph survives a tracked split after reconnect', async () => {
  const r = await room();
  try {
    const [alice, bob] = r.peers;
    r.pair.pause();
    await trackedSplit(alice!.runtime);
    await bob!.runtime.run(async (context) => {
      context.document.body.paragraphs.getFirst().insertText('Items: ', 'Start');
      await context.sync();
    });
    r.sync();
    r.pair.resume();
    r.sync();
    const xml = await expectConverged(r, ['Items: One; ', 'two; ', 'three', 'Signed']);
    expect(proposedMarks(xml)).toBe(2);
    const [bytes] = await r.saved();
    expect((await decidedOnReopen(bytes!, 'rejectAll')).texts).toEqual([
      'Items: One; two; three',
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
    await trackedSplit(alice!.runtime);
    await bob!.runtime.run(async (context) => {
      context.document.body.paragraphs.getFirst().delete();
      await context.sync();
    });
    r.sync();
    r.pair.resume();
    r.sync();
    // The deletion removes the paragraph it named, which now holds only the first piece, and
    // the text it saw: the split moved that text into the new pieces, so they show none of it,
    // as after a split into two. The pieces stay, with the split's proposed mark between them.
    const xml = await expectConverged(r, ['', '', 'Signed']);
    expect(proposedMarks(xml)).toBe(1);
  } finally {
    r.close();
  }
});

test('undo and redo of a tracked split replicate to the other peer', async () => {
  const r = await room();
  try {
    const [alice, bob] = r.peers;
    await trackedSplit(alice!.runtime);
    r.sync();
    expect(await texts(bob!.runtime)).toEqual(SPLIT);
    expect(alice!.editor.exec({ type: 'undo' }).ok).toBe(true);
    r.sync();
    expect(await texts(bob!.runtime)).toEqual(ORIGINAL);
    expect(alice!.editor.exec({ type: 'redo' }).ok).toBe(true);
    r.sync();
    expect(proposedMarks(await expectConverged(r, SPLIT))).toBe(2);
  } finally {
    r.close();
  }
});

test('a tracked page break converges and the other peer rejects it', async () => {
  const r = await room();
  try {
    const [alice, bob] = r.peers;
    await trackedBreak(alice!.runtime, 'two', 'Page');
    r.sync();
    const xml = await expectConverged(r);
    expect(xml).toMatch(
      /<w:ins\b[^>]*w:author="Alice"[^>]*><w:r><w:br w:type="page"\/><\/w:r><\/w:ins>/
    );
    for (const bytes of await r.saved()) {
      expect((await decidedOnReopen(bytes, 'rejectAll')).xml).not.toContain('w:type="page"');
      expect((await decidedOnReopen(bytes, 'acceptAll')).xml).toContain('<w:br w:type="page"/>');
    }
    await decide(bob!.runtime, 'rejectAll');
    r.sync();
    expect(await expectConverged(r, ORIGINAL)).not.toContain('w:type="page"');
  } finally {
    r.close();
  }
});

test('a tracked section break converges with an offline edit, and reject removes the section', async () => {
  const r = await room();
  try {
    const [alice, bob] = r.peers;
    r.pair.pause();
    await trackedBreak(alice!.runtime, 'two; ', 'SectionNext');
    await bob!.runtime.run(async (context) => {
      context.document.body.paragraphs.getFirst().insertText(' four', 'End');
      await context.sync();
    });
    r.sync();
    r.pair.resume();
    r.sync();
    const xml = await expectConverged(r, ['One; two; ', 'three four', 'Signed']);
    expect(xml).toMatch(/<w:pPr><w:rPr><w:ins\b[^>]*w:author="Alice"[^>]*\/><\/w:rPr><w:sectPr>/);
    const [bytes] = await r.saved();
    const rejected = await decidedOnReopen(bytes!, 'rejectAll');
    expect(rejected.texts).toEqual(['One; two; three four', 'Signed']);
    expect(rejected.xml).not.toContain('<w:pPr><w:sectPr>');
    expect((await decidedOnReopen(bytes!, 'acceptAll')).texts).toEqual([
      'One; two; ',
      'three four',
      'Signed',
    ]);
    await decide(bob!.runtime, 'rejectAll');
    r.sync();
    expect(await expectConverged(r, ['One; two; three four', 'Signed'])).not.toContain(
      '<w:pPr><w:sectPr>'
    );
  } finally {
    r.close();
  }
});
