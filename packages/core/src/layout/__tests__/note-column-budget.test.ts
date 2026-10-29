import { describe, expect, test } from 'bun:test';
import {
  MIN_FOOTNOTE_BODY_BAND_PT,
  noteColumnBudgetPt,
  pageNoteColumnPt,
} from '../note-reserves.ts';

describe('note column budget', () => {
  test('a page with body content keeps the minimum body band', () => {
    expect(noteColumnBudgetPt(100, 6)).toBe(100 - MIN_FOOTNOTE_BODY_BAND_PT - 6);
    expect(pageNoteColumnPt({ contentBox: { height: 100 }, fragments: [{}] }, 6)).toBe(
      100 - MIN_FOOTNOTE_BODY_BAND_PT - 6
    );
  });

  test('a page without body content gives its notes the whole column', () => {
    expect(noteColumnBudgetPt(100, 6, false)).toBe(94);
    expect(pageNoteColumnPt({ contentBox: { height: 100 }, fragments: [] }, 6)).toBe(94);
  });
});
