/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Concurrent splits of one paragraph, and a rejected split that its author undoes, on two and
// three collaborating editors that work offline and then reconnect.
//
// Each test checks that every peer reads the same paragraphs, that the text is what the edits
// mean, and that every peer saves the same bytes.

import { afterAll, afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import * as Y from 'yjs';
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

let now = 1_800_000_000_000;
/** Move the clock past the undo capture window, so each action is its own undo step. */
function later(): void {
  now += 2_000;
  setSystemTime(new Date(now));
}
afterEach(() => setSystemTime());

type Runtime = ReturnType<typeof DocxEditor.createBrowser>;
const paragraph = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

/**
 * Alice, Bob, and Carol, each with an editor on a collaboration session. `clientIds` fixes the
 * Yjs client IDs, which order concurrent inserts at one place, so a test can run both orders.
 * `offline()` holds every update back until `online()`.
 */
async function room(first: string, clientIds: Readonly<Record<string, number>>) {
  later();
  const harness = createPeerHarness('concurrent-split-order', { offlineEditing: true }, clientIds);
  const pair = await harness.pair(zipDocument(paragraph(first) + paragraph('Signed')));
  const carol = await harness.joinDetached(pair.alice, 'carol');
  let connected = true;
  const toCarol: Uint8Array[] = [];
  const fromCarol: Uint8Array[] = [];
  for (const host of [pair.alice, pair.bob]) {
    host.ydoc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === 'carol') return;
      if (connected) Y.applyUpdate(carol.ydoc, update, 'relay');
      else toCarol.push(update);
    });
  }
  const toHosts = (update: Uint8Array) => {
    for (const host of [pair.alice, pair.bob]) Y.applyUpdate(host.ydoc, update, 'carol');
  };
  carol.ydoc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === 'relay') return;
    if (connected) toHosts(update);
    else fromCarol.push(update);
  });
  const peers = [
    { peer: pair.alice, author: 'Alice' },
    { peer: pair.bob, author: 'Bob' },
    { peer: carol, author: 'Carol' },
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
  const [alice, bob, carolPeer] = peers as [
    (typeof peers)[0],
    (typeof peers)[0],
    (typeof peers)[0],
  ];
  const flush = () => {
    for (const peer of peers) peer.room.session.flushPendingJournals();
  };
  return {
    alice,
    bob,
    carol: carolPeer,
    sync: flush,
    offline() {
      flush();
      pair.pause();
      connected = false;
    },
    online() {
      flush();
      pair.resume();
      connected = true;
      for (const update of toCarol.splice(0)) Y.applyUpdate(carol.ydoc, update, 'relay');
      for (const update of fromCarol.splice(0)) toHosts(update);
      flush();
    },
    /** Every peer reads `expected`, holds `revisions` pending changes, and saves alike. */
    async expectAll(expected: readonly string[], revisions?: number) {
      for (const peer of peers) {
        expect(peer.room.session.statusSnapshot().status).toBe('ready');
        expect(await texts(peer.runtime)).toEqual([...expected]);
        if (revisions !== undefined) expect(await revisionCount(peer.runtime)).toBe(revisions);
      }
      const xml = await Promise.all(
        peers.map(async (peer) => {
          const saved = unzipSync(new Uint8Array(await peer.editor.save()));
          return strFromU8(saved['word/document.xml']!);
        })
      );
      expect(xml[1]).toBe(xml[0]!);
      expect(xml[2]).toBe(xml[0]!);
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

async function texts(runtime: Runtime): Promise<string[]> {
  return runtime.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load('items/text');
    await context.sync();
    return paragraphs.items.map((item) => item.text);
  });
}

async function revisionCount(runtime: Runtime): Promise<number> {
  return runtime.run(async (context) => {
    const revisions = context.document.body.revisions;
    revisions.load('items');
    await context.sync();
    return revisions.items.length;
  });
}

/** Split the first paragraph after `delimiter`, tracked or not. */
async function splitAfter(runtime: Runtime, delimiter: string, tracked: boolean): Promise<void> {
  await runtime.run(async (context) => {
    if (tracked) context.document.changeTrackingMode = 'TrackMineOnly';
    const first = context.document.body.paragraphs.getFirst();
    await context.sync();
    first.split([delimiter]);
    await context.sync();
  });
}

/** A paragraph break typed after the first match of `find`, tracked or not. */
async function newlineAfter(runtime: Runtime, find: string, tracked: boolean): Promise<void> {
  await runtime.run(async (context) => {
    if (tracked) context.document.changeTrackingMode = 'TrackMineOnly';
    const found = context.document.body.search(find).getFirst();
    await context.sync();
    found.insertText('\n', 'After');
    await context.sync();
  });
}

async function typeAt(runtime: Runtime, index: number, text: string): Promise<void> {
  await runtime.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load('items');
    await context.sync();
    paragraphs.items[index]!.insertText(text, 'Start');
    await context.sync();
  });
}

async function rejectAll(runtime: Runtime): Promise<void> {
  await runtime.run(async (context) => {
    context.document.body.revisions.rejectAll();
    await context.sync();
  });
}

