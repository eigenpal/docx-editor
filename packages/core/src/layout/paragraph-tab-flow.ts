import type { CellAnchorScope } from './cell-anchor-layout.ts';
import {
  nextTabDestination,
  TAB_PEN_TOLERANCE_PT,
  tabAdvanceWidth,
  tabStopPastPen,
  type TabDestination,
  type ResolvedTabStops,
} from './paragraph-tabs.ts';

import type { PositionalTab } from './field-projection.ts';
import {
  measureFollowingTabSegment,
  positionalTabDestination,
  type Piece,
} from './paragraph-piece-metrics.ts';
import type { TextMeasurer } from './semantic-records.ts';

const OVERFLOW_TOLERANCE_PT = 0.001;

/**
 * Whether a tab closes its line before it is placed.
 *
 * A tab on a full line closes it when content follows. In a cell, the real next stop is
 * tested before clamping consumes a wrapped cell tab at the old edge. A tab whose next stop
 * is a left stop past the right edge opens the next line, even with nothing after it, and
 * reaches its first stop there, unless a custom stop lies past the pen: that stop takes the
 * tab on this line at the edge. With `edgeStopKeepsTabs` (a legacy mode outside a table cell)
 * a custom stop at the pen counts too, so text aligned on a stop at the edge keeps its
 * trailing tabs on its line. `plain` means left-to-right, not positional, and with no
 * exclusion zone cutting the line short of the right edge.
 *
 * ECMA-376 Part 1 §17.3.3.32 (`tab`) defines only where a tab advances to. It does not say
 * what happens when that stop lies past the right edge, so this line break is a layout rule
 * (see `edgeStopKeepsTrailingTabs` in the compatibility rules).
 */
export function tabClosesLine(
  scope: CellAnchorScope | undefined,
  edgeStopKeepsTabs: boolean,
  plain: boolean,
  tabs: ResolvedTabStops,
  currentX: number,
  rightEdge: number,
  lineFull: boolean,
  contentFollows: boolean
): boolean {
  if (!plain) return lineFull && contentFollows;
  const next = nextTabDestination(tabs, currentX, Number.POSITIVE_INFINITY);
  const pastEdge = next.alignment === 'left' && tabStopPastPen(next.positionPt, rightEdge);
  if ((lineFull || (scope?.inTableCell === true && pastEdge)) && contentFollows) return true;
  if (!pastEdge) return false;
  const holds = (positionPt: number) =>
    edgeStopKeepsTabs
      ? positionPt >= currentX - TAB_PEN_TOLERANCE_PT
      : tabStopPastPen(positionPt, currentX);
  return !tabs.stops.some((stop) => !stop.numberingOnly && holds(stop.positionPt));
}

/**
 * Choose the ordinary or positional destination without changing either stop policy, and how
 * far the text after the tab may run (`segmentRight`), given the furthest such point so far.
 *
 * An aligned stop's text reaches the stop, up to the margin (`tabEdge`). A left stop may lie
 * past the right indent: it reaches the margin, and its text may run to the margin. With
 * `pastMargin` (a legacy mode) any custom left stop is honoured and its text has no bound.
 */
export function tabDestinationForFlow(
  tabs: ResolvedTabStops,
  stopX: number,
  stopRight: number,
  tabEdge: number,
  currentX: number,
  rightEdge: number,
  positional: TabDestination | null,
  pastMargin = false,
  rtl = false,
  segmentRight = 0
): TabDestination & { readonly segmentRight: number } {
  const authored = nextTabDestination(tabs, stopX, tabEdge);
  // Only a custom stop reaches past the right indent; the default grid stops at it.
  const customAhead = tabs.stops.some(
    (stop) => !stop.numberingOnly && tabStopPastPen(stop.positionPt, stopX)
  );
  const destination =
    positional === null
      ? authored.alignment !== 'left'
        ? authored
        : !customAhead
          ? nextTabDestination(tabs, stopX, stopRight)
          : pastMargin
            ? nextTabDestination(tabs, stopX, Number.POSITIVE_INFINITY)
            : authored
      : Number.isFinite(positional.positionPt) && positional.positionPt > currentX
        ? positional
        : {
            ...nextTabDestination(tabs, currentX, rightEdge),
            ...(positional.leader ? { leader: positional.leader } : {}),
          };
  // Right-to-left stops count from the other edge; their text keeps the measure.
  let right = segmentRight;
  if (!rtl && destination.alignment !== 'left')
    right = Math.max(segmentRight, Math.min(destination.positionPt, tabEdge));
  else if (!rtl && tabStopPastPen(destination.positionPt, stopRight))
    right = Math.max(segmentRight, pastMargin ? Number.POSITIVE_INFINITY : tabEdge);
  return { ...destination, segmentRight: right };
}

