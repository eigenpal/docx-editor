// The effect extent of an inline drawing on its line (`wp:effectExtent`, CT_EffectExtent,
// ECMA-376 Part 1, 20.4.2.6): the extent adds to the drawing at the top and at the bottom,
// and the bottom side sits on the baseline with it.

import { describe, expect, test } from 'bun:test';
import { inlineDrawingVerticalLayout, type InlineDrawingMeasure } from '../drawing-layout.ts';

/** A drawing `height` tall with these top and bottom effect extents, in points. */
function measure(height: number, effectT = 0, effectB = 0): InlineDrawingMeasure {
  return {
    distL: 0,
    distR: 0,
    distT: 0,
    distB: 0,
    effectL: 0,
    effectR: 0,
    effectT,
    effectB,
    width: 100,
    height,
    totalWidth: 100,
    lineContribution: effectT + height + effectB,
    turnedInset: 0,
  };
}

/** A 12pt text line: 11pt above the baseline and 3pt below it. */
const [BASELINE, TEXT_HEIGHT] = [11, 14];
const layout = (height: number, effectT = 0, effectB = 0) =>
  inlineDrawingVerticalLayout(BASELINE, TEXT_HEIGHT, measure(height, effectT, effectB));

describe('a drawing taller than the text', () => {
  test('sits on the baseline without an effect extent', () => {
    expect(layout(72)).toEqual({ extentTopY: 0, lineHeight: 72, baseline: 72 });
  });
  test('the top effect extent adds to the line above the drawing', () => {
    expect(layout(72, 6)).toEqual({ extentTopY: 6, lineHeight: 78, baseline: 78 });
  });
  test('the bottom effect extent adds to the line under the drawing', () => {
    expect(layout(72, 0, 6)).toEqual({ extentTopY: 0, lineHeight: 78, baseline: 78 });
  });
  test('both sides add', () => {
    expect(layout(72, 6, 6)).toEqual({ extentTopY: 6, lineHeight: 84, baseline: 84 });
  });
});

describe('a drawing shorter than the text', () => {
  test('keeps the text line', () => {
    expect(layout(5)).toEqual({ extentTopY: 6, lineHeight: 14, baseline: 11 });
  });
  test('a bottom effect extent that fits above the baseline keeps the text line', () => {
    // 5pt of drawing and 6pt of extent are the 11pt above the baseline.
    expect(layout(5, 0, 6)).toEqual({ extentTopY: 0, lineHeight: 14, baseline: 11 });
  });
  test('extents that reach past the text ascent move the baseline down', () => {
    expect(layout(5, 6, 6)).toEqual({ extentTopY: 6, lineHeight: 17, baseline: 17 });
  });
});
