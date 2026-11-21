// A line that only touches a wrapped picture's top or bottom edge stays clear of it. Such
// edges meet up to float noise, and the line probe sits 0.001 pt below the line top: before,
// the noise chose whether the line wrapped, so a chain of such pictures had two layouts and
// reflow passes settled it one link at a time (#1803).

import { expect, test } from 'bun:test';
import { mergeAvailableIntervalsAtY, WRAP_EDGE_TOUCH_PT } from '../drawing-exclusion.ts';
import { narrowRectangularWrapSkip } from '../narrow-wrap-clearance.ts';
import { breakClearanceSkip } from '../text-wrapping-break-clear.ts';
import { squareWrapZone } from './float-over-table-harness.ts';

const zone = squareWrapZone({
  anchorParagraphId: 'p',
  top: 100,
  height: 84,
  left: 0,
  width: 120,
  contentWidth: 400,
});
const LINE = 14;
/** Where the line probe tests a line whose top is `top` (`createLineExclusionProbe`). */
const probe = (top: number) => top + 0.001;
const full = [{ start: 0, end: 400 }];

test('a line whose bottom touches the picture top stays full width', () => {
  for (const noise of [-1e-12, 0, 1e-12, 3e-14])
    expect(mergeAvailableIntervalsAtY(probe(100 - LINE + noise), [zone], 0, 400, LINE)).toEqual(
      full
    );
});

test('a line whose top touches the picture bottom stays full width', () => {
  for (const noise of [-1e-12, 0, 1e-12])
    expect(mergeAvailableIntervalsAtY(probe(184 + noise), [zone], 0, 400, LINE)).toEqual(full);
});

test('a line that overlaps either edge by more than the touch margin wraps the picture', () => {
  const overlap = WRAP_EDGE_TOUCH_PT * 5;
  for (const top of [100 - LINE + overlap, 184 - overlap]) {
    const intervals = mergeAvailableIntervalsAtY(probe(top), [zone], 0, 400, LINE);
    expect(intervals).not.toEqual(full);
    expect(intervals.every((interval) => interval.start >= 120)).toBe(true);
  }
});

test('a line within the touch margin of a full-width picture stays above it', () => {
  // A picture that leaves no passage moves the line below it (`narrowRectangularWrapSkip`,
  // `breakClearanceSkip`); within the touch margin those agree with the line probe.
  const wide = squareWrapZone({
    anchorParagraphId: 'p',
    top: 100,
    height: 84,
    left: 0,
    width: 400,
    contentWidth: 400,
  });
  for (const overlap of [0, 1e-12, WRAP_EDGE_TOUCH_PT * 0.8]) {
    const top = 100 - LINE + overlap;
    expect(mergeAvailableIntervalsAtY(probe(top), [wide], 0, 400, LINE)).toEqual(full);
    expect(narrowRectangularWrapSkip(top, LINE, [wide], 0, 400, 30)).toBe(0);
    expect(breakClearanceSkip(top, LINE, [wide], 0, 400)).toBe(0);
    expect(narrowRectangularWrapSkip(184 - overlap, LINE, [wide], 0, 400, 30)).toBe(0);
  }
  const top = 100 - LINE + WRAP_EDGE_TOUCH_PT * 5;
  expect(narrowRectangularWrapSkip(top, LINE, [wide], 0, 400, 30)).toBeCloseTo(184 - top, 6);
  expect(breakClearanceSkip(top, LINE, [wide], 0, 400)).toBeCloseTo(184 - top, 6);
});
