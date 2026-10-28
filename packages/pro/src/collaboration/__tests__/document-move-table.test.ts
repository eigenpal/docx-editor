/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// moveTable between two peers: every peer shows the same body order as the one that moved
// the table, and a move that races another edit converges without losing a block.

import { afterEach, describe, expect, test } from 'bun:test';
import type { OoxmlNode, TreeDocOp } from '@docx-editor.dev/core/store';
import {
  createPeerHarness,
  nodeText,
  walk,
  zipDocument,
  type Peer,
} from './document-peer-support.ts';

const harness = createPeerHarness('move-table-room');
afterEach(() => harness.cleanup());

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const TABLE = `<w:tbl><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc>${p('cell')}</w:tc></w:tr></w:tbl>`;
const DOC = zipDocument(p('p0') + p('p1') + TABLE + p('p2') + p('p3') + p('p4') + '<w:sectPr/>');

function body(peer: Peer): OoxmlNode {
  let found: OoxmlNode | undefined;
  walk(harness.packageOf(peer).parts.get('/word/document.xml')!.root, (node) => {
    if (!found && node.kind !== 'textValue' && node.localName === 'body') found = node;
  });
  if (!found) throw new Error('no body');
  return found;
}

/** Body blocks as text, the table as `[T]`. */
function order(peer: Peer): string[] {
  const node = body(peer);
  if (node.kind === 'textValue') return [];
  return node.children
    .filter((child) => child.kind === 'paragraph' || child.kind === 'table')
    .map((child) => (child.kind === 'table' ? '[T]' : nodeText(child)));
}

function blockId(peer: Peer, label: string): string {
  const node = body(peer);
  if (node.kind === 'textValue') throw new Error('no body');
  const found = node.children.find((child) =>
    label === '[T]'
      ? child.kind === 'table'
      : child.kind === 'paragraph' && nodeText(child) === label
  );
  if (!found) throw new Error(`no block ${label}`);
  return found.id;
}

const move = (peer: Peer, before: string): TreeDocOp => ({
  op: 'moveTable',
  tableId: blockId(peer, '[T]'),
  beforeBlockId: blockId(peer, before),
});

describe('moving a table between peers', () => {
  const cases: readonly [string, string, string[]][] = [
    ['up by two', 'p0', ['[T]', 'p0', 'p1', 'p2', 'p3', 'p4']],
    ['up by one', 'p1', ['p0', '[T]', 'p1', 'p2', 'p3', 'p4']],
    ['down by two', 'p4', ['p0', 'p1', 'p2', 'p3', '[T]', 'p4']],
  ];
  for (const [name, before, expected] of cases) {
    test(`a move ${name} shows the same order on every peer`, async () => {
      const { alice, bob } = await harness.pair(DOC);
      harness.apply(alice, [move(alice, before)]);
      expect(order(alice)).toEqual(expected);
      expect(order(bob)).toEqual(expected);
      const late = await harness.join(alice, 'late');
      expect(order(late)).toEqual(expected);
      harness.expectConverged(alice, bob);
    });
  }

  test('a move up by three keeps every block', async () => {
    const doc = zipDocument(p('p0') + p('p1') + p('p2') + TABLE + p('p3') + '<w:sectPr/>');
    const { alice, bob } = await harness.pair(doc);
    harness.apply(alice, [move(alice, 'p0')]);
    expect(order(alice)).toEqual(['[T]', 'p0', 'p1', 'p2', 'p3']);
    expect(order(bob)).toEqual(['[T]', 'p0', 'p1', 'p2', 'p3']);
    harness.expectConverged(alice, bob);
  });

  test('concurrent moves to different slots converge on one table and keep every block', async () => {
    const { alice, bob, pause, resume } = await harness.pair(DOC);
    pause();
    harness.apply(alice, [move(alice, 'p0')]);
    harness.apply(bob, [move(bob, 'p4')]);
    resume();
    harness.expectConverged(alice, bob);
    const result = order(alice);
    expect(result.filter((label) => label === '[T]')).toHaveLength(1);
    expect(result.filter((label) => label !== '[T]')).toEqual(['p0', 'p1', 'p2', 'p3', 'p4']);
    expect(order(bob)).toEqual(result);
  });

  test('a move before a paragraph the other peer deletes keeps the table', async () => {
    const { alice, bob, pause, resume } = await harness.pair(DOC);
    pause();
    harness.apply(alice, [move(alice, 'p0')]);
    harness.apply(bob, [{ op: 'deleteBlock', blockId: blockId(bob, 'p0') }]);
    resume();
    harness.expectConverged(alice, bob);
    expect(order(alice)).toEqual(['[T]', 'p1', 'p2', 'p3', 'p4']);
  });

  test('a move while the other peer deletes the table converges on the deletion', async () => {
    const { alice, bob, pause, resume } = await harness.pair(DOC);
    pause();
    harness.apply(alice, [move(alice, 'p0')]);
    harness.apply(bob, [{ op: 'deleteBlock', blockId: blockId(bob, '[T]') }]);
    resume();
    harness.expectConverged(alice, bob);
    expect(order(alice)).toEqual(['p0', 'p1', 'p2', 'p3', 'p4']);
  });
});
