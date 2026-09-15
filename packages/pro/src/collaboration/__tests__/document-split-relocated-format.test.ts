/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, expect, spyOn, test } from 'bun:test';
import { createPeerHarness, nodeText, zipDocument } from './document-peer-support.ts';

const harness = createPeerHarness('split-relocated-format');
afterEach(() => harness.cleanup());

for (const splitter of ['alice', 'bob'] as const) {
  test(`paragraph split by ${splitter} preserves previously formatted runs moved to its tail`, async () => {
    let identity = 16;
    const random = spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(
      (array: Uint8Array) => {
        new Uint8Array(array!.buffer, array!.byteOffset, array!.byteLength).fill(identity++);
        return array;
      }
    );
    try {
      const pair = await harness.pair(
        zipDocument('<w:p><w:r><w:t>ABCDEFGHIJKLMNOPQRSTUVWXYZ</w:t></w:r></w:p>')
      );
      const format = pair[splitter === 'alice' ? 'bob' : 'alice'];
      harness.apply(format, [
        {
          op: 'setRunProperties',
          paragraphId: harness.paragraphIdAt(format, 0),
          start: 10,
          end: 20,
          properties: [{ localName: 'b' }],
        },
      ]);
      const author = pair[splitter];
      harness.apply(author, [
        { op: 'splitParagraph', paragraphId: harness.paragraphIdAt(author, 0), offset: 4 },
      ]);
      for (const peer of [pair.alice, pair.bob]) {
        expect(nodeText(peer.store.bodyStore().part.root)).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
        harness.expectConverged(author, peer);
      }
      const joined = await harness.join(author, 'late-reader');
      expect(nodeText(joined.store.bodyStore().part.root)).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
      harness.expectConverged(author, joined);
    } finally {
      random.mockRestore();
    }
  });
}
