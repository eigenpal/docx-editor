import type { CellAnchorScope } from './cell-anchor-layout.ts';
import {
  nextTabDestination,
  type TabDestination,
  type ResolvedTabStops,
} from './paragraph-tabs.ts';

/** Test the real next stop before clamping consumes a wrapped cell tab at the old edge. */
export function shouldReplayCellTab(
  scope: CellAnchorScope | undefined,
  rtl: boolean,
  positional: boolean,
  exclusionCount: number,
  tabs: ResolvedTabStops,
  currentX: number,
  rightEdge: number
): boolean {
  if (!scope?.inTableCell || rtl || positional || exclusionCount !== 0) return false;
  const destination = nextTabDestination(tabs, currentX, Number.POSITIVE_INFINITY);
  return destination.alignment === 'left' && destination.positionPt > rightEdge;
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
