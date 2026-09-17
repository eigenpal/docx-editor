/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// History groups reach the shared undo authority: frames of one gesture are one shared undo
// item and a change of group is a boundary, on every replica. The clock rule itself is
// exercised against the manager in `history-group-capture.test.ts`.
import { afterEach, describe, expect, test } from 'bun:test';
import type { OoxmlNode } from '@docx-editor.dev/core/store';
import { BODY, createPeerHarness, walk, zipDocument, type Peer } from './document-peer-support.ts';

const harness = createPeerHarness('history-groups-room');
const doc = () => zipDocument('<w:p><w:r><w:t>Hello</w:t></w:r></w:p><w:sectPr/>');

afterEach(() => harness.cleanup());

function setColor(peer: Peer, value: string, historyGroup?: symbol): void {
  const paragraphId = harness.paragraphIdAt(peer, 0);
  const result = peer.store.transact(
    BODY,
    (context) =>
      context.apply({
        op: 'setRunProperties',
        paragraphId,
        start: 0,
        end: 5,
        properties: [{ localName: 'color', attributes: { val: value } }],
      }),
    historyGroup ? { historyGroup } : {}
  );
  if (!result.ok) throw new Error(result.detail ?? result.reason);
  peer.port.flushPendingJournals();
}

/** The `w:color` values the body's runs author, in order. */
function colors(peer: Peer): string[] {
  const found: string[] = [];
  walk(peer.store.bodyStore().part.root, (node: OoxmlNode) => {
    if (node.kind === 'textValue' || node.localName !== 'color') return;
    const value = node.attributes.find((attribute) => attribute.localName === 'val')?.value;
    if (value) found.push(value);
  });
  return found;
}

describe('history groups in a collaborative session', () => {
  test('frames of one gesture are one shared undo item, on every replica', async () => {
    const { alice, bob } = await harness.pair(doc());
    const gesture = Symbol('color-drag');
    setColor(alice, 'FF0000', gesture);
    setColor(alice, '00FF00', gesture);
    setColor(alice, '0000FF', gesture);
    expect(colors(bob)).toEqual(['0000FF']);
    expect(alice.room.session.undo()).toBe(true);
    alice.port.flushPendingJournals();
    expect(colors(alice)).toEqual([]);
    expect(colors(bob)).toEqual([]);
    expect(alice.room.session.canUndo()).toBe(false);
    harness.expectConverged(alice, bob);
  });

  test('ungrouped edits inside the capture window still join one item', async () => {
    const { alice } = await harness.pair(doc());
    setColor(alice, 'FF0000');
    setColor(alice, '00FF00');
    expect(alice.room.session.undo()).toBe(true);
    expect(colors(alice)).toEqual([]);
    expect(alice.room.session.canUndo()).toBe(false);
  });

  test('a change of group is a boundary in both directions', async () => {
    const { alice } = await harness.pair(doc());
    const gesture = Symbol('color-drag');
    setColor(alice, 'FF0000', gesture);
    setColor(alice, '00FF00'); // out of the group
    setColor(alice, '0000FF', gesture); // back in: a new gesture item, not the first one
    expect(alice.room.session.undo()).toBe(true);
    expect(colors(alice)).toEqual(['00FF00']);
    expect(alice.room.session.undo()).toBe(true);
    expect(colors(alice)).toEqual(['FF0000']);
    expect(alice.room.session.undo()).toBe(true);
    expect(colors(alice)).toEqual([]);
  });

  test('two gestures are two items', async () => {
    const { alice } = await harness.pair(doc());
    setColor(alice, 'FF0000', Symbol('first'));
    setColor(alice, '00FF00', Symbol('second'));
    expect(alice.room.session.undo()).toBe(true);
    expect(colors(alice)).toEqual(['FF0000']);
    expect(alice.room.session.undo()).toBe(true);
    expect(colors(alice)).toEqual([]);
  });

  test('undo is a boundary: a frame after it does not merge into the item below', async () => {
    const { alice } = await harness.pair(doc());
    const gesture = Symbol('color-drag');
    setColor(alice, 'FF0000', gesture);
    setColor(alice, '00FF00', Symbol('other'));
    expect(alice.room.session.undo()).toBe(true);
    expect(colors(alice)).toEqual(['FF0000']);
    setColor(alice, '0000FF', gesture);
    expect(alice.room.session.undo()).toBe(true);
    expect(colors(alice)).toEqual(['FF0000']);
  });
});
