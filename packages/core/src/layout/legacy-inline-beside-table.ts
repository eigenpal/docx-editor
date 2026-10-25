// The width an inline object asks of a line beside a floating table.
//
// In legacy compatibility modes an inline object that opens its line stays beside a floating
// table even when it is wider than the gap there: it sits at the start of the gap and runs past
// the margin. Modern modes move it below the table. Only the opening object of an empty line,
// and only beside a table, is measured this way; text and other floats keep their rules.

import type { ExclusionZone } from './drawing-exclusion.ts';

/**
 * The width to place an inline object of `width` with: a token width that the gap beside the
 * table holds when the legacy rule applies, or `width` itself.
 */
export function besideTableWidth(
  width: number,
  flow: { readonly inlineObjectsBesideTables?: boolean } | undefined,
  lineHoldsContent: boolean,
  zones: () => readonly ExclusionZone[]
): number {
  if (!flow?.inlineObjectsBesideTables || lineHoldsContent) return width;
  if (!zones().some((zone) => zone.sourceKind === 'table')) return width;
  return Math.min(width, 1);
}
