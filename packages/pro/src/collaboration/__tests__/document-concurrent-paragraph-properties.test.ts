/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Concurrent writes of an element OOXML allows once.
//
// Two people formatting one paragraph at the same moment can each give it a `w:pPr`, each give
// a run a `w:rPr`, or each add a `w:jc` to one `w:pPr`. Merged, the paragraph holds two of an
// element its schema allows once. Validation used to refuse the part on every replica, idle
// peers included, and end the session for the whole room.
//
// Every replica now shows the first live copy in shared child order, with a leading
// properties element first. These cases pin that the room stays `ready`, converges, survives
// save and reopen and a cold join, and keeps working: the losing author can edit the same
// properties again, undo, and keep typing.

import { afterEach, describe, expect, test } from 'bun:test';
import type { OoxmlNode, TreeDocOp } from '@docx-editor.dev/core/store';
import { createPeerHarness, nodeText, zipDocument, type Peer } from './document-peer-support.ts';

const harness = createPeerHarness('concurrent-paragraph-properties-room');

afterEach(() => {
  harness.cleanup();
});

function paragraph(peer: Peer, index = 0): Extract<OoxmlNode, { children: unknown }> {
  const id = harness.paragraphIdAt(peer, index);
  let found: OoxmlNode | null = null;
  const walk = (node: OoxmlNode): void => {
    if (found || node.kind === 'textValue') return;
    if (node.id === id) found = node;
    else node.children.forEach(walk);
  };
  walk(peer.store.bodyStore().part.root);
  if (!found || (found as OoxmlNode).kind === 'textValue') throw new Error('no paragraph');
  return found as Extract<OoxmlNode, { children: unknown }>;
}

function childNames(node: OoxmlNode): string[] {
  return node.kind === 'textValue'
    ? []
    : node.children.map((child) => (child.kind === 'textValue' ? '#text' : child.localName));
}

/** Local names under the paragraph's `w:pPr`, or null without one. */
function paragraphProperties(peer: Peer, index = 0): string[] | null {
  const properties = paragraph(peer, index).children.find(
    (child) => child.kind === 'paragraphProperties'
  );
  return properties ? childNames(properties) : null;
}

function alignment(peer: Peer, index = 0): string | null {
  const properties = paragraph(peer, index).children.find(
    (child) => child.kind === 'paragraphProperties'
  );
  if (!properties || properties.kind === 'textValue') return null;
  const jc = properties.children.find(
    (child) => child.kind !== 'textValue' && child.localName === 'jc'
  );
  if (!jc || jc.kind === 'textValue') return null;
  return jc.attributes.find((attribute) => attribute.localName === 'val')?.value ?? null;
}

function align(peer: Peer, value: string, index = 0): TreeDocOp {
  return {
    op: 'setParagraphProperties',
    paragraphId: harness.paragraphIdAt(peer, index),
    properties: [{ localName: 'jc', attributes: { val: value } }],
  };
}

function expectHealthy(...peers: Peer[]): void {
  for (const peer of peers) expect(peer.room.session.status()).toBe('ready');
  for (const peer of peers.slice(1)) harness.expectConverged(peers[0]!, peer);
}

/** Every paragraph and run has at most one properties element, and it comes first. */
function expectWellFormed(peer: Peer): void {
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    const leading =
      node.kind === 'paragraph'
        ? 'paragraphProperties'
        : node.kind === 'run'
          ? 'runProperties'
          : null;
    if (leading) {
      const indexes = node.children.flatMap((child, at) => (child.kind === leading ? [at] : []));
      expect(indexes.length).toBeLessThanOrEqual(1);
      if (indexes.length === 1) expect(indexes[0]).toBe(0);
    }
    if (node.kind === 'paragraphProperties' || node.kind === 'runProperties') {
      const names = childNames(node);
      expect(new Set(names).size).toBe(names.length);
    }
    node.children.forEach(visit);
  };
  visit(peer.store.bodyStore().part.root);
}

