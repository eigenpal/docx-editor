// The box a top-level table's width resolves against, and the indent that places it, before the
// columns are resolved. Three compatibility behaviors meet here:
//
// - older modes measure a percentage, or a table without a usable width, against the text
//   column plus the outer cell margins, and align the content of the outer cells with the text
//   edge (`legacyTableContentWidth`);
// - outside that box, a percentage excludes the mean outer side rule (`ruleAdjustedTableWidth`);
// - an AutoFit table without a width fits the room its leading indent leaves, and a nested
//   one in the older modes also the room of its outer cell margins.
import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';
import {
  legacyNestedAutoRoomPt,
  legacyRoundedCellClaims,
  legacyTableContentWidth,
  textBoxLegacyContentWidth,
  type LegacyTableContentWidth,
} from './legacy-table-content-width.ts';
import type { SemanticTableRow, TableAlignment } from './semantic-table.ts';
import type { TableBorderBox, TableBorderSide } from './table-borders.ts';
import type { CellWidthClaim, PreferredWidth } from './table-widths.ts';

/** The painted width of a simple outer side rule; other rules have no captured geometry. */
function simpleRulePt(side: TableBorderSide): number {
  if (side.state !== 'edge' || (side.style !== 'single' && side.style !== 'thick')) return 0;
  return Number.isFinite(side.widthPt) && side.widthPt > 0 ? side.widthPt : 0;
}

/** The painted widths of a table's two visual outer side rules, where they are simple. */
function outerSideRulesPt(
  borders: TableBorderBox,
  rows: readonly SemanticTableRow[],
  bidiVisual: boolean
): { readonly left: number; readonly right: number } {
  // Cells and table borders are in document order, so a right-to-left table's visual left
  // side is the trailing side of its last cell. The outer cells' own rules replace the
  // table's, as they do when the table paints.
  const cells = rows[0]?.cells ?? [];
  const visualLeft = bidiVisual ? cells.at(-1)?.borders.right : cells[0]?.borders.left;
  const visualRight = bidiVisual ? cells[0]?.borders.left : cells.at(-1)?.borders.right;
  const tableLeft = bidiVisual ? borders.right : borders.left;
  const tableRight = bidiVisual ? borders.left : borders.right;
  const left = !visualLeft || visualLeft.state === 'omitted' ? tableLeft : visualLeft;
  const right = !visualRight || visualRight.state === 'omitted' ? tableRight : visualRight;
  return { left: simpleRulePt(left), right: simpleRulePt(right) };
}

/**
 * A table percentage resolved against a box whose outer side rules sit outside the share.
 *
 * Outside the legacy reference box, a percentage is a share of the container less the mean
 * outer side rule, and the table then adds that rule back: `p × (container − rule) + rule`.
 * At 100% this is the container itself; above or below, the result moves by the rule times
 * the distance from 100%. The returned preference states that width as a share of the
 * container, so the width resolver needs no other change.
 */
export function ruleAdjustedTableWidth(
  tableWidth: PreferredWidth,
  containerWidthPt: number,
  borders: TableBorderBox,
  rows: readonly SemanticTableRow[],
  bidiVisual = false
): PreferredWidth {
  // At 100% the share is the container itself, whatever the rules.
  if (tableWidth.type !== 'pct' || tableWidth.value === 100 || !(containerWidthPt > 0))
    return tableWidth;
  const sides = outerSideRulesPt(borders, rows, bidiVisual);
  const rule = (sides.left + sides.right) / 2;
  if (!(rule > 0) || rule >= containerWidthPt) return tableWidth;
  const widthPt = (tableWidth.value / 100) * (containerWidthPt - rule) + rule;
  return { type: 'pct', value: (widthPt / containerWidthPt) * 100 };
}

export interface TableWidthPlacement {
  readonly legacy: LegacyTableContentWidth | undefined;
  /** The width preference the column resolver reads. */
  readonly tableWidth: PreferredWidth;
  /** The box the column resolver measures against. */
  readonly contentWidthPt: number;
  readonly claims: readonly CellWidthClaim[];
  /** The indent that places the table. */
  readonly indentPt: number;
  /** How far a right-to-left table moves from its aligned place, in points. */
  readonly bidiRuleShiftPt?: number;
}

