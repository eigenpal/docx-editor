/**
 * Block-measurement pipeline for PagedEditor — paragraph/table/image/
 * textBox measurement. The floating-zone pre-scan + per-block cumulative-Y
 * orchestration lives in core's `measureBlocksWithFloats` so React and Vue
 * stay in lockstep.
 *
 * `measureBlock` contains the FlowBlock exhaustiveness switch. The
 * `assertExhaustiveFlowBlock(block, 'react PagedEditor measureBlock')`
 * call at the default branch is one of three sites that fail typecheck
 * with a `never` mismatch when a new FlowBlock variant is added — see
 * the FlowBlock invariant note in CLAUDE.md.
 */

import {
  DEFAULT_TEXTBOX_MARGINS,
  DEFAULT_TEXTBOX_WIDTH,
  assertExhaustiveFlowBlock,
} from '@eigenpal/docx-editor-core/layout-engine';
import type {
  FlowBlock,
  ImageBlock,
  Measure,
  ParagraphBlock,
  TableBlock,
  TableMeasure,
  TextBoxBlock,
} from '@eigenpal/docx-editor-core/layout-engine';
import {
  type FloatingImageZone,
  getCachedParagraphMetrics,
  measureBlocksWithFloats,
  paragraphLayout,
  measureTable,
  setCachedParagraphMetrics,
} from '@eigenpal/docx-editor-core/layout-bridge';

/**
 * Measure a block based on its type.
 */
export function measureBlock(
  block: FlowBlock,
  contentWidth: number,
  floatingZones?: FloatingImageZone[],
  cumulativeY?: number
): Measure {
  switch (block.kind) {
    case 'paragraph': {
      const pBlock = block as ParagraphBlock;

      // Cache paragraph measurements when no floating zones affect this block.
      // Safe because without floating zones the result depends only on content
      // and contentWidth (both captured in the cache key). When floating zones
      // ARE present, we always measure fresh since zones depend on inter-block
      // layout context (cumulative Y, neighboring floating tables/images).
      if (!floatingZones || floatingZones.length === 0) {
        const cached = getCachedParagraphMetrics(pBlock, contentWidth);
        if (cached) return cached;
      }

      const result = paragraphLayout(pBlock, contentWidth, {
        floatingZones,
        paragraphYOffset: cumulativeY ?? 0,
      });

      if (!floatingZones || floatingZones.length === 0) {
        setCachedParagraphMetrics(pBlock, contentWidth, result);
      }

      return result;
    }

    case 'table': {
      return measureTable(block as TableBlock, contentWidth, measureBlock);
    }

    case 'image': {
      const imageBlock = block as ImageBlock;
      return {
        kind: 'image',
        width: imageBlock.width ?? 100,
        height: imageBlock.height ?? 100,
      };
    }

    case 'textBox': {
      const tb = block as TextBoxBlock;
      const margins = tb.margins ?? DEFAULT_TEXTBOX_MARGINS;
      const innerWidth = (tb.width ?? DEFAULT_TEXTBOX_WIDTH) - margins.left - margins.right;
      const innerMeasures = tb.content.map((p) => paragraphLayout(p, innerWidth));
      const contentHeight = innerMeasures.reduce((sum, m) => sum + m.totalHeight, 0);
      const totalHeight = tb.height ?? contentHeight + margins.top + margins.bottom;
      return {
        kind: 'textBox' as const,
        width: tb.width ?? DEFAULT_TEXTBOX_WIDTH,
        height: totalHeight,
        innerMeasures,
      };
    }

    case 'pageBreak':
      return { kind: 'pageBreak' };

    case 'columnBreak':
      return { kind: 'columnBreak' };

    case 'sectionBreak':
      return { kind: 'sectionBreak' };

    default:
      // Exhaustiveness guard — see FlowBlock in core/layout-engine/types.ts.
      assertExhaustiveFlowBlock(block, 'react PagedEditor measureBlock');
  }
}

/**
 * Measure all blocks with floating-image support. Pre-scans for anchored
 * images, floating tables, and floating textboxes, then threads the
 * exclusion zones plus cumulative Y into each per-block measurement.
 */
export function measureBlocks(blocks: FlowBlock[], contentWidth: number | number[]): Measure[] {
  return measureBlocksWithFloats(blocks, contentWidth, measureBlock);
}

// TableMeasure used internally above; re-exported for tests that compare types.
export type { TableMeasure };
