/**
 * Per-section column geometry helpers — twips→px, section-property →
 * `ColumnLayout`, and the per-block width array that `measureBlocks`
 * needs when a document changes columns mid-flow.
 */

import { collectSectionConfigs } from '@eigenpal/docx-editor-core/layout-engine';
import type {
  ColumnLayout,
  FlowBlock,
  SectionLayoutConfig,
} from '@eigenpal/docx-editor-core/layout-engine';
import type { SectionProperties } from '@eigenpal/docx-editor-core/types/document';

/**
 * Convert twips to pixels (1 twip = 1/20 point, 96 pixels per inch).
 */
export function twipsToPixels(twips: number): number {
  return Math.round((twips / 1440) * 96);
}

/**
 * Extract column layout from section properties.
 * Returns undefined for single-column (default) to avoid unnecessary pageComposer overhead.
 */
export function getColumns(
  sectionProps: SectionProperties | null | undefined
): ColumnLayout | undefined {
  const count = sectionProps?.columnCount ?? 1;
  if (count <= 1) return undefined;
  // Default column spacing: 720 twips (0.5 inch) per OOXML spec
  const gap = twipsToPixels(sectionProps?.columnSpace ?? 720);
  return {
    count,
    gap,
    equalWidth: sectionProps?.equalWidth ?? true,
    separator: sectionProps?.separator,
  };
}

export function columnWidthForSection(config: SectionLayoutConfig): number {
  const contentWidth = config.pageSize.w - config.margins.left - config.margins.right;
  const cols = config.columns;
  if (!cols || cols.count <= 1) return contentWidth;
  return Math.floor((contentWidth - (cols.count - 1) * cols.gap) / cols.count);
}

/**
 * Compute per-block measurement widths by scanning for section breaks.
 * Blocks must be measured with the page width/margins/columns of their own
 * section so that the layout engine can paginate them against the right
 * geometry without remeasuring.
 */
export function computePerBlockWidths(
  blocks: FlowBlock[],
  initialConfig: SectionLayoutConfig,
  finalConfig: SectionLayoutConfig
): number[] {
  const { configs: sectionConfigs, breakIndices } = collectSectionConfigs(
    blocks,
    initialConfig,
    finalConfig
  );

  let sectionIdx = 0;
  const widths: number[] = [];

  for (let i = 0; i < blocks.length; i++) {
    widths.push(columnWidthForSection(sectionConfigs[sectionIdx] ?? initialConfig));

    if (sectionIdx < breakIndices.length && i === breakIndices[sectionIdx]) {
      sectionIdx++;
    }
  }

  return widths;
}
