/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Typing into formatted text that another replica split must stay an incremental receive.
//
// A run split deletes the old run and moves its `w:rPr` to the new run, while the deleted run
// still lists it. Counting that tombstone as a second parent made every later keystroke in
// the paragraph look like a placement contest and sent it through a full pass, which costs
// the whole document on every replica in the room.

import { afterEach, describe, expect, test } from 'bun:test';
import { materializedPassCounts } from '../document/materialize.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';

const harness = createPeerHarness('remote-receive-split-run-cost');
afterEach(() => harness.cleanup());

describe('receiving keystrokes in a split formatted run', () => {
  test('stays incremental after a peer splits the run', async () => {
    const { alice, bob } = await harness.pair(
      zipDocument(
        '<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Formatted words in one run</w:t></w:r></w:p>' +
          '<w:sectPr/>'
      )
    );
    harness.apply(bob, [
      {
        op: 'setRunProperties',
        paragraphId: harness.paragraphIdAt(bob, 0),
        start: 10,
        end: 15,
        properties: [{ localName: 'b' }],
      },
    ]);
    const type = (): void =>
      harness.apply(alice, [
        { op: 'insertText', paragraphId: harness.paragraphIdAt(alice, 0), offset: 2, text: 'x' },
      ]);
    // The first receive after a split can take one full pass; the steady state must not.
    type();
    const full: number[] = [];
    for (let at = 0; at < 3; at += 1) {
      const before = materializedPassCounts().full;
      type();
      full.push(materializedPassCounts().full - before);
    }
    expect(full).toEqual([0, 0, 0]);
    harness.expectConverged(alice, bob);
  });
});
