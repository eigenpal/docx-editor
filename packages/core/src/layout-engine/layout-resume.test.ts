import { describe, expect, test } from 'bun:test';

import { layoutDocument } from './index';
import { createPaginator } from './paginator';
import type { FlowBlock, LayoutOptions, Measure, ParagraphBlock, ParagraphMeasure } from './types';

// =============================================================================
// HELPERS
// =============================================================================

function makeParagraph(id: number, pmStart: number = 0, pmEnd: number = 10): ParagraphBlock {
  return {
    kind: 'paragraph',
    id,
    runs: [{ kind: 'text', text: `Block ${id}` }],
    attrs: { spacing: { before: 0, after: 0 } },
    pmStart,
    pmEnd,
  };
}

function makeMeasure(height: number): ParagraphMeasure {
  return {
    kind: 'paragraph',
    lines: [
      {
        fromRun: 0,
        fromChar: 0,
        toRun: 0,
        toChar: 5,
        width: 100,
        ascent: height * 0.8,
        descent: height * 0.2,
        lineHeight: height,
      },
    ],
    totalHeight: height,
  };
}

const PAGE_SIZE = { w: 400, h: 400 };
const MARGINS = { top: 20, right: 20, bottom: 20, left: 20 };
// Content height = 360

const BASE_OPTIONS: LayoutOptions = {
  pageSize: PAGE_SIZE,
  margins: MARGINS,
};

// =============================================================================
// TESTS
// =============================================================================

