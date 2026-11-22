// Where the next paragraph's leading pictures land, carried from one reflow pass to the next.
//
// A paragraph's last lines may wrap around the leading picture of the next paragraph
// (`followingAnchor` in `paragraph-drawing-wrap.ts`). That picture is not placed yet when the
// paragraph breaks, so its zone comes from the previous pass, where it sat below the place the
// previous pass gave the paragraph. In a run of such paragraphs each pass settled one more link
// of the chain, so the pass count grew with the document, and every pass lays out all of it.
//
// The picture is placed against the next paragraph's top less the lines its own wrap added to
// this paragraph (`displacement`). That top is this paragraph's top plus the extent of its lines
// broken without the picture (the prediction), plus a gap: what lies between the paragraphs,
// such as a bottom border. The gap does not depend on where the paragraphs are. A pass learns it
// where the previous pass placed the picture on the page of its prediction, and keeps it. A break
// then moves the previous pass's zone, on its page, to its prediction plus the gap, and a chain
// settles in a constant number of passes.
//
// A move never puts a picture where the map of an earlier pass of the reflow put it. Then the
// passes cycle through its places, as when a paragraph's last line wraps the picture only while
// the picture sits high enough, and the ordinary passes find that cycle without any move.
//
// Moves run only where ordinary passes show a chain that settles a link at a time: the drift
// between two successive maps alternates direction and shrinks (`driftSettles`). A line that
// only touches a picture's edge stays clear of it (`WRAP_EDGE_TOUCH_PT`), so rounding never
// decides such a wrap, and a move cannot reach a layout that ordinary passes would not.
//
// At a fixed point every zone already sits there, and no zone moves: the layout is the one the
// previous pass's zones alone give. A pass that did move a zone wrapped it where this pass places
// the picture, not where the zones the reflow compares put it, so it never publishes as stable.

import type { DrawingProjection } from '../store/package/drawing-projection.ts';
import { exclusionLayoutToken, type ExclusionZone } from './drawing-exclusion.ts';
import { emuToPointsSafe, type AnchoredDrawingRecord } from './drawing-layout.ts';

/** Moves smaller than this, in points, leave the zone where the previous pass put it. */
const SHIFT_TOLERANCE_PT = 0.001;

let movesOffForTest = false;

/** A place key that equal places, within the shift tolerance, share. */
function placeKey(pageIndex: number, top: number): string {
  return `${pageIndex}:${Math.round(top / SHIFT_TOLERANCE_PT)}`;
}

/**
 * Leaves every following picture's zone where the previous pass put it until the returned
 * function runs: the reflow the predictions must settle on. @internal
 */
export function disableFollowingZoneMovesForTest(): () => void {
  movesOffForTest = true;
  return () => {
    movesOffForTest = false;
  };
}

/** Where a break predicted the next paragraph's top: a page index and a y on that page. */
export interface FollowingPrediction {
  readonly pageIndex: number;
  readonly y: number;
}

/** The zones of one paragraph's pictures on the page the previous pass put them on. */
export interface PlacedFollowingZones {
  readonly pageIndex: number;
  readonly zones: readonly ExclusionZone[];
}

/** The predictions of one reflow, shared by its passes. */
export interface FollowingAnchorTops {
  /** Starts a pass laid out under `zonesByPage`, which moves zones only when `mayMove`. */
  beginPass(
    zonesByPage: ReadonlyMap<number, readonly ExclusionZone[]> | undefined,
    mayMove: boolean
  ): void;
  /**
   * Starts one layout of the bodies within the pass. A pass may lay them out more than once
   * (column balancing, the retry without hidden furniture), and its last layout is its result:
   * each layout drops what an earlier one recorded.
   */
  beginLayout(): void;
  /** The body picture zones of paragraph `paragraphId` in that map, in column `columnIndex`. */
  placed(paragraphId: string, columnIndex: number): PlacedFollowingZones | undefined;
  /**
   * How far `placed` (from {@link placed}) moves for `predicted`, made under `key`, or
   * undefined when it stays: while the gap under `key` is not known, in a pass that does not
   * move zones, when the previous pass predicted the same page and still put the pictures on
   * another one (as when the next paragraph did not fit), and when an earlier map of the reflow
   * put the picture at the place the move would take it to. Learns the gap in every pass, and
   * only learns it without `predicted`.
   */
  shift(
    key: string,
    placed: PlacedFollowingZones,
    predicted: FollowingPrediction | undefined
  ): number | undefined;
  /** Whether this pass may move zones: only then does a break need its prediction early. */
  readonly mayMove: boolean;
  /**
   * Records the prediction of a placed break, and whether the break moved a zone that can
   * narrow one of its lines. A later break of the same paragraph in the pass (on the next page,
   * say) replaces the prediction. It replaces the move only on the same page: the lines a moved
   * zone changed on an earlier page stay there.
   */
  record(key: string, prediction: FollowingPrediction, moved: boolean): void;
  /** Whether some placed break of the pass's last layout moved a zone. */
  readonly moved: boolean;
}

