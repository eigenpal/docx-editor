import { describe, expect, test } from 'bun:test';

import { createPaginator } from './paginator';
import type { ParagraphFragment } from './types';

function makeParagraphFragment(id: number): ParagraphFragment {
  return {
    kind: 'paragraph',
    blockId: id,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    fromLine: 0,
    toLine: 1,
  };
}

describe('Paginator oversized fragment handling', () => {
  test('places oversized fragment on current empty page', () => {
    const paginator = createPaginator({
      pageSize: { w: 200, h: 200 },
      margins: { top: 20, right: 20, bottom: 20, left: 20 },
    });

    const fragment = makeParagraphFragment(1);
    paginator.addFragment(fragment, 300);

    expect(paginator.pages.length).toBe(1);
    expect(fragment.y).toBe(20);
    expect(paginator.getCurrentState().cursorY).toBe(320);
  });

  test('moves oversized fragment to next page when current page already has content', () => {
    const paginator = createPaginator({
      pageSize: { w: 200, h: 200 },
      margins: { top: 20, right: 20, bottom: 20, left: 20 },
    });

    paginator.addFragment(makeParagraphFragment(1), 40);

    const oversized = makeParagraphFragment(2);
    paginator.addFragment(oversized, 300);

    expect(paginator.pages.length).toBe(2);
    expect(oversized.y).toBe(20);
    expect(oversized.x).toBe(20);
    expect(paginator.pages[1].fragments.length).toBe(1);
  });
});
