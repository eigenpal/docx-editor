// Layout cost guards (independent review follow-up).
//
// Two amplification bugs were found in `layoutParagraphInBox`, both of the same
// shape: work proportional to the whole paragraph, repeated once per character.
// These tests exist so deleting either mitigation fails a test rather than
// quietly reintroducing a multi-second freeze on open. The earlier capsule test
// claimed a "layout-cost test" covered this; that cross-reference was false and
// this file is it.

import { afterEach, describe, expect, test } from 'bun:test';
import { layoutBody } from '../src/layout.ts';
import { createDeterministicLayoutShaping } from '../src/metrics.ts';
import {
  intlGraphemeBoundary,
  resetGraphemeBoundary,
  setGraphemeBoundary,
} from '../src/grapheme.ts';
import { createEmptyModel, bodyStoryId, type ParagraphRecord } from '@docx-editor.dev/engine-core';

const LAYOUT = {
  pageWidth: 12240,
  pageHeight: 15840,
  margin: 1440,
  shaping: createDeterministicLayoutShaping(),
};

function modelWith(runs: ParagraphRecord['runs']) {
  const base = createEmptyModel();
  const storyId = bodyStoryId(base);
  const story = base.stories.get(storyId)!;
  const p: ParagraphRecord = { kind: 'paragraph', id: 'p-cost', runs };
  return { ...base, stories: new Map(base.stories).set(storyId, { ...story, blocks: [p] }) };
}

function timeLayout(runs: ParagraphRecord['runs']): number {
  const model = modelWith(runs);
  const started = Date.now();
  layoutBody(model, LAYOUT);
  return Date.now() - started;
}

/**
 * Count the characters segmentation actually walks during one layout.
 *
 * A wall-clock budget was the wrong instrument: the previous version of this file
 * asserted an absolute 2,000 ms at 6,000 chars and *documented the residual
 * quadratic as accepted*, so it passed while a 1,897-byte .docx still froze the
 * main thread for 41 seconds. Counting segmented characters is deterministic and
 * measures the amplifier itself rather than the machine it ran on.
 */
function countSegmentedChars(runs: ParagraphRecord['runs']): { chars: number; textLength: number } {
  let chars = 0;
  setGraphemeBoundary({
    segment(text: string) {
      chars += text.length;
      return intlGraphemeBoundary.segment(text);
    },
  });
  try {
    layoutBody(modelWith(runs), LAYOUT);
  } finally {
    resetGraphemeBoundary();
  }
  return { chars, textLength: runs.reduce((n, r) => n + r.text.length, 0) };
}

afterEach(() => {
  resetGraphemeBoundary();
});

/**
 * Count complete-span shaping calls during one layout.
 *
 * A SECOND instrument, because counting segmented characters was structurally blind
 * to the third amplifier: for a whitespace-free paragraph with alternating run
 * styles, segmentation is exactly 1.0x linear while `advance()` ran 4,003x per
 * character. Independent review measured a 4,039-byte .docx freezing the main
 * thread for 45 seconds while the segmentation guard read perfectly clean.
 *
 * The lesson is general enough to state: a cost guard must instrument the quantity
 * that actually amplifies, and each fix in this area moved which quantity that was.
 */
function countShapeCalls(runs: ParagraphRecord['runs']): { calls: number; chars: number } {
  const base = createDeterministicLayoutShaping();
  let calls = 0;
  const shaping = {
    ...base,
    shaper: {
      shape: (input: Parameters<typeof base.shaper.shape>[0]) => {
        calls += 1;
        return base.shaper.shape(input);
      },
    },
  };
  layoutBody(modelWith(runs), { ...LAYOUT, shaping });
  return { calls, chars: runs.reduce((n, r) => n + r.text.length, 0) };
}

