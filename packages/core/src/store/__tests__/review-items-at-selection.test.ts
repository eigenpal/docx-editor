// `reviewItemsAtSelection`: the items a range selection is in.
//
// The caret rule counts both ends of a range, which is right for a caret and wrong for a range
// selection. A selection whose head sits on an item's boundary, with none of the item's
// characters selected, must not open that item.

import { describe, expect, test } from 'bun:test';
import {
  reviewItemsAt,
  reviewItemsAtSelection,
  type ReviewItem,
  type ReviewRange,
} from '../store/review-items.ts';

const PART = 'word/document.xml';
const ORDER: ReadonlyMap<string, number> = new Map([
  ['p1', 0],
  ['p2', 1],
]);

function range(
  start: number,
  end: number,
  paragraphId = 'p1',
  endParagraphId = paragraphId
): ReviewRange {
  return {
    partName: PART,
    start: { paragraphId, offset: start },
    end: { paragraphId: endParagraphId, offset: end },
  };
}

function revision(id: string, ...ranges: ReviewRange[]): ReviewItem {
  return {
    kind: 'revision',
    id,
    address: { id, author: 'A' },
    addresses: [{ id, author: 'A' }],
    replacedText: '',
    revisionKind: 'insert',
    author: 'A',
    text: 'x',
    ranges,
    nesting: 0,
    readOnly: false,
    replyIds: [],
  };
}

function comment(id: string, anchor: ReviewRange): ReviewItem {
  return {
    kind: 'comment',
    id,
    comment: { id, author: 'A', blocks: [] },
    range: anchor,
    resolved: false,
    replyIds: [],
    orphaned: false,
  };
}

function idsAt(
  items: readonly ReviewItem[],
  anchor: number,
  head: number,
  anchorParagraph = 'p1',
  headParagraph = anchorParagraph
): string[] {
  return reviewItemsAtSelection(
    items,
    { paragraphId: anchorParagraph, offset: anchor },
    { paragraphId: headParagraph, offset: head },
    ORDER
  ).map((item) => item.id);
}

describe('items a selection is in', () => {
  const before = revision('before', range(0, 5));
  const after = revision('after', range(10, 15));

  test('a collapsed selection keeps the caret rule at both ends', () => {
    expect(idsAt([before, after], 5, 5)).toEqual(['before']);
    expect(idsAt([before, after], 10, 10)).toEqual(['after']);
  });

  test('a head on a neighbour boundary opens nothing', () => {
    expect(idsAt([before, after], 5, 10)).toEqual([]);
    expect(idsAt([before, after], 10, 5)).toEqual([]);
  });

  test('a head that holds selected characters of the item opens it', () => {
    expect(idsAt([before, after], 7, 11)).toEqual(['after']);
    expect(idsAt([before, after], 7, 4)).toEqual(['before']);
    expect(idsAt([before, after], 12, 15)).toEqual(['after']);
    expect(idsAt([before, after], 3, 0)).toEqual(['before']);
  });

  test('a comment beside the selection does not open', () => {
    const note = comment('c1', range(10, 15));
    expect(idsAt([note], 6, 10)).toEqual([]);
    expect(idsAt([note], 6, 11)).toEqual(['c1']);
  });

  test('a point anchor counts only when the selection includes its position', () => {
    // A tracked paragraph mark sits at the paragraph end and decorates the break after it.
    const mark = revision('mark', range(20, 20));
    expect(idsAt([mark], 15, 20)).toEqual([]);
    expect(idsAt([mark], 0, 20, 'p2', 'p1')).toEqual(['mark']);
    expect(idsAt([mark], 20, 20)).toEqual(['mark']);
  });

  test('a range across paragraphs compares by paragraph order first', () => {
    const spanning = revision('spanning', range(8, 3, 'p1', 'p2'));
    expect(idsAt([spanning], 3, 6, 'p2')).toEqual([]);
    expect(idsAt([spanning], 2, 8, 'p1')).toEqual([]);
    expect(idsAt([spanning], 6, 2, 'p2')).toEqual(['spanning']);
    expect(idsAt([spanning], 2, 9, 'p1')).toEqual(['spanning']);
  });
});

