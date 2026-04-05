/**
 * Tests for convertTopLevelNode extraction and IncrementalBlockCache.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import { EditorState } from 'prosemirror-state';
import type { FlowBlock, PageBreakBlock, ParagraphBlock } from '../layout-engine/types';
import { schema } from '../prosemirror/schema';
import {
  computeDirtyRange,
  createIncrementalBlockCache,
  rebuildIndices,
  reindexPositions,
  saveBlockState,
  snapshotListCounters,
  updateBlocks,
} from './incrementalBlockCache';
import type { ToFlowBlocksOptions } from './toFlowBlocks';
import { convertTopLevelNode, toFlowBlocks } from './toFlowBlocks';

// =============================================================================
// HELPERS
// =============================================================================

const defaultOpts: ToFlowBlocksOptions = {
  defaultFont: 'Calibri',
  defaultSize: 11,
};

function makeDoc(...paras: Array<{ text: string; attrs?: Record<string, unknown> }>) {
  return schema.node(
    'doc',
    null,
    paras.map((p) =>
      schema.node('paragraph', { paraId: null, ...p.attrs }, p.text ? [schema.text(p.text)] : [])
    )
  );
}

function makeDocWithPageBreak(
  ...items: Array<
    { type: 'paragraph'; text: string; attrs?: Record<string, unknown> } | { type: 'pageBreak' }
  >
) {
  return schema.node(
    'doc',
    null,
    items.map((item) => {
      if (item.type === 'pageBreak') {
        return schema.node('pageBreak');
      }
      return schema.node(
        'paragraph',
        { paraId: null, ...item.attrs },
        item.text ? [schema.text(item.text)] : []
      );
    })
  );
}

/**
 * Create an EditorState and apply a text insertion transaction.
 * Returns the new doc where unchanged nodes preserve identity with the original.
 */
function applyTextInsert(doc: ReturnType<typeof makeDoc>, insertPos: number, text: string) {
  const state = EditorState.create({ doc, schema });
  const tr = state.tr.insertText(text, insertPos);
  return tr.doc;
}

/**
 * Apply a text deletion transaction.
 */
function applyTextDelete(doc: ReturnType<typeof makeDoc>, from: number, to: number) {
  const state = EditorState.create({ doc, schema });
  const tr = state.tr.delete(from, to);
  return tr.doc;
}

// =============================================================================
// convertTopLevelNode — equivalence with toFlowBlocks
// =============================================================================

