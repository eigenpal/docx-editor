/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A shared-state reference this replica cannot resolve must not throw out of `applyUpdate`.
//
// The registry indexes paragraph shared text inside a Yjs observer. A throw there escapes the
// provider's message handler into the host's error reporting, and the transaction that carried
// it may have been only partly observed. An embed that names no node is refused through the
// session status, as every other dangling shared reference is. Malformed character attributes
// are read as missing, and the character takes its run from its neighbor, as typing does.

import { afterEach, describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { PACKAGE_NODES_KEY } from '../document/schema.ts';
import { INLINE_FIELD } from '../document/paragraph-text.ts';
import { createPeerHarness, walk, zipDocument, type Peer } from './document-peer-support.ts';

const harness = createPeerHarness('observer-no-throw-room');
afterEach(() => harness.cleanup());

function inlineText(peer: Peer): Y.Text {
  const nodes = peer.ydoc.getMap<Y.Map<unknown>>(PACKAGE_NODES_KEY);
  const [, record] = [...nodes.entries()].find(
    ([, value]) => value.get(INLINE_FIELD) instanceof Y.Text
  )!;
  return record.get(INLINE_FIELD) as Y.Text;
}

function bodyText(peer: Peer): string {
  const texts: string[] = [];
  walk(peer.store.bodyStore().part.root, (node) => {
    if (node.kind === 'textValue') texts.push(node.value);
  });
  return texts.join('');
}

describe('remote references a replica cannot resolve', () => {
  test('an embed that names no node is reported through the status', async () => {
    const { alice, bob } = await harness.pair(
      zipDocument('<w:p><w:r><w:t>Some text</w:t></w:r></w:p><w:sectPr/>')
    );
    // The relay applies this to bob inside alice's transaction, so a throw surfaces here.
    expect(() => inlineText(alice).insertEmbed(0, { n: 'missing-node', r: 1 })).not.toThrow();
    // The writer puts an embedded node's record and its embed in one transaction, so a
    // missing record is damaged state, not an update in flight.
    const snapshot = bob.room.session.statusSnapshot();
    expect(snapshot.status).toBe('error');
    expect(snapshot.reason?.code).toBe('materialize-dropped-content');
  });

  test('malformed character attributes keep the text', async () => {
    const { alice, bob } = await harness.pair(
      zipDocument('<w:p><w:r><w:t>Some text</w:t></w:r></w:p><w:sectPr/>')
    );
    expect(() =>
      inlineText(alice).format(0, 4, { r: '{not json', t: '[', __proto__: '{}' })
    ).not.toThrow();
    expect(bob.room.session.status()).toBe('ready');
    expect(bodyText(bob)).toBe('Some text');
    harness.expectConverged(alice, bob);
  });
});