export function resolveTableWidthPlacement(input: {
  readonly table: OoxmlElement;
  readonly propertyNodes: readonly OoxmlElement[];
  readonly rows: readonly SemanticTableRow[];
  readonly columnCount: number;
  readonly contentWidthPt: number;
  readonly compatibilityMode: number | undefined;
  readonly depth: number;
  readonly tableWidth: PreferredWidth;
  readonly cellSpacingPt: number;
  readonly floating: boolean;
  readonly layoutFixed: boolean;
  readonly alignment: TableAlignment;
  readonly bidiVisual: boolean;
  readonly indentPt: number;
  /** A direct or style `w:tblInd` states the indent. */
  readonly indentStated: boolean;
  readonly tableBorders: TableBorderBox;
  readonly claims: readonly CellWidthClaim[];
  readonly gridCols: readonly OoxmlElement[];
  /** A top-level table of a text box story. */
  readonly textBox?: boolean;
}): TableWidthPlacement {
  const { depth, tableWidth, contentWidthPt, rows } = input;
  const reference = legacyTableContentWidth({
    ...input,
    ...(input.bidiVisual
      ? {}
      : { outerRulesPt: outerSideRulesPt(input.tableBorders, rows, false) }),
  });
  const legacy =
    reference && input.textBox && !input.bidiVisual
      ? textBoxLegacyContentWidth(reference, tableWidth)
      : reference;
  // A nested table, and every table outside the legacy modes, adds its outer rule to the share.
  const resolvedWidth =
    legacy === undefined &&
    (depth > 0 || !hasCompatibilityRule(input.compatibilityMode, 'legacyPercentTableContentWidth'))
      ? ruleAdjustedTableWidth(
          tableWidth,
          contentWidthPt,
          input.tableBorders,
          rows,
          input.bidiVisual
        )
      : tableWidth;
  // With neither a table style nor a stated indent, a leading-aligned legacy table sits as if
  // indented by its leading cell margin: its outer edge, not its content, meets the text edge.
  const leading = input.alignment === 'left' && !input.bidiVisual;
  const indentPt =
    legacy && leading && !input.indentStated && input.propertyNodes.length === 0
      ? (rows[0]?.cells[0]?.margins.left ?? 0)
      : input.indentPt;
  // A top-level AutoFit table without a width fits the room its leading indent leaves.
  const autoRoomPt =
    tableWidth.type === 'auto' &&
    !input.layoutFixed &&
    depth === 0 &&
    !input.floating &&
    input.alignment === 'left'
      ? Math.max(0, indentPt)
      : 0;
  // A nested table without a width of its own may also use its outer margins in older modes.
  const nestedRoomPt = legacy ? undefined : legacyNestedAutoRoomPt(input);
  // A right-to-left table mirrors the left-to-right geometry, then sits half its mean outer
  // side rule further toward its visual left.
  const sides =
    input.bidiVisual &&
    depth === 0 &&
    !input.textBox &&
    !input.floating &&
    input.cellSpacingPt === 0 &&
    hasCompatibilityRule(input.compatibilityMode, 'modernBidiTableRuleShift')
      ? outerSideRulesPt(input.tableBorders, rows, true)
      : undefined;
  const shift = sides ? -(sides.left + sides.right) / 4 : 0;
  return {
    ...(shift < 0 ? { bidiRuleShiftPt: shift } : {}),
    legacy,
    tableWidth: resolvedWidth,
    contentWidthPt: nestedRoomPt ?? (legacy?.widthPt ?? contentWidthPt) - autoRoomPt,
    claims: legacy?.gridConfirmed
      ? legacyRoundedCellClaims(
          input.claims,
          input.gridCols,
          (legacy.widthPt * tableWidth.value) / 100
        )
      : input.claims,
    indentPt,
  };
}
