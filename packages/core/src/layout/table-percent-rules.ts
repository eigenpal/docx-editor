import type { SemanticTableRow } from './semantic-table.ts';
import type { TableBorderBox, TableBorderSide } from './table-borders.ts';
import type { PreferredWidth } from './table-widths.ts';

/** The painted width of a simple outer side rule; other rules have no captured geometry. */
function simpleRulePt(side: TableBorderSide): number {
  if (side.state !== 'edge' || (side.style !== 'single' && side.style !== 'thick')) return 0;
  return Number.isFinite(side.widthPt) && side.widthPt > 0 ? side.widthPt : 0;
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
  rows: readonly SemanticTableRow[]
): PreferredWidth {
  // At 100% the share is the container itself, whatever the rules.
  if (tableWidth.type !== 'pct' || tableWidth.value === 100 || !(containerWidthPt > 0))
    return tableWidth;
  // The outer cells' own rules replace the table's, as they do when the table paints.
  const first = rows[0]?.cells[0]?.borders.left;
  const last = rows[0]?.cells.at(-1)?.borders.right;
  const left = !first || first.state === 'omitted' ? borders.left : first;
  const right = !last || last.state === 'omitted' ? borders.right : last;
  const rule = (simpleRulePt(left) + simpleRulePt(right)) / 2;
  if (!(rule > 0) || rule >= containerWidthPt) return tableWidth;
  const widthPt = (tableWidth.value / 100) * (containerWidthPt - rule) + rule;
  return { type: 'pct', value: (widthPt / containerWidthPt) * 100 };
}
