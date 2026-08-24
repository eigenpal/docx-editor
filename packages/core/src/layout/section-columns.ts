import { twips, twipsToPoints } from '@docx-editor.dev/core/store';
import type { SectionColumns } from './section-properties.ts';

export interface ResolvedSectionColumns {
  readonly count: number;
  readonly widths: readonly number[];
  readonly gaps: readonly number[];
  readonly lefts: readonly number[];
  readonly separator: boolean;
}

const MIN_COLUMN_WIDTH_PT = 1;

/**
 * Resolve bounded OOXML column declarations into content-box-relative point geometry.
 *
 * Incomplete unequal-width declarations fall back as a unit. Mixing authored and invented
 * widths would move every later column to an arbitrary x position and can overlap content.
 */
export function resolveSectionColumns(
  columns: SectionColumns,
  contentWidth: number
): ResolvedSectionColumns {
  const width = Math.max(MIN_COLUMN_WIDTH_PT, contentWidth);
  const count = Math.max(1, Math.min(12, Math.floor(columns.count)));
  const definitions = columns.definitions ?? [];
  const completeUnequal =
    columns.equalWidth === false &&
    definitions.length === count &&
    definitions.every((definition) => definition.widthTwips > 0);

  let widths: number[];
  let gaps: number[];
  if (completeUnequal) {
    widths = definitions.map((definition) =>
      Math.max(MIN_COLUMN_WIDTH_PT, twipsToPoints(twips(definition.widthTwips)))
    );
    gaps = definitions
      .slice(0, -1)
      .map((definition) => Math.max(0, twipsToPoints(twips(definition.gapTwips))));
    const gapTotal = gaps.reduce((sum, gap) => sum + gap, 0);
    const availableForWidths = Math.max(count * MIN_COLUMN_WIDTH_PT, width - gapTotal);
    const statedWidth = widths.reduce((sum, columnWidth) => sum + columnWidth, 0);
    if (statedWidth > availableForWidths) {
      const scale = availableForWidths / statedWidth;
      widths = widths.map((columnWidth) => Math.max(MIN_COLUMN_WIDTH_PT, columnWidth * scale));
    }
  } else {
    const requestedGap = Math.max(0, twipsToPoints(twips(columns.gapTwips)));
    const gap = Math.min(
      requestedGap,
      Math.max(0, (width - count * MIN_COLUMN_WIDTH_PT) / (count - 1 || 1))
    );
    gaps = Array.from({ length: Math.max(0, count - 1) }, () => gap);
    const columnWidth = Math.max(
      MIN_COLUMN_WIDTH_PT,
      (width - gaps.reduce((sum, value) => sum + value, 0)) / count
    );
    widths = Array.from({ length: count }, () => columnWidth);
  }

  const lefts: number[] = [];
  let left = 0;
  for (let index = 0; index < count; index += 1) {
    lefts.push(left);
    left += widths[index]! + (gaps[index] ?? 0);
  }

  return {
    count,
    widths,
    gaps,
    lefts,
    separator: columns.separator === true && count > 1,
  };
}
