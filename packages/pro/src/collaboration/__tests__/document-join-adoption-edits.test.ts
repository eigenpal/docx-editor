/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Editing a joined paragraph after a peer typed into the paragraph it absorbed.
//
// One author joins two paragraphs while another types into the second. The typed run reaches
// the joined paragraph by adoption: the survivor shows it after its own children, while shared
// state still lists it under the deleted paragraph. A later structural edit of the survivor —
// Enter, a format split — addressed the shown children, which shared state did not have,
// and the journal refused it with `invalid-bound`. The author's session ended.

import { afterEach, describe, expect, test } from 'bun:test';
import {
  createPeerHarness,
  nodeText,
  walk,
  zipDocument,
  type Peer,
} from './document-peer-support.ts';

const harness = createPeerHarness('join-adoption-edits-room');

afterEach(() => {
  harness.cleanup();
});

function doc(): Uint8Array {
  return zipDocument(
    '<w:p><w:r><w:t>First part</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>second part</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Closing</w:t></w:r></w:p><w:sectPr/>'
  );
}

function paragraphTexts(peer: Peer): string[] {
  const texts: string[] = [];
  walk(peer.store.bodyStore().part.root, (node) => {
    if (node.kind === 'paragraph') texts.push(nodeText(node));
  });
  return texts;
}

function expectHealthy(alice: Peer, bob: Peer): void {
  expect(alice.room.session.status()).toBe('ready');
  expect(bob.room.session.status()).toBe('ready');
  harness.expectConverged(alice, bob);
}

/** Bob joins paragraphs 0 and 1 while Alice types at the end of paragraph 1. */
async function joinWhileTyping(): Promise<{ alice: Peer; bob: Peer }> {
  const { alice, bob, pause, resume } = await harness.pair(doc());
  pause();
  harness.apply(alice, [
    {
      op: 'setRunProperties',
      paragraphId: harness.paragraphIdAt(alice, 1),
      start: 7,
      end: 11,
      properties: [{ localName: 'b' }],
    },
  ]);
  harness.apply(bob, [
    {
      op: 'joinParagraphs',
      firstId: harness.paragraphIdAt(bob, 0),
      secondId: harness.paragraphIdAt(bob, 1),
    },
  ]);
  resume();
  expectHealthy(alice, bob);
  return { alice, bob };
}

/** Alice splits paragraph 1 and types in it while Bob joins paragraphs 0 and 1. */
async function joinWhileSplitting(): Promise<{ alice: Peer; bob: Peer }> {
  const { alice, bob, pause, resume } = await harness.pair(doc());
  pause();
  harness.apply(alice, [
    { op: 'splitParagraph', paragraphId: harness.paragraphIdAt(alice, 1), offset: 3 },
  ]);
  harness.apply(alice, [
    { op: 'insertText', paragraphId: harness.paragraphIdAt(alice, 1), offset: 2, text: 'xy' },
  ]);
  harness.apply(bob, [
    {
      op: 'joinParagraphs',
      firstId: harness.paragraphIdAt(bob, 0),
      secondId: harness.paragraphIdAt(bob, 1),
    },
  ]);
  resume();
  expectHealthy(alice, bob);
  return { alice, bob };
}

