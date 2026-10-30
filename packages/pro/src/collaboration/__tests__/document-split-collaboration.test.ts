/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Paragraph splits, joins, and their decisions on two collaborating editors.
//
// Each test drives two editors through the document API, then checks that both peers read the
// same paragraphs, that the text is what the edits mean, and that both save the same bytes.

import { afterAll, afterEach, describe, expect, setSystemTime, test } from 'bun:test';
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
/**
 * Move the clock the shared undo manager reads past its capture window, so each user action
 * is its own undo step, as it is when a person makes them.
 */
function later(): void {
  now += 2_000;
  setSystemTime(new Date(now));
}
afterEach(() => setSystemTime());

const BODY =
  '<w:p><w:r><w:t xml:space="preserve">One; two; three</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>Signed</w:t></w:r></w:p>';
const ORIGINAL = ['One; two; three', 'Signed'];

type Runtime = ReturnType<typeof DocxEditor.createBrowser>;

/**
 * Alice and Bob, each with an editor on a collaboration session. `clientIds` fixes the Yjs
 * client IDs, which order concurrent inserts at one place, so a test can run both orders.
 */
async function room(clientIds?: Readonly<Record<string, number>>) {
  later();
  const harness = createPeerHarness('split-collaboration', { offlineEditing: true }, clientIds);
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
  const [alice, bob] = peers as [(typeof peers)[0], (typeof peers)[0]];
  return {
    alice,
    bob,
    pause: pair.pause,
    resume: pair.resume,
    /** Publish every queued edit on both peers. */
    sync() {
      for (const peer of peers) peer.room.session.flushPendingJournals();
    },
    /** Both peers read `expected`, hold no pending change when `revisions` is 0, save alike. */
    async expectBoth(expected: readonly string[], revisions?: number) {
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
      expect(xml[0]).toBe(xml[1]!);
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
    return paragraphs.items.map((paragraph) => paragraph.text);
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

/** The unique local ID of the first paragraph, which names the paragraph across peers. */
async function firstParagraphId(runtime: Runtime): Promise<string> {
  return runtime.run(async (context) => {
    const paragraph = context.document.body.paragraphs.getFirst();
    paragraph.load('uniqueLocalId');
    await context.sync();
    return paragraph.uniqueLocalId;
  });
}

async function rejectAll(runtime: Runtime): Promise<void> {
  await runtime.run(async (context) => {
    context.document.body.revisions.rejectAll();
    await context.sync();
  });
}

/** Split the first paragraph after each `delimiter`, tracked or not. */
async function splitAt(runtime: Runtime, delimiter: string, tracked: boolean): Promise<void> {
  await runtime.run(async (context) => {
    if (tracked) context.document.changeTrackingMode = 'TrackMineOnly';
    const paragraph = context.document.body.paragraphs.getFirst();
    await context.sync();
    paragraph.split([delimiter]);
    await context.sync();
  });
}

/** A tracked paragraph break after the first match of `find`. */
async function trackedNewline(runtime: Runtime, find: string): Promise<void> {
  await runtime.run(async (context) => {
    context.document.changeTrackingMode = 'TrackMineOnly';
    const found = context.document.body.search(find).getFirst();
    await context.sync();
    found.insertText('\n', 'After');
    await context.sync();
  });
}

/** A tracked break of `type` after the first match of `find`. */
async function trackedBreak(
  runtime: Runtime,
  find: string,
  type: 'Line' | 'Page' | 'SectionNext'
): Promise<void> {
  await runtime.run(async (context) => {
    context.document.changeTrackingMode = 'TrackMineOnly';
    const found = context.document.body.search(find).getFirst();
    await context.sync();
    found.insertBreak(type, 'After');
    await context.sync();
  });
}

describe('rejecting every change of a paragraph that holds a break and a new paragraph mark', () => {
  // Rejecting the mark joins the paragraph into the next one, and the same decision removes
  // the break. One rejectAll must do both, on both peers.
  for (const { name, offline, first, second } of [
    {
      name: 'a line break and a paragraph break, made offline',
      offline: true,
      first: (runtime: Runtime) => trackedBreak(runtime, 'One', 'Line'),
      second: (runtime: Runtime) => trackedNewline(runtime, 'two; '),
    },
    {
      name: 'a page break and a next-page section break, made online',
      offline: false,
      first: (runtime: Runtime) => trackedBreak(runtime, 'One', 'Page'),
      second: (runtime: Runtime) => trackedBreak(runtime, 'two; ', 'SectionNext'),
    },
  ]) {
    test(name, async () => {
      const r = await room();
      try {
        if (offline) r.pause();
        await first(r.alice.runtime);
        r.sync();
        later();
        await second(r.bob.runtime);
        r.sync();
        later();
        if (offline) {
          r.resume();
          r.sync();
        }
        expect(await revisionCount(r.alice.runtime)).toBe(2);
        await rejectAll(r.alice.runtime);
        r.sync();
        await r.expectBoth(ORIGINAL, 0);
        // Undo brings both changes back, and redo rejects both again.
        later();
        expect(r.alice.editor.exec({ type: 'undo' }).ok).toBe(true);
        r.sync();
        expect(await revisionCount(r.bob.runtime)).toBe(2);
        later();
        expect(r.alice.editor.exec({ type: 'redo' }).ok).toBe(true);
        r.sync();
        await r.expectBoth(ORIGINAL, 0);
      } finally {
        r.close();
      }
    });
  }

  test('a break on each side of the new paragraph mark, rejected by the other peer', async () => {
    // Whichever paragraph the join keeps, the one it removes holds a break the same decision
    // removes, and that break must not move into the joined paragraph.
    const r = await room();
    try {
      await trackedBreak(r.alice.runtime, 'One', 'Line');
      later();
      await trackedNewline(r.alice.runtime, 'two; ');
      later();
      await trackedBreak(r.alice.runtime, 'thr', 'Page');
      r.sync();
      later();
      expect(await revisionCount(r.bob.runtime)).toBe(3);
      await rejectAll(r.bob.runtime);
      r.sync();
      await r.expectBoth(ORIGINAL, 0);
      later();
      expect(r.bob.editor.exec({ type: 'undo' }).ok).toBe(true);
      r.sync();
      expect(await revisionCount(r.alice.runtime)).toBe(3);
      later();
      expect(r.bob.editor.exec({ type: 'redo' }).ok).toBe(true);
      r.sync();
      await r.expectBoth(ORIGINAL, 0);
    } finally {
      r.close();
    }
  });
});

describe('rejecting a tracked split while its author undoes it offline', () => {
  // Both take the split back. Rejecting the mark joins the second paragraph into the first,
  // as the undo does, so both keep the first paragraph and the whole text.
  const orders = [
    { label: 'Alice inserts first', ids: { alice: 1_000, bob: 2_000 } },
    { label: 'Bob inserts first', ids: { alice: 2_000, bob: 1_000 } },
  ];
  for (const { name, split } of [
    {
      name: 'a tracked paragraph break',
      split: (runtime: Runtime) => trackedNewline(runtime, 'One; '),
    },
    {
      name: 'a tracked split',
      split: (runtime: Runtime) => splitAt(runtime, 'One; ', true),
    },
  ]) {
    for (const { label, ids } of orders) {
      test(`${name} keeps the paragraph (${label})`, async () => {
        const r = await room(ids);
        try {
          await split(r.alice.runtime);
          r.sync();
          later();
          r.pause();
          await rejectAll(r.bob.runtime);
          later();
          expect(r.alice.editor.exec({ type: 'undo' }).ok).toBe(true);
          r.sync();
          r.resume();
          r.sync();
          await r.expectBoth(ORIGINAL, 0);
          // Undoing the rejection brings the proposed split back with all of its text.
          later();
          expect(r.bob.editor.exec({ type: 'undo' }).ok).toBe(true);
          r.sync();
          await r.expectBoth(['One; ', 'two; three', 'Signed']);
        } finally {
          r.close();
        }
      });
    }
  }

  test('a rejected tracked split joins into the first paragraph, which keeps its identity', async () => {
    const r = await room();
    try {
      await trackedNewline(r.alice.runtime, 'One; ');
      r.sync();
      const first = await firstParagraphId(r.bob.runtime);
      await rejectAll(r.bob.runtime);
      r.sync();
      await r.expectBoth(ORIGINAL, 0);
      expect(await firstParagraphId(r.alice.runtime)).toBe(first);
    } finally {
      r.close();
    }
  });
});

describe('two peers splitting one paragraph at different points while offline', () => {
  // Both new paragraphs go in right after the split paragraph, and Yjs orders them by client
  // ID. The paragraph that holds the earlier tail comes first, whichever peer made it.
  const orders = [
    { label: 'Alice inserts first', ids: { alice: 1_000, bob: 2_000 } },
    { label: 'Bob inserts first', ids: { alice: 2_000, bob: 1_000 } },
  ];
  for (const { label, ids } of orders) {
    test(`both splits stay, in text order, and later edits land where shown (${label})`, async () => {
      const r = await room(ids);
      try {
        r.pause();
        await splitAt(r.alice.runtime, 'One; ', false);
        later();
        await splitAt(r.bob.runtime, 'two; ', false);
        r.sync();
        r.resume();
        r.sync();
        await r.expectBoth(['One; ', 'two; ', 'three', 'Signed']);
        // Each peer types at the end of the paragraph it sees second and third.
        later();
        await r.alice.runtime.run(async (context) => {
          const paragraphs = context.document.body.paragraphs;
          paragraphs.load('items');
          await context.sync();
          paragraphs.items[1]!.insertText('2', 'End');
          paragraphs.items[2]!.insertText('3', 'End');
          await context.sync();
        });
        r.sync();
        later();
        await r.bob.runtime.run(async (context) => {
          const paragraphs = context.document.body.paragraphs;
          paragraphs.load('items');
          await context.sync();
          paragraphs.items[1]!.insertText('b', 'Start');
          await context.sync();
        });
        r.sync();
        await r.expectBoth(['One; ', 'btwo; 2', 'three3', 'Signed']);
        // Bob takes back his typing, then his split; Alice's split stays.
        later();
        expect(r.bob.editor.exec({ type: 'undo' }).ok).toBe(true);
        r.sync();
        await r.expectBoth(['One; ', 'two; 2', 'three3', 'Signed']);
        later();
        expect(r.bob.editor.exec({ type: 'undo' }).ok).toBe(true);
        r.sync();
        await r.expectBoth(['One; ', 'two; 2three3', 'Signed']);
      } finally {
        r.close();
      }
    });
  }
});

describe('undoing a split into three paragraphs while a peer types in the middle one', () => {
  // The split moves the tail of the paragraph into two new paragraphs, one piece in each. The
  // pieces are the moved text, so text a peer types in one follows it back when the split is
  // undone, as it does after a split into two.
  for (const { name, split } of [
    {
      name: 'an untracked split',
      split: (runtime: Runtime) => splitAt(runtime, '; ', false),
    },
    {
      name: 'a tracked split',
      split: (runtime: Runtime) => splitAt(runtime, '; ', true),
    },
  ]) {
    test(`${name} keeps the typing on undo and on redo`, async () => {
      const r = await room();
      try {
        await split(r.alice.runtime);
        r.sync();
        later();
        await r.bob.runtime.run(async (context) => {
          const paragraphs = context.document.body.paragraphs;
          paragraphs.load('items');
          await context.sync();
          paragraphs.items[1]!.insertText('2 ', 'Start');
          await context.sync();
        });
        r.sync();
        await r.expectBoth(['One; ', '2 two; ', 'three', 'Signed']);
        later();
        expect(r.alice.editor.exec({ type: 'undo' }).ok).toBe(true);
        r.sync();
        await r.expectBoth(['One; 2 two; three', 'Signed']);
        later();
        expect(r.alice.editor.exec({ type: 'redo' }).ok).toBe(true);
        r.sync();
        await r.expectBoth(['One; ', '2 two; ', 'three', 'Signed']);
      } finally {
        r.close();
      }
    });
  }

  // `split(['; '], true)` trims the delimiters, so the pieces do not spell the text the split
  // removed and are not moved text: the typing has nothing to follow on undo (#1653).
  test.todo('a split that trims its delimiters keeps the typing on undo and on redo', () => {});
});
