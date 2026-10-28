/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// An undo while a peer edits the same content at the same time: each participant's undo takes
// back its own edit only, and text a peer deleted stays deleted.

import { afterEach, describe, expect, test } from 'bun:test';
import type { OoxmlNode, TreeDocOp } from '@docx-editor.dev/core/store';
import {
  createPeerHarness,
  nodeText,
  walk,
  zipDocument,
  type Peer,
} from './document-peer-support.ts';

const harnesses: ReturnType<typeof createPeerHarness>[] = [];

/** A harness whose peers have fixed Yjs client IDs: concurrent writes resolve by client ID. */
function harnessWith(clientIds?: Readonly<Record<string, number>>) {
  const harness = createPeerHarness('undo-beside-concurrent-edits-room', undefined, clientIds);
  harnesses.push(harness);
  return harness;
}

afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.cleanup();
});

/** Both orders of the two peers' client IDs: the undoing peer's write wins one, loses one. */
const CLIENT_ORDERS = [
  { label: 'the undoing peer has the higher client ID', ids: { alice: 10, bob: 20, carol: 30 } },
  { label: 'the undoing peer has the lower client ID', ids: { alice: 20, bob: 10, carol: 30 } },
] as const;

const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const cell = (text: string) => `<w:tc>${paragraph(text)}</w:tc>`;
const TABLE =
  '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>' +
  `<w:tr>${cell('a1')}${cell('b1')}</w:tr><w:tr>${cell('a2')}${cell('b2')}</w:tr></w:tbl>`;
const TABLE_DOCUMENT = zipDocument(
  paragraph('Before') + TABLE + paragraph('After') + '<w:sectPr/>'
);

function texts(peer: Peer): string[] {
  const found: string[] = [];
  walk(peer.store.bodyStore().part.root, (node) => {
    if (node.kind === 'paragraph') found.push(nodeText(node));
  });
  return found;
}

function elementIds(peer: Peer, localName: string): string[] {
  const found: string[] = [];
  walk(peer.store.bodyStore().part.root, (node) => {
    if (node.kind !== 'textValue' && node.localName === localName) found.push(node.id);
  });
  return found;
}

describe('two peers delete the same table content and one undoes', () => {
  // The peer that deletes typed text it saw, while the other peer, which never saw it,
  // deletes the same row, column, or table and undoes. Only the undoing peer's delete goes.
  const deletes: readonly {
    readonly name: string;
    readonly op: (peer: Peer) => TreeDocOp;
  }[] = [
    {
      name: 'a row',
      op: (peer) => ({
        op: 'deleteTableRow',
        tableId: elementIds(peer, 'tbl')[0]!,
        rowId: elementIds(peer, 'tr')[0]!,
      }),
    },
    {
      name: 'a column',
      op: (peer) => ({
        op: 'deleteTableColumn',
        tableId: elementIds(peer, 'tbl')[0]!,
        gridColumnId: elementIds(peer, 'gridCol')[1]!,
      }),
    },
    {
      name: 'the table',
      op: (peer) => ({ op: 'deleteBlock', blockId: elementIds(peer, 'tbl')[0]! }),
    },
  ];
  for (const { label, ids } of CLIENT_ORDERS) {
    for (const { name, op } of deletes) {
      test(`${name}: the text the other peer deleted stays deleted (${label})`, async () => {
        const harness = harnessWith(ids);
        const { alice, bob, pause, resume } = await harness.pair(TABLE_DOCUMENT);
        pause();
        // "b1", in the first row and the second column.
        const typedIn = harness.paragraphIdAt(alice, 2);
        harness.apply(alice, [{ op: 'insertText', paragraphId: typedIn, offset: 2, text: 'X' }]);
        harness.apply(alice, [op(alice)]);
        harness.apply(bob, [op(bob)]);
        expect(bob.room.session.undo()).toBe(true);
        resume();
        harness.expectConverged(alice, bob);
        for (const peer of [alice, bob]) {
          expect(texts(peer).join('|')).not.toContain('X');
          expect(texts(peer).join('|')).not.toContain('b1');
        }
      });
    }
  }

  test('a peer that undoes its own delete alone gets the row back', async () => {
    const harness = harnessWith(CLIENT_ORDERS[0].ids);
    const { alice, bob } = await harness.pair(TABLE_DOCUMENT);
    harness.apply(bob, [deletes[0]!.op(bob)]);
    expect(texts(alice)).toEqual(['Before', 'a2', 'b2', 'After']);
    expect(bob.room.session.undo()).toBe(true);
    harness.expectConverged(alice, bob);
    expect(texts(alice)).toEqual(['Before', 'a1', 'b1', 'a2', 'b2', 'After']);
  });
});

describe('an undo of typing while a peer joins its paragraph', () => {
  for (const { label, ids } of CLIENT_ORDERS) {
    test(`the copy the join made goes with the typing (${label})`, async () => {
      const harness = harnessWith(ids);
      const { alice, bob, pause, resume } = await harness.pair(
        zipDocument(paragraph('First') + paragraph('Second') + '<w:sectPr/>')
      );
      const first = harness.paragraphIdAt(alice, 0);
      const second = harness.paragraphIdAt(alice, 1);
      harness.apply(alice, [{ op: 'insertText', paragraphId: second, offset: 6, text: 'XYZ' }]);
      expect(texts(bob)).toEqual(['First', 'SecondXYZ']);
      pause();
      expect(alice.room.session.undo()).toBe(true);
      harness.apply(bob, [{ op: 'joinParagraphs', firstId: first, secondId: second }]);
      resume();
      harness.expectConverged(alice, bob);
      expect(texts(alice)).toEqual(['FirstSecond']);
      // The redo brings the typing back where the join put it.
      expect(alice.room.session.redo()).toBe(true);
      harness.expectConverged(alice, bob);
      expect(texts(bob)).toEqual(['FirstSecondXYZ']);
    });
  }
});
