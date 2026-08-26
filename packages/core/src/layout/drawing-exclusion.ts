// Anchored drawing exclusion zones and paint-layer ordering (typed-drawings-and-images task 9).
//
// Wrap exclusions feed paragraph line breaking; behind/inFront wrapNone produce none.
// Overlap displacement under allowOverlap=false is deterministic before paint order.

import type { DrawingProjection, ImageWrapTarget } from '../store/package/drawing-projection.ts';
import {
  anchoredDrawingAtomsInParagraph,
  drawingModelOffsetsInParagraph,
  measureInlineDrawing,
  resolveAnchoredDrawingPosition,
  type AnchoredDrawingLayoutFallback,
  type AnchoredDrawingRecord,
  type InlineDrawingLayoutContext,
} from './drawing-layout.ts';
import { drawingGeometryFromProjection } from './drawing-geometry.ts';
import {
  DEFAULT_REVISION_DISPLAY_MODE,
  revisionsVisible,
  type RevisionDisplayMode,
} from './revision-projection.ts';
import type { OoxmlNode } from '@docx-editor.dev/core/store';
import type { DrawingGeometry } from './drawing-geometry.ts';
import {
  availableTextIntervalsOnScanline,
  squareExclusionBounds,
  type ScanlineInterval,
  type WrapExclusionInput,
  type WrapTextSide,
  wrapExclusionFromProjection,
} from './drawing-wrap.ts';
import type { LayoutBox } from './semantic-records.ts';

/** Paint layer relative to body text — not the OOXML wrap element. */
export type DrawingPaintLayer = 'behind' | 'inFront';

/** Maximum vertical displacement attempts before next-page deferral. */
export const MAX_OVERLAP_DISPLACEMENT_ATTEMPTS = 256;

/** Maximum page-to-page deferrals before publishing with {@link AnchoredDrawingLayoutFallback}. */
export const MAX_ANCHOR_PAGE_DEFERRALS = 8;

/** Maximum full-document reflow passes while wrap exclusions converge. */
export const MAX_DRAWING_EXCLUSION_REFLOW_PASSES = 8;

/** Raised when wrap-exclusion reflow does not converge within {@link MAX_DRAWING_EXCLUSION_REFLOW_PASSES}. */
export class DrawingExclusionConvergenceError extends Error {
  readonly name = 'DrawingExclusionConvergenceError';
  constructor(message = 'drawing exclusion reflow did not converge') {
    super(message);
  }
}

export interface ExclusionZone {
  readonly drawingNodeId: string;
  readonly anchorParagraphId: string;
  /** UTF-16 model offset of the anchor atom — exclusions apply at/after this point in the paragraph. */
  readonly anchorModelStart: number;
  readonly sourceOrder: number;
  readonly paintLayer: DrawingPaintLayer;
  readonly relativeHeight: number;
  readonly allowOverlap: boolean;
  /** Owning column index in a multi-column section — 0 for single-column and HF stories. */
  readonly columnIndex: number;
  /** Resolved top edge in page-content coordinates after overlap displacement. */
  readonly y: number;
  readonly verticalBand: LayoutBox;
  readonly input: WrapExclusionInput;
}

export interface ExclusionColumnLayout {
  readonly columnCount: number;
  readonly columnGapPt: number;
  readonly contentWidth: number;
  readonly columnLefts?: readonly number[];
  readonly columnWidths?: readonly number[];
}

/** Column that owns an anchored drawing's horizontal center in a multi-column section. */
export function columnIndexForDrawing(
  drawing: Pick<AnchoredDrawingRecord, 'x' | 'width'>,
  layout: ExclusionColumnLayout
): number {
  const count = Math.max(1, layout.columnCount);
  if (count <= 1) return 0;
  const centerX = drawing.x + drawing.width / 2;
  if (layout.columnLefts && layout.columnWidths && layout.columnLefts.length === count) {
    for (let index = 0; index < count; index += 1) {
      const left = layout.columnLefts[index]!;
      const right = left + layout.columnWidths[index]!;
      if (centerX >= left - 0.001 && centerX < right + 0.001) return index;
    }
    return count - 1;
  }
  const gap = layout.columnGapPt;
  const columnWidth = (layout.contentWidth - gap * (count - 1)) / count;
  for (let index = 0; index < count; index += 1) {
    const left = index * (columnWidth + gap);
    const right = left + columnWidth;
    if (centerX >= left - 0.001 && centerX < right + 0.001) return index;
  }
  return count - 1;
}

export function paintLayerOf(drawing: AnchoredDrawingRecord): DrawingPaintLayer {
  return drawing.behindDocument ? 'behind' : 'inFront';
}