describe('paragraph layout advance work', () => {
  test('a whitespace-free paragraph with alternating run styles stays linear', () => {
    // The reviewer's exact shape: no whitespace anywhere (so the paragraph is ONE
    // token) and a style flip every 23 characters. Cost was k^2*m/2 in the number of
    // style segments, from `prefixWidth` being re-measured per segment.
    //
    // A whitespace-free token is not a crafted edge case — CJK text has no
    // whitespace, so an ordinary CJK paragraph is one token.
    const runs = Array.from({ length: 400 }, (_, i) => ({
      text: 'x'.repeat(23),
      ...(i % 2 === 0 ? { props: { bold: true } } : {}),
    }));
    const { calls, chars } = countShapeCalls(runs);
    // Linear means a small constant multiple of the character count. The measured
    // pre-fix ratio for this shape was ~400x (k/2 with k=800 segments).
    expect(calls).toBeLessThan(chars * 6);
  });

  test('advance work grows linearly as style segments multiply', () => {
    const shape = (segments: number) =>
      countShapeCalls(
        Array.from({ length: segments }, (_, i) => ({
          text: 'x'.repeat(23),
          ...(i % 2 === 0 ? { props: { bold: true } } : {}),
        }))
      );
    const small = shape(200);
    const large = shape(800);
    // 4x the segments must cost about 4x, not 16x.
    expect(large.calls).toBeLessThan(small.calls * 8);
  });
});

describe('paragraph layout segmentation work', () => {
  test('segmentation is proportional to the paragraph, not to paragraph x tokens', () => {
    // Independent review measured 201 full-paragraph passes for a 200-word
    // paragraph and 801 for 800 words (3.1M characters segmented, 801x the
    // paragraph). Cause: `segmentGraphemes(token.text)` evicted the single-entry
    // memo holding the paragraph text once per token, so the very next caret-edge
    // probe re-segmented the whole paragraph.
    //
    // Budget is a small multiple of the paragraph, not a ratio between sizes:
    // linear work is the property under test, and it must hold at one size.
    const { chars, textLength } = countSegmentedChars([{ text: 'word '.repeat(4000) }]);
    expect(textLength).toBeGreaterThan(19_000);
    expect(chars).toBeLessThan(textLength * 3);
  });

  test('segmentation work grows linearly with paragraph length', () => {
    const small = countSegmentedChars([{ text: 'word '.repeat(1000) }]);
    const large = countSegmentedChars([{ text: 'word '.repeat(4000) }]);
    // 4x the text must cost about 4x, not 16x. Generous slack for constant terms.
    expect(large.chars).toBeLessThan(small.chars * 8);
  });
});

describe('paragraph layout cost', () => {
  test('a long paragraph lays out within an interactive budget', () => {
    // The previous version of this test asserted 2,000 ms at 6,000 chars and
    // documented a "residual quadratic term" as accepted. That was the defect: the
    // budget was loose enough to pass at 8 ms while a 1,897-byte .docx still froze
    // the main thread for 41 s, and a comment recorded the amplifier as tolerated
    // rather than bounding it. Asserting linearity is now correct, and the
    // deterministic counting tests above are the real guard.
    //
    // Measured after removing the amplifiers, single paragraph: 2,000 words 6 ms,
    // 12,000 words 17 ms, 30,000 words 37 ms, 1,000,000 words 1,241 ms — against
    // review's pre-fix 1,536 ms / 41,085 ms / 264,988 ms for the first three.
    const long = timeLayout([{ text: 'x '.repeat(3000) }]);
    expect(long).toBeLessThan(250);
  });

  test('an oversized preservation capsule does not amplify layout', () => {
    // The invariant is that capsule cost does not scale with paragraph length.
    // Measured at this commit with an ~8MB capsule the added cost is flat — 300
    // chars +402ms, 1,200 chars +406ms, 6,000 chars +402ms — so the
    // `chars x capsuleBytes` amplification is genuinely gone. (Two pre-fix
    // figures in the record, 144,956ms at 2MB and 990ms at 8MB, are mutually
    // inconsistent and neither is reproducible; this test does not rely on them.)
    // Asserted as flatness, not as a budget. An absolute ceiling would pass just
    // as happily if the cost DID scale with length but stayed under the number,
    // which is the mistake the sibling test above documents.
    const filler = '<w:rFonts w:ascii="Inter"/>'.repeat(80_000); // ~2MB
    const capsule = `<w:rPr>${filler}<w:b/></w:rPr>`;
    const deltaAt = (chars: number): number => {
      const text = 'x '.repeat(chars / 2);
      const none = timeLayout([{ text }]);
      const big = timeLayout([{ text, rPrCapsule: capsule }]);
      return big - none;
    };
    const short = deltaAt(300);
    const long = deltaAt(6000);
    console.log(`2MB capsule delta: 300 chars ${short}ms | 6000 chars ${long}ms`);
    // 20x the text must not multiply the capsule cost. Generous slack for noise
    // on a shared machine; the pre-fix behavior was a ~20x difference here.
    expect(long).toBeLessThan(Math.max(short, 20) * 4);
  });
});