const ORDERS = [
  { label: 'Alice, Bob, Carol', ids: { alice: 1_000, bob: 2_000, carol: 3_000 } },
  { label: 'Carol, Bob, Alice', ids: { alice: 3_000, bob: 2_000, carol: 1_000 } },
];
const EDITS = [
  { name: 'Paragraph.split', edit: splitAfter },
  { name: 'a typed paragraph break', edit: newlineAfter },
];

describe('splitting a paragraph that concurrent splits added', () => {
  // A new paragraph goes right after the paragraph it splits, also when the paragraph it
  // splits shows in another place than Yjs lists it.
  for (const { label, ids } of ORDERS)
    for (const { by, find, expected } of [
      { by: 'alice', find: 'tw', expected: ['One; ', 'tw', 'o; ', 'three', 'Signed'] },
      { by: 'bob', find: 'thr', expected: ['One; ', 'two; ', 'thr', 'ee', 'Signed'] },
      { by: 'carol', find: 'One', expected: ['One', '; ', 'two; ', 'three', 'Signed'] },
    ] as const)
      test(`${by} splits after "${find}" (${label})`, async () => {
        const r = await room('One; two; three', ids);
        try {
          r.offline();
          await splitAfter(r.bob.runtime, 'two; ', false);
          later();
          await splitAfter(r.alice.runtime, 'One; ', false);
          later();
          r.online();
          await r.expectAll(['One; ', 'two; ', 'three', 'Signed']);
          later();
          await newlineAfter(r[by].runtime, find, false);
          r.sync();
          await r.expectAll(expected);
          later();
          expect(r[by].editor.exec({ type: 'undo' }).ok).toBe(true);
          r.sync();
          await r.expectAll(['One; ', 'two; ', 'three', 'Signed']);
        } finally {
          r.close();
        }
      });
});

describe('three peers splitting one paragraph at different points while offline', () => {
  // Every new paragraph goes in right after the split paragraph, and Yjs orders them by client
  // ID. The paragraphs show in the order of the text they hold, whichever peer made each one.
  for (const tracked of [false, true])
    for (const { name, edit } of EDITS)
      for (const { label, ids } of ORDERS) {
        const kind = tracked ? 'tracked' : 'untracked';
        test(`${kind} ${name}: every split stays, in text order (${label})`, async () => {
          const r = await room('One; two; three; four', ids);
          try {
            r.offline();
            await edit(r.bob.runtime, 'two; ', tracked);
            later();
            await edit(r.carol.runtime, 'three; ', tracked);
            later();
            await edit(r.alice.runtime, 'One; ', tracked);
            later();
            r.online();
            await r.expectAll(['One; ', 'two; ', 'three; ', 'four', 'Signed']);
            // Typing after the merge lands in the paragraph it was typed in, on every peer.
            later();
            await typeAt(r.carol.runtime, 2, 'C ');
            r.sync();
            later();
            await typeAt(r.alice.runtime, 1, 'A ');
            r.sync();
            await r.expectAll(['One; ', 'A two; ', 'C three; ', 'four', 'Signed']);
          } finally {
            r.close();
          }
        });
      }

  for (const tracked of [false, true])
    for (const { name, edit } of EDITS)
      for (const { label, ids } of ORDERS) {
        const kind = tracked ? 'tracked' : 'untracked';
        test(`${kind} ${name} by two peers: both splits stay (${label})`, async () => {
          const r = await room('One; two; three', ids);
          try {
            r.offline();
            await edit(r.alice.runtime, 'One; ', tracked);
            later();
            await edit(r.bob.runtime, 'two; ', tracked);
            later();
            r.online();
            await r.expectAll(['One; ', 'two; ', 'three', 'Signed']);
          } finally {
            r.close();
          }
        });
      }

  for (const { label, ids } of ORDERS)
    test(`two peers split while a third types in the tail offline (${label})`, async () => {
      const r = await room('One; two; three', ids);
      try {
        r.offline();
        await splitAfter(r.bob.runtime, 'two; ', false);
        later();
        await splitAfter(r.alice.runtime, 'One; ', false);
        later();
        await newlineAfter(r.carol.runtime, 'thr', false);
        later();
        r.online();
        await r.expectAll(['One; ', 'two; ', 'thr', 'ee', 'Signed']);
      } finally {
        r.close();
      }
    });
});

describe('rejecting a tracked split while its author undoes it, with a third peer', () => {
  // Bob rejects the proposed split and Alice undoes it, both offline, while Carol types in the
  // second paragraph. The rejection and the undo keep the same paragraph, so no text is lost.
  for (const { name, edit } of EDITS)
    for (const { label, ids } of ORDERS)
      test(`tracked ${name} (${label})`, async () => {
        const r = await room('One; two; three', ids);
        try {
          await edit(r.alice.runtime, 'One; ', true);
          r.sync();
          await r.expectAll(['One; ', 'two; three', 'Signed'], 1);
          later();
          r.offline();
          await rejectAll(r.bob.runtime);
          later();
          expect(r.alice.editor.exec({ type: 'undo' }).ok).toBe(true);
          later();
          await typeAt(r.carol.runtime, 1, 'C ');
          later();
          r.online();
          await r.expectAll(['One; C two; three', 'Signed'], 0);
        } finally {
          r.close();
        }
      });
});
