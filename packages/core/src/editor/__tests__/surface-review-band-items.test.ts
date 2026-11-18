// The items behind the painted review bands.
//
// A band takes its class and its author from its item. The lookup must answer as a map over
// the whole queue would, while building keys only for the items the bands name: the queue of
// a long document holds thousands of items, and the visible pages show a few.

import { describe, expect, test } from 'bun:test';
import { reviewItemKey, type ReviewItem } from '@docx-editor.dev/core/layout';
import {
  RANGE_SUFFIX,
  bandRanges,
  createBandItemLookup,
  reviewBands,
  type KeyedBandRect,
} from '../surface-review-band-class.ts';

const PART = 'word/document.xml';
const at = (paragraphId: string, start: number, end: number) => ({
  partName: PART,
  start: { paragraphId, offset: start },
  end: { paragraphId, offset: end },
});

/** A revision over the given paragraphs, one range in each; one range in `p1` by default. */
function revisionIn(id: string, ...paragraphIds: string[]): ReviewItem {
  return { ...revision(id), ranges: paragraphIds.map((paragraphId) => at(paragraphId, 0, 1)) };
}

function commentIn(id: string, paragraphId: string | null): ReviewItem {
  return { ...comment(id), range: paragraphId === null ? null : at(paragraphId, 2, 5) };
}

function revision(id: string, author = 'A', revisionKind = 'insert'): ReviewItem {
  return {
    kind: 'revision',
    id,
    address: { id, author },
    addresses: [{ id, author }],
    replacedText: '',
    revisionKind,
    author,
    text: 'x',
    ranges: [at('p1', 0, 1)],
    nesting: 0,
    readOnly: false,
    replyIds: [],
  } as ReviewItem;
}

function comment(id: string, resolved = false): ReviewItem {
  return {
    kind: 'comment',
    id,
    comment: { id, author: 'B', blocks: [] },
    range: at('p1', 0, 1),
    resolved,
    replyIds: [],
    orphaned: false,
  } as ReviewItem;
}

const rect = (key: string, y = 0): KeyedBandRect => ({
  key,
  pageIndex: 0,
  x: 0,
  y,
  width: 10,
  height: 10,
});

/** What the lookup replaces: every item of the queue by its key, the last one winning. */
function wholeQueue(items: readonly ReviewItem[]): Map<string, ReviewItem> {
  const byKey = new Map<string, ReviewItem>();
  for (const item of items) byKey.set(reviewItemKey(item), item);
  return byKey;
}

describe('the ranges measured for the review bands', () => {
  const visible = new Set(['p1', 'p2']);
  const onScreen = (from: string, to: string) => visible.has(from) || visible.has(to);

  test('each range on the pages is measured under the key of its decision', () => {
    const custom = { kind: 'custom', id: 'n1', range: at('p2', 1, 4), carded: true } as ReviewItem;
    const ranges = bandRanges(
      [
        commentIn('c1', 'p1'),
        commentIn('orphan', null),
        commentIn('away', 'p9'),
        revisionIn('one', 'p2'),
        revisionIn('two', 'p1', 'p9', 'p2'),
        revisionIn('gone', 'p8', 'p9'),
        revisionIn('none'),
        custom,
      ],
      onScreen
    );
    expect(ranges.map((entry) => [entry.key, entry.from.paragraphId, entry.from.offset])).toEqual([
      ['comment-c1', 'p1', 2],
      ['revision-one', 'p2', 0],
      // A decision over several sites keeps the index of each range, on the pages or not.
      [`revision-two${RANGE_SUFFIX}0`, 'p1', 0],
      [`revision-two${RANGE_SUFFIX}2`, 'p2', 0],
      ['custom-n1', 'p2', 1],
    ]);
    expect(ranges[0]!.to).toEqual({ paragraphId: 'p1', offset: 5 });
  });

  test('it builds a key only for an item with a range on the pages', () => {
    let idReads = 0;
    const counted = (item: ReviewItem): ReviewItem =>
      new Proxy(item, {
        get(target, property, receiver) {
          if (property === 'id') idReads += 1;
          return Reflect.get(target, property, receiver);
        },
      });
    const items: ReviewItem[] = [];
    for (let index = 0; index < 2_000; index += 1) {
      items.push(counted(revisionIn(`r${index}`, `q${index}`, `q${index + 1}`)));
      items.push(counted(commentIn(`c${index}`, `q${index}`)));
    }
    items.push(counted(revisionIn('here', 'p1', 'p2')));
    const ranges = bandRanges(items, onScreen);
    expect(ranges).toHaveLength(2);
    // One key for the one item on the pages, shared by its two ranges.
    expect(idReads).toBe(1);
  });
});

