/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Concurrent splits that reach one peer before the text they split. The order of the new
// paragraphs depends on where each split fell in that text, so the peer reads the order again
// when the text arrives, and every peer ends with the same paragraphs.

import { afterAll, afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import * as Y from 'yjs';
import { strFromU8, unzipSync } from 'fflate';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '@docx-editor.dev/editor-api/browser';
import { collaborationModule, reviewModule } from '../../index';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support';

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

const NAMES = ['alice', 'bob', 'carol', 'dave'] as const;
type Name = (typeof NAMES)[number];

/**
 * Four peers. Alice and Bob share a relay that `offline()` pauses. Carol and Dave have none:
 * `deliver(from, to)` gives `to` every local update of `from` it has not had, in the order
 * `from` made them, so a test chooses what reaches each peer, and when.
 */
async function room(clientIds: Readonly<Record<Name, number>>, gc: boolean) {
  later();
  const harness = createPeerHarness('split-late-delivery', { offlineEditing: true }, clientIds, gc);
  const pair = await harness.pair(zipDocument(paragraph('One; two; three') + paragraph('Signed')));
  const joined: Record<Name, Peer> = {
    alice: pair.alice,
    bob: pair.bob,
    carol: await harness.joinDetached(pair.alice, 'carol'),
    dave: await harness.joinDetached(pair.alice, 'dave'),
  };
  const local = new Map<Name, Uint8Array[]>(NAMES.map((name) => [name, []]));
  const sent = new Map<string, number>();
  for (const name of NAMES)
    joined[name].ydoc.on('update', (update: Uint8Array, _origin: unknown, _doc, transaction) => {
      if (transaction.local) local.get(name)!.push(update);
    });
  const peers = NAMES.map((name) => {
    const peer = joined[name];
    peer.detach();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = createDocxEditor({
      container,
      document: peer.room.document,
      modules: [reviewModule(), collaborationModule({ session: peer.room.session })],
    });
    const author = name[0]!.toUpperCase() + name.slice(1);
    return { name, peer, editor, runtime: DocxEditor.createBrowser(editor, { author }), container };
  });
  const flush = () => {
    for (const { peer } of peers) peer.room.session.flushPendingJournals();
  };
  const runtime = (name: Name) => peers.find((entry) => entry.name === name)!.runtime;
  return {
    runtime,
    offline() {
      flush();
      pair.pause();
    },
    online() {
      flush();
      pair.resume();
      flush();
    },
    deliver(from: Name, to: Name) {
      flush();
      const updates = local.get(from)!;
      const key = `${from}>${to}`;
      for (const update of updates.slice(sent.get(key) ?? 0))
        Y.applyUpdate(joined[to].ydoc, update, from);
      sent.set(key, updates.length);
      flush();
    },
    /** Every peer reads `expected` and saves the same bytes. */
    async expectAll(expected: readonly string[]) {
      for (const { name, peer, runtime } of peers) {
        expect(peer.room.session.statusSnapshot().status).toBe('ready');
        expect({ name, texts: await texts(runtime) }).toEqual({ name, texts: [...expected] });
      }
      const xml = await Promise.all(
        peers.map(async ({ editor }) => {
          const saved = unzipSync(new Uint8Array(await editor.save()));
          return strFromU8(saved['word/document.xml']!);
        })
      );
      for (const one of xml.slice(1)) expect(one).toBe(xml[0]!);
    },
    close() {
      for (const { editor, runtime, container } of peers) {
        runtime.dispose();
        editor.destroy();
        container.remove();
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

async function typeAtStart(runtime: Runtime, index: number, text: string): Promise<void> {
  await runtime.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load('items');
    await context.sync();
    paragraphs.items[index]!.insertText(text, 'Start');
    await context.sync();
  });
}

/** A paragraph break typed after the first match of `find`. */
async function newlineAfter(runtime: Runtime, find: string): Promise<void> {
  await runtime.run(async (context) => {
    const found = context.document.body.search(find).getFirst();
    await context.sync();
    found.insertText('\n', 'After');
    await context.sync();
  });
}

const ORDERS = [
  { label: 'Alice, Bob, Carol', ids: { alice: 1_000, bob: 2_000, carol: 3_000, dave: 4_000 } },
  { label: 'Carol, Bob, Alice', ids: { alice: 3_000, bob: 2_000, carol: 1_000, dave: 4_000 } },
];

describe('concurrent splits that reach a peer before the text they split', () => {
  // Carol types "BBB; ", then "AAA; " before it, so her clocks run against text order. Alice
  // and Bob split that text offline. Dave gets both splits first and Carol's text last.
  for (const gc of [true, false])
    for (const { label, ids } of ORDERS)
      test(`every peer ends in text order (garbage collection ${gc ? 'on' : 'off'}, ${label})`, async () => {
        const r = await room(ids, gc);
        try {
          await typeAtStart(r.runtime('carol'), 0, 'BBB; ');
          later();
          await typeAtStart(r.runtime('carol'), 0, 'AAA; ');
          later();
          r.deliver('carol', 'alice');
          r.deliver('carol', 'bob');
          r.offline();
          await newlineAfter(r.runtime('alice'), 'A');
          later();
          await newlineAfter(r.runtime('bob'), 'AAA; B');
          later();
          r.online();
          for (const from of ['alice', 'bob'] as const) r.deliver(from, 'carol');
          for (const from of ['alice', 'bob', 'carol'] as const) r.deliver(from, 'dave');
          const expected = ['A', 'AA; B', 'BB; One; two; three', 'Signed'];
          await r.expectAll(expected);
          // Typing after the merge lands where it was typed, on every peer.
          await typeAtStart(r.runtime('dave'), 1, 'D ');
          later();
          for (const to of ['alice', 'bob', 'carol'] as const) r.deliver('dave', to);
          await r.expectAll(['A', 'D AA; B', 'BB; One; two; three', 'Signed']);
        } finally {
          r.close();
        }
      });
});
