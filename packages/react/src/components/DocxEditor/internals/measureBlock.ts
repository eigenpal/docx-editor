/**
 * Block-measurement pipeline for PagedEditor — paragraph/table/image/
 * textBox measurement + the floating-image exclusion-zone pre-scan that
 * lets paragraphs flow around anchored images and floating tables.
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
  ImageRun,
  Measure,
  ParagraphBlock,
  TableBlock,
  TableMeasure,
  TextBoxBlock,
} from '@eigenpal/docx-editor-core/layout-engine';
import {
  type FloatingImageZone,
  getCachedParagraphMetrics,
  paragraphLayout,
  measureTable,
  setCachedParagraphMetrics,
} from '@eigenpal/docx-editor-core/layout-bridge';
import { emuToPixels } from '@eigenpal/docx-editor-core/utils';
import { isTextWrappingFloatingImageRun } from '@eigenpal/docx-editor-core/layout-painter';

/**
 * Extended floating zone info that includes anchor block index.
 */
interface FloatingZoneWithAnchor extends FloatingImageZone {
  /** Block index where this floating image is anchored */
  anchorBlockIndex: number;
  /** If true, zone is positioned relative to margin/page and applies to all blocks */
  isMarginRelative?: boolean;
}

/**
 * Extract floating image exclusion zones from all blocks.
 * Called before measurement to determine line width reductions.
 *
 * For images with vertical align="top" relative to margin, they're at Y=0.
 * The exclusion zones define the areas where text lines need reduced widths.
 */
function extractFloatingZones(blocks: FlowBlock[], contentWidth: number): FloatingZoneWithAnchor[] {
  const zones: FloatingZoneWithAnchor[] = [];

  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
    const block = blocks[blockIndex];
    if (block.kind !== 'paragraph') continue;

    const paragraphBlock = block as ParagraphBlock;

    for (const run of paragraphBlock.runs) {
      if (run.kind !== 'image') continue;
      const imgRun = run as ImageRun;

      if (!isTextWrappingFloatingImageRun(imgRun)) continue;

      // Calculate Y position based on vertical alignment
      let topY = 0;
      const position = imgRun.position;
      const distTop = imgRun.distTop ?? 0;
      const distBottom = imgRun.distBottom ?? 0;
      const distLeft = imgRun.distLeft ?? 12;
      const distRight = imgRun.distRight ?? 12;

      if (position?.vertical) {
        const v = position.vertical;
        if (v.align === 'top' && v.relativeTo === 'margin') {
          // Image at top of content area
          topY = 0;
        } else if (v.posOffset !== undefined) {
          topY = emuToPixels(v.posOffset);
        }
        // Other cases (paragraph-relative) are harder to handle without knowing paragraph positions
      }

      const bottomY = topY + imgRun.height;

      // Calculate margins based on horizontal position
      let leftMargin = 0;
      let rightMargin = 0;

      if (position?.horizontal) {
        const h = position.horizontal;
        if (h.align === 'left') {
          // Image on left - text needs left margin
          leftMargin = imgRun.width + distRight;
        } else if (h.align === 'right') {
          // Image on right - text needs right margin
          rightMargin = imgRun.width + distLeft;
        } else if (h.posOffset !== undefined) {
          const x = emuToPixels(h.posOffset);
          if (x < contentWidth / 2) {
            leftMargin = x + imgRun.width + distRight;
          } else {
            rightMargin = contentWidth - x + distLeft;
          }
        }
      } else if (imgRun.cssFloat === 'left') {
        leftMargin = imgRun.width + distRight;
      } else if (imgRun.cssFloat === 'right') {
        rightMargin = imgRun.width + distLeft;
      }

      if (leftMargin > 0 || rightMargin > 0) {
        // Images positioned relative to margin/page apply globally (before their anchor paragraph)
        const isMarginRelative =
          position?.vertical?.relativeTo === 'margin' || position?.vertical?.relativeTo === 'page';
        zones.push({
          leftMargin,
          rightMargin,
          topY: topY - distTop,
          bottomY: bottomY + distBottom,
          anchorBlockIndex: blockIndex,
          isMarginRelative,
        });
      }
    }
  }

  // Floating tables (block-level) - treat them as exclusion zones for subsequent text
  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
    const block = blocks[blockIndex];
    if (block.kind !== 'table') continue;

    const tableBlock = block as TableBlock;
    const floating = tableBlock.floating;
    if (!floating) continue;

    const tableMeasure = measureTable(tableBlock, contentWidth, measureBlock);
    const tableWidth = tableMeasure.totalWidth;
    const tableHeight = tableMeasure.totalHeight;

    const distLeft = floating.leftFromText ?? 12;
    const distRight = floating.rightFromText ?? 12;
    const distTop = floating.topFromText ?? 0;
    const distBottom = floating.bottomFromText ?? 0;

    let leftMargin = 0;
    let rightMargin = 0;

    // Determine horizontal position relative to content area
    let x = 0;
    if (floating.tblpX !== undefined) {
      x = floating.tblpX;
    } else if (floating.tblpXSpec) {
      if (floating.tblpXSpec === 'left' || floating.tblpXSpec === 'inside') {
        x = 0;
      } else if (floating.tblpXSpec === 'right' || floating.tblpXSpec === 'outside') {
        x = contentWidth - tableWidth;
      } else if (floating.tblpXSpec === 'center') {
        x = (contentWidth - tableWidth) / 2;
      }
    } else if (tableBlock.justification === 'center') {
      x = (contentWidth - tableWidth) / 2;
    } else if (tableBlock.justification === 'right') {
      x = contentWidth - tableWidth;
    }

    if (x < contentWidth / 2) {
      leftMargin = x + tableWidth + distRight;
    } else {
      rightMargin = contentWidth - x + distLeft;
    }

    const topY = floating.tblpY ?? 0;
    const bottomY = topY + tableHeight;

    zones.push({
      leftMargin,
      rightMargin,
      topY: topY - distTop,
      bottomY: bottomY + distBottom,
      anchorBlockIndex: blockIndex,
    });
  }

  return zones;
}

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
 * Measure all blocks with floating image support.
 *
 * Pre-scans all blocks to find floating images and creates exclusion zones.
 * Then measures each block, passing the zones so paragraphs can calculate
 * per-line widths based on vertical overlap with floating images.
 */
