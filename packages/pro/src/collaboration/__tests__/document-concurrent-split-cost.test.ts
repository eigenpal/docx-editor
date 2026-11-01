/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The order of concurrent split siblings costs once per change, not once per read.
//
// After two peers split one long paragraph at once, every later edit in the room reads the
// order of the new paragraphs, many times per edit through document-order comparisons. The
// time per edit in a large room must grow with the room as it does without such a run, so the
// test compares a large room with a small one in the same process, not with a wall clock.

import { expect, test } from 'bun:test';
import { createPeerHarness, zipDocument } from './document-peer-support';

const LONG = Array.from({ length: 120 }, (_, at) => `word${at}`).join(' ');

/** Milliseconds per edit after a concurrent split, in a body of `count` paragraphs. */
async function editCost(count: number, concurrent: boolean): Promise<number> {
  const body = [
    `<w:p><w:r><w:t xml:space="preserve">${LONG}</w:t></w:r></w:p>`,
    ...Array.from({ length: count }, (_, at) => `<w:p><w:r><w:t>Paragraph ${at}</w:t></w:r></w:p>`),
  ].join('');
  const harness = createPeerHarness(
    'concurrent-split-cost',
    { offlineEditing: true },
    {
      alice: 2_000,
      bob: 1_000,
    }
  );
  try {
    const { alice, bob, pause, resume } = await harness.pair(zipDocument(body));
    const long = harness.paragraphIdAt(alice, 0);
    pause();
    harness.apply(alice, [{ op: 'splitParagraph', paragraphId: long, offset: 100 }]);
    if (concurrent) harness.apply(bob, [{ op: 'splitParagraph', paragraphId: long, offset: 400 }]);
    for (const peer of [alice, bob]) peer.room.session.flushPendingJournals();
    resume();
    for (const peer of [alice, bob]) peer.room.session.flushPendingJournals();
    const middle = harness.paragraphIdAt(alice, 1);
    const unrelated = harness.paragraphIdAt(alice, Math.floor(count / 2));
    const started = performance.now();
    const edits = 6;
    for (let at = 0; at < edits; at += 1) {
      harness.apply(alice, [{ op: 'insertText', paragraphId: middle, offset: 0, text: 'x' }]);
      harness.apply(alice, [{ op: 'splitParagraph', paragraphId: unrelated, offset: 2 }]);
      alice.room.session.flushPendingJournals();
    }
    return (performance.now() - started) / edits;
  } finally {
    harness.cleanup();
  }
}

/**
 * The median of three interleaved measurements of each room, so a pause of a loaded machine
 * during one measurement does not decide a ratio.
 */
async function medianCosts(): Promise<
  Record<'small' | 'large' | 'smallPlain' | 'largePlain', number>
> {
  const runs = {
    small: [] as number[],
    large: [] as number[],
    smallPlain: [] as number[],
    largePlain: [] as number[],
  };
  for (let round = 0; round < 3; round += 1) {
    runs.small.push(await editCost(100, true));
    runs.smallPlain.push(await editCost(100, false));
    runs.large.push(await editCost(1_000, true));
    runs.largePlain.push(await editCost(1_000, false));
  }
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[1]!;
  return {
    small: median(runs.small),
    large: median(runs.large),
    smallPlain: median(runs.smallPlain),
    largePlain: median(runs.largePlain),
  };
}

test('edits after concurrent splits grow with the room as edits without them do', async () => {
  // Warm up the code paths once, so the first measurement does not pay for compilation.
  await editCost(20, true);
  await editCost(20, false);
  const { small, large, smallPlain, largePlain } = await medianCosts();
  // An edit beside the run costs about what one without it does, in a small and a large room.
  // Reading the order once per comparison made it about 100 times dearer at both sizes.
  expect(small / smallPlain).toBeLessThan(5);
  expect(large / largePlain).toBeLessThan(5);
  // And the large room grows from the small one as a room without the run does.
  expect(large / small).toBeLessThan(Math.max(3 * (largePlain / smallPlain), 15));
}, 60_000);
