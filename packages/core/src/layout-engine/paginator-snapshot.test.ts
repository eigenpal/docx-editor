import { describe, expect, test } from 'bun:test';

import { createPaginator, createPaginatorFromSnapshot } from './paginator';
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

const PAGE_SIZE = { w: 400, h: 400 };
const MARGINS = { top: 20, right: 20, bottom: 20, left: 20 };
// Content height = 400 - 20 - 20 = 360

describe('Paginator snapshot/restore', () => {
  test('snapshot + restore produces identical layout to full run', () => {
    // Full run: add 4 fragments across 2 pages
    const full = createPaginator({ pageSize: PAGE_SIZE, margins: MARGINS });
    full.addFragment(makeParagraphFragment(1), 100);
    full.addFragment(makeParagraphFragment(2), 100);
    // Snapshot point would be here (after 2 fragments on page 1)
    full.addFragment(makeParagraphFragment(3), 200); // fills rest of page 1, spills to page 2
    full.addFragment(makeParagraphFragment(4), 50);

    // Incremental run: add 2 fragments, snapshot, restore, continue
    const first = createPaginator({ pageSize: PAGE_SIZE, margins: MARGINS });
    first.addFragment(makeParagraphFragment(1), 100);
    first.addFragment(makeParagraphFragment(2), 100);
    const snap = first.snapshot();

    const resumed = createPaginatorFromSnapshot(snap, {
      pageSize: PAGE_SIZE,
      margins: MARGINS,
    });
    resumed.addFragment(makeParagraphFragment(3), 200);
    resumed.addFragment(makeParagraphFragment(4), 50);

    // Same number of pages
    expect(resumed.pages.length).toBe(full.pages.length);

    // Same fragments on each page
    for (let p = 0; p < full.pages.length; p++) {
      expect(resumed.pages[p].fragments.length).toBe(full.pages[p].fragments.length);
      for (let f = 0; f < full.pages[p].fragments.length; f++) {
        expect(resumed.pages[p].fragments[f].blockId).toBe(full.pages[p].fragments[f].blockId);
        expect(resumed.pages[p].fragments[f].y).toBe(full.pages[p].fragments[f].y);
      }
    }
  });

  test('snapshot at page boundary, then continue adding', () => {
    const paginator = createPaginator({ pageSize: PAGE_SIZE, margins: MARGINS });
    // Fill page 1 exactly
    paginator.addFragment(makeParagraphFragment(1), 360);
    expect(paginator.pages.length).toBe(1);

    const snap = paginator.snapshot();

    const resumed = createPaginatorFromSnapshot(snap, {
      pageSize: PAGE_SIZE,
      margins: MARGINS,
    });
    // Next fragment should go to page 2
    resumed.addFragment(makeParagraphFragment(2), 50);
    expect(resumed.pages.length).toBe(2);
    expect(resumed.pages[1].fragments[0].blockId).toBe(2);
    expect(resumed.pages[1].fragments[0].y).toBe(20); // top margin
  });

  test('snapshot with multi-column layout', () => {
    const columns = { count: 2, gap: 20 };
    const paginator = createPaginator({
      pageSize: PAGE_SIZE,
      margins: MARGINS,
      columns,
    });

    // Add fragment to first column
    paginator.addFragment(makeParagraphFragment(1), 100);
    expect(paginator.getCurrentState().columnIndex).toBe(0);

    const snap = paginator.snapshot();

    const resumed = createPaginatorFromSnapshot(snap, {
      pageSize: PAGE_SIZE,
      margins: MARGINS,
      columns,
    });

    // Column state should be preserved
    expect(resumed.getCurrentState().columnIndex).toBe(0);
    expect(resumed.columnWidth).toBe(paginator.columnWidth);

    // Fill first column, should advance to second
    resumed.addFragment(makeParagraphFragment(2), 260); // fills column 1
    resumed.addFragment(makeParagraphFragment(3), 50); // should be in column 2
    expect(resumed.getCurrentState().columnIndex).toBe(1);
  });

  test('snapshot after updateColumns preserves column state', () => {
    const paginator = createPaginator({ pageSize: PAGE_SIZE, margins: MARGINS });

    // Add content, then switch to 3 columns
    paginator.addFragment(makeParagraphFragment(1), 100);
    paginator.updateColumns({ count: 3, gap: 10 });

    const snap = paginator.snapshot();

    expect(snap.columns.count).toBe(3);
    expect(snap.columns.gap).toBe(10);
    expect(snap.columnRegionTop).toBe(120); // cursor was at 20 + 100 = 120

    const resumed = createPaginatorFromSnapshot(snap, {
      pageSize: PAGE_SIZE,
      margins: MARGINS,
    });

    expect(resumed.columns.count).toBe(3);
    expect(resumed.columns.gap).toBe(10);
  });

  test('snapshot is a true deep clone — mutating original does not affect snapshot', () => {
    const paginator = createPaginator({ pageSize: PAGE_SIZE, margins: MARGINS });
    paginator.addFragment(makeParagraphFragment(1), 100);

    const snap = paginator.snapshot();

    // Mutate original paginator
    paginator.addFragment(makeParagraphFragment(2), 50);
    paginator.addFragment(makeParagraphFragment(3), 50);

    // Snapshot should still have 1 fragment on page 1
    expect(snap.pages.length).toBe(1);
    expect(snap.pages[0].fragments.length).toBe(1);
    expect(snap.pages[0].fragments[0].blockId).toBe(1);

    // Mutate the snapshot's page margins
    snap.pages[0].margins.top = 999;

    // Original paginator should not be affected
    expect(paginator.pages[0].margins.top).toBe(20);
  });

  test('snapshot is a deep clone — mutating snapshot does not affect restored paginator', () => {
    const paginator = createPaginator({ pageSize: PAGE_SIZE, margins: MARGINS });
    paginator.addFragment(makeParagraphFragment(1), 100);

    const snap = paginator.snapshot();
    const resumed = createPaginatorFromSnapshot(snap, {
      pageSize: PAGE_SIZE,
      margins: MARGINS,
    });

    // Mutate snapshot after restore
    snap.pages[0].fragments.push(makeParagraphFragment(99));
    snap.pages[0].margins.top = 999;

    // Restored paginator should not be affected
    expect(resumed.pages[0].fragments.length).toBe(1);
    expect(resumed.pages[0].margins.top).toBe(20);
  });

  test('snapshot preserves trailingSpacing on current state', () => {
    const paginator = createPaginator({ pageSize: PAGE_SIZE, margins: MARGINS });
    paginator.addFragment(makeParagraphFragment(1), 100, 0, 15);

    const snap = paginator.snapshot();
    expect(snap.states[0].trailingSpacing).toBe(15);

    const resumed = createPaginatorFromSnapshot(snap, {
      pageSize: PAGE_SIZE,
      margins: MARGINS,
    });
    expect(resumed.getCurrentState().trailingSpacing).toBe(15);
  });

  test('3-page scenario: snapshot at page 2, restore and continue to page 3', () => {
    // Full run
    const full = createPaginator({ pageSize: PAGE_SIZE, margins: MARGINS });
    for (let i = 1; i <= 6; i++) {
      full.addFragment(makeParagraphFragment(i), 150);
    }
    // 360 / 150 = 2.4 → 2 fragments per page → 3 pages for 6 fragments

    // Incremental: snapshot after 4 fragments (end of page 2)
    const first = createPaginator({ pageSize: PAGE_SIZE, margins: MARGINS });
    for (let i = 1; i <= 4; i++) {
      first.addFragment(makeParagraphFragment(i), 150);
    }
    const snap = first.snapshot();
    expect(snap.pages.length).toBe(2);

    const resumed = createPaginatorFromSnapshot(snap, {
      pageSize: PAGE_SIZE,
      margins: MARGINS,
    });
    for (let i = 5; i <= 6; i++) {
      resumed.addFragment(makeParagraphFragment(i), 150);
    }

    expect(resumed.pages.length).toBe(full.pages.length);
    // Last page should have the same fragments
    const lastPageFull = full.pages[full.pages.length - 1];
    const lastPageResumed = resumed.pages[resumed.pages.length - 1];
    expect(lastPageResumed.fragments.length).toBe(lastPageFull.fragments.length);
  });
});