export function measureBlocks(blocks: FlowBlock[], contentWidth: number | number[]): Measure[] {
  const defaultWidth = Array.isArray(contentWidth) ? (contentWidth[0] ?? 0) : contentWidth;
  // Pre-extract floating image exclusion zones with anchor block indices
  const floatingZonesWithAnchors = extractFloatingZones(blocks, defaultWidth);

  // Margin-relative zones (positioned relative to page/margin) on the same vertical
  // position are likely on the same page. Group them and activate all from the earliest
  // anchor so text wraps around ALL images from the first paragraph onward.
  // e.g. left-aligned and right-aligned images at margin top should both affect text
  // starting from the first anchor paragraph, not just the one containing each image.
  const marginRelative = floatingZonesWithAnchors.filter((z) => z.isMarginRelative);
  const paragraphRelative = floatingZonesWithAnchors.filter((z) => !z.isMarginRelative);

  // Group margin-relative zones by topY and move all to earliest anchor in group
  const marginByTopY = new Map<number, FloatingZoneWithAnchor[]>();
  for (const z of marginRelative) {
    const group = marginByTopY.get(z.topY) ?? [];
    group.push(z);
    marginByTopY.set(z.topY, group);
  }

  const adjustedZones: FloatingZoneWithAnchor[] = [...paragraphRelative];
  for (const group of marginByTopY.values()) {
    const minAnchor = Math.min(...group.map((z) => z.anchorBlockIndex));
    for (const z of group) {
      adjustedZones.push({ ...z, anchorBlockIndex: minAnchor });
    }
  }

  // Group zones by effective anchor block index
  const zonesByAnchor = new Map<number, FloatingImageZone[]>();
  for (const z of adjustedZones) {
    const existing = zonesByAnchor.get(z.anchorBlockIndex) ?? [];
    existing.push({
      leftMargin: z.leftMargin,
      rightMargin: z.rightMargin,
      topY: z.topY,
      bottomY: z.bottomY,
    });
    zonesByAnchor.set(z.anchorBlockIndex, existing);
  }

  const anchorIndices = new Set(adjustedZones.map((z) => z.anchorBlockIndex));

  // Track cumulative Y position for floating zone overlap calculation
  // Resets when we reach a block with floating images (establishing local page coords)
  let cumulativeY = 0;
  let activeZones: FloatingImageZone[] = [];

  return blocks.map((block, blockIndex) => {
    // Check if this block is an anchor for floating images
    // If so, reset cumulative Y and replace active zones (old zones from previous
    // anchors are invalid after the Y reset since their topY/bottomY are in the old
    // coordinate system)
    if (anchorIndices.has(blockIndex)) {
      cumulativeY = 0;
      activeZones = zonesByAnchor.get(blockIndex) ?? [];
    }

    const zones = activeZones.length > 0 ? activeZones : undefined;

    try {
      const blockStart = performance.now();
      const blockWidth = Array.isArray(contentWidth)
        ? (contentWidth[blockIndex] ?? defaultWidth)
        : contentWidth;
      const measure = measureBlock(block, blockWidth, zones, cumulativeY);
      const blockTime = performance.now() - blockStart;
      if (blockTime > 500) {
        console.warn(
          `[measureBlocks] Block ${blockIndex} (${block.kind}) took ${Math.round(blockTime)}ms`
        );
      }

      // Update cumulative Y for next block
      if ('totalHeight' in measure) {
        if (!(block.kind === 'table' && (block as TableBlock).floating)) {
          cumulativeY += measure.totalHeight;
        }
      }

      return measure;
    } catch (error) {
      console.error(`[measureBlocks] Error measuring block ${blockIndex} (${block.kind}):`, error);
      // Return a minimal measure so we don't crash the entire layout
      return { totalHeight: 20 } as Measure;
    }
  });
}

// TableMeasure used internally above; re-exported for tests that compare types.
export type { TableMeasure };
