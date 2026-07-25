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
    const small = timePublish(500);
    const large = timePublish(2000);
    // Generous slack for a shared machine and for the genuinely linear terms, while
    // still far below the ~16x a quadratic produces.
    expect(large).toBeLessThan(Math.max(small, 40) * 8);
  });

  test('an ordinary 75-page document publishes within an interactive budget', () => {
    // The shape review measured at 120.7 s. An absolute assertion is defensible HERE
    // because the pre-fix number was four orders of magnitude away, not 2x.
    expect(timePublish(4000)).toBeLessThan(8000);
  });

  test('a whitespace-free paragraph with alternating run styles stays interactive', () => {
    // STATED HONESTLY: this shape is still SUPER-LINEAR through the bridge after the
    // four indexing fixes. Measured exponent ~1.7 (ratios per doubling: 1.50, 2.73,
    // 3.39, 3.31 at 200/400/800/1600/3200 style segments), against ~1.95 before.
    // Absolute cost fell from 21.8 s to 1.47 s at 73,600 characters.
    //
    // So this is deliberately an ABSOLUTE budget and is NOT a linearity claim. The
    // sibling test above asserts scaling for ordinary documents, where the fix does
    // make cost near-linear; asserting it here would encode something untrue, which is
    // the exact mistake the previous generation of these guards made.
    //
    // The residual term is unlocated and is recorded as an OPEN finding rather than
    // tolerated silently. This budget exists to catch a return to the 20-second
    // behavior, not to certify the shape as fixed.
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
