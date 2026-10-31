// The structure of a table whose autofit columns widened past the widths it was read with.

import { retargetSharedGridLineSideRules } from './legacy-table-side-rules.ts';
import type { SemanticTableStructure } from './semantic-table.ts';

/**
 * Widened structures per base, by their widths. Readers that widen one base differently (two
 * measurers, two field contexts) keep separate entries instead of evicting each other.
 */
const widenedStructureMemos = new WeakMap<
  SemanticTableStructure,
  Map<string, SemanticTableStructure>
>();
const MAX_WIDENED_PER_BASE = 4;

/** `base` at the autofit `widths`, its shared grid line side rules moved with them. */
export function widenedTableStructure(
  base: SemanticTableStructure,
  widths: readonly number[],
  context: {
    readonly compatibilityMode: number | undefined;
    readonly depth: number;
    readonly contentWidthPt: number;
  }
): SemanticTableStructure {
  const widthsKey = widths.join(',');
  let widened = widenedStructureMemos.get(base);
  const known = widened?.get(widthsKey);
  if (known) return known;
  const sideRules = retargetSharedGridLineSideRules(
    base.rows,
    {
      compatibilityMode: context.compatibilityMode,
      depth: context.depth,
      bidiVisual: base.bidiVisual === true,
      floating: base.float !== undefined,
      cellSpacingPt: base.cellSpacingPt,
      widthType: base.tableWidth.type,
      ...(base.tableWidth.type === 'dxa' ? { statedWidthPt: base.tableWidth.value } : {}),
      // The structure stores the visual alignment; side rules take the authored one.
      alignment: base.bidiVisual ? mirroredAlignment(base.alignment) : base.alignment,
      layoutFixed: base.layoutFixed,
      indentPt: base.indentPt,
      columnWidthsPt: base.columnWidthsPt,
      containerWidthPt: context.contentWidthPt,
    },
    widths
  );
  // A legacy content-edge offset does not depend on the widths; other offsets move with them.
  const { outerRuleOffsetPt: _previousOffset, ...unchanged } = base;
  const offset = base.legacyContentOffsetPt ?? sideRules.outerRuleOffsetPt;
  const structure: SemanticTableStructure = {
    ...unchanged,
    columnWidthsPt: widths,
    rows: sideRules.rows,
    ...(offset === undefined ? {} : { outerRuleOffsetPt: offset }),
  };
  if (!widened) widenedStructureMemos.set(base, (widened = new Map()));
  if (widened.size >= MAX_WIDENED_PER_BASE) widened.delete(widened.keys().next().value!);
  widened.set(widthsKey, structure);
  return structure;
}

function mirroredAlignment(alignment: SemanticTableStructure['alignment']) {
  return alignment === 'left' ? 'right' : alignment === 'right' ? 'left' : alignment;
}
