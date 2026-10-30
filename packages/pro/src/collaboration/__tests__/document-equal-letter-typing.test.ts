/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Two participants type the same letter at one place. Each letter is shared where its author
// typed it, so a caret that follows its own letter stays after it.
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { paragraphTextOf } from '@docx-editor.dev/core/store';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';

type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
const harnesses: ReturnType<typeof createPeerHarness>[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  for (const harness of harnesses.splice(0)) harness.cleanup();
});

const LEAD = 'Edit me.';

/** Both Yjs client orders: concurrent letters at one place are ordered by client id. */
const ORDERS = [
  { alice: 1, bob: 2 },
  { alice: 2, bob: 1 },
];

async function typingPair(clientIds: Readonly<Record<string, number>>) {
  const harness = createPeerHarness(
    'equal-letter-typing-room',
    { offlineEditing: true },
    clientIds
  );
  harnesses.push(harness);
  const peers = await harness.pair(
    zipDocument(`<w:p><w:r><w:t>${LEAD}</w:t></w:r></w:p><w:p><w:r><w:t>Tail</w:t></w:r></w:p>`)
  );
  const [alice, bob] = [peers.alice, peers.bob].map((peer) => {
    peer.detach();
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
    editors.push(editor);
    return editor;
  }) as [Editor, Editor];
  for (const editor of [alice, bob]) {
    const match = editor.findMatches(LEAD)[0]!;
    const end = { paragraphId: match.blockId, offset: match.start + match.length };
    editor.surface!.setSelection({ anchor: end, head: end });
  }
  peers.pause();
  const sync = () => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
    peers.resume();
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
    peers.pause();
  };
  const type = (editor: Editor, text: string) =>
    expect(editor.exec({ type: 'insertText', text }).ok).toBe(true);
  const typed = (editor: Editor) => {
    editor.surface!.layout();
    const id = editor.findMatches(LEAD)[0]!.blockId;
    return (paragraphTextOf(editor.surface!.session.part(), id) ?? '').slice(LEAD.length);
  };
  return { alice, bob, sync, type, typed };
}

test.each(ORDERS)(
  'a letter typed before an equal letter of a peer keeps its caret after it %o',
  async (order) => {
    const { alice, bob, sync, type, typed } = await typingPair(order);
    type(alice, '[');
    sync();
    // The peer's letter arrived at the caret and went after it, so this one goes before it.
    type(bob, '[');
    type(alice, 'A');
    sync();
    expect(typed(bob)).toBe('[[A');
    type(bob, 'B');
    sync();
    expect(typed(alice)).toBe('[B[A');
    expect(typed(bob)).toBe('[B[A');
  }
);

/** A repeatable stream of numbers in [0, 1). */
function stream(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

test.each([3, 7, 11])(
  'tokens typed at once at one place keep their order, run %i',
  async (seed) => {
    const { alice, bob, sync, type, typed } = await typingPair(ORDERS[0]!);
    const tokens = { a: [...'[A1][A2][A3][A4][A5]'], b: [...'[B1][B2][B3][B4][B5]'] };
    const next = stream(seed);
    // Each side types a letter or delivers, in an order that lands brackets beside each other.
    while (tokens.a.length || tokens.b.length) {
      const roll = next();
      if (roll < 0.4 && tokens.a.length) type(alice, tokens.a.shift()!);
      else if (roll < 0.8 && tokens.b.length) type(bob, tokens.b.shift()!);
      else if (roll >= 0.9) sync();
    }
    sync();
    sync();
    const text = typed(alice);
    expect(typed(bob)).toBe(text);
    for (const token of [
      '[A1]',
      '[A2]',
      '[A3]',
      '[A4]',
      '[A5]',
      '[B1]',
      '[B2]',
      '[B3]',
      '[B4]',
      '[B5]',
    ]) {
      expect(text.split(token).length - 1, `${token} in ${text}`).toBe(1);
    }
  }
);
