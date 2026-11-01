/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// An undo of an edit that listed a paragraph keeps what others typed there, and an undo and
// redo of typing beside text a peer moved restore it where it showed.
import { afterEach, describe, expect, test } from 'bun:test';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { findNode } from '@docx-editor.dev/core/store';
import {
  createPeerHarness,
  nodeText,
  walk,
  zipDocument,
  type Peer,
} from './document-peer-support.ts';

const harness = createPeerHarness('undo-inserted-paragraph');
afterEach(() => harness.cleanup());

const paragraphs = (...lines: string[]) =>
  zipDocument(
    lines.map((line) => `<w:p><w:r><w:t>${line}</w:t></w:r></w:p>`).join('') + '<w:sectPr/>'
  );

function texts(peer: Peer): string[] {
  const found: string[] = [];
  walk(peer.store.bodyStore().part.root, (node) => {
    if (node.kind === 'paragraph') found.push(nodeText(node));
  });
  return found;
}

const at = (peer: Peer, index: number) => harness.paragraphIdAt(peer, index);

/** Both replicas show `expected`, converge, and a replica reopened from the room shows it. */
async function expectShown(alice: Peer, bob: Peer, expected: string[]): Promise<Peer> {
  harness.expectConverged(alice, bob);
  expect(texts(alice)).toEqual(expected);
  expect(texts(bob)).toEqual(expected);
  const reopened = await harness.remount(bob);
  expect(texts(reopened)).toEqual(expected);
  return reopened;
}

/** The paragraph identity (`w14:paraId`) a peer shows for a paragraph. */
function paraIdOf(peer: Peer, id: string): string {
  const node = findNode(peer.store.bodyStore().part, id);
  const paraId =
    node && node.kind !== 'textValue'
      ? node.attributes.find((attribute) => attribute.localName === 'paraId')?.value
      : undefined;
  if (!paraId) throw new Error(`no paragraph identity for ${id}`);
  return paraId.toUpperCase();
}

describe('undo of a paragraph a peer typed in', () => {
  test('joins the peer text into the paragraph above', async () => {
    const { alice, bob: joined } = await harness.pair(paragraphs('Intro text.', 'Next.'));
    let bob = joined;
    harness.apply(alice, [{ op: 'splitParagraph', paragraphId: at(alice, 0), offset: 11 }]);
    harness.apply(alice, [
      { op: 'insertText', paragraphId: at(alice, 1), offset: 0, text: 'Summary' },
    ]);
    harness.apply(bob, [{ op: 'insertText', paragraphId: at(bob, 1), offset: 7, text: ' PERSON' }]);
    expect(texts(alice)).toEqual(['Intro text.', 'Summary PERSON', 'Next.']);
    expect(alice.room.session.undo()).toBe(true);
    bob = await expectShown(alice, bob, ['Intro text. PERSON', 'Next.']);
    expect(alice.room.session.redo()).toBe(true);
    bob = await expectShown(alice, bob, ['Intro text.', 'Summary PERSON', 'Next.']);
  });

  test('keeps typing in an empty new paragraph, and later typing beside it', async () => {
    const { alice, bob: joined } = await harness.pair(paragraphs('Intro text.', 'Next.'));
    let bob = joined;
    harness.apply(alice, [{ op: 'splitParagraph', paragraphId: at(alice, 0), offset: 11 }]);
    harness.apply(bob, [{ op: 'insertText', paragraphId: at(bob, 1), offset: 0, text: 'PERSON' }]);
    expect(alice.room.session.undo()).toBe(true);
    bob = await expectShown(alice, bob, ['Intro text.PERSON', 'Next.']);
    // Bob types after the text where it shows now, and Alice sees his caret there.
    harness.apply(bob, [{ op: 'insertText', paragraphId: at(bob, 0), offset: 17, text: '!' }]);
    const point = { paragraphId: paraIdOf(bob, at(bob, 0)), offset: 18 };
    bob.room.session.setLocalSelection({ anchor: point, head: point });
    applyAwarenessUpdate(
      alice.awareness,
      encodeAwarenessUpdate(bob.awareness, [bob.awareness.clientID]),
      'relay'
    );
    const shown = alice.room.session.remoteSelections().find((s) => s.actorId === 'bob');
    expect(shown?.head).toMatchObject(point);
    bob = await expectShown(alice, bob, ['Intro text.PERSON!', 'Next.']);
  });

  test('keeps peer text that arrives after the undo', async () => {
    const {
      alice,
      bob: joined,
      pause,
      resume,
    } = await harness.pair(paragraphs('Intro text.', 'Next.'));
    let bob = joined;
    harness.apply(alice, [{ op: 'splitParagraph', paragraphId: at(alice, 0), offset: 11 }]);
    harness.apply(alice, [
      { op: 'insertText', paragraphId: at(alice, 1), offset: 0, text: 'Summary' },
    ]);
    pause();
    harness.apply(bob, [{ op: 'insertText', paragraphId: at(bob, 1), offset: 7, text: ' PERSON' }]);
    expect(alice.room.session.undo()).toBe(true);
    resume();
    bob = await expectShown(alice, bob, ['Intro text. PERSON', 'Next.']);
  });

  test('joins the peer text into the paragraph after it when none comes before', async () => {
    const { alice, bob: joined } = await harness.pair(paragraphs('Intro text.', 'Next.'));
    let bob = joined;
    harness.apply(alice, [{ op: 'splitParagraph', paragraphId: at(alice, 0), offset: 11 }]);
    harness.apply(alice, [
      { op: 'insertText', paragraphId: at(alice, 1), offset: 0, text: 'Summary' },
    ]);
    harness.apply(bob, [{ op: 'deleteBlock', blockId: at(bob, 0) }]);
    harness.apply(bob, [{ op: 'insertText', paragraphId: at(bob, 0), offset: 7, text: ' PERSON' }]);
    expect(alice.room.session.undo()).toBe(true);
    bob = await expectShown(alice, bob, [' PERSONNext.']);
  });

  test('keeps the moved text when a peer deleted the paragraph it came from', async () => {
    const { alice, bob: joined } = await harness.pair(
      paragraphs('First part. Second part.', 'Next.')
    );
    let bob = joined;
    harness.apply(alice, [{ op: 'splitParagraph', paragraphId: at(alice, 0), offset: 12 }]);
    harness.apply(bob, [{ op: 'deleteBlock', blockId: at(bob, 0) }]);
    harness.apply(bob, [{ op: 'insertText', paragraphId: at(bob, 0), offset: 6, text: ' PERSON' }]);
    expect(texts(alice)).toEqual(['Second PERSON part.', 'Next.']);
    expect(alice.room.session.undo()).toBe(true);
    bob = await expectShown(alice, bob, ['Second PERSON part.', 'Next.']);
    expect(alice.room.session.redo()).toBe(true);
    bob = await expectShown(alice, bob, ['Second PERSON part.', 'Next.']);
  });

  test('an undo and redo of the peer text keep it where it joined', async () => {
    const { alice, bob } = await harness.pair(paragraphs('Intro text.', 'Next.'));
    harness.apply(alice, [{ op: 'splitParagraph', paragraphId: at(alice, 0), offset: 11 }]);
    harness.apply(bob, [{ op: 'insertText', paragraphId: at(bob, 1), offset: 0, text: 'PERSON' }]);
    expect(alice.room.session.undo()).toBe(true);
    expect(texts(bob)).toEqual(['Intro text.PERSON', 'Next.']);
    expect(bob.room.session.undo()).toBe(true);
    harness.expectConverged(alice, bob);
    expect(texts(alice)).toEqual(['Intro text.', 'Next.']);
    expect(bob.room.session.redo()).toBe(true);
    await expectShown(alice, bob, ['Intro text.PERSON', 'Next.']);
  });
});