describe('layoutDocument resume', () => {
  test('resumed layout produces same result as full layout', () => {
    const blocks: FlowBlock[] = [];
    const measures: Measure[] = [];
    for (let i = 0; i < 6; i++) {
      blocks.push(makeParagraph(i));
      measures.push(makeMeasure(100));
    }
    // 360 / 100 = 3.6 → 3 blocks per page → 2 pages

    // Full layout
    const full = layoutDocument(blocks, measures, BASE_OPTIONS);

    // Get snapshot at block 2 from a paginator
    const paginator = createPaginator({ pageSize: PAGE_SIZE, margins: MARGINS });
    // Simulate layout of first 2 blocks
    for (let i = 0; i < 2; i++) {
      const frag = {
        kind: 'paragraph' as const,
        blockId: i,
        x: 0,
        y: 0,
        width: 360,
        height: 100,
        fromLine: 0,
        toLine: 1,
      };
      paginator.addFragment(frag, 100, 0, 0);
    }
    const snapshot = paginator.snapshot();

    // Resume from block 2
    const resumed = layoutDocument(blocks, measures, {
      ...BASE_OPTIONS,
      resumeFrom: {
        resumeFromBlock: 2,
        paginatorSnapshot: snapshot,
        dirtyTo: 3,
      },
    });

    expect(resumed.pages.length).toBe(full.pages.length);
    // Compare fragment counts on each page
    for (let p = 0; p < full.pages.length; p++) {
      expect(resumed.pages[p].fragments.length).toBe(full.pages[p].fragments.length);
    }
  });

  test('statesAtBlock is populated for each processed block', () => {
    const blocks: FlowBlock[] = [];
    const measures: Measure[] = [];
    for (let i = 0; i < 4; i++) {
      blocks.push(makeParagraph(i));
      measures.push(makeMeasure(80));
    }

    const result = layoutDocument(blocks, measures, BASE_OPTIONS);
    expect(result.statesAtBlock).toBeDefined();
    expect(result.statesAtBlock!.length).toBe(4);

    // First block: after placing 80px block at top (20) + 80 = cursor at 100
    expect(result.statesAtBlock![0].cursorY).toBe(100);
    expect(result.statesAtBlock![0].pageCount).toBe(1);
  });

  test('early exit when layout converges after dirty range', () => {
    // Create 10 blocks, each 80px tall
    // 360 / 80 = 4.5 → 4 blocks per page
    const blocks: FlowBlock[] = [];
    const measures: Measure[] = [];
    for (let i = 0; i < 10; i++) {
      blocks.push(makeParagraph(i));
      measures.push(makeMeasure(80));
    }

    // First: get the full layout's statesAtBlock
    const full = layoutDocument(blocks, measures, BASE_OPTIONS);
    const fullStates = full.statesAtBlock!;
    expect(fullStates.length).toBe(10);

    // Now simulate: dirty range is [2, 3), but the change doesn't affect layout
    // (same measure height). Resume from block 2 with snapshot.
    const paginator = createPaginator({ pageSize: PAGE_SIZE, margins: MARGINS });
    for (let i = 0; i < 2; i++) {
      const frag = {
        kind: 'paragraph' as const,
        blockId: i,
        x: 0,
        y: 0,
        width: 360,
        height: 80,
        fromLine: 0,
        toLine: 1,
      };
      paginator.addFragment(frag, 80, 0, 0);
    }
    const snapshot = paginator.snapshot();

    const resumed = layoutDocument(blocks, measures, {
      ...BASE_OPTIONS,
      resumeFrom: {
        resumeFromBlock: 2,
        paginatorSnapshot: snapshot,
        dirtyTo: 3,
        prevStatesAtBlock: fullStates,
        prevPages: full.pages,
      },
    });

    // Should have early-exited: the edit didn't change layout, so after dirty range
    // the states should converge with the previous run
    expect(resumed.earlyExitBlock).toBeDefined();
    // Early exit splices remaining statesAtBlock from previous run, so length is complete
    expect(resumed.statesAtBlock!.length).toBe(10);
    // Verify pages are also complete (remaining pages spliced from previous run)
    expect(resumed.pages.length).toBe(full.pages.length);
  });

  test('no early exit when layout changes propagate', () => {
    // Create 6 blocks, first 3 at 80px, last 3 at 80px
    const blocks: FlowBlock[] = [];
    const measures: Measure[] = [];
    for (let i = 0; i < 6; i++) {
      blocks.push(makeParagraph(i));
      measures.push(makeMeasure(80));
    }

    // Full layout with original measures
    const full = layoutDocument(blocks, measures, BASE_OPTIONS);
    const fullStates = full.statesAtBlock!;

    // Now change block 2's measure to be much taller (pushes everything down)
    const modifiedMeasures = [...measures];
    modifiedMeasures[2] = makeMeasure(200);

    const paginator = createPaginator({ pageSize: PAGE_SIZE, margins: MARGINS });
    for (let i = 0; i < 2; i++) {
      const frag = {
        kind: 'paragraph' as const,
        blockId: i,
        x: 0,
        y: 0,
        width: 360,
        height: 80,
        fromLine: 0,
        toLine: 1,
      };
      paginator.addFragment(frag, 80, 0, 0);
    }
    const snapshot = paginator.snapshot();

    const resumed = layoutDocument(blocks, modifiedMeasures, {
      ...BASE_OPTIONS,
      resumeFrom: {
        resumeFromBlock: 2,
        paginatorSnapshot: snapshot,
        dirtyTo: 3,
        prevStatesAtBlock: fullStates,
      },
    });

    // The taller block pushes layout down — no convergence, so no early exit
    expect(resumed.earlyExitBlock).toBeUndefined();
  });

  test('contextual spacing is applied for dirty range in resume mode', () => {
    // Two consecutive paragraphs with same style and contextualSpacing
    const blocks: FlowBlock[] = [
      {
        kind: 'paragraph',
        id: 0,
        runs: [{ kind: 'text', text: 'A' }],
        attrs: { spacing: { before: 10, after: 10 }, contextualSpacing: true, styleId: 'Normal' },
      },
      {
        kind: 'paragraph',
        id: 1,
        runs: [{ kind: 'text', text: 'B' }],
        attrs: { spacing: { before: 10, after: 10 }, contextualSpacing: true, styleId: 'Normal' },
      },
      {
        kind: 'paragraph',
        id: 2,
        runs: [{ kind: 'text', text: 'C' }],
        attrs: { spacing: { before: 10, after: 10 }, contextualSpacing: true, styleId: 'Normal' },
      },
    ];
    const measures: Measure[] = [makeMeasure(50), makeMeasure(50), makeMeasure(50)];

    // Full layout for reference
    const full = layoutDocument(
      // Deep clone to avoid mutation
      JSON.parse(JSON.stringify(blocks)),
      measures,
      BASE_OPTIONS
    );

    // Resume from block 1 with dirty range [1, 2)
    const paginator = createPaginator({ pageSize: PAGE_SIZE, margins: MARGINS });
    const frag = {
      kind: 'paragraph' as const,
      blockId: 0,
      x: 0,
      y: 0,
      width: 360,
      height: 50,
      fromLine: 0,
      toLine: 1,
    };
    paginator.addFragment(frag, 50, 10, 10);
    const snapshot = paginator.snapshot();

    const freshBlocks = JSON.parse(JSON.stringify(blocks));
    const resumed = layoutDocument(freshBlocks, measures, {
      ...BASE_OPTIONS,
      resumeFrom: {
        resumeFromBlock: 1,
        paginatorSnapshot: snapshot,
        dirtyTo: 2,
      },
    });

    // Both should produce the same page count
    expect(resumed.pages.length).toBe(full.pages.length);
  });

  test('edge case: dirty range at last block — no early exit possible', () => {
    const blocks: FlowBlock[] = [];
    const measures: Measure[] = [];
    for (let i = 0; i < 5; i++) {
      blocks.push(makeParagraph(i));
      measures.push(makeMeasure(80));
    }

    const full = layoutDocument(blocks, measures, BASE_OPTIONS);
    const fullStates = full.statesAtBlock!;

    // Resume from block 3, dirty range is [3, 5) — covers the last 2 blocks
    const paginator = createPaginator({ pageSize: PAGE_SIZE, margins: MARGINS });
    for (let i = 0; i < 3; i++) {
      const frag = {
        kind: 'paragraph' as const,
        blockId: i,
        x: 0,
        y: 0,
        width: 360,
        height: 80,
        fromLine: 0,
        toLine: 1,
      };
      paginator.addFragment(frag, 80, 0, 0);
    }
    const snapshot = paginator.snapshot();

    const resumed = layoutDocument(blocks, measures, {
      ...BASE_OPTIONS,
      resumeFrom: {
        resumeFromBlock: 3,
        paginatorSnapshot: snapshot,
        dirtyTo: 5, // dirty range covers last blocks — no room for convergence
        prevStatesAtBlock: fullStates,
      },
    });

    // No early exit since dirty range extends to the end
    expect(resumed.earlyExitBlock).toBeUndefined();
    // But layout should still be correct
    expect(resumed.pages.length).toBe(full.pages.length);
  });

  test('edge case: page break shift prevents convergence', () => {
    // 5 blocks at 80px each, content height 360 → 4 blocks per page normally
    const blocks: FlowBlock[] = [];
    const measures: Measure[] = [];
    for (let i = 0; i < 8; i++) {
      blocks.push(makeParagraph(i));
      measures.push(makeMeasure(80));
    }

    const full = layoutDocument(blocks, measures, BASE_OPTIONS);
    const fullStates = full.statesAtBlock!;

    // Now insert an explicit page break block at position 1
    const blocksWithBreak: FlowBlock[] = [
      blocks[0],
      { kind: 'pageBreak', id: 'pb' },
      ...blocks.slice(1),
    ];
    const measuresWithBreak: Measure[] = [measures[0], { kind: 'pageBreak' }, ...measures.slice(1)];

    // Resume from block 0 (essentially full re-layout since page break shifts everything)
    const paginator = createPaginator({ pageSize: PAGE_SIZE, margins: MARGINS });
    const resumed = layoutDocument(blocksWithBreak, measuresWithBreak, {
      ...BASE_OPTIONS,
      resumeFrom: {
        resumeFromBlock: 0,
        paginatorSnapshot: paginator.snapshot(),
        dirtyTo: 2,
        prevStatesAtBlock: fullStates,
      },
    });

    // The page break shifts everything — layout should NOT converge with the old states
    // (different page counts at corresponding block indices)
    // More pages due to the page break
    expect(resumed.pages.length).toBeGreaterThan(full.pages.length);
  });
});

describe('PaginatorStateAtBlock convergence', () => {
  test('identical states are detected as converged', () => {
    const blocks: FlowBlock[] = [];
    const measures: Measure[] = [];
    for (let i = 0; i < 4; i++) {
      blocks.push(makeParagraph(i));
      measures.push(makeMeasure(80));
    }

    const run1 = layoutDocument(blocks, measures, BASE_OPTIONS);
    const run2 = layoutDocument(blocks, measures, BASE_OPTIONS);

    // Same input should produce identical statesAtBlock
    expect(run1.statesAtBlock!.length).toBe(run2.statesAtBlock!.length);
    for (let i = 0; i < run1.statesAtBlock!.length; i++) {
      const s1 = run1.statesAtBlock![i];
      const s2 = run2.statesAtBlock![i];
      expect(s1.pageCount).toBe(s2.pageCount);
      expect(s1.cursorY).toBe(s2.cursorY);
      expect(s1.columnIndex).toBe(s2.columnIndex);
      expect(s1.trailingSpacing).toBe(s2.trailingSpacing);
    }
  });
});
