// How `reviewItemsAt` orders items that all cover one position.
//
// Width alone was the order, and width is the wrong question at a boundary. Both ends of a range
// count as covered — a caret resting past a range's last character is visually still on that
// character, and requiring it to be strictly inside makes the last character feel dead — but a
// range that merely ENDS at the caret then beat the range the caret is properly inside whenever
// the toucher was narrower. Tracked edits meet end-to-start by construction, so that was the
// common case, not a corner: a one-character insertion claimed every click on the six-character
// one beside it.

import { describe, expect, test } from 'bun:test';
import { reviewItemsAt, type ReviewItem, type ReviewRange } from '../review-support.ts';

const PART = 'word/document.xml';
const P1 = 'p1';
const P2 = 'p2';
const ORDER: ReadonlyMap<string, number> = new Map([
  [P1, 0],
  [P2, 1],
]);

function range(
  start: number,
  end: number,
  paragraphId = P1,
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
    readOnly: false,
    replyIds: [],
  };
}

function keysAt(items: readonly ReviewItem[], offset: number, paragraphId = P1): string[] {
  return reviewItemsAt(items, { paragraphId, offset }, ORDER).map((item) => item.id);
}

describe('ordering items that cover one position', () => {
  test('a range holding the caret inside beats a narrower one that only ends there', () => {
    const toucher = revision('toucher', range(29, 30));
    const container = revision('container', range(30, 36));
    // Both cover offset 30. The toucher is one character wide against six.
    expect(keysAt([toucher, container], 30)).toEqual(['container', 'toucher']);
    // Order of the input must not decide it.
    expect(keysAt([container, toucher], 30)).toEqual(['container', 'toucher']);
  });

  test('the narrower container still wins between two that both hold the caret', () => {
    const wide = revision('wide', range(0, 100));
    const narrow = revision('narrow', range(28, 34));
    expect(keysAt([wide, narrow], 30)).toEqual(['narrow', 'wide']);
  });

  test('a range covering no characters ranks last however narrow it is', () => {
    const empty = revision('empty', range(30, 30));
    const container = revision('container', range(30, 36));
    expect(keysAt([empty, container], 30)).toEqual(['container', 'empty']);
  });

  test('the caret at a range start is inside it, not merely touching', () => {
    const before = revision('before', range(20, 30));
    const at = revision('at', range(30, 31));
    // `at` is one character wide and `before` is ten, yet `at` holds offset 30 inside it.
    expect(keysAt([before, at], 30)).toEqual(['at', 'before']);
  });

  test('a card reports its HARDEST grip, not its first range', () => {
    // A replacement's two halves meet at the caret: the first range ends at 30 and the second
    // starts there. Asking only the first range read the card as a toucher and lost it to a
    // neighbour it should have outranked.
    const replacement = revision('replacement', range(20, 30), range(30, 40));
    const toucher = revision('toucher', range(29, 30));
    expect(keysAt([replacement, toucher], 30)).toEqual(['replacement', 'toucher']);
  });

  test('a cross-paragraph range holds a caret in its interior paragraph', () => {
    const spanning = revision('spanning', range(5, 5, P1, P2));
    expect(keysAt([spanning], 0, P2)).toEqual(['spanning']);
    // Past its end in the last paragraph is uncovered, as before.
    expect(keysAt([spanning], 6, P2)).toEqual([]);
  });

  test('an item whose paragraph the order does not know covers nothing', () => {
    const unknown = revision('unknown', range(0, 10, 'gone'));
    expect(keysAt([unknown], 5, P1)).toEqual([]);
  });
});