describe('convertTopLevelNode', () => {
  test('produces identical output to toFlowBlocks for plain paragraphs', () => {
    const doc = makeDoc(
      { text: 'Hello world' },
      { text: 'Second paragraph' },
      { text: 'Third paragraph' }
    );

    const fullBlocks = toFlowBlocks(doc, defaultOpts);

    // Reconstruct using convertTopLevelNode
    const listCounters = new Map<number, number[]>();
    const manualBlocks: FlowBlock[] = [];
    doc.forEach((node, nodeOffset) => {
      const result = convertTopLevelNode(node, nodeOffset, defaultOpts, listCounters);
      for (const b of result) manualBlocks.push(b);
    });

    // Compare block count and structure (ids will differ due to global counter)
    expect(manualBlocks.length).toBe(fullBlocks.length);
    for (let i = 0; i < fullBlocks.length; i++) {
      expect(manualBlocks[i].kind).toBe(fullBlocks[i].kind);
      if ('pmStart' in fullBlocks[i]) {
        expect((manualBlocks[i] as ParagraphBlock).pmStart).toBe(
          (fullBlocks[i] as ParagraphBlock).pmStart
        );
        expect((manualBlocks[i] as ParagraphBlock).pmEnd).toBe(
          (fullBlocks[i] as ParagraphBlock).pmEnd
        );
      }
    }
  });

  test('produces paragraph + sectionBreak for paragraph with _sectionProperties', () => {
    const doc = makeDoc({
      text: 'Section end',
      attrs: {
        _sectionProperties: {
          sectionStart: 'nextPage',
          pageWidth: 12240,
          pageHeight: 15840,
          marginTop: 1440,
          marginLeft: 1440,
        },
      },
    });

    const blocks = toFlowBlocks(doc, defaultOpts);
    expect(blocks.length).toBe(2);
    expect(blocks[0].kind).toBe('paragraph');
    expect(blocks[1].kind).toBe('sectionBreak');
  });

  test('handles numbered list counter mutation correctly', () => {
    const doc = makeDoc(
      { text: 'Item 1', attrs: { numPr: { numId: 1, ilvl: 0 } } },
      { text: 'Item 2', attrs: { numPr: { numId: 1, ilvl: 0 } } },
      { text: 'Item 3', attrs: { numPr: { numId: 1, ilvl: 1 } } }
    );

    const blocks = toFlowBlocks(doc, defaultOpts);
    expect(blocks.length).toBe(3);

    // Verify list markers were assigned
    for (const block of blocks) {
      if (block.kind === 'paragraph' && block.attrs) {
        expect(block.attrs.listMarker).toBeDefined();
      }
    }
  });

  test('handles bullet list items', () => {
    const doc = makeDoc({
      text: 'Bullet item',
      attrs: { numPr: { numId: 1, ilvl: 0 }, listIsBullet: true },
    });

    const blocks = toFlowBlocks(doc, defaultOpts);
    expect(blocks.length).toBe(1);
    if (blocks[0].kind === 'paragraph' && blocks[0].attrs) {
      expect(blocks[0].attrs.listMarker).toBe('•');
    }
  });

  test('handles pageBreak nodes', () => {
    const doc = makeDocWithPageBreak(
      { type: 'paragraph', text: 'Before break' },
      { type: 'pageBreak' },
      { type: 'paragraph', text: 'After break' }
    );

    const blocks = toFlowBlocks(doc, defaultOpts);
    expect(blocks.length).toBe(3);
    expect(blocks[0].kind).toBe('paragraph');
    expect(blocks[1].kind).toBe('pageBreak');
    expect(blocks[2].kind).toBe('paragraph');
  });

  test('paragraph with numId=0 gets no list marker', () => {
    const doc = makeDoc({
      text: 'No numbering',
      attrs: { numPr: { numId: 0, ilvl: 0 } },
    });

    const blocks = toFlowBlocks(doc, defaultOpts);
    expect(blocks.length).toBe(1);
    if (blocks[0].kind === 'paragraph' && blocks[0].attrs) {
      expect(blocks[0].attrs.listMarker).toBeUndefined();
    }
  });
});

// =============================================================================
// computeDirtyRange — uses PM transactions for node identity preservation
// =============================================================================

