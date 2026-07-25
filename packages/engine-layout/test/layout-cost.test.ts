// Layout cost guards (independent review follow-up).
//
// Two amplification bugs were found in `layoutParagraphInBox`, both of the same
// shape: work proportional to the whole paragraph, repeated once per character.
// These tests exist so deleting either mitigation fails a test rather than
// quietly reintroducing a multi-second freeze on open. The earlier capsule test
// claimed a "layout-cost test" covered this; that cross-reference was false and
// this file is it.

import { describe, expect, test } from 'bun:test';
import { layoutBody } from '../src/layout.ts';
import { HelveticaMetrics } from '../src/metrics.ts';
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

describe('paragraph layout cost', () => {
  test('a long paragraph lays out within an interactive budget', () => {
    // Independent review measured, before the segmentation memo and the
    // incremental trust probe: 600 chars 132ms, 2,400 chars 1.85s, 10,000 chars
    // 29.1s, 20,000 chars 117s — one paragraph in a ~20KB .docx freezing the tab
    // for two minutes on open, with no capsule and no crafted markup.
    //
    // An ABSOLUTE budget, deliberately, not a ratio. A residual quadratic term
    // still exists further down the layout sink, so asserting linearity would be
    // asserting something untrue; this locks in the ~20x gain and fails if it
    // regresses. Measured after the fix: 600 chars ~9ms, 6,000 chars ~561ms.
    const long = timeLayout([{ text: 'x '.repeat(3000) }]);
    expect(long).toBeLessThan(2000);
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