/** What a tab's placement depends on besides the pen: its stops, edges and following text. */
export interface TabContext {
  readonly tabs: ResolvedTabStops;
  readonly stopRight: number;
  readonly tabEdge: number;
  readonly rightEdge: number;
  readonly positional: TabDestination | null;
  readonly pastMargin: boolean | undefined;
  readonly rtl: boolean;
  readonly segment: {
    readonly width: number;
    readonly decimalOffset: number;
    readonly rtlDecimalOffset: number;
  };
}

/** The context a tab at `boundary` of `pieces[pieceIndex]` is placed in. */
export function tabContextFor(input: {
  readonly pieces: readonly Piece[];
  readonly pieceIndex: number;
  readonly boundary: number;
  readonly measurer: TextMeasurer;
  readonly pageBreaksIgnored: boolean;
  readonly positionalTab: PositionalTab | undefined;
  readonly tabs: ResolvedTabStops;
  readonly indentLeft: number;
  readonly rightEdge: number;
  readonly stopRight: number;
  readonly marginExtent: { readonly left: number; readonly right: number } | undefined;
  readonly zonesActive: boolean;
  readonly pastMargin: boolean | undefined;
  readonly rtl: boolean;
}): TabContext {
  const { pieces, pieceIndex, boundary, measurer, pageBreaksIgnored, stopRight } = input;
  const segment = measureFollowingTabSegment(
    pieces,
    pieceIndex,
    boundary,
    measurer,
    pageBreaksIgnored
  );
  // A `w:ptab` states its own destination and leader, so it does NOT consult the
  // paragraph's tab stops — a table-of-contents line authored with one has none.
  // A positional tab whose destination is at or behind the caret cannot advance —
  // a left-aligned one almost never can, and it is also the fallback for a malformed
  // `w:alignment`. Falling back to the ordinary stop rule keeps the glyphs apart
  // instead of reproducing the very run-together text this element exists to prevent.
  const positional = input.positionalTab
    ? positionalTabDestination(
        input.positionalTab,
        input.indentLeft,
        input.rightEdge,
        input.marginExtent
      )
    : null;
  // Authored aligned tabs may reach the containing margin beyond the paragraph's
  // right indent. Only their following segment gets that extra room.
  const tabEdge = input.zonesActive
    ? stopRight
    : Math.max(stopRight, input.marginExtent?.right ?? stopRight);
  return {
    tabs: input.tabs,
    stopRight,
    tabEdge,
    rightEdge: input.rightEdge,
    positional,
    pastMargin: input.pastMargin,
    rtl: input.rtl,
    segment,
  };
}

/** The stop a tab reaches from the pen at `currentX` (`stopX` for its stops), and its width. */
export function tabPlacement(
  context: TabContext,
  currentX: number,
  stopX: number,
  segmentRight: number
): { readonly destination: ReturnType<typeof tabDestinationForFlow>; readonly width: number } {
  const { tabs, stopRight, tabEdge, rightEdge, positional, pastMargin, rtl, segment } = context;
  const destination = tabDestinationForFlow(
    tabs,
    stopX,
    stopRight,
    tabEdge,
    currentX,
    rightEdge,
    positional,
    pastMargin,
    rtl,
    segmentRight
  );
  const width = tabAdvanceWidth(
    destination.alignment,
    positional === null ? stopX : currentX,
    destination.positionPt,
    segment.width,
    rtl && positional === null ? segment.rtlDecimalOffset : segment.decimalOffset
  );
  return { destination, width };
}

/**
 * Whether a tab opens the next line with the word after it (`w:tab`, Tab Character, `CT_Empty`,
 * ECMA-376 Part 1, 17.3.3.32). The standard defines only where a tab advances to. A tab and the
 * unbreakable word after it stay together: when the word would overflow the line after the tab,
 * the tab moves down and reaches its stop on the next line. When the two would not fit on a
 * fresh line either, the word opens it alone.
 */
export function tabCarriesItsWord(
  context: TabContext,
  word: number,
  placed: { readonly width: number },
  lineRoom: number,
  fresh: { readonly x: number; readonly room: number }
): boolean {
  if (word <= 0 || placed.width + word <= lineRoom + OVERFLOW_TOLERANCE_PT) return false;
  const onFreshLine = tabPlacement(context, fresh.x, fresh.x, 0).width;
  return onFreshLine + word <= fresh.room + OVERFLOW_TOLERANCE_PT;
}

/**
 * The cell scope for replaying a tab past the cell edge before content that follows it: off
 * when the paragraph holds consecutive tabs. A tab whose next stop lies past the edge still
 * opens the next line through `tabClosesLine`'s general rule, whether tabs repeat or not.
 */
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
