// Gap-free selection presentation (task M6S.1).
//
// The engine derives one rectangle per painted RUN, and the painter emits one absolutely
// positioned box per run with no line box. A selection therefore showed a visible hole
// wherever whitespace fell on a run boundary — reported with screenshots where
// "Arial | Times New Roman | Courier New" highlighted as separate islands.
//
// The per-run rects are individually correct; a reader perceives a selection as
// continuous along a line. Merging is presentation only: PM still owns the selection and
// the engine still owns geometry.

import { describe, expect, test } from 'bun:test';
import { overlaysForFrame } from '../src/display-bridge.ts';
import type { InteractionFrame } from '@docx-editor.dev/core-contract/interaction';

/** A frame carrying only what `overlaysForFrame` reads for selection rects. */
function frameWithRects(rects: { x: number; y: number; width: number; height: number }[], pages = 1): InteractionFrame {
  return {
    focus: { scope: { kind: 'body' }, focused: true },
    caret: null,
    selectionGeometry: {
      collapsed: false,
      rects,
      pageIndices: rects.map(() => 0),
    },
    pageGeometry: Array.from({ length: pages }, (_, i) => ({
      index: i,
      box: { x: 0, y: 0, width: 816, height: 1056 },
    })),
  } as unknown as InteractionFrame;
}

const sel = (frame: InteractionFrame) => overlaysForFrame(frame).selection;

describe('selection rect merging', () => {
  test('adjacent run rects on one line become a single continuous rect', () => {
    // Three runs separated by the width of a space — the reported defect.
    const merged = sel(
      frameWithRects([
        { x: 100, y: 200, width: 60, height: 16 },
        { x: 164, y: 200, width: 80, height: 16 },
        { x: 248, y: 200, width: 40, height: 16 },
      ]),
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]!.rect.x).toBe(100);
    expect(merged[0]!.rect.width).toBe(188); // 288 - 100, spanning the gaps
  });

  test('runs of different heights on one line still merge', () => {
    // Mixed font sizes give different tops AND heights, so an equality test on `y`
    // would refuse to merge exactly the lines that show the worst gaps.
    const merged = sel(
      frameWithRects([
        { x: 100, y: 200, width: 50, height: 16 },
        { x: 154, y: 194, width: 50, height: 24 },
      ]),
    );
    expect(merged).toHaveLength(1);
    // The union keeps the taller run's extent.
    expect(merged[0]!.rect.y).toBe(194);
    expect(merged[0]!.rect.height).toBe(24);
  });

  test('separate lines are never merged', () => {
    const merged = sel(
      frameWithRects([
        { x: 100, y: 200, width: 60, height: 16 },
        { x: 100, y: 230, width: 60, height: 16 },
      ]),
    );
    expect(merged).toHaveLength(2);
  });

  test('a real gap stays a gap', () => {
    // A tab or a right-aligned tail is genuine whitespace between two selections. Closing
    // it would claim the selection covers content it does not.
    const merged = sel(
      frameWithRects([
        { x: 100, y: 200, width: 60, height: 16 },
        { x: 500, y: 200, width: 60, height: 16 },
      ]),
    );
    expect(merged).toHaveLength(2);
  });

  test('a single rect and an empty selection are unchanged', () => {
    expect(sel(frameWithRects([{ x: 10, y: 10, width: 5, height: 16 }]))).toHaveLength(1);
    expect(sel(frameWithRects([]))).toHaveLength(0);
  });

  test('merging never loses horizontal coverage', () => {
    // Property: the merged rects must cover every x the originals covered on that line.
    const rects = [
      { x: 100, y: 200, width: 30, height: 16 },
      { x: 134, y: 200, width: 30, height: 16 },
      { x: 168, y: 200, width: 30, height: 16 },
    ];
    const merged = sel(frameWithRects(rects));
    const covered = (x: number) => merged.some((b) => x >= b.rect.x && x <= b.rect.x + b.rect.width);
    for (const r of rects) {
      expect(covered(r.x), `left edge ${r.x} uncovered`).toBe(true);
      expect(covered(r.x + r.width), `right edge uncovered`).toBe(true);
    }
  });
});
