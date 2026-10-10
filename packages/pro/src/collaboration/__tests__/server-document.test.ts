/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A server that holds a room's document receives every update as a remote one. Yjs then
// removes formatting markers it finds redundant, and that removal is a change of the server's
// own, which the server sends to every participant. A prepared document writes nothing.

import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { prepareCollaborationServerDocument } from '../index.ts';
import { deleteContent, keepFormattingMarkers } from '../document/yjs-items.ts';

const REMOTE = Symbol('remote');

/** The updates the server document writes itself while two participants edit one text. */
function serverWrites(prepare: boolean): number {
  const left = new Y.Doc();
  const right = new Y.Doc();
  const server = new Y.Doc();
  for (const doc of [left, right]) keepFormattingMarkers(doc);
  if (prepare) prepareCollaborationServerDocument(server);
  // Paragraph text lives in a record map, so the server decodes it as a text with formatting.
  const text = new Y.Text();
  left.getMap('nodes').set('p', text);
  text.insert(0, 'abcd', { t: 'one' });
  text.insert(4, 'efgh', { t: 'two' });
  Y.applyUpdate(server, Y.encodeStateAsUpdate(left), REMOTE);
  Y.applyUpdate(right, Y.encodeStateAsUpdate(server), REMOTE);
  let own = 0;
  server.on('update', (_update: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE) own += 1;
  });
  deleteContent(left.getMap('nodes').get('p') as Y.Text, 0, 4);
  const rightText = right.getMap('nodes').get('p') as Y.Text;
  rightText.insert(2, 'XY', { t: 'one' });
  rightText.format(0, 6, { t: 'two' });
  Y.applyUpdate(server, Y.encodeStateAsUpdate(left), REMOTE);
  Y.applyUpdate(server, Y.encodeStateAsUpdate(right), REMOTE);
  return own;
}

describe('prepareCollaborationServerDocument', () => {
  test('a prepared server document writes no change of its own', () => {
    expect(serverWrites(true)).toBe(0);
  });

  test('an unprepared one does, which is why servers prepare it', () => {
    expect(serverWrites(false)).toBeGreaterThan(0);
  });
});
