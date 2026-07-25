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
import { HelveticaMetrics } from '../src/metrics.ts';
import { intlGraphemeBoundary, resetGraphemeBoundary, setGraphemeBoundary } from '../src/grapheme.ts';
import { createEmptyModel, bodyStoryId, type ParagraphRecord } from '@docx-editor.dev/engine-core';

const LAYOUT = { pageWidth: 12240, pageHeight: 15840, margin: 1440, metrics: new HelveticaMetrics() };

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
    // Review measured 144,956ms at 2MB before per-run memoization.
    const text = 'x '.repeat(300);
    const none = timeLayout([{ text }]);
    const filler = '<w:rFonts w:ascii="Inter"/>'.repeat(80_000); // ~2MB
    const big = timeLayout([{ text, rPrCapsule: `<w:rPr>${filler}<w:b/></w:rPr>` }]);
    console.log(`no capsule: ${none}ms | 2MB capsule: ${big}ms`);
    expect(big).toBeLessThan(none * 3 + 400);
  });
});