export function createFollowingAnchorTops(): FollowingAnchorTops {
  let previous = new Map<string, FollowingPrediction>();
  let current = new Map<string, FollowingPrediction>();
  let movedBreaks = new Set<string>();
  // Learned gaps, kept across passes: a pass where the next paragraph did not start on the page
  // of the prediction teaches none.
  const gaps = new Map<string, number>();
  let zonesByPage: ReadonlyMap<number, readonly ExclusionZone[]> | undefined;
  let byParagraph: Map<string, { pageIndex: number; zones: ExclusionZone[] }> | undefined;
  // Where the maps of earlier passes put each picture, by drawing: `pageIndex:top` keys.
  const earlierTops = new Map<string, Set<string>>();
  let movesAllowed = false;
  return {
    beginPass(zones, mayMove) {
      previous = current;
      current = new Map();
      movedBreaks = new Set();
      for (const [pageIndex, pageZones] of zonesByPage ?? [])
        for (const zone of pageZones) {
          if (zone.paragraphTop === undefined || zone.sourceKind || zone.earlierSection) continue;
          const tops = earlierTops.get(zone.drawingNodeId) ?? new Set<string>();
          tops.add(placeKey(pageIndex, zone.paragraphTop));
          earlierTops.set(zone.drawingNodeId, tops);
        }
      zonesByPage = zones;
      byParagraph = undefined;
      movesAllowed = mayMove;
    },
    beginLayout() {
      current = new Map();
      movedBreaks = new Set();
    },
    placed(paragraphId, columnIndex) {
      if (!byParagraph) {
        byParagraph = new Map();
        for (const [pageIndex, zones] of zonesByPage ?? [])
          for (const zone of zones) {
            if (zone.sourceKind || zone.earlierSection || zone.paragraphTop === undefined) continue;
            const placed = byParagraph.get(zone.anchorParagraphId);
            // A body picture stands on one page, and a paragraph's pictures on its first one.
            if (!placed) byParagraph.set(zone.anchorParagraphId, { pageIndex, zones: [zone] });
            else if (placed.pageIndex === pageIndex) placed.zones.push(zone);
          }
      }
      const placed = byParagraph.get(paragraphId);
      const zones = placed?.zones.filter((zone) => zone.columnIndex === columnIndex) ?? [];
      return placed && zones.length > 0 ? { pageIndex: placed.pageIndex, zones } : undefined;
    },
    shift(key, placed, predicted) {
      if (movesOffForTest) return undefined;
      const top = placed.zones[0]!.paragraphTop!;
      const before = previous.get(key);
      if (before?.pageIndex === placed.pageIndex) gaps.set(key, top - before.y);
      else if (before?.pageIndex === predicted?.pageIndex) return undefined;
      const gap = gaps.get(key);
      if (gap === undefined || !movesAllowed || !predicted) return undefined;
      const shift = predicted.y + gap - top;
      if (Math.abs(shift) < SHIFT_TOLERANCE_PT) return 0;
      // An earlier map put the picture there already: the passes cycle through its places, and
      // ordinary passes find that cycle without any move.
      const id = placed.zones[0]!.drawingNodeId;
      return earlierTops.get(id)?.has(placeKey(predicted.pageIndex, top + shift))
        ? undefined
        : shift;
    },
    record(key, prediction, moved) {
      current.set(key, prediction);
      const pageKey = `${key}@${prediction.pageIndex}`;
      if (moved) movedBreaks.add(pageKey);
      else movedBreaks.delete(pageKey);
    },
    get mayMove() {
      return movesAllowed && !movesOffForTest;
    },
    get moved() {
      return movedBreaks.size > 0;
    },
  };
}

/**
 * Whether `drawing` sits at its authored offset below its paragraph's top, so it moves one for
 * one with that top. A simple position, an unresolvable frame, an alignment, and a place clamped
 * to the content top or bottom (`anchor-content-top.ts`) do not follow it.
 */
