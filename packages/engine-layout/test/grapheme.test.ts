// Grapheme boundary tests (interactive-paginated-editing 3.3).

import { describe, expect, test, afterEach } from 'bun:test';
import {
  GRAPHEME_SEGMENTER_LOCALE,
  graphemeCount,
  intlGraphemeBoundary,
  isIntlSegmenterAvailable,
  resetGraphemeBoundary,
  segmentGraphemes,
  setGraphemeBoundary,
} from '../src/grapheme.ts';

afterEach(() => resetGraphemeBoundary());

describe('Intl.Segmenter grapheme boundary', () => {
  test('uses invariant und locale and is available in this runtime', () => {
    expect(isIntlSegmenterAvailable()).toBe(true);
    expect(GRAPHEME_SEGMENTER_LOCALE).toBe('und');
  });

  test('replaceable boundary hook is used by segmentGraphemes', () => {
    setGraphemeBoundary({
      segment: () => [{ index: 0, text: 'X', utf16From: 0, utf16To: 1 }],
    });
    expect(graphemeCount('anything')).toBe(1);
    resetGraphemeBoundary();
    expect(graphemeCount('ab')).toBe(2);
  });

  test('default boundary segments combining marks and surrogate pairs as one grapheme', () => {
    expect(segmentGraphemes('e\u0301')).toHaveLength(1);
    expect(segmentGraphemes('😀')).toHaveLength(1);
    expect(intlGraphemeBoundary.segment('')).toEqual([]);
  });
});
