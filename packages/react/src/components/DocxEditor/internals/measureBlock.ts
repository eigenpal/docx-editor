/**
 * Node-measurement pipeline for PagedEditor — paragraph/table/image/
 * textBox measurement. The floating-zone pre-scan + per-node cumulative-Y
 * orchestration lives in core's `measureBlocksWithFloats` so React and Vue
 * stay in lockstep.
 *
 * `measureBlock` contains the ContentNode exhaustiveness switch. The
 * `assertExhaustiveContentNode(node, 'react PagedEditor measureBlock')`
 * call at the default branch is one of three sites that fail typecheck
 * with a `never` mismatch when a new ContentNode variant is added — see
 * the ContentNode invariant note in CLAUDE.md.
 */

import {
  DEFAULT_TEXTBOX_MARGINS,
  DEFAULT_TEXTBOX_WIDTH,
  assertExhaustiveContentNode,
} from '@eigenpal/docx-editor-core/pagination-model';
import type {
  ContentNode,
  ImageBlock,
  LayoutMetrics,
  ParagraphBlock,
  TableBlock,
  TableMetrics,
  TextBoxBlock,
} from '@eigenpal/docx-editor-core/pagination-model';
import {
  type FloatingImageZone,
  type FloatPageGeometry,
  floatZoneKey,
  getCachedParagraphMetrics,
  measureBlocksWithFloats,
  paragraphLayout,
  measureTable,
  setCachedParagraphMetrics,
} from '@eigenpal/docx-editor-core/flow-model';

/**
 * Measure a block based on its type.
 */
export function measureBlock(
  node: ContentNode,
  contentWidth: number,
  floatingZones?: FloatingImageZone[],
  cumulativeY?: number
): LayoutMetrics {
  switch (node.kind) {
    case 'paragraph': {
      const paragraphNode = node as ParagraphBlock;

      // Cache paragraph measurements when no floating zones affect this block.
      // Safe because without floating zones the result depends only on content
      // and contentWidth (both captured in the cache key). When floating zones
      // ARE present, we always measure fresh since zones depend on inter-block
      // layout context (cumulative Y, neighboring floating tables/images).
      //
      // The float context is part of the cache key, not a reason to skip the
      // cache: the same paragraph beside an image and below it are different
      // layouts, and `floatZoneKey` is what keeps them apart.
      const floatKey = floatZoneKey(floatingZones ?? [], cumulativeY ?? 0);

      const cached = getCachedParagraphMetrics(paragraphNode, contentWidth, floatKey);
      if (cached) return cached;

      const result = paragraphLayout(paragraphNode, contentWidth, {
        floatingZones,
        paragraphYOffset: cumulativeY ?? 0,
      });

      setCachedParagraphMetrics(paragraphNode, contentWidth, result, floatKey);

      return result;
    }

    case 'table': {
      return measureTable(node as TableBlock, contentWidth, measureBlock);
    }

    case 'image': {
      const imageNode = node as ImageBlock;
      return {
        kind: 'image',
        width: imageNode.width ?? 100,
        height: imageNode.height ?? 100,
      };
    }

    case 'textBox': {
      const tb = node as TextBoxBlock;
      const margins = tb.margins ?? DEFAULT_TEXTBOX_MARGINS;
      const innerWidth = (tb.width ?? DEFAULT_TEXTBOX_WIDTH) - margins.left - margins.right;
      const innerMetrics = tb.content.map((p) => paragraphLayout(p, innerWidth));
      const contentHeight = innerMetrics.reduce((sum, metric) => sum + metric.totalHeight, 0);
      const totalHeight = tb.height ?? contentHeight + margins.top + margins.bottom;
      return {
        kind: 'textBox' as const,
        width: tb.width ?? DEFAULT_TEXTBOX_WIDTH,
        height: totalHeight,
        innerMetrics,
      };
    }

    case 'pageBreak':
      return { kind: 'pageBreak' };

    case 'columnBreak':
      return { kind: 'columnBreak' };

    case 'sectionBreak':
      return { kind: 'sectionBreak' };

    default:
      // Exhaustiveness guard — see ContentNode in core/pagination-model/types.ts.
      assertExhaustiveContentNode(node, 'react PagedEditor measureBlock');
  }
}

/**
 * Measure all nodes with floating-image support. Pre-scans for anchored
 * images, floating tables, and floating textboxes, then threads the
 * exclusion zones plus cumulative Y into each per-node measurement.
 */
export function measureBlocks(
  nodes: ContentNode[],
  contentWidth: number | number[],
  pageGeometry?: FloatPageGeometry,
  finalPageGeometry?: FloatPageGeometry
): Measure[] {
  return measureBlocksWithFloats(
    blocks,
    contentWidth,
    measureBlock,
    pageGeometry,
    finalPageGeometry
  );
}

// TableMetrics used internally above; re-exported for tests that compare types.
export type { TableMetrics };