describe('computeDirtyRange', () => {
  let cache: ReturnType<typeof createIncrementalBlockCache>;

  beforeEach(() => {
    cache = createIncrementalBlockCache();
  });

  test('returns null when no prevDoc', () => {
    const doc = makeDoc({ text: 'Hello' });
    expect(computeDirtyRange(cache, doc)).toBeNull();
  });

  test('returns null when same document (identity)', () => {
    const doc = makeDoc({ text: 'Hello' }, { text: 'World' });
    const blocks = toFlowBlocks(doc, defaultOpts);
    saveBlockState(cache, doc, blocks, []);

    // Same doc reference — no changes
    expect(computeDirtyRange(cache, doc)).toBeNull();
  });

  test('detects single changed node via transaction', () => {
    const doc1 = makeDoc({ text: 'First' }, { text: 'Second' }, { text: 'Third' });
    const blocks1 = toFlowBlocks(doc1, defaultOpts);
    saveBlockState(cache, doc1, blocks1, []);

    // Insert a character in the middle paragraph via transaction
    // doc structure: <doc><para>First</para><para>Second</para><para>Third</para></doc>
    // Positions: 0=doc_start, 1=para1_start, 6=para1_end, 7=para1_close,
    //   8=para2_start, 9-14=Second, 15=para2_close, etc.
    // Insert 'X' at position 14 (after "Secon" in "Second")
    const doc2 = applyTextInsert(doc1, 14, 'X');

    const range = computeDirtyRange(cache, doc2);
    expect(range).not.toBeNull();
    // Only the middle paragraph should be dirty
    expect(range!.dirtyFrom).toBeLessThanOrEqual(1);
    expect(range!.dirtyTo).toBeGreaterThanOrEqual(2);
  });

  test('detects change at beginning via transaction', () => {
    const doc1 = makeDoc({ text: 'Alpha' }, { text: 'Beta' });
    const blocks1 = toFlowBlocks(doc1, defaultOpts);
    saveBlockState(cache, doc1, blocks1, []);

    // Insert at beginning of first paragraph
    const doc2 = applyTextInsert(doc1, 1, 'X');
    const range = computeDirtyRange(cache, doc2);
    expect(range).not.toBeNull();
    expect(range!.dirtyFrom).toBe(0);
  });

  test('detects deletion via transaction', () => {
    const doc1 = makeDoc({ text: 'First' }, { text: 'Second' }, { text: 'Third' });
    const blocks1 = toFlowBlocks(doc1, defaultOpts);
    saveBlockState(cache, doc1, blocks1, []);

    // Delete a character from the middle paragraph
    const doc2 = applyTextDelete(doc1, 9, 10);
    const range = computeDirtyRange(cache, doc2);
    expect(range).not.toBeNull();
  });

  test('returns null when section break in dirty range', () => {
    const doc1 = makeDoc(
      { text: 'Before section' },
      {
        text: 'Section end',
        attrs: {
          _sectionProperties: { sectionStart: 'nextPage' },
        },
      },
      { text: 'After section' }
    );
    const blocks1 = toFlowBlocks(doc1, defaultOpts);
    saveBlockState(cache, doc1, blocks1, []);

    // Modify the paragraph that has the section break (insert into node 1)
    // Node 0 ends at pos 16 (1 + 14 + 1), node 1 starts at 16
    // Insert inside node 1's text
    const doc2 = applyTextInsert(doc1, 17, 'X');

    const range = computeDirtyRange(cache, doc2);
    // Should return null because section break is in dirty range
    expect(range).toBeNull();
  });
});

// =============================================================================
// updateBlocks
// =============================================================================

describe('updateBlocks', () => {
  test('incremental update matches full conversion for single-char edit', () => {
    const cache = createIncrementalBlockCache();
    const doc1 = makeDoc(
      { text: 'First paragraph' },
      { text: 'Second paragraph' },
      { text: 'Third paragraph' }
    );
    const blocks1 = toFlowBlocks(doc1, defaultOpts);
    saveBlockState(cache, doc1, blocks1, []);

    // Insert a character into the middle paragraph via transaction
    const doc2 = applyTextInsert(doc1, 24, '!');

    const range = computeDirtyRange(cache, doc2);
    expect(range).not.toBeNull();

    const incrementalBlocks = updateBlocks(
      cache,
      doc2,
      range!.dirtyFrom,
      range!.dirtyTo,
      defaultOpts
    );
    const fullBlocks = toFlowBlocks(doc2, defaultOpts);

    expect(incrementalBlocks.blocks.length).toBe(fullBlocks.length);
    for (let i = 0; i < fullBlocks.length; i++) {
      expect(incrementalBlocks.blocks[i].kind).toBe(fullBlocks[i].kind);
    }
  });
});

// =============================================================================
// reindexPositions
// =============================================================================