function wrapProducesExclusion(wrap: ImageWrapTarget): boolean {
  return wrap !== 'inline' && wrap !== 'behind' && wrap !== 'inFront';
}

function exclusionModeFromWrap(wrap: ImageWrapTarget): WrapExclusionInput['mode'] | null {
  switch (wrap) {
    case 'inline':
    case 'behind':
    case 'inFront':
      return null;
    case 'square':
    case 'squareLeft':
    case 'squareRight':
      return 'square';
    case 'tight':
      return 'tight';
    case 'through':
      return 'through';
    case 'topAndBottom':
      return 'topAndBottom';
    default:
      return null;
  }
}

function textSideFromWrap(wrap: ImageWrapTarget): WrapTextSide {
  if (wrap === 'squareLeft') return 'left';
  if (wrap === 'squareRight') return 'right';
  return 'bothSides';
}

export function wrapExclusionInputForProjection(options: {
  readonly projection: DrawingProjection;
  readonly geometry: DrawingGeometry;
  readonly contentLeft: number;
  readonly contentRight: number;
  readonly anchorX: number;
  readonly anchorY: number;
}): WrapExclusionInput | null {
  const mode = exclusionModeFromWrap(options.projection.wrap);
  if (!mode || !options.projection.wrapGeometry) return null;
  const wrap = options.projection.wrapGeometry;
  const contentBounds = Object.freeze({
    x: options.anchorX,
    y: options.anchorY,
    width: options.geometry.contentBounds.width,
    height: options.geometry.contentBounds.height,
  });
  return wrapExclusionFromProjection({
    mode,
    contentBounds,
    geometry: options.geometry,
    wrapDistancesEmu: wrap.distancesEmu,
    polygonEmu: wrap.polygon,
    crop: options.projection.picture?.crop ?? { left: 0, top: 0, right: 0, bottom: 0 },
    transform: options.projection.picture?.transform ?? {
      rotationDegrees: 0,
      flipHorizontal: false,
      flipVertical: false,
      offsetEmu: { x: 0, y: 0 },
      extentEmu: { cx: 0, cy: 0 },
    },
    extentWidthPt: options.geometry.contentBounds.width,
    extentHeightPt: options.geometry.contentBounds.height,
    textSide: mode === 'square' ? textSideFromWrap(options.projection.wrap) : wrap.textSide,
    contentLeft: options.contentLeft,
    contentRight: options.contentRight,
  });
}

export function verticalBandOfExclusion(input: WrapExclusionInput): LayoutBox {
  if (input.mode === 'topAndBottom' || input.mode === 'square') {
    return squareExclusionBounds(input.contentBounds, input.effectInsets, input.wrapDistances);
  }
  const ys = [input.contentBounds.y, input.contentBounds.y + input.contentBounds.height];
  if (input.polygon) {
    for (const point of input.polygon) ys.push(point.y);
  }
  const top = Math.min(...ys) - input.effectInsets.top - input.wrapDistances.top;
  const bottom = Math.max(...ys) + input.effectInsets.bottom + input.wrapDistances.bottom;
  return Object.freeze({
    x: input.contentLeft,
    y: top,
    width: Math.max(0, input.contentRight - input.contentLeft),
    height: Math.max(0, bottom - top),
  });
}

export function exclusionZoneFromAnchoredDrawing(options: {
  readonly drawing: AnchoredDrawingRecord;
  readonly projection: DrawingProjection;
  readonly sourceOrder: number;
  readonly contentLeft: number;
  readonly contentRight: number;
  readonly columnIndex?: number;
  readonly yOverride?: number;
}): ExclusionZone | null {
  if (options.drawing.behindDocument) return null;
  if (!wrapProducesExclusion(options.drawing.wrap)) return null;
  const y = options.yOverride ?? options.drawing.y;
  const input = wrapExclusionInputForProjection({
    projection: options.projection,
    geometry: options.drawing.geometry,
    contentLeft: options.contentLeft,
    contentRight: options.contentRight,
    anchorX: options.drawing.x,
    anchorY: y,
  });
  if (!input) return null;
  return Object.freeze({
    drawingNodeId: options.drawing.drawingNodeId,
    anchorParagraphId: options.drawing.anchorParagraphId,
    anchorModelStart: options.drawing.start,
    sourceOrder: options.sourceOrder,
    paintLayer: paintLayerOf(options.drawing),
    relativeHeight: options.drawing.relativeHeight,
    allowOverlap: options.drawing.allowOverlap,
    columnIndex: options.columnIndex ?? 0,
    y,
    verticalBand: verticalBandOfExclusion(input),
    input,
  });
}