export function followsParagraphTop(
  drawing: AnchoredDrawingRecord,
  projection: DrawingProjection
): boolean {
  const vertical = projection.position?.vertical;
  if (
    drawing.verticalFrame !== 'paragraph' ||
    drawing.layoutFallback ||
    projection.anchor?.simplePos ||
    !vertical ||
    vertical.align !== null
  )
    return false;
  const offset = vertical.offsetEmu === null ? 0 : emuToPointsSafe(vertical.offsetEmu);
  return offset !== null && Math.abs(drawing.y - drawing.verticalFrameOrigin - offset) < 0.001;
}

/** The fewest following pictures one pass must move on a page before moves may run. */
const MIN_DRIFTING_PICTURES = 3;

/** How each following picture moved from one map to the next: +1 down the flow, -1 up. */
export type FollowingDrift = ReadonlyMap<string, number>;

/**
 * How the map a pass collected (`next`) differs from the one it was laid out under
 * (`previous`), when it differs only as a chain of following pictures drifts; otherwise
 * undefined. Every zone that changed must be the one picture of its paragraph, placed at an
 * offset below that paragraph's top (`followsParagraphTop`), square or top-and-bottom wrapped,
 * and anchored at the paragraph's start, and some page must hold `MIN_DRIFTING_PICTURES` of
 * them. Anything else that changed (a frame, a table, a page-framed object, a picture that
 * shares its paragraph) follows dynamics a move does not predict.
 */
export function followingDrift(
  previous: ReadonlyMap<number, readonly ExclusionZone[]>,
  next: ReadonlyMap<number, readonly ExclusionZone[]>
): FollowingDrift | undefined {
  const index = (zonesByPage: ReadonlyMap<number, readonly ExclusionZone[]>) => {
    const byDrawing = new Map<string, { pageIndex: number; zone: ExclusionZone; token: string }>();
    const perParagraph = new Map<string, number>();
    for (const [pageIndex, zones] of zonesByPage)
      for (const zone of zones) {
        byDrawing.set(zone.drawingNodeId, {
          pageIndex,
          zone,
          token: `${pageIndex}|${exclusionLayoutToken([zone])}`,
        });
        perParagraph.set(
          zone.anchorParagraphId,
          (perParagraph.get(zone.anchorParagraphId) ?? 0) + 1
        );
      }
    return { byDrawing, perParagraph };
  };
  const before = index(previous);
  const after = index(next);
  const drifting = (
    entry: { zone: ExclusionZone } | undefined,
    counts: Map<string, number>
  ): entry is { pageIndex: number; zone: ExclusionZone; token: string } =>
    entry !== undefined &&
    // A picture that moved onto a page above its anchor stops at the content top.
    (entry.zone.paragraphTop !== undefined || Math.abs(entry.zone.y) < SHIFT_TOLERANCE_PT) &&
    !entry.zone.sourceKind &&
    !entry.zone.earlierSection &&
    !entry.zone.pageFramedBand &&
    entry.zone.anchorModelStart === 0 &&
    (entry.zone.input.mode === 'square' || entry.zone.input.mode === 'topAndBottom') &&
    counts.get(entry.zone.anchorParagraphId) === 1;
  const drift = new Map<string, number>();
  const perPage = new Map<number, number>();
  for (const id of new Set([...before.byDrawing.keys(), ...after.byDrawing.keys()])) {
    const was = before.byDrawing.get(id);
    const is = after.byDrawing.get(id);
    if (was?.token === is?.token) continue;
    if (!drifting(was, before.perParagraph) || !drifting(is, after.perParagraph)) {
      return undefined;
    }
    const down =
      is.pageIndex !== was.pageIndex ? is.pageIndex > was.pageIndex : is.zone.y > was.zone.y;
    drift.set(id, down ? 1 : -1);
    perPage.set(is.pageIndex, (perPage.get(is.pageIndex) ?? 0) + 1);
  }
  return [...perPage.values()].some((count) => count >= MIN_DRIFTING_PICTURES) ? drift : undefined;
}

/**
 * Whether two successive drifts (`earlier`, then `later`) are one chain settling. Ordinary
 * passes settle such a chain from its top, a few pictures per page per pass. Each picture not
 * settled yet swings back each pass, as the lines above it wrap it and then do not: `later`
 * moves fewer pictures than `earlier`, each the other way. A cycle between two maps moves the
 * same pictures back and forth, so `later` moves as many as `earlier`.
 */
export function driftSettles(earlier: FollowingDrift, later: FollowingDrift): boolean {
  if (later.size >= earlier.size) return false;
  for (const [id, direction] of later) if (earlier.get(id) !== -direction) return false;
  return true;
}
