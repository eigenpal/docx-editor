/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, expect, test } from 'bun:test';
import {
  createPeerHarness,
  nodeText,
  walk,
  zipDocument,
  type Peer,
} from './document-peer-support.ts';
const h = createPeerHarness('split-boundary-592');
afterEach(() => h.cleanup());
function runs(peer: Peer): string[] {
  const result: string[] = [];
  walk(peer.store.bodyStore().part.root, (node) => {
    if (node.kind === 'run') result.push(nodeText(node));
  });
  return result;
}
for (const bias of ['left', 'right'] as const) {
  test(`split-boundary insertion preserves ${bias} formatting on peers and cold joins`, async () => {
    const { alice, bob } = await h.pair(
      zipDocument('<w:p><w:r><w:t>ABCDEFGHIJ</w:t></w:r></w:p><w:sectPr/>')
    );
    h.apply(alice, [
      {
        op: 'setRunProperties',
        paragraphId: h.paragraphIdAt(alice, 0),
        start: 0,
        end: 5,
        properties: [{ localName: 'b' }],
      },
    ]);
    h.apply(alice, [
      { op: 'insertText', paragraphId: h.paragraphIdAt(alice, 0), offset: 5, text: 'XXX', bias },
    ]);
    const expected = bias === 'left' ? ['ABCDEXXX', 'FGHIJ'] : ['ABCDE', 'XXXFGHIJ'];
    const cold = await h.join(bob, 'cold');
    for (const peer of [alice, bob, cold]) {
      expect(runs(peer)).toEqual(expected);
      h.expectConverged(alice, peer);
    }
  });
}
test('ordinary typing reuses split visibility until structural changes invalidate it', async () => {
  const { alice, bob } = await h.pair(
    zipDocument('<w:p><w:r><w:t>ABCDEFGHIJ</w:t></w:r></w:p><w:sectPr/>')
  );
  h.apply(alice, [
    {
      op: 'setRunProperties',
      paragraphId: h.paragraphIdAt(alice, 0),
      start: 0,
      end: 5,
      properties: [{ localName: 'b' }],
    },
  ]);
  const { registry } = alice.room.session as unknown as {
    registry: import('../document/registry.ts').DocumentRegistry;
  };
  const before = registry.replacementLoserRuns();
  h.apply(alice, [
    { op: 'insertText', paragraphId: h.paragraphIdAt(alice, 0), offset: 2, text: 'X' },
  ]);
  expect(registry.replacementLoserRuns()).toBe(before);
  h.expectConverged(alice, bob);
  h.apply(alice, [
    {
      op: 'setRunProperties',
      paragraphId: h.paragraphIdAt(alice, 0),
      start: 1,
      end: 3,
      properties: [{ localName: 'i' }],
    },
  ]);
  expect(registry.replacementLoserRuns()).not.toBe(before);
  h.expectConverged(alice, bob);
});