/** Canonical collision/displacement order — source traversal only, not paint metadata. */
export function compareDrawingCollisionOrder(
  left: AnchoredDrawingRecord,
  right: AnchoredDrawingRecord
): number {
  const leftOrder = left.sourceOrder ?? Number.MAX_SAFE_INTEGER;
  const rightOrder = right.sourceOrder ?? Number.MAX_SAFE_INTEGER;
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  return left.drawingNodeId.localeCompare(right.drawingNodeId);
}

export function compareDrawingPaintOrder(
  left: AnchoredDrawingRecord,
  right: AnchoredDrawingRecord
): number {
  const leftLayer = paintLayerOf(left);
  const rightLayer = paintLayerOf(right);
  if (leftLayer !== rightLayer) return leftLayer === 'behind' ? -1 : 1;
  if (left.relativeHeight !== right.relativeHeight) {
    return left.relativeHeight - right.relativeHeight;
  }
  return compareDrawingCollisionOrder(left, right);
}

export function sortDrawingsForPaint(
  drawings: readonly AnchoredDrawingRecord[]
): readonly AnchoredDrawingRecord[] {
  return Object.freeze([...drawings].sort(compareDrawingPaintOrder));
}

function paintBoundsOverlap(a: LayoutBox, b: LayoutBox): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function shiftAnchoredDrawingY(
  drawing: AnchoredDrawingRecord,
  dy: number
): AnchoredDrawingRecord {
  if (Math.abs(dy) <= 0.000_1) return drawing;
  const geometry = drawing.geometry;
  return Object.freeze({
    ...drawing,
    y: drawing.y + dy,
    paintBounds: Object.freeze({ ...drawing.paintBounds, y: drawing.paintBounds.y + dy }),
    hitBounds: Object.freeze({ ...drawing.hitBounds, y: drawing.hitBounds.y + dy }),
    geometry: Object.freeze({
      ...geometry,
      contentBounds: Object.freeze({
        ...geometry.contentBounds,
        y: geometry.contentBounds.y + dy,
      }),
      paintBounds: Object.freeze({
        ...geometry.paintBounds,
        y: geometry.paintBounds.y + dy,
      }),
      hitBounds: Object.freeze({
        ...geometry.hitBounds,
        y: geometry.hitBounds.y + dy,
      }),
      transformedCorners: geometry.transformedCorners.map((point) =>
        Object.freeze({ x: point.x, y: point.y + dy })
      ),
      clipPolygon: geometry.clipPolygon
        ? geometry.clipPolygon.map((point) => Object.freeze({ x: point.x, y: point.y + dy }))
        : null,
    }),
  });
}

export interface OverlapDisplacementOptions {
  readonly pageBottom: number;
  readonly maxAttempts?: number;
}

export interface OverlapDisplacementResult {
  readonly drawings: readonly AnchoredDrawingRecord[];
  readonly deferred: readonly AnchoredDrawingRecord[];
  readonly deferredNodeIds: readonly string[];
}

/** Deterministic overlap resolution: canonical source order, then stable node id. */
export function resolveOverlapDisplacement(
  drawings: readonly AnchoredDrawingRecord[],
  options: OverlapDisplacementOptions
): OverlapDisplacementResult {
  const maxAttempts = options.maxAttempts ?? MAX_OVERLAP_DISPLACEMENT_ATTEMPTS;
  const sorted = [...drawings].sort(compareDrawingCollisionOrder);
  const placed: AnchoredDrawingRecord[] = [];
  const deferred: AnchoredDrawingRecord[] = [];
  const deferredNodeIds: string[] = [];

  for (const drawing of sorted) {
    if (drawing.allowOverlap) {
      placed.push(drawing);
      continue;
    }
    let candidate = drawing;
    let attempts = 0;
    while (attempts < maxAttempts) {
      const overlaps = placed.some((existing) =>
        paintBoundsOverlap(existing.paintBounds, candidate.paintBounds)
      );
      if (!overlaps) break;
      const blocker = placed.find((existing) =>
        paintBoundsOverlap(existing.paintBounds, candidate.paintBounds)
      )!;
      const step =
        blocker.paintBounds.y + blocker.paintBounds.height - candidate.paintBounds.y + 0.001;
      candidate = shiftAnchoredDrawingY(candidate, step);
      attempts += 1;
    }
    const stillOverlaps = placed.some((existing) =>
      paintBoundsOverlap(existing.paintBounds, candidate.paintBounds)
    );
    const pastPageBottom =
      candidate.paintBounds.y + candidate.paintBounds.height > options.pageBottom + 0.001;
    if (stillOverlaps || pastPageBottom) {
      deferred.push(candidate);
      deferredNodeIds.push(candidate.drawingNodeId);
      continue;
    }
    placed.push(candidate);
  }

  return Object.freeze({
    drawings: Object.freeze(placed),
    deferred: Object.freeze(deferred),
    deferredNodeIds: Object.freeze(deferredNodeIds),
  });
}

