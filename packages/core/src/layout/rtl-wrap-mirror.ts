// The x space a paragraph's lines break in beside floats.
//
// A right-to-left line fills the passages a float leaves it from right to left: its first
// words take the rightmost passage, and the text then continues in the passage to the left of
// the float. The line breaker moves its pen one way only, from the line's start edge, so a
// right-to-left paragraph breaks in x mirrored about its own measure. There the start edge is
// on the left and the rightmost passage is the first one the pen meets. Every zone the breaker
// reads is mirrored once, so passages, wrap sides, wrap distances, and clearance all agree.
// Alignment maps each part of the line back to its physical passage
// (`lineAlignmentMeasure`).

import type { DrawingInsets, DrawingPoint } from './drawing-geometry.ts';
import type { ExclusionZone } from './drawing-exclusion.ts';
import type { WrapTextSide } from './drawing-wrap.ts';
import type { LayoutBox } from './semantic-records.ts';
import {
  carryHorizontalResolution,
  type TextWrappingBreakClear,
} from './text-wrapping-break-clear.ts';

/** Where a paragraph's pen breaks lines beside floats. */
export interface WrapBreakSpace {
  /** The left bound of the pen's x space: the paragraph's content left, or its mirror. */
  readonly left: number;
  /** The right bound of the pen's x space. */
  readonly right: number;
  /** True when lines break in x mirrored about the paragraph's measure. */
  readonly mirrored: boolean;
  /** The zones as the pen sees them. Each zone maps to one stable mirrored copy. */
  readonly zones: (zones: readonly ExclusionZone[]) => readonly ExclusionZone[];
  /** The physical side a `w:br w:clear` names, as a side of the pen's x space. */
  readonly clearSide: (clear: TextWrappingBreakClear) => TextWrappingBreakClear;
}

/**
 * The break space of a paragraph whose measure starts at `lineLeft` and is `width` wide. A
 * left-to-right paragraph breaks in physical x, between `contentLeft` and `wrapRight`. A
 * right-to-left paragraph mirrors x about its measure, so the pen's first line origin (after a
 * first-line indent) maps to the physical right edge less that indent. Its bounds are those
 * edges mirrored; the near bound also reaches a hanging first line, which starts before the
 * measure in that space.
 */
export function wrapBreakSpace(
  rightToLeft: boolean,
  lineLeft: number,
  width: number,
  edges: {
    readonly firstLineOffset: number;
    readonly contentLeft: number;
    readonly wrapRight: number;
  }
): WrapBreakSpace {
  const { contentLeft, wrapRight } = edges;
  if (!rightToLeft) {
    return {
      left: contentLeft,
      right: wrapRight,
      mirrored: false,
      zones: (zones) => zones,
      clearSide: (clear) => clear,
    };
  }
  const axis = 2 * lineLeft + width;
  const mirrors = new WeakMap<ExclusionZone, ExclusionZone>();
  const mirror = (zone: ExclusionZone): ExclusionZone => {
    let image = mirrors.get(zone);
    if (!image) {
      image = mirrorExclusionZone(zone, axis);
      carryHorizontalResolution(zone, image);
      mirrors.set(zone, image);
    }
    return image;
  };
  return {
    left: Math.min(axis - wrapRight, lineLeft + Math.min(0, edges.firstLineOffset)),
    right: axis - contentLeft,
    mirrored: true,
    zones: (zones) => (zones.length === 0 ? zones : Object.freeze(zones.map(mirror))),
    clearSide: (clear) => (clear === 'left' ? 'right' : clear === 'right' ? 'left' : clear),
  };
}

/** `zone` reflected about the vertical line `x = axis / 2`. */
export function mirrorExclusionZone(zone: ExclusionZone, axis: number): ExclusionZone {
  const input = zone.input;
  return Object.freeze({
    ...zone,
    verticalBand: mirrorBox(zone.verticalBand, axis),
    input: Object.freeze({
      ...input,
      contentBounds: mirrorBox(input.contentBounds, axis),
      polygon: mirrorPolygon(input.polygon, axis),
      clipPolygon: mirrorPolygon(input.clipPolygon, axis),
      wrapDistances: mirrorInsets(input.wrapDistances),
      effectInsets: mirrorInsets(input.effectInsets),
      textSide: mirrorTextSide(input.textSide),
      contentLeft: axis - input.contentRight,
      contentRight: axis - input.contentLeft,
    }),
  });
}

function mirrorBox(box: LayoutBox, axis: number): LayoutBox {
  return Object.freeze({ ...box, x: axis - box.x - box.width });
}

function mirrorPolygon(
  polygon: readonly DrawingPoint[] | null,
  axis: number
): readonly DrawingPoint[] | null {
  if (!polygon) return polygon;
  return Object.freeze(polygon.map((point) => Object.freeze({ x: axis - point.x, y: point.y })));
}

function mirrorInsets(insets: DrawingInsets): DrawingInsets {
  return Object.freeze({ ...insets, left: insets.right, right: insets.left });
}

/**
 * A wrap side names a physical side, so it swaps. `largest` stays: on a tie it keeps the
 * pen's far side, which is the physical left in a right-to-left paragraph.
 */
function mirrorTextSide(side: WrapTextSide): WrapTextSide {
  return side === 'left' ? 'right' : side === 'right' ? 'left' : side;
}