const PLAIN = '<w:p><w:r><w:t>Aligned text here</w:t></w:r></w:p><w:sectPr/>';

describe('concurrent singleton properties', () => {
  test('two peers creating w:pPr on one paragraph keep the room ready', async () => {
    const { alice, bob, pause, resume } = await harness.pair(zipDocument(PLAIN));
    const carol = await harness.join(alice, 'carol');
    pause();
    harness.apply(alice, [align(alice, 'left')]);
    harness.apply(bob, [align(bob, 'right')]);
    resume();
    expectHealthy(alice, bob, carol);
    expectWellFormed(alice);
    // One author's alignment wins, the same one everywhere.
    expect(['left', 'right']).toContain(alignment(alice)!);
    expect(alignment(bob)).toBe(alignment(alice));
  });

  test('the losing author can align again, undo, and type afterwards', async () => {
    const { alice, bob, pause, resume } = await harness.pair(zipDocument(PLAIN));
    pause();
    harness.apply(alice, [align(alice, 'left')]);
    harness.apply(bob, [align(bob, 'right')]);
    resume();
    const loser = alignment(alice) === 'left' ? bob : alice;
    const other = loser === alice ? bob : alice;
    harness.apply(loser, [align(loser, 'center')]);
    expectHealthy(alice, bob);
    expect(alignment(other)).toBe('center');
    harness.apply(loser, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(loser, 0), offset: 0, text: 'New ' },
    ]);
    expectHealthy(alice, bob);
    expect(nodeText(paragraph(other))).toBe('New Aligned text here');
    loser.room.session.undo();
    expectHealthy(alice, bob);
    expectWellFormed(alice);
  });

  test('a peer joining after the conflict sees the same document', async () => {
    const { alice, bob, pause, resume } = await harness.pair(zipDocument(PLAIN));
    pause();
    harness.apply(alice, [align(alice, 'left')]);
    harness.apply(bob, [align(bob, 'right')]);
    resume();
    const late = await harness.join(bob, 'late');
    expectHealthy(alice, bob, late);
    expect(alignment(late)).toBe(alignment(alice));
  });

  test('removing the shown copy does not bring back the hidden one', async () => {
    // Without a `w:pPr`, each author creates one, so the conflict is between two of them.
    const { alice, bob, pause, resume } = await harness.pair(zipDocument(PLAIN));
    pause();
    harness.apply(alice, [align(alice, 'left')]);
    harness.apply(bob, [align(bob, 'right')]);
    resume();
    const winner = alignment(alice) === 'left' ? alice : bob;
    harness.apply(winner, [
      {
        op: 'setParagraphProperties',
        paragraphId: harness.paragraphIdAt(winner, 0),
        properties: [],
      },
    ]);
    expectHealthy(alice, bob);
    expect(alignment(alice)).toBeNull();
    expect(alignment(bob)).toBeNull();
    const late = await harness.join(alice, 'late');
    expect(alignment(late)).toBeNull();
  });

  test('paragraph-mark formatting and tab stops written at once keep the room ready', async () => {
    // Both writes append to the same `w:pPr`, so Yjs orders them by random client id: about
    // half the time the merged list puts `w:tabs` after the mark's `w:rPr`. Repeat with fresh
    // peers so a regression shows up on nearly every run.
    for (let round = 0; round < 8; round += 1) {
      const { alice, bob, pause, resume } = await harness.pair(
        zipDocument(
          '<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t>Mark</w:t></w:r></w:p>' +
            '<w:sectPr/>'
        )
      );
      pause();
      harness.apply(alice, [
        {
          op: 'setParagraphMarkProperties',
          paragraphId: harness.paragraphIdAt(alice, 0),
          properties: [{ localName: 'b' }],
        },
      ]);
      harness.apply(bob, [
        {
          op: 'setParagraphTabStops',
          paragraphId: harness.paragraphIdAt(bob, 0),
          stops: [{ positionTwips: 720, alignment: 'left' }],
        },
      ]);
      resume();
      expectHealthy(alice, bob);
      expectWellFormed(alice);
      // Later edits address the order every replica shows, with the mark's `w:rPr` last.
      for (const [author, op] of [
        [alice, align(alice, 'center')],
        [
          bob,
          {
            op: 'setParagraphTabStops',
            paragraphId: harness.paragraphIdAt(bob, 0),
            stops: [],
          },
        ],
      ] as const) {
        harness.apply(author, [op as TreeDocOp]);
        expectHealthy(alice, bob);
        expectWellFormed(alice);
        expectWellFormed(bob);
      }
      const late = await harness.join(alice, 'late');
      harness.expectConverged(alice, late);
      harness.cleanup();
    }
  });

  test('two w:jc written into one existing w:pPr show once', async () => {
    const { alice, bob, pause, resume } = await harness.pair(
      zipDocument(
        '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:t>Spaced</w:t></w:r></w:p>' +
          '<w:sectPr/>'
      )
    );
    pause();
    harness.apply(alice, [align(alice, 'left')]);
    harness.apply(bob, [align(bob, 'right')]);
    resume();
    expectHealthy(alice, bob);
    expectWellFormed(alice);
    // `setParagraphProperties` replaces the list, so each author's write is one `w:jc`.
    expect(paragraphProperties(alice)).toEqual(['jc']);
  });

  test('two peers creating w:rPr on one run keep the room ready', async () => {
    const { alice, bob, pause, resume } = await harness.pair(zipDocument(PLAIN));
    const length = 'Aligned text here'.length;
    pause();
    harness.apply(alice, [
      {
        op: 'setRunProperties',
        paragraphId: harness.paragraphIdAt(alice, 0),
        start: 0,
        end: length,
        properties: [{ localName: 'b' }],
      },
    ]);
    harness.apply(bob, [
      {
        op: 'setRunProperties',
        paragraphId: harness.paragraphIdAt(bob, 0),
        start: 0,
        end: length,
        properties: [{ localName: 'i' }],
      },
    ]);
    resume();
    expectHealthy(alice, bob);
    expectWellFormed(alice);
    expect(nodeText(paragraph(alice))).toBe('Aligned text here');
  });

  test('w:pPr stays first when a concurrent edit inserts runs at the paragraph start', async () => {
    const { alice, bob, pause, resume } = await harness.pair(zipDocument(PLAIN));
    pause();
    harness.apply(alice, [align(alice, 'center')]);
    harness.apply(bob, [
      {
        op: 'setRunProperties',
        paragraphId: harness.paragraphIdAt(bob, 0),
        start: 0,
        end: 3,
        properties: [{ localName: 'b' }],
      },
    ]);
    resume();
    expectHealthy(alice, bob);
    expectWellFormed(alice);
    expectWellFormed(bob);
    expect(alignment(bob)).toBe('center');
    // Both authors keep editing the start of the paragraph without leaving `ready`.
    harness.apply(bob, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(bob, 0), offset: 0, text: 'B' },
    ]);
    harness.apply(alice, [align(alice, 'right')]);
    expectHealthy(alice, bob);
    expect(nodeText(paragraph(alice))).toBe('BAligned text here');
    expect(alignment(bob)).toBe('right');
  });

  test('duplicates the source file already holds stay as loaded', async () => {
    const { alice, bob } = await harness.pair(
      zipDocument('<w:p><w:r><w:rPr><w:b/><w:b/></w:rPr><w:t>Bold</w:t></w:r></w:p><w:sectPr/>')
    );
    harness.apply(alice, [
      { op: 'insertText', paragraphId: harness.paragraphIdAt(alice, 0), offset: 4, text: '!' },
    ]);
    expectHealthy(alice, bob);
    const run = paragraph(bob).children.find((child) => child.kind === 'run')!;
    const properties = run.kind === 'textValue' ? null : run.children[0]!;
    expect(properties ? childNames(properties) : []).toEqual(['b', 'b']);
  });
});