describe('edits after a join adopts concurrent content', () => {
  test('deleting the paragraph that won concurrently moved runs hands them to the other', async () => {
    const { alice, bob, pause, resume } = await harness.pair(doc());
    pause();
    harness.apply(alice, [
      {
        op: 'joinParagraphs',
        firstId: harness.paragraphIdAt(alice, 0),
        secondId: harness.paragraphIdAt(alice, 1),
      },
    ]);
    harness.apply(bob, [
      { op: 'splitParagraph', paragraphId: harness.paragraphIdAt(bob, 1), offset: 0 },
    ]);
    resume();
    expectHealthy(alice, bob);
    const winner = paragraphTexts(alice).findIndex((text) => text.includes('second'));
    expect(winner).toBeGreaterThanOrEqual(0);
    harness.apply(alice, [
      {
        op: 'deleteBlock',
        blockId: harness.paragraphIdAt(alice, winner),
      } as never,
    ]);
    expectHealthy(alice, bob);
    // The author deleted the paragraph that showed the moved text, so it stays deleted.
    expect(paragraphTexts(bob).join('|')).not.toContain('second');
    const late = await harness.join(bob, 'late');
    harness.expectConverged(alice, late);
  });

  test('undoing a join gives concurrently split content back to every peer', async () => {
    const { alice, bob, pause, resume } = await harness.pair(doc());
    pause();
    harness.apply(bob, [
      { op: 'splitParagraph', paragraphId: harness.paragraphIdAt(bob, 1), offset: 6 },
    ]);
    harness.apply(alice, [
      {
        op: 'joinParagraphs',
        firstId: harness.paragraphIdAt(alice, 0),
        secondId: harness.paragraphIdAt(alice, 1),
      },
    ]);
    resume();
    expectHealthy(alice, bob);
    expect(alice.room.session.undo()).toBe(true);
    expectHealthy(alice, bob);
    expect(paragraphTexts(bob)).toEqual(['First part', 'second', ' part', 'Closing']);
    const late = await harness.join(alice, 'late');
    harness.expectConverged(alice, late);
  });

  test('typing into an adopted run that a concurrent format split produced reaches every peer', async () => {
    const { alice, bob, pause, resume } = await harness.pair(
      zipDocument(
        '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>DOCX-EDITOR.DEV</w:t></w:r></w:p>' +
          '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>ELEMENT TEST DOCUMENT</w:t></w:r></w:p>' +
          '<w:sectPr/>'
      )
    );
    harness.apply(alice, [
      { op: 'insertTab', paragraphId: harness.paragraphIdAt(alice, 1), offset: 4 },
    ]);
    pause();
    harness.apply(alice, [
      {
        op: 'joinParagraphs',
        firstId: harness.paragraphIdAt(alice, 0),
        secondId: harness.paragraphIdAt(alice, 1),
      },
    ]);
    harness.apply(bob, [
      {
        op: 'setRunProperties',
        paragraphId: harness.paragraphIdAt(bob, 1),
        start: 0,
        end: 8,
        properties: [],
      },
    ]);
    harness.apply(alice, [
      {
        op: 'setRunProperties',
        paragraphId: harness.paragraphIdAt(alice, 0),
        start: 13,
        end: 21,
        properties: [{ localName: 'u' }],
      },
    ]);
    harness.apply(bob, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(bob, 1), offset: 3, text: 'l' },
    ]);
    resume();
    expectHealthy(alice, bob);
    const late = await harness.join(alice, 'late');
    harness.expectConverged(alice, late);
    expect(paragraphTexts(alice).join('')).toContain('ELEl');
  });

  test('the joining author can split a paragraph that adopted a concurrent edit', async () => {
    const { alice, bob } = await joinWhileSplitting();
    const before = paragraphTexts(bob).join('');
    for (const offset of [2, 6]) {
      const last = paragraphTexts(bob)[0]!.length;
      harness.apply(bob, [
        {
          op: 'splitParagraph',
          paragraphId: harness.paragraphIdAt(bob, 0),
          offset: Math.min(offset, last),
        },
      ]);
      expectHealthy(alice, bob);
    }
    harness.apply(bob, [
      {
        op: 'splitParagraph',
        paragraphId: harness.paragraphIdAt(bob, 2),
        offset: paragraphTexts(bob)[2]!.length,
      },
    ]);
    expectHealthy(alice, bob);
    expect(paragraphTexts(alice).join('')).toBe(before);
  });

  test('the joining author can split the joined paragraph', async () => {
    const { alice, bob } = await joinWhileTyping();
    const joined = paragraphTexts(bob)[0]!;
    harness.apply(bob, [
      {
        op: 'splitParagraph',
        paragraphId: harness.paragraphIdAt(bob, 0),
        offset: joined.length - 2,
      },
    ]);
    expectHealthy(alice, bob);
    expect(paragraphTexts(alice).join('')).toBe(`${joined}Closing`);
  });

  test('both authors keep editing the joined paragraph', async () => {
    const { alice, bob } = await joinWhileTyping();
    harness.apply(bob, [
      { op: 'splitParagraph', paragraphId: harness.paragraphIdAt(bob, 0), offset: 5 },
    ]);
    harness.apply(alice, [
      {
        op: 'setRunProperties',
        paragraphId: harness.paragraphIdAt(alice, 1),
        start: 0,
        end: 3,
        properties: [{ localName: 'i' }],
      },
    ]);
    harness.apply(alice, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(alice, 1), offset: 0, text: '>' },
    ]);
    expectHealthy(alice, bob);
    expect(paragraphTexts(bob)[1]!.startsWith('>')).toBe(true);
  });

  test('a peer joining afterwards matches', async () => {
    const { alice, bob } = await joinWhileTyping();
    harness.apply(bob, [
      { op: 'splitParagraph', paragraphId: harness.paragraphIdAt(bob, 0), offset: 3 },
    ]);
    const late = await harness.join(alice, 'late');
    expectHealthy(alice, bob);
    expect(late.room.session.status()).toBe('ready');
    harness.expectConverged(alice, late);
  });
});