export function mergeAvailableIntervalsAtY(
  y: number,
  zones: readonly ExclusionZone[],
  contentLeft: number,
  contentRight: number
): readonly ScanlineInterval[] {
  let available: ScanlineInterval[] = [{ start: contentLeft, end: contentRight }];
  for (const zone of zones) {
    const band = zone.verticalBand;
    if (y < band.y || y >= band.y + band.height) continue;
    const atY = availableTextIntervalsOnScanline(y, zone.input);
    const next: ScanlineInterval[] = [];
    for (const base of available) {
      for (const clip of atY) {
        const start = Math.max(base.start, clip.start);
        const end = Math.min(base.end, clip.end);
        if (end > start + 0.000_001) next.push(Object.freeze({ start, end }));
      }
    }
    available = next;
    if (available.length === 0) break;
  }
  return Object.freeze(available);
}

export function remainingWidthAtX(x: number, intervals: readonly ScanlineInterval[]): number {
  for (const interval of intervals) {
    if (x >= interval.start - 0.000_001 && x < interval.end - 0.000_001) {
      return Math.max(0, interval.end - x);
    }
  }
  return 0;
}

/** First text passage whose right edge is strictly past `x`. */
export function firstAvailableIntervalAtOrAfter(
  x: number,
  intervals: readonly ScanlineInterval[]
): ScanlineInterval | null {
  for (const interval of intervals) {
    if (interval.end > x + 0.000_001) return interval;
  }
  return null;
}

/** Snap `x` forward to the start of the first available passage at/after `x`. */
export function snapXToAvailableInterval(
  x: number,
  intervals: readonly ScanlineInterval[]
): { readonly x: number; readonly available: number } | null {
  const interval = firstAvailableIntervalAtOrAfter(x, intervals);
  if (!interval) return null;
  const snapped = Math.max(x, interval.start);
  const available = interval.end - snapped;
  if (available <= 0.001) return null;
  return Object.freeze({ x: snapped, available });
}

function shiftWrapInput(input: WrapExclusionInput, dx: number, dy: number): WrapExclusionInput {
  const bounds = input.contentBounds;
  return Object.freeze({
    ...input,
    contentBounds: Object.freeze({
      ...bounds,
      x: bounds.x + dx,
      y: bounds.y + dy,
    }),
    contentLeft: input.contentLeft + dx,
    contentRight: input.contentRight + dx,
    ...(input.polygon
      ? {
          polygon: input.polygon.map((point) =>
            Object.freeze({ x: point.x + dx, y: point.y + dy })
          ),
        }
      : {}),
    ...(input.clipPolygon
      ? {
          clipPolygon: input.clipPolygon.map((point) =>
            Object.freeze({ x: point.x + dx, y: point.y + dy })
          ),
        }
      : {}),
  });
}

export function withAnchoredDrawingLayoutFallback(
  drawing: AnchoredDrawingRecord,
  layoutFallback: AnchoredDrawingLayoutFallback
): AnchoredDrawingRecord {
  return Object.freeze({ ...drawing, layoutFallback });
}

/** Shift page-content exclusion zones into a cell-local coordinate space. */
export function localizeExclusionZones(
  zones: readonly ExclusionZone[],
  originX: number,
  originY: number,
  contentClip?: { readonly left: number; readonly right: number }
): readonly ExclusionZone[] {
  if (zones.length === 0) return zones;
  return Object.freeze(
    zones.map((zone) => {
      const band = zone.verticalBand;
      const input = zone.input;
      return Object.freeze({
        ...zone,
        y: zone.y - originY,
        verticalBand: Object.freeze({
          ...band,
          x: band.x - originX,
          y: band.y - originY,
        }),
        input: Object.freeze({
          ...shiftWrapInput(input, -originX, -originY),
          contentLeft: contentClip?.left ?? input.contentLeft - originX,
          contentRight: contentClip?.right ?? input.contentRight - originX,
        }),
      });
    })
  );
}

