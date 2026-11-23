// The font size ladder that the grow and shrink commands walk.

import { describe, expect, test } from 'bun:test';
import { FONT_SIZE_PRESETS_PT, steppedFontSizeHalfPoints } from '../package/font-size-steps.ts';

/** Points in, points out, so each case reads as the sizes a user sees. */
const grow = (points: number) => steppedFontSizeHalfPoints(points * 2, 'increase') / 2;
const shrink = (points: number) => steppedFontSizeHalfPoints(points * 2, 'decrease') / 2;

describe('font size ladder', () => {
  test('the presets include every common size from 8 pt to 72 pt', () => {
    expect(FONT_SIZE_PRESETS_PT).toEqual([
      8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72,
    ]);
  });

  test('growing walks each preset in order', () => {
    const walked = [8];
    while (walked.at(-1)! < 72) walked.push(grow(walked.at(-1)!));
    expect(walked).toEqual([...FONT_SIZE_PRESETS_PT]);
  });

  test('shrinking walks each preset in reverse order', () => {
    const walked = [72];
    while (walked.at(-1)! > 8) walked.push(shrink(walked.at(-1)!));
    expect(walked).toEqual([...FONT_SIZE_PRESETS_PT].reverse());
  });

  test('a size between presets steps to the nearest preset in each direction', () => {
    expect([grow(13), shrink(13)]).toEqual([14, 12]);
    expect([grow(10.5), shrink(10.5)]).toEqual([11, 10]);
    expect([grow(30), shrink(30)]).toEqual([36, 28]);
  });

  test('below 8 pt the steps are whole points', () => {
    expect([grow(1), grow(7), grow(7.5)]).toEqual([2, 8, 8]);
    expect([shrink(8), shrink(7.5), shrink(2)]).toEqual([7, 7, 1]);
  });

  test('above 72 pt the steps are multiples of 10 pt', () => {
    expect([grow(72), grow(75), grow(80)]).toEqual([80, 80, 90]);
    expect([shrink(90), shrink(80), shrink(75)]).toEqual([80, 72, 72]);
  });

  test('the bounds of 1 pt and 1638 pt hold', () => {
    expect(shrink(1)).toBe(1);
    expect(grow(1638)).toBe(1638);
    expect(grow(1635)).toBe(1638);
    expect(shrink(1638)).toBe(1630);
  });

  test('a size outside the bounds never steps the wrong way', () => {
    expect(steppedFontSizeHalfPoints(1, 'decrease')).toBe(1);
    expect(steppedFontSizeHalfPoints(1, 'increase')).toBe(2);
    expect(steppedFontSizeHalfPoints(4000, 'increase')).toBe(4000);
    expect(steppedFontSizeHalfPoints(4000, 'decrease')).toBe(3276);
  });

  test('a value that is not a positive finite size is returned unchanged', () => {
    expect(steppedFontSizeHalfPoints(0, 'increase')).toBe(0);
    expect(steppedFontSizeHalfPoints(-4, 'decrease')).toBe(-4);
    expect(steppedFontSizeHalfPoints(Number.NaN, 'increase')).toBeNaN();
  });
});
