// Footnote hold-outs around `w:keepNext` groups and multi-column pages: the reserve that
// keeps a reference line off a page must not break a keep-with-next group, and a warm
// session must settle where a clean layout does.
import { describe, expect, test } from 'bun:test';
import type { TreeDocOp } from '../../store/store/tree-op-types.ts';
import {
  expectFixedPoint,
  expectNotesWithReferences,
  pages,
  shapeOf,
  warmSessionOver,
  type Probe,
} from './footnote-probe-harness.ts';

const EXACT_24 = 'w:after="0" w:line="480" w:lineRule="exact"';
const ONE_AND_HALF = 'w:after="0" w:line="360" w:lineRule="auto"';
const SPACED_BEFORE = 'w:before="240" w:after="0" w:line="480" w:lineRule="auto"';
const SPACED_AROUND = 'w:before="120" w:after="240" w:line="480" w:lineRule="auto"';
const SINGLE_AFTER_8 = 'w:after="160" w:line="259" w:lineRule="auto"';

describe('footnote hold-out with keep-with-next groups', () => {
  test('a keep-with-next paragraph returns only with the paragraph it keeps with', () => {
    // L31-L42 keep with L43, whose reference and note must come back too. Releasing the
    // hold on L31-L42 and their notes alone pulled the group back without room for note 4;
    // the reserve then evicted it again, and the loop ended with notes 2-4 carried to a
    // page that holds none of their references.
    const probe: Probe = {
      lines: 63,
      paragraphs: [
        { lines: 30, widowControl: true, spacing: EXACT_24 },
        { lines: 12, keepNext: true },
        { lines: 1, widowControl: true, bottomBorder: true, spacing: SPACED_BEFORE },
        { lines: 20, spacing: SPACED_BEFORE },
      ],
      refs: { 6: [1], 33: [3], 42: [2], 43: [4] },
      notes: { 1: 1, 2: 10, 3: 1, 4: 2 },
    };
    expect(pages(probe)).toEqual(['L01..L25 | 1', 'L26..L30', 'L31..L44 | 3 2 4', 'L45..L63']);
    expectNotesWithReferences(probe);
  });

  const chain: Probe = {
    lines: 28,
    paragraphs: [
      { lines: 1, widowControl: true, spacing: SPACED_AROUND },
      { lines: 2, widowControl: true, keepNext: true, spacing: ONE_AND_HALF },
      { lines: 20, keepNext: true, spacing: ONE_AND_HALF },
      { lines: 1, widowControl: true, spacing: SINGLE_AFTER_8 },
      { lines: 4 },
    ],
    refs: { 23: [1] },
    notes: { 1: 6 },
  };

  test('a keep-with-next chain returns only with the opening line it keeps with', () => {
    // L02-L23 keep with L24. Without L24's line, the chain and note 1 would fit page 1;
    // with it they do not, so the chain stays on page 2 with its note.
    expect(pages(chain)).toEqual(['L01..L01', 'L02..L25 | 1', 'L26..L28']);
    expectNotesWithReferences(chain);
  });

  test('typing inside a keep-with-next chain keeps the warm layout equal to a clean one', () => {
    const doc = warmSessionOver(chain);
    expect(shapeOf(doc.warm())).toEqual(shapeOf(doc.clean()));
    const paragraphId = doc.paragraphIds()[1]!;
    for (const text of ['x', 'y', 'z']) {
      expect(doc.edit({ op: 'insertText', paragraphId, offset: 3, text })).toBe(true);
      const warm = shapeOf(doc.warm());
      expect(warm).toEqual(shapeOf(doc.clean()));
      expect(warm.some((page) => page.startsWith('-..-'))).toBe(false);
    }
  });
});