/** Keep only zones whose anchor paragraph is at or before `paragraphOrder` in document order. */
export function filterExclusionZonesForParagraphOrder(
  zones: readonly ExclusionZone[],
  paragraphOrder: number,
  orderOfParagraph: (paragraphId: string) => number | undefined
): readonly ExclusionZone[] {
  return Object.freeze(
    zones.filter((zone) => {
      const anchorOrder = orderOfParagraph(zone.anchorParagraphId);
      if (anchorOrder === undefined) return zone.sourceOrder <= paragraphOrder;
      return anchorOrder <= paragraphOrder;
    })
  );
}

/** Paragraph-local square/tight/through zones synthesized during break. */
export function synthesizeParagraphWrapExclusionZones(options: {
  readonly paragraph: OoxmlNode;
  readonly paragraphId: string;
  readonly drawingLayout: InlineDrawingLayoutContext;
  readonly contentLeft: number;
  readonly contentRight: number;
  readonly paragraphStartY: number;
  readonly anchorLineTopByModelStart: ReadonlyMap<number, number>;
  readonly sourceOrderOf?: (drawingNodeId: string) => number | undefined;
  readonly anchorCellBox?: LayoutBox | null;
  /** Which revisions this pass resolves away — see {@link publishAnchoredDrawingsForParagraph}. */
  readonly displayMode?: RevisionDisplayMode;
}): readonly ExclusionZone[] {
  const atoms = anchoredDrawingAtomsInParagraph(options.paragraph, options.drawingLayout);
  if (atoms.length === 0) return Object.freeze([]);
  const offsets = drawingModelOffsetsInParagraph(options.paragraph);
  const displayMode = options.displayMode ?? DEFAULT_REVISION_DISPLAY_MODE;
  const contentWidth = Math.max(1, options.contentRight - options.contentLeft);
  const zones: ExclusionZone[] = [];
  for (const atom of atoms) {
    // A drawing the display mode resolves away publishes no record, so it must carve no
    // hole either: the original view must not wrap text around an insertion it hides.
    if (!revisionsVisible(atom.revisions, displayMode)) continue;
    if (atom.projection.anchor?.behindDocument) continue;
    if (!wrapProducesExclusion(atom.projection.wrap) || atom.projection.wrap === 'topAndBottom')
      continue;
    const modelStart = offsets.get(atom.atomId);
    if (modelStart === undefined) continue;
    const lineTop = options.anchorLineTopByModelStart.get(modelStart);
    if (lineTop === undefined) continue;
    const lineBox = Object.freeze({
      x: options.contentLeft,
      y: lineTop,
      width: contentWidth,
      height: 14,
    });
    const layoutInCell = options.anchorCellBox != null;
    const resolved = resolveAnchoredDrawingPosition(atom.projection, {
      pageNumber: 1,
      pageWidth: options.contentRight + options.contentLeft + contentWidth,
      pageHeight: 792,
      marginLeft: options.contentLeft,
      marginRight: 0,
      marginBottom: 0,
      contentInsetTop: 0,
      contentInsetBottom: 0,
      contentWidth,
      contentHeight: 648,
      contentBandHeight: 648,
      paragraphBox: lineBox,
      anchorLineBox: lineBox,
      anchorCharacterX: options.contentLeft,
      columnBox: lineBox,
      cellBox: layoutInCell ? options.anchorCellBox! : null,
      layoutInCell,
      ownerPartName: options.drawingLayout.ownerPartName,
      storyKind: 'body',
    });
    const anchorY = options.paragraphStartY + lineTop;
    const measure = measureInlineDrawing(atom.projection);
    const geometry = drawingGeometryFromProjection({
      projection: atom.projection,
      anchorX: resolved.x,
      anchorY,
      extentWidth: measure.width,
      extentHeight: measure.height,
    });
    const input = wrapExclusionInputForProjection({
      projection: atom.projection,
      geometry,
      contentLeft: options.contentLeft,
      contentRight: options.contentRight,
      anchorX: resolved.x,
      anchorY,
    });
    if (!input) continue;
    zones.push(
      Object.freeze({
        drawingNodeId: atom.atomId,
        anchorParagraphId: options.paragraphId,
        anchorModelStart: modelStart,
        sourceOrder: options.sourceOrderOf?.(atom.atomId) ?? Number.MAX_SAFE_INTEGER,
        paintLayer: atom.projection.anchor?.behindDocument
          ? ('behind' as const)
          : ('inFront' as const),
        relativeHeight: atom.projection.anchor?.relativeHeight ?? 0,
        allowOverlap: atom.projection.anchor?.allowOverlap ?? true,
        columnIndex: 0,
        y: anchorY,
        verticalBand: verticalBandOfExclusion(input),
        input,
      })
    );
  }
  zones.sort((left, right) => left.sourceOrder - right.sourceOrder);
  return Object.freeze(zones);
}

