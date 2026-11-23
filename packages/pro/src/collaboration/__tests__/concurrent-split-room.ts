/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Three collaborating editors (Alice, Bob, and Carol) that work offline and then reconnect,
// for tests of concurrent paragraph splits. The test file registers the DOM globals.

import { expect, setSystemTime } from 'bun:test';
import * as Y from 'yjs';
import { strFromU8, unzipSync } from 'fflate';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '@docx-editor.dev/editor-api/browser';
import { collaborationModule, reviewModule } from '../../index';
import { createPeerHarness, zipDocument } from './document-peer-support';
import { packageFingerprint } from './document-support';
let now = 1_800_000_000_000;
/** Move the clock past the undo capture window, so each action is its own undo step. */
export function later(): void {
  now += 2_000;
  setSystemTime(new Date(now));
}

export type Runtime = ReturnType<typeof DocxEditor.createBrowser>;
export const paragraph = (text: string, properties = '') =>
  `<w:p>${properties}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

/**
 * Alice, Bob, and Carol, each with an editor on a collaboration session. `clientIds` fixes the
 * Yjs client IDs, which order concurrent inserts at one place, so a test can run both orders.
 * `offline()` holds every update back until `online()`.
 */
export async function room(
  first: string,
  clientIds: Readonly<Record<string, number>>,
  /** The first paragraph's `w:pPr`, if any. */
  properties = '',
  gc = true
) {
  later();
  const harness = createPeerHarness(
    'concurrent-split-order',
    { offlineEditing: true },
    clientIds,
    gc
  );
  const pair = await harness.pair(zipDocument(paragraph(first, properties) + paragraph('Signed')));
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
      // A paragraph mark's run properties come before section properties (`CT_PPr`).
      expect(xml[0]).not.toMatch(/<\/w:sectPr><w:rPr>/);
    },
    /** A participant that joins now, and builds its view once from shared state, reads alike. */
    async expectJoinerConverges() {
      flush();
      const dave = await harness.join(pair.alice, 'dave');
      expect(packageFingerprint(harness.packageOf(dave))).toBe(
        packageFingerprint(peers[0]!.editor.surface!.session.currentPackage())
      );
    },
    /** Every peer's saved document opens again with `expected` and no pending change. */
    async expectReopens(expected: readonly string[], revisions = 0) {
      for (const peer of peers) {
        const reopened = createDocxEditor({
          container: document.createElement('div'),
          document: new Uint8Array(await peer.editor.save()),
          modules: [reviewModule()],
        });
        const runtime = DocxEditor.createBrowser(reopened, { author: 'Reader' });
        try {
          expect(await texts(runtime)).toEqual([...expected]);
          expect(await revisionCount(runtime)).toBe(revisions);
        } finally {
          runtime.dispose();
          reopened.destroy();
        }
      }
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

export async function texts(runtime: Runtime): Promise<string[]> {
  return runtime.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load('items/text');
    await context.sync();
    return paragraphs.items.map((item) => item.text);
  });
}

export async function revisionCount(runtime: Runtime): Promise<number> {
  return runtime.run(async (context) => {
    const revisions = context.document.body.revisions;
    revisions.load('items');
    await context.sync();
    return revisions.items.length;
  });
}

export async function rejectAll(runtime: Runtime): Promise<void> {
  await runtime.run(async (context) => {
    context.document.body.revisions.rejectAll();
    await context.sync();
  });
}

export const ORDERS = [
  { label: 'Alice, Bob, Carol', ids: { alice: 1_000, bob: 2_000, carol: 3_000 } },
  { label: 'Carol, Bob, Alice', ids: { alice: 3_000, bob: 2_000, carol: 1_000 } },
];
