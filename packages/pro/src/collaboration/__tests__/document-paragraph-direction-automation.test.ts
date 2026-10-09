/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Paragraph direction written through the document API on two collaborating editors (#1173).
//
// `Paragraph.readingOrder` writes `w:bidi` with the same paragraph-property op as alignment and
// indents, so it replicates as an ordinary paragraph property edit. Each test makes the peers
// diverge, then checks that they converge on the same direction and text and save the same bytes.
//
// Two peers writing paragraph properties on the SAME paragraph at once is not covered here: every
// paragraph property shares that limit (#579), and the direction adds nothing to it.

import { afterAll, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { canonicalOoxmlFingerprint, readOoxmlPackage } from '@docx-editor.dev/core/store';
import { DocxEditor } from '@docx-editor.dev/editor-api/browser';
import { collaborationModule, reviewModule } from '../../index';
import { createPeerHarness, zipDocument } from './document-peer-support';

const registered = !GlobalRegistrator.isRegistered;
if (registered) GlobalRegistrator.register();
afterAll(() => {
  if (registered) GlobalRegistrator.unregister();
});

const BODY =
  '<w:p><w:r><w:t xml:space="preserve">שלום עולם</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>Second</w:t></w:r></w:p>';

type Runtime = ReturnType<typeof DocxEditor.createBrowser>;
type Order = 'Unknown' | 'LeftToRight' | 'RightToLeft';

async function room() {
  const harness = createPeerHarness('paragraph-direction-automation', { offlineEditing: true });
  const pair = await harness.pair(zipDocument(BODY));
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
    async saved() {
      return Promise.all(peers.map(async (peer) => new Uint8Array(await peer.editor.save())));
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

function mainXml(bytes: Uint8Array): string {
  return strFromU8(unzipSync(bytes)['word/document.xml']!);
}

function fingerprint(bytes: Uint8Array): string {
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(loaded.reason);
  return canonicalOoxmlFingerprint(loaded.package.parts.get(loaded.package.mainDocumentPart)!);
}

/** Both peers save the same main part; answers it. */
async function converged(r: Room): Promise<string> {
  const [left, right] = await r.saved();
  expect(fingerprint(left!)).toBe(fingerprint(right!));
  expect(mainXml(left!)).toBe(mainXml(right!));
  return mainXml(left!);
}

async function paragraphs(runtime: Runtime): Promise<{ text: string; order: Order }[]> {
  return runtime.run(async (context) => {
    const items = context.document.body.paragraphs;
    items.load('items');
    await context.sync();
    for (const paragraph of items.items) paragraph.load(['text', 'readingOrder']);
    await context.sync();
    return items.items.map((paragraph) => ({
      text: paragraph.text,
      order: paragraph.readingOrder,
    }));
  });
}

async function setOrder(runtime: Runtime, value: Order, tracked = false): Promise<void> {
  await runtime.run(async (context) => {
    if (tracked) context.document.changeTrackingMode = 'TrackMineOnly';
    context.document.body.paragraphs.getFirst().readingOrder = value;
    await context.sync();
  });
}

async function typeAtEnd(runtime: Runtime, text: string): Promise<void> {
  await runtime.run(async (context) => {
    context.document.body.paragraphs.getFirst().insertText(text, 'End');
    await context.sync();
  });
}

test('a direction set while the other peer types in the same paragraph keeps both', async () => {
  const r = await room();
  try {
    const [alice, bob] = r.peers;
    r.pair.pause();
    await setOrder(alice!.runtime, 'RightToLeft');
    await typeAtEnd(bob!.runtime, ' שלום');
    r.pair.resume();
    r.sync();
    for (const peer of r.peers) {
      expect((await paragraphs(peer.runtime))[0]).toEqual({
        text: 'שלום עולם שלום',
        order: 'RightToLeft',
      });
    }
    const xml = await converged(r);
    expect(xml.match(/<w:bidi\/>/g)).toHaveLength(1);
  } finally {
    r.close();
  }
});

test('deleting the paragraph while the other peer sets its direction converges', async () => {
  const r = await room();
  try {
    const [alice, bob] = r.peers;
    r.pair.pause();
    await alice!.runtime.run(async (context) => {
      context.document.body.paragraphs.getFirst().delete();
      await context.sync();
    });
    await setOrder(bob!.runtime, 'RightToLeft');
    r.pair.resume();
    r.sync();
    const [left, right] = await Promise.all(r.peers.map((peer) => paragraphs(peer.runtime)));
    expect(left).toEqual(right!);
    await converged(r);
  } finally {
    r.close();
  }
});

test('a tracked direction change replicates while the other peer types, and rejection restores it', async () => {
  const r = await room();
  try {
    const [alice, bob] = r.peers;
    r.pair.pause();
    await setOrder(alice!.runtime, 'RightToLeft', true);
    await typeAtEnd(bob!.runtime, '!');
    r.pair.resume();
    r.sync();
    const tracked = await converged(r);
    expect(tracked).toMatch(
      /<w:pPr><w:bidi\/><w:pPrChange [^>]*><w:pPr\/><\/w:pPrChange><\/w:pPr>/
    );
    expect(tracked).toContain('שלום עולם!');

    await bob!.runtime.run(async (context) => {
      const revisions = context.document.body.revisions;
      revisions.load('items');
      await context.sync();
      expect(revisions.items).toHaveLength(1);
      revisions.rejectAll();
      await context.sync();
    });
    r.sync();
    for (const peer of r.peers) {
      expect((await paragraphs(peer.runtime))[0]).toEqual({
        text: 'שלום עולם!',
        order: 'Unknown',
      });
    }
    const rejected = await converged(r);
    expect(rejected).not.toContain('w:bidi');
    expect(rejected).not.toContain('pPrChange');
  } finally {
    r.close();
  }
});

test('undo and redo of a direction change replicate to the other peer', async () => {
  const r = await room();
  try {
    const [alice, bob] = r.peers;
    await setOrder(alice!.runtime, 'RightToLeft');
    r.sync();
    await typeAtEnd(bob!.runtime, '.');
    r.sync();
    expect((await paragraphs(bob!.runtime))[0]!.order).toBe('RightToLeft');
    expect(alice!.editor.exec({ type: 'undo' }).ok).toBe(true);
    r.sync();
    expect((await paragraphs(bob!.runtime))[0]).toEqual({ text: 'שלום עולם.', order: 'Unknown' });
    expect(alice!.editor.exec({ type: 'redo' }).ok).toBe(true);
    r.sync();
    expect((await paragraphs(bob!.runtime))[0]).toEqual({
      text: 'שלום עולם.',
      order: 'RightToLeft',
    });
    await converged(r);
  } finally {
    r.close();
  }
});

test('offline edits on both peers converge on reconnect and survive save and reopen', async () => {
  const r = await room();
  try {
    const [alice, bob] = r.peers;
    // Bob is offline: nothing he or Alice writes reaches the other until reconnect.
    r.pair.pause();
    await setOrder(alice!.runtime, 'RightToLeft');
    await bob!.runtime.run(async (context) => {
      const items = context.document.body.paragraphs;
      items.load('items');
      await context.sync();
      items.items[1]!.readingOrder = 'RightToLeft';
      items.items[0]!.insertText(' offline', 'End');
      await context.sync();
    });
    r.pair.resume();
    r.sync();
    const expected: { text: string; order: Order }[] = [
      { text: 'שלום עולם offline', order: 'RightToLeft' },
      { text: 'Second', order: 'RightToLeft' },
    ];
    for (const peer of r.peers) expect(await paragraphs(peer.runtime)).toEqual(expected);
    const xml = await converged(r);

    const [saved] = await r.saved();
    const reopened = await DocxEditor.createServer(saved!);
    try {
      expect(await paragraphs(reopened as unknown as Runtime)).toEqual(expected);
      const again = await reopened.save();
      expect(fingerprint(again)).toBe(fingerprint(saved!));
      expect(mainXml(again)).toBe(xml);
    } finally {
      reopened.dispose();
    }
  } finally {
    r.close();
  }
});