/** Paragraph-local topAndBottom zones synthesized during break (stable across reflow passes). */
export function synthesizeParagraphTopAndBottomZones(options: {
  readonly paragraph: OoxmlNode;
  readonly paragraphId: string;
  readonly drawingLayout: InlineDrawingLayoutContext;
  readonly contentLeft: number;
  readonly contentRight: number;
  readonly paragraphStartY: number;
  readonly anchorLineTopByModelStart: ReadonlyMap<number, number>;
  readonly sourceOrderOf?: (drawingNodeId: string) => number | undefined;
  readonly columnIndex?: number;
  /** Which revisions this pass resolves away — see {@link publishAnchoredDrawingsForParagraph}. */
  readonly displayMode?: RevisionDisplayMode;
}): readonly ExclusionZone[] {
  const atoms = anchoredDrawingAtomsInParagraph(options.paragraph, options.drawingLayout);
  if (atoms.length === 0) return Object.freeze([]);
  const offsets = drawingModelOffsetsInParagraph(options.paragraph);
  const displayMode = options.displayMode ?? DEFAULT_REVISION_DISPLAY_MODE;
  const zones: ExclusionZone[] = [];
  for (const atom of atoms) {
    // Same rule as the wrap zones above: no record, no hole.
    if (!revisionsVisible(atom.revisions, displayMode)) continue;
    if (atom.projection.anchor?.behindDocument) continue;
    if (atom.projection.wrap !== 'topAndBottom') continue;
    const modelStart = offsets.get(atom.atomId);
    if (modelStart === undefined) continue;
    const lineTop = options.anchorLineTopByModelStart.get(modelStart);
    if (lineTop === undefined) continue;
    const anchorY = options.paragraphStartY + lineTop;
    const measure = measureInlineDrawing(atom.projection);
    const geometry = drawingGeometryFromProjection({
      projection: atom.projection,
      anchorX: options.contentLeft,
      anchorY,
      extentWidth: measure.width,
      extentHeight: measure.height,
    });
    const input = wrapExclusionInputForProjection({
      projection: atom.projection,
      geometry,
      contentLeft: options.contentLeft,
      contentRight: options.contentRight,
      anchorX: options.contentLeft,
      anchorY,
    });
    if (!input) continue;
    zones.push(
      Object.freeze({
        drawingNodeId: atom.atomId,
        anchorParagraphId: options.paragraphId,
        anchorModelStart: modelStart,
        sourceOrder: options.sourceOrderOf?.(atom.atomId) ?? Number.MAX_SAFE_INTEGER,
        paintLayer: atom.projection.anchor?.behindDocument
          ? ('behind' as const)
          : ('inFront' as const),
        relativeHeight: atom.projection.anchor?.relativeHeight ?? 0,
        allowOverlap: atom.projection.anchor?.allowOverlap ?? true,
        columnIndex: options.columnIndex ?? 0,
        y: anchorY,
        verticalBand: verticalBandOfExclusion(input),
        input,
      })
    );
  }
  zones.sort((left, right) => left.sourceOrder - right.sourceOrder);
  return Object.freeze(zones);
}

/** Maximum rechecks when clearing a line below overlapping topAndBottom bands. */
export const MAX_TOP_AND_BOTTOM_CLEARANCE_ATTEMPTS = 8;

function lineIntervalIntersectsTopAndBottomBand(
  lineTop: number,
  lineBottom: number,
  bandTop: number,
  bandBottom: number
): boolean {
  return lineTop < bandBottom && lineBottom > bandTop;
}

/**
 * Vertical skip before placing a line whose [top, bottom] interval intersects a topAndBottom band.
 *
 * Uses the full final line height, unions overlapping band bottoms, and rechecks until clear or
 * {@link MAX_TOP_AND_BOTTOM_CLEARANCE_ATTEMPTS} — pre-placement may pass a minimum height; callers
 * must re-run at line close with the styled/drawing final height.
 */