describe('the items behind the review bands', () => {
  test('each band key resolves to the item a whole-queue map gives', () => {
    const items = [
      revision('ins-1'),
      comment('7'),
      revision('7'),
      revision('del-2', 'C', 'delete'),
      comment('a-b-c'),
      revision('unseen'),
    ];
    const rects = [
      rect('revision-ins-1'),
      rect(`revision-del-2${RANGE_SUFFIX}0`),
      rect(`revision-del-2${RANGE_SUFFIX}1`),
      rect('comment-7'),
      rect('comment-a-b-c'),
      rect('custom-missing'),
    ];
    const found = createBandItemLookup()(items, rects);
    const reference = wholeQueue(items);
    for (const key of [
      'revision-ins-1',
      'revision-del-2',
      'comment-7',
      'comment-a-b-c',
      'custom-missing',
    ]) {
      expect(found.get(key)).toBe(reference.get(key));
    }
    // A revision and a comment may share an id; only the comment is behind a band here.
    expect(found.has('revision-7')).toBe(false);
    expect(found.has('revision-unseen')).toBe(false);
  });

  test('a key listed more than once resolves to the last item, as a whole-queue map does', () => {
    const open = comment('5', false);
    const settled = comment('5', true);
    const items = [open, revision('r'), settled];
    const found = createBandItemLookup()(items, [rect('comment-5')]);
    expect(found.get('comment-5')).toBe(settled);
    expect(found.get('comment-5')).toBe(wholeQueue(items).get('comment-5'));
  });

  test('a band key the key parser does not know still resolves, by comparing every item', () => {
    // An item of a kind the parser does not list yet: the id filter must not hide its band.
    const foreign = { ...revision('9'), kind: 'future' } as unknown as ReviewItem;
    const items = [revision('1'), foreign, comment('2', false)];
    const found = createBandItemLookup()(items, [rect('future-9'), rect('comment-2')]);
    expect(found.get('future-9')).toBe(foreign);
    expect(found.get('comment-2')).toBe(items[2]);
    expect(found.size).toBe(2);
  });

  test('it builds a key only for the items the bands name', () => {
    let kindReads = 0;
    const counted = (item: ReviewItem): ReviewItem =>
      new Proxy(item, {
        get(target, property, receiver) {
          if (property === 'kind') kindReads += 1;
          return Reflect.get(target, property, receiver);
        },
      });
    const items: ReviewItem[] = [];
    for (let index = 0; index < 2_000; index += 1) items.push(counted(revision(`r${index}`)));
    const lookup = createBandItemLookup();
    const found = lookup(items, [rect('revision-r40'), rect('revision-r1999')]);
    expect(found.size).toBe(2);
    expect(found.get('revision-r40')).toBe(items[40]);
    // One key for each of the two items on screen, none for the 1,998 that are not.
    expect(kindReads).toBe(2);
  });

  test('the answer stands for the same queue and the same bands, and no longer', () => {
    const items = [revision('a'), comment('b')];
    const rects = [rect('revision-a')];
    const lookup = createBandItemLookup();
    const first = lookup(items, rects);
    expect(lookup(items, rects)).toBe(first);
    // A queue that changed can carry a different item under the same key.
    const resolved = [revision('a'), comment('b', true)];
    const afterQueue = lookup(resolved, [rect('comment-b')]);
    expect(afterQueue.get('comment-b')).toBe(resolved[1]);
    // New bands name other items, even over the same queue.
    const afterBands = lookup(resolved, [rect('revision-a')]);
    expect(afterBands).not.toBe(afterQueue);
    expect(afterBands.get('revision-a')).toBe(resolved[0]);
    expect(afterBands.has('comment-b')).toBe(false);
  });

  test('no bands means no walk of the queue', () => {
    let reads = 0;
    const items = new Proxy([revision('a')], {
      get(target, property, receiver) {
        reads += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    expect(createBandItemLookup()(items, []).size).toBe(0);
    expect(reads).toBe(0);
  });
});

describe('the bands painted for the measured rectangles', () => {
  const authors = new Map([
    ['A', { author: 'A', slot: 0, color: 'red', style: { activeBackground: 'pink' } }],
  ]) as never;

  test('a band takes its class and its author from the decision, not the range', () => {
    const items = [revision('r1'), comment('c1'), comment('c2', true)];
    const rects = [
      rect(`revision-r1${RANGE_SUFFIX}0`, 0),
      rect(`revision-r1${RANGE_SUFFIX}1`, 20),
      rect('comment-c1', 40),
      rect('comment-c2', 60),
      rect('custom-n1', 80),
    ];
    const byKey = createBandItemLookup()(items, rects);
    const idle = reviewBands(rects, new Set(), byKey, authors);
    // A resolved comment and a custom node draw nothing until their card is open.
    expect(idle.map((band) => [band.y, band.className])).toEqual([
      [0, 'docx-revision-band docx-revision-band--insert'],
      [20, 'docx-revision-band docx-revision-band--insert'],
      [40, 'docx-comment-band'],
    ]);
    expect(idle.every((band) => band.activeBackground === undefined)).toBe(true);
    expect(idle[0]!.reviewAuthor?.author).toBe('A');
    expect(idle[2]!.reviewAuthor).toBeUndefined();

    const open = reviewBands(rects, new Set(['revision-r1']), byKey, authors);
    // Every range of the open decision is active and takes the author's background.
    expect(open.slice(0, 2).map((band) => [band.className, band.activeBackground])).toEqual([
      ['docx-revision-band docx-revision-band--insert docx-revision-band--active', 'pink'],
      ['docx-revision-band docx-revision-band--insert docx-revision-band--active', 'pink'],
    ]);
    expect(open[2]!.activeBackground).toBeUndefined();
  });
});
