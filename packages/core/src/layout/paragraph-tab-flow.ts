import type { CellAnchorScope } from './cell-anchor-layout.ts';
import {
  nextTabDestination,
  type TabDestination,
  type ResolvedTabStops,
} from './paragraph-tabs.ts';

/**
 * Whether a tab closes its line before it is placed.
 *
 * A tab on a full line closes it when content follows. In a cell, the real next stop is
 * tested before clamping consumes a wrapped cell tab at the old edge. In body text, a tab
 * whose next default stop lies past the right edge opens the next line, even with nothing
 * after it, and reaches its first stop there. `plain` means left-to-right, not positional,
 * and with no exclusion zone cutting the line short of the right edge.
 */
export function tabClosesLine(
  scope: CellAnchorScope | undefined,
  inTableCell: boolean,
  plain: boolean,
  tabs: ResolvedTabStops,
  currentX: number,
  rightEdge: number,
  lineFull: boolean,
  contentFollows: boolean
): boolean {
  if (!plain) return lineFull && contentFollows;
  const next = nextTabDestination(tabs, currentX, Number.POSITIVE_INFINITY);
  const pastEdge = next.alignment === 'left' && next.positionPt > rightEdge + 1e-6;
  if ((lineFull || (scope?.inTableCell === true && pastEdge)) && contentFollows) return true;
  // A custom stop at the pen counts too: text aligned on a stop at the edge keeps its
  // trailing tabs on its line.
  const customAhead = tabs.stops.some(
    (stop) => !stop.numberingOnly && stop.positionPt >= currentX - 1e-6
  );
  return !inTableCell && !customAhead && pastEdge;
}

/** Choose the ordinary or positional destination without changing either stop policy. */
export function tabDestinationForFlow(
  tabs: ResolvedTabStops,
  stopX: number,
  stopRight: number,
  tabEdge: number,
  currentX: number,
  rightEdge: number,
  positional: TabDestination | null
): TabDestination {
  const authored = nextTabDestination(tabs, stopX, tabEdge);
  return positional === null
    ? authored.alignment === 'left'
      ? nextTabDestination(tabs, stopX, stopRight)
      : authored
    : Number.isFinite(positional.positionPt) && positional.positionPt > currentX
      ? positional
      : {
          ...nextTabDestination(tabs, currentX, rightEdge),
          ...(positional.leader ? { leader: positional.leader } : {}),
        };
}

/** Repeated tab sequences retain their existing placement across the whole paragraph. */
export function cellTabReplayScope(
  scope: CellAnchorScope | undefined,
  pieces: readonly { readonly text: string }[]
): CellAnchorScope | undefined {
  if (!scope?.inTableCell) return undefined;
  let previousTab = false;
  for (const piece of pieces) {
    for (let offset = 0; offset < piece.text.length; offset += 1) {
      const tab = piece.text[offset] === '\t';
      if (tab && previousTab) return undefined;
      previousTab = tab;
    }
  }
  return scope;
}