export function topAndBottomSkipBeforeLine(
  lineTopY: number,
  lineHeight: number,
  zones: readonly ExclusionZone[]
): number {
  if (lineHeight <= 0 || zones.length === 0) return 0;
  let skip = 0;
  for (let attempt = 0; attempt < MAX_TOP_AND_BOTTOM_CLEARANCE_ATTEMPTS; attempt += 1) {
    const intervalTop = lineTopY + skip;
    const intervalBottom = intervalTop + lineHeight;
    let unionBottom = intervalTop;
    let intersects = false;
    for (const zone of zones) {
      if (zone.input.mode !== 'topAndBottom') continue;
      const bandTop = zone.verticalBand.y;
      const bandBottom = bandTop + zone.verticalBand.height;
      if (
        lineIntervalIntersectsTopAndBottomBand(intervalTop, intervalBottom, bandTop, bandBottom)
      ) {
        intersects = true;
        unionBottom = Math.max(unionBottom, bandBottom);
      }
    }
    if (!intersects) break;
    const nextSkip = unionBottom - lineTopY;
    if (nextSkip <= skip + 0.001) break;
    skip = nextSkip;
  }
  return skip;
}

function intervalToken(intervals: readonly ScanlineInterval[]): string {
  return intervals
    .map((interval) => `${interval.start.toFixed(3)}-${interval.end.toFixed(3)}`)
    .join(',');
}

function wrapInputToken(input: WrapExclusionInput): string {
  const bounds = input.contentBounds;
  const distances = input.wrapDistances;
  const effects = input.effectInsets;
  const polygon =
    input.polygon?.map((point) => `${point.x.toFixed(3)},${point.y.toFixed(3)}`).join(';') ?? '';
  const clip =
    input.clipPolygon?.map((point) => `${point.x.toFixed(3)},${point.y.toFixed(3)}`).join(';') ??
    '';
  return [
    input.mode,
    input.textSide,
    bounds.x.toFixed(3),
    bounds.y.toFixed(3),
    bounds.width.toFixed(3),
    bounds.height.toFixed(3),
    distances.top.toFixed(3),
    distances.right.toFixed(3),
    distances.bottom.toFixed(3),
    distances.left.toFixed(3),
    effects.top.toFixed(3),
    effects.right.toFixed(3),
    effects.bottom.toFixed(3),
    effects.left.toFixed(3),
    polygon,
    clip,
  ].join(':');
}

export function exclusionLayoutToken(zones: readonly ExclusionZone[]): string {
  if (zones.length === 0) return '';
  return zones
    .map((zone) => {
      const band = zone.verticalBand;
      const probeY = zone.y + zone.input.contentBounds.height / 2;
      const intervals = mergeAvailableIntervalsAtY(
        probeY,
        [zone],
        zone.input.contentLeft,
        zone.input.contentRight
      );
      return [
        zone.drawingNodeId,
        String(zone.sourceOrder),
        String(zone.columnIndex),
        zone.y.toFixed(3),
        band.x.toFixed(3),
        band.y.toFixed(3),
        band.width.toFixed(3),
        band.height.toFixed(3),
        wrapInputToken(zone.input),
        intervalToken(intervals),
      ].join('|');
    })
    .join('\n');
}

export function paintLayerRecords(
  drawings: readonly AnchoredDrawingRecord[]
): readonly { readonly layer: DrawingPaintLayer; readonly drawing: AnchoredDrawingRecord }[] {
  return Object.freeze(
    sortDrawingsForPaint(drawings).map((drawing) =>
      Object.freeze({ layer: paintLayerOf(drawing), drawing })
    )
  );
}

export function collectExclusionZonesFromDrawings(
  drawings: readonly AnchoredDrawingRecord[],
  drawingLayout: import('./drawing-layout.ts').InlineDrawingLayoutContext,
  contentLeft: number,
  contentRight: number,
  sourceOrderOf?: (drawingNodeId: string) => number | undefined,
  columnLayout?: ExclusionColumnLayout
): readonly ExclusionZone[] {
  const zones: ExclusionZone[] = [];
  for (const drawing of drawings) {
    const projection = drawingLayout.projectionForAtom?.(drawing.drawingNodeId);
    if (!projection) continue;
    const sourceOrder =
      drawing.sourceOrder ?? sourceOrderOf?.(drawing.drawingNodeId) ?? Number.MAX_SAFE_INTEGER;
    const columnIndex =
      columnLayout !== undefined ? columnIndexForDrawing(drawing, columnLayout) : 0;
    const zone = exclusionZoneFromAnchoredDrawing({
      drawing,
      projection,
      sourceOrder,
      contentLeft,
      contentRight,
      columnIndex,
    });
    if (zone) zones.push(zone);
  }
  zones.sort((left, right) => left.sourceOrder - right.sourceOrder);
  return Object.freeze(zones);
}