describe('undo and redo of typing beside text a peer moved', () => {
  test('a redo restores typing in the paragraph the split moved it to', async () => {
    const {
      alice,
      bob: joined,
      pause,
      resume,
    } = await harness.pair(paragraphs('Shared text.', 'Next.'));
    let bob = joined;
    harness.apply(bob, [{ op: 'insertText', paragraphId: at(bob, 0), offset: 12, text: '[p1]' }]);
    pause();
    harness.apply(alice, [
      { op: 'insertText', paragraphId: at(alice, 0), offset: 16, text: '(a2)' },
    ]);
    // Bob, who has not seen Alice's typing, splits inside his own.
    harness.apply(bob, [{ op: 'splitParagraph', paragraphId: at(bob, 0), offset: 14 }]);
    resume();
    const before = ['Shared text.[p', '1](a2)', 'Next.'];
    bob = await expectShown(alice, bob, before);
    expect(alice.room.session.undo()).toBe(true);
    bob = await expectShown(alice, bob, ['Shared text.[p', '1]', 'Next.']);
    expect(alice.room.session.redo()).toBe(true);
    bob = await expectShown(alice, bob, before);
  });

  test('a redo keeps typing hidden when a peer deleted its paragraph', async () => {
    const {
      alice,
      bob: joined,
      pause,
      resume,
    } = await harness.pair(paragraphs('First.', 'Second paragraph to split and join.', 'Next.'));
    let bob = joined;
    harness.apply(alice, [{ op: 'deleteBlock', blockId: at(alice, 0) }]);
    harness.apply(alice, [{ op: 'splitParagraph', paragraphId: at(alice, 0), offset: 29 }]);
    pause();
    harness.apply(alice, [
      { op: 'insertText', paragraphId: at(alice, 0), offset: 29, text: '[a]' },
    ]);
    // Bob, who has not seen the typing, deletes the paragraph it went into.
    harness.apply(bob, [{ op: 'deleteBlock', blockId: at(bob, 0) }]);
    resume();
    const before = [' join.', 'Next.'];
    bob = await expectShown(alice, bob, before);
    expect(alice.room.session.undo()).toBe(true);
    expect(alice.room.session.redo()).toBe(true);
    bob = await expectShown(alice, bob, before);
  });
});