describe('reindexPositions', () => {
  test('shifts pmStart/pmEnd by positive delta', () => {
    const blocks: ParagraphBlock[] = [
      {
        kind: 'paragraph',
        id: 'b1',
        runs: [{ kind: 'text', text: 'Hello', pmStart: 10, pmEnd: 15 }],
        attrs: {},
        pmStart: 10,
        pmEnd: 16,
      },
      {
        kind: 'paragraph',
        id: 'b2',
        runs: [{ kind: 'text', text: 'World', pmStart: 20, pmEnd: 25 }],
        attrs: {},
        pmStart: 20,
        pmEnd: 26,
      },
    ];

    reindexPositions(blocks, 1, 5);

    // First block unchanged
    expect(blocks[0].pmStart).toBe(10);
    expect(blocks[0].pmEnd).toBe(16);
    // Second block shifted
    expect(blocks[1].pmStart).toBe(25);
    expect(blocks[1].pmEnd).toBe(31);
    // Run in second block also shifted
    expect(blocks[1].runs[0].pmStart).toBe(25);
    expect(blocks[1].runs[0].pmEnd).toBe(30);
  });

  test('shifts by negative delta', () => {
    const blocks: ParagraphBlock[] = [
      {
        kind: 'paragraph',
        id: 'b1',
        runs: [{ kind: 'text', text: 'Hello', pmStart: 20, pmEnd: 25 }],
        attrs: {},
        pmStart: 20,
        pmEnd: 26,
      },
    ];

    reindexPositions(blocks, 0, -5);

    expect(blocks[0].pmStart).toBe(15);
    expect(blocks[0].pmEnd).toBe(21);
  });

  test('handles pageBreak blocks', () => {
    const blocks: PageBreakBlock[] = [
      {
        kind: 'pageBreak',
        id: 'pb1',
        pmStart: 50,
        pmEnd: 51,
      },
    ];

    reindexPositions(blocks, 0, 10);

    expect(blocks[0].pmStart).toBe(60);
    expect(blocks[0].pmEnd).toBe(61);
  });
});

// =============================================================================
// snapshotListCounters
// =============================================================================

describe('snapshotListCounters', () => {
  test('creates independent deep clone', () => {
    const original = new Map<number, number[]>();
    original.set(1, [1, 0, 0, 0, 0, 0, 0, 0, 0]);
    original.set(2, [3, 2, 0, 0, 0, 0, 0, 0, 0]);

    const snapshot = snapshotListCounters(original);

    // Values should match
    expect(snapshot.get(1)).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(snapshot.get(2)).toEqual([3, 2, 0, 0, 0, 0, 0, 0, 0]);

    // Mutating original should not affect snapshot
    original.get(1)![0] = 99;
    original.set(3, [1, 0, 0, 0, 0, 0, 0, 0, 0]);

    expect(snapshot.get(1)).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(snapshot.has(3)).toBe(false);
  });
});

// =============================================================================
// rebuildIndices
// =============================================================================

describe('rebuildIndices', () => {
  test('maps node indices to block ranges correctly', () => {
    const cache = createIncrementalBlockCache();
    const doc = makeDoc(
      { text: 'Para 1' },
      {
        text: 'Section end',
        attrs: { _sectionProperties: { sectionStart: 'nextPage' } },
      },
      { text: 'Para 3' }
    );
    const blocks = toFlowBlocks(doc, defaultOpts);
    cache.blocks = blocks;

    rebuildIndices(cache, doc);

    // Node 0 → 1 block (paragraph)
    expect(cache.nodeToBlockRange.get(0)).toEqual([0, 1]);
    // Node 1 → 2 blocks (paragraph + sectionBreak)
    expect(cache.nodeToBlockRange.get(1)).toEqual([1, 3]);
    // Node 2 → 1 block (paragraph)
    expect(cache.nodeToBlockRange.get(2)).toEqual([3, 4]);

    // Section break should be tracked
    expect(cache.sectionBreakIndices).toContain(2);
  });

  test('handles document with only plain paragraphs', () => {
    const cache = createIncrementalBlockCache();
    const doc = makeDoc({ text: 'A' }, { text: 'B' }, { text: 'C' });
    const blocks = toFlowBlocks(doc, defaultOpts);
    cache.blocks = blocks;

    rebuildIndices(cache, doc);

    expect(cache.nodeToBlockRange.size).toBe(3);
    expect(cache.sectionBreakIndices).toEqual([]);
  });
});

// =============================================================================
// saveBlockState
// =============================================================================

describe('saveBlockState', () => {
  test('persists doc, blocks, and measures', () => {
    const cache = createIncrementalBlockCache();
    const doc = makeDoc({ text: 'Hello' });
    const blocks = toFlowBlocks(doc, defaultOpts);

    saveBlockState(cache, doc, blocks, []);

    expect(cache.prevDoc).toBe(doc);
    expect(cache.blocks).toBe(blocks);
    expect(cache.measures).toEqual([]);
    expect(cache.nodeToBlockRange.size).toBe(1);
  });
});