export function collectExclusionZonesByPage(
  pages: readonly import('./semantic-records.ts').PageRecord[],
  drawingLayout: import('./drawing-layout.ts').InlineDrawingLayoutContext,
  contentWidth: number,
  sourceOrderOf?: (drawingNodeId: string) => number | undefined,
  columnLayout?: ExclusionColumnLayout
): ReadonlyMap<number, readonly ExclusionZone[]> {
  const layout: ExclusionColumnLayout =
    columnLayout ?? Object.freeze({ columnCount: 1, columnGapPt: 0, contentWidth });
  const out = new Map<number, readonly ExclusionZone[]>();
  for (const page of pages) {
    const drawings = page.anchoredDrawings ?? [];
    const zones = collectExclusionZonesFromDrawings(
      drawings,
      drawingLayout,
      0,
      contentWidth,
      sourceOrderOf,
      layout
    );
    if (zones.length > 0) out.set(page.index, zones);
  }
  return out;
}

/**
 * Zone maps memoized on the pages array plus every input that can move a zone.
 *
 * The wrap-exclusion wrapper collects zones from each section's PREVIOUS pages before every
 * pass, and a multi-section document runs that wrapper once per section per keystroke — for
 * unchanged sections the pages array comes back by identity, so the collection is a replay.
 * The column layout is a fresh object per call, so it keys by content, not identity.
 */
interface ExclusionZonesMemoEntry {
  readonly drawingLayout: import('./drawing-layout.ts').InlineDrawingLayoutContext;
  readonly drawingLayoutEpoch: string | undefined;
  readonly contentWidth: number;
  readonly drawingSourceOrder: ReadonlyMap<string, number> | undefined;
  readonly columnToken: string;
  readonly zones: ReadonlyMap<number, readonly ExclusionZone[]>;
}

const exclusionZonesByPageMemos = new WeakMap<
  readonly import('./semantic-records.ts').PageRecord[],
  ExclusionZonesMemoEntry
>();

function columnLayoutToken(layout: ExclusionColumnLayout | undefined): string {
  if (!layout) return '';
  return `${layout.columnCount};${layout.columnGapPt};${layout.contentWidth};${(layout.columnLefts ?? []).join(',')};${(layout.columnWidths ?? []).join(',')}`;
}

export function collectExclusionZonesByPageMemoized(
  pages: readonly import('./semantic-records.ts').PageRecord[],
  drawingLayout: import('./drawing-layout.ts').InlineDrawingLayoutContext,
  /** Projection epoch of the owning part — the context object keeps identity across it. */
  drawingLayoutEpoch: string | undefined,
  contentWidth: number,
  // The source-order LOOKUP is derived here from the keyed map, never passed in: a caller-
  // supplied closure could disagree with the map the memo keys on, and the key could not see
  // it — warm passes would then serve zones computed under a different drawing order.
  drawingSourceOrder: ReadonlyMap<string, number> | undefined,
  columnLayout?: ExclusionColumnLayout
): ReadonlyMap<number, readonly ExclusionZone[]> {
  const columnToken = columnLayoutToken(columnLayout);
  const cached = exclusionZonesByPageMemos.get(pages);
  if (
    cached &&
    cached.drawingLayout === drawingLayout &&
    cached.drawingLayoutEpoch === drawingLayoutEpoch &&
    cached.contentWidth === contentWidth &&
    cached.drawingSourceOrder === drawingSourceOrder &&
    cached.columnToken === columnToken
  ) {
    return cached.zones;
  }
  const zones = collectExclusionZonesByPage(
    pages,
    drawingLayout,
    contentWidth,
    drawingSourceOrder
      ? (drawingNodeId: string) => drawingSourceOrder.get(drawingNodeId)
      : undefined,
    columnLayout
  );
  exclusionZonesByPageMemos.set(pages, {
    drawingLayout,
    drawingLayoutEpoch,
    contentWidth,
    drawingSourceOrder,
    columnToken,
    zones,
  });
  return zones;
}

export function exclusionMapsEqual(
  left: ReadonlyMap<number, readonly ExclusionZone[]>,
  right: ReadonlyMap<number, readonly ExclusionZone[]>
): boolean {
  if (left.size !== right.size) return false;
  for (const [page, zones] of left) {
    const other = right.get(page);
    if (!other || exclusionLayoutToken(zones) !== exclusionLayoutToken(other)) return false;
  }
  return true;
}

/** Stable serialization of every page's exclusion zones — used for reflow cycle detection. */
export function exclusionMapsToken(
  zonesByPage: ReadonlyMap<number, readonly ExclusionZone[]>
): string {
  if (zonesByPage.size === 0) return '';
  return [...zonesByPage.entries()]
    .sort(([leftPage], [rightPage]) => leftPage - rightPage)
    .map(([page, zones]) => `${page}:${exclusionLayoutToken(zones)}`)
    .join('\n');
}
