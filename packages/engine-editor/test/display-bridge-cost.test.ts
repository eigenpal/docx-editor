// Display-publication cost guard (round-5 security Blocker).
//
// `createEditor()` runs `layoutBody` AND `toDisplayPages` in the same synchronous
// tick, and again on every keystroke. Four rounds of cost guards instrumented
// `layoutBody` only — `packages/engine-layout/test/layout-cost.test.ts` never imports
// `toDisplayPages`, and neither did any other cost test in the repo. So when the
// quadratic moved into the bridge, every guard read perfectly linear.
//
// Independent review measured the consequence on ORDINARY documents — plain
// sentences, one run per paragraph, realistic zip ratio, nothing crafted:
//
//   500 paragraphs   (6 KB, 10 pages)    createEditor()   1.72 s
//   1,000            (11 KB, 19 pages)                    8.27 s
//   2,000            (20 KB, 38 pages)                   23.5 s
//   4,000            (38 KB, 75 pages)                  120.7 s
//   8,000            (75 KB, 149 pages)                 534 s (8.9 min)
//
// Four independent quadratic terms caused it: a per-item `blocks.find`, a per-region
// full-page scan, a per-item pair of full-page caret-edge scans, and — dominant — a
// per-caret-edge `stories.flatMap().find()` that allocated a flattened array of every
// block on every call. After the other three were indexed, `buildVisualLines` alone
// still accounted for 6,361 ms of a 6,601 ms publish at 4,000 paragraphs.
//
// The ordinary-document guard asserts SCALING, because an absolute ceiling is what
// let the previous guards pass at 2x margin on an input that froze the product for
// 21.8 s. One shape (alternating run styles in a whitespace-free paragraph) remains
// super-linear at exponent ~1.7 and is guarded by an absolute budget with that fact
// stated at the test, not by a linearity claim it would fail.

import { describe, expect, test } from 'bun:test';
import { layoutBody, HelveticaMetrics } from '@docx-editor.dev/engine-layout';
import { createEmptyModel, bodyStoryId, type ParagraphRecord } from '@docx-editor.dev/engine-core';
import { toDisplayPages } from '../src/display-bridge.ts';

const LAYOUT = { pageWidth: 12240, pageHeight: 15840, margin: 1440, metrics: new HelveticaMetrics() };

/** An ordinary document: plain sentences, one run per paragraph. */
function ordinaryDocument(paragraphs: number) {
  const base = createEmptyModel();
  const storyId = bodyStoryId(base);
  const story = base.stories.get(storyId)!;
  const blocks: ParagraphRecord[] = Array.from({ length: paragraphs }, (_, i) => ({
    kind: 'paragraph',
    id: `p${i}`,
    runs: [{ text: `Paragraph ${i} with a handful of ordinary words in it for realistic length.` }],
  }));
  return { ...base, stories: new Map(base.stories).set(storyId, { ...story, blocks }) };
}

/** Time the FULL publish path `createEditor` runs synchronously, not just layout. */
function timePublish(paragraphs: number): number {
  const model = ordinaryDocument(paragraphs);
  const laid = layoutBody(model, LAYOUT) as unknown as { pages?: unknown[] };
  const pages = (laid.pages ?? laid) as never;
  const started = Date.now();
  toDisplayPages(model, pages);
  return Date.now() - started;
}