describe('footnote hold-out with keeps the reserve cannot change', () => {
  /** Apply each edit to the paragraph at `index`, comparing warm and clean after each. */
  function expectWarmMatchesClean(
    probe: Probe,
    edits: readonly (readonly [number, (paragraphId: string) => TreeDocOp])[]
  ): void {
    const doc = warmSessionOver(probe);
    expect(shapeOf(doc.warm())).toEqual(shapeOf(doc.clean()));
    for (const [index, op] of edits) {
      expect(doc.edit(op(doc.paragraphIds()[index]!))).toBe(true);
      expect(shapeOf(doc.warm())).toEqual(shapeOf(doc.clean()));
    }
  }
  const insert = (paragraphId: string): TreeDocOp => ({
    op: 'insertText',
    paragraphId,
    offset: 3,
    text: 'x',
  });
  const deleteLabel = (paragraphId: string): TreeDocOp => ({
    op: 'deleteText',
    paragraphId,
    start: 0,
    end: 9,
  });
  const split = (paragraphId: string): TreeDocOp => ({
    op: 'splitParagraph',
    paragraphId,
    offset: 9,
  });

  test('a keep-with-next paragraph that began on an earlier page does not pin the hold', () => {
    // The 45-line paragraph keeps with the next one, but its keep was priced two pages
    // back. Holding the whole slack on its account made the page end wherever the warm
    // session's previous body ended.
    const probe: Probe = {
      lines: 50,
      paragraphs: [
        { lines: 1, spacing: SPACED_AROUND },
        {
          lines: 45,
          widowControl: true,
          keepNext: true,
          spacing: 'w:after="0" w:line="520" w:lineRule="atLeast"',
        },
        { lines: 4, spacing: SPACED_BEFORE },
      ],
      refs: { 32: [2], 46: [1] },
      notes: { 1: 12, 2: 8 },
    };
    expectWarmMatchesClean(probe, [
      [0, insert],
      [1, deleteLabel],
      [0, insert],
      [2, deleteLabel],
      [1, insert],
      [1, split],
    ]);
    expectFixedPoint(probe);
  });

  test("the body's last paragraph keeps with nothing", () => {
    // The last paragraph declares keep-with-next, which binds nothing. Treating it as an
    // unpriced group held the whole slack, and a split before it pinned the old page end.
    const probe: Probe = {
      lines: 38,
      paragraphs: [
        { lines: 4, widowControl: true, keepLines: true, spacing: SPACED_BEFORE },
        { lines: 4, spacing: SINGLE_AFTER_8 },
        { lines: 30, widowControl: true, keepNext: true, spacing: EXACT_24 },
      ],
      refs: { 4: [1], 17: [4, 5], 18: [3], 23: [7], 25: [6], 27: [2] },
      notes: { 1: 1, 2: 2, 3: 16, 4: 8, 5: 10, 6: 8, 7: 12 },
    };
    expectWarmMatchesClean(probe, [
      [2, split],
      [1, insert],
      [2, insert],
    ]);
    expectFixedPoint(probe);
  });
});

describe('footnote hold-out on two-column pages', () => {
  test('a keep-with-next paragraph in a column keeps every note with its reference', () => {
    const probe: Probe = {
      lines: 36,
      columns: 2,
      paragraphs: [
        { lines: 20, keepNext: true, spacing: SPACED_AROUND },
        { lines: 12, spacing: EXACT_24 },
        { lines: 1, widowControl: true, spacing: EXACT_24 },
        { lines: 3, widowControl: true, spacing: SINGLE_AFTER_8 },
      ],
      refs: { 1: [7], 3: [3], 9: [4], 12: [5], 13: [6], 24: [2], 34: [1] },
      notes: { 1: 1, 2: 4, 3: 4, 4: 3, 5: 10, 6: 16, 7: 10 },
    };
    expect(pages(probe)).toEqual(['L01..L06 | 7 3', 'L07..L22 | 4 5 6', 'L23..L36 | 2 1']);
    expectNotesWithReferences(probe);
  });

  test('column pages charge every note that could return, and the reserves settle', () => {
    // Which lines return to a column page is only an estimate, so the release test charges
    // every pulled note. Charging only the reference line's own notes released holds the
    // next round had to take back, and the reserves orbited to the attempt cap.
    const probe: Probe = {
      lines: 99,
      columns: 2,
      paragraphs: [
        { lines: 3, spacing: SPACED_AROUND },
        { lines: 5, widowControl: true, keepNext: true, spacing: ONE_AND_HALF },
        { lines: 45 },
        { lines: 45, widowControl: true, spacing: SINGLE_AFTER_8 },
        { lines: 1, widowControl: true, spacing: SPACED_AROUND },
      ],
      refs: { 14: [7], 17: [8], 35: [5], 48: [6], 69: [1], 75: [2], 79: [4], 99: [3] },
      notes: { 1: 6, 2: 12, 3: 16, 4: 1, 5: 4, 6: 12, 7: 20, 8: 12 },
    };
    expectFixedPoint(probe);
  });
});
