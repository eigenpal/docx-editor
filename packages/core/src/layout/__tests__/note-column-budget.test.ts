import { describe, expect, test } from 'bun:test';
import {
  MIN_FOOTNOTE_BODY_BAND_PT,
  carriesNoteTo,
  compactFootnoteReserves,
  footnoteReservesEqual,
  footnoteReservesFingerprint,
  growFootnoteReserves,
  markCarriedNotePage,
  noteColumnBudgetPt,
  notesReserveContextKey,
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

describe('pages a continued footnote reaches', () => {
  test('travel with the reserve map and count in its comparisons and keys', () => {
    const plain = new Map([[2, 30]]);
    const carried = new Map([[2, 30]]);
    markCarriedNotePage(carried, 2);
    expect(carriesNoteTo(carried, 2)).toBe(true);
    expect(carriesNoteTo(plain, 2)).toBe(false);
    expect(footnoteReservesEqual(plain, carried)).toBe(false);
    expect(footnoteReservesFingerprint(plain)).not.toBe(footnoteReservesFingerprint(carried));
    expect(notesReserveContextKey(carried, 1, 4)).toBe('|nr:1=30|nc:1');
    expect(notesReserveContextKey(carried, 3, 4)).toBe('');
    expect(carriesNoteTo(compactFootnoteReserves(carried), 2)).toBe(true);
    expect(carriesNoteTo(growFootnoteReserves(plain, carried), 2)).toBe(true);
  });
});