describe('display publication cost', () => {
  test('publishing an ordinary multi-page document is not quadratic in paragraph count', () => {
    // 4x the paragraphs must not cost ~16x. Measured after indexing the four terms:
    // 500 -> 133 ms, 1,000 -> 234 ms, 2,000 -> 488 ms, 4,000 -> 1,205 ms,
    // 8,000 -> 3,088 ms, against a pre-fix 4,000 -> 120.7 s.
    // 2,000 -> 8,000, not 500 -> 2,000. The smaller range is where this guard PASSED
    // through a real quadratic: independent review found `deprecatedFlatDocOffset`
    // scanning every block per painted item, and the full-path exponent only climbed
    // 1.19 -> 1.48 -> 1.64 -> 2.04 across successive doublings. At 500/2000 the linear
    // terms still dominate and the ratio looks fine, so the guard has to sample where
    // the quadratic would actually show.
    // An EIGHT-fold span, because a four-fold one is not decisive here. Verified by
    // reverting the fix: at 500->2000 and at 2000->8000 the ratio stayed under 8x even
    // WITH the quadratic present, so both of those guards passed through the defect.
    // Across 8x, linear is ~8x and quadratic is ~64x, which no amount of machine noise
    // confuses.
    const small = timePublish(2000);
    const large = timePublish(16000);
    expect(large).toBeLessThan(Math.max(small, 40) * 20);
  });

  test('an ordinary 75-page document publishes within an interactive budget', () => {
    // The shape review measured at 120.7 s. An absolute assertion is defensible HERE
    // because the pre-fix number was four orders of magnitude away, not 2x.
    expect(timePublish(4000)).toBeLessThan(8000);
  });

  test('cost does not depend on how the SAME text is split into paragraphs', () => {
    // The axis the first version of this file missed, and review named it: all three
    // original tests scaled PARAGRAPH COUNT while one quadratic lived INSIDE a
    // paragraph, so the guard sampled exactly the region where cost looked fine.
    // Holding total text constant and varying only the split exposes it.
    //
    // Measured before the fix: 80,000 characters as ONE paragraph cost 1,854 ms against
    // 181 ms for the same text in 250 paragraphs — 10x worse at identical total text.
    // After: 171 ms as one paragraph, now the cheapest split rather than the worst.
    const words = (n: number) => Array.from({ length: n }, (_, j) => `w${j % 97}`).join(' ');
    const split = (paragraphs: number, wordsEach: number) => {
      const base = createEmptyModel();
      const storyId = bodyStoryId(base);
      const story = base.stories.get(storyId)!;
      const blocks: ParagraphRecord[] = Array.from({ length: paragraphs }, (_, i) => ({
        kind: 'paragraph',
        id: `p${i}`,
        runs: [{ text: words(wordsEach) }],
      }));
      const model = { ...base, stories: new Map(base.stories).set(storyId, { ...story, blocks }) };
      const laid = layoutBody(model, LAYOUT) as unknown as { pages?: unknown[] };
      const started = Date.now();
      toDisplayPages(model, (laid.pages ?? laid) as never);
      return Date.now() - started;
    };
    const many = split(250, 64); // 16,000 words spread out
    const one = split(1, 16000); // the same 16,000 words in ONE paragraph
    // One paragraph must not be dramatically worse than the same text spread out.
    expect(one).toBeLessThan(Math.max(many, 40) * 4);
  });

  test('a single paragraph with many whitespace runs is not quadratic', () => {
    // Same axis, as a scaling assertion: whitespace-run count inside ONE paragraph.
    // Measured 2.29 / 1.65 / 2.14 / 2.22 per doubling at 2k-32k words, i.e. linear.
    const oneParagraph = (wordCount: number) => {
      const base = createEmptyModel();
      const storyId = bodyStoryId(base);
      const story = base.stories.get(storyId)!;
      const text = Array.from({ length: wordCount }, (_, j) => `w${j % 97}`).join(' ');
      const p: ParagraphRecord = { kind: 'paragraph', id: 'p-ws', runs: [{ text }] };
      const model = { ...base, stories: new Map(base.stories).set(storyId, { ...story, blocks: [p] }) };
      const laid = layoutBody(model, LAYOUT) as unknown as { pages?: unknown[] };
      const started = Date.now();
      toDisplayPages(model, (laid.pages ?? laid) as never);
      return Date.now() - started;
    };
    const small = oneParagraph(4000);
    const large = oneParagraph(16000);
    // 4x the whitespace runs must not cost ~16x.
    expect(large).toBeLessThan(Math.max(small, 40) * 8);
  });

  test('a whitespace-free paragraph with alternating run styles stays interactive', () => {
    // This shape WAS still super-linear (exponent ~1.7) when this file was first
    // written, and was recorded here as open rather than tolerated. Review then
    // located the cause — `resolveEdgePaintSlice` ran three to five full
    // `slices.filter(...)` passes per caret edge, and a whitespace-free paragraph puts
    // every slice and every edge on one visual line — and it is now indexed.
    // Measured after: 178 ms at 73,600 characters (was 1,471 ms after the first round
    // of bridge fixes, and 21,753 ms before them), ratios 1.41 / 1.79 / 1.86 / 2.23 per
    // doubling, i.e. linear.
    const shape = (segments: number) => {
      const base = createEmptyModel();
      const storyId = bodyStoryId(base);
      const story = base.stories.get(storyId)!;
      const runs = Array.from({ length: segments }, (_, i) => ({
        text: 'x'.repeat(23),
        ...(i % 2 === 0 ? { props: { bold: true } } : {}),
      }));
      const p: ParagraphRecord = { kind: 'paragraph', id: 'p-alt', runs };
      const model = { ...base, stories: new Map(base.stories).set(storyId, { ...story, blocks: [p] }) };
      const laid = layoutBody(model, LAYOUT) as unknown as { pages?: unknown[] };
      const started = Date.now();
      toDisplayPages(model, (laid.pages ?? laid) as never);
      return Date.now() - started;
    };
    // 73,600 characters: measured 1,471 ms here, 21,753 ms before the fixes.
    expect(shape(3200)).toBeLessThan(6000);
  });
});