describe('the work one caret position costs', () => {
  /** A paragraph order that counts how often it is asked for a position. */
  class CountedOrder extends Map<string, number> {
    reads = 0;
    override get(key: string): number | undefined {
      this.reads += 1;
      return super.get(key);
    }
  }

  test('each range in one paragraph costs one read of the order, and the caret one in all', () => {
    const order = new CountedOrder();
    const items: ReviewItem[] = [];
    for (let index = 0; index < 1_000; index += 1) {
      order.set(`q${index}`, index);
      items.push(revision(`r${index}`, range(0, 4, `q${index}`)));
    }
    order.set('caret', 1_000);
    order.set('after', 1_001);
    items.push(revision('here', range(2, 6, 'caret')));
    items.push(revision('spanning', range(1, 3, 'q998', 'after')));
    order.reads = 0;
    const found = reviewItemsAt(items, { paragraphId: 'caret', offset: 4 }, order);
    expect(found.map((item) => item.id)).toEqual(['here', 'spanning']);
    // One read for the caret, one for each range in one paragraph, two for the range across
    // paragraphs, and the width of the two ranges that hold the caret. Three reads for every
    // range was 3,006.
    expect(order.reads).toBe(1 + 1_001 + 2 + 4);
  });

  test('every position gets the answer a position-by-position comparison gives', () => {
    const paragraphs = ['a', 'b', 'c', 'd'];
    const order = new Map(paragraphs.map((id, index) => [id, index] as const));
    // A fixed sequence, so a failure names the same case on every run.
    let seed = 7;
    const next = (bound: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % bound;
    };
    const someRange = (): ReviewRange => {
      const from = next(paragraphs.length);
      const to = Math.min(paragraphs.length - 1, from + (next(4) === 0 ? next(3) : 0));
      const start = next(6);
      const end = from === to ? start + next(4) : next(6);
      return range(start, end, paragraphs[from]!, paragraphs[to]!);
    };
    const items: ReviewItem[] = [];
    for (let index = 0; index < 60; index += 1) {
      // One decision can cover several sites, in one paragraph or in several.
      const ranges = [someRange()];
      while (next(3) === 0) ranges.push(someRange());
      items.push(revision(`r${index}`, ...ranges));
      if (index % 5 === 0) items.push(comment(`c${index}`, someRange()));
    }
    items.push(revision('elsewhere', range(0, 3, 'not-in-order')));
    items.push(revision('half-known', range(0, 3, 'a'), range(0, 3, 'not-in-order')));
    const rangesOf = (item: ReviewItem): readonly ReviewRange[] =>
      item.kind === 'revision' ? item.ranges : item.range ? [item.range] : [];
    const holds = (item: ReviewItem, at: number, offset: number): boolean => {
      return rangesOf(item).some((candidate) => {
        const start = order.get(candidate.start.paragraphId);
        const end = order.get(candidate.end.paragraphId);
        if (start === undefined || end === undefined) return false;
        const afterStart = at > start || (at === start && offset >= candidate.start.offset);
        const beforeEnd = at < end || (at === end && offset <= candidate.end.offset);
        return afterStart && beforeEnd;
      });
    };
    for (const [paragraphId, at] of order) {
      for (let offset = 0; offset <= 10; offset += 1) {
        const found = reviewItemsAt(items, { paragraphId, offset }, order).map((item) => item.id);
        const expected = items.filter((item) => holds(item, at, offset)).map((item) => item.id);
        expect([...found].sort()).toEqual([...expected].sort());
      }
    }
    expect(reviewItemsAt(items, { paragraphId: 'not-in-order', offset: 1 }, order)).toEqual([]);
  });
});
