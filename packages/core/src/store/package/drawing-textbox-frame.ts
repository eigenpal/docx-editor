// The shape around a DrawingML text box (`wps:wsp` with `wps:txbx`): the outline of its
// preset or custom geometry, the text rectangle that geometry names, its turn, and its text
// flow. It reuses the frame a legacy text box paints with, so layout and both painters treat
// the two the same way.

import type { TextboxLegacyFrame } from './drawing-shape-projection.ts';
import { readShapeGeometry, shapeRotationDegrees } from './drawing-shape-geometry.ts';
import { findDirectChild } from './drawing-shape-readers.ts';
import { schemaFlagIsSet } from './drawing-group-frame.ts';
import { schemaAttributeValue } from './ooxml-drawing-rules.ts';
import { DRAWINGML_MAIN_NAMESPACE_URI, type OoxmlElement } from './ooxml-tree.ts';

const A = DRAWINGML_MAIN_NAMESPACE_URI;
/** An outline with more points than this keeps the plain box. */
const MAX_OUTLINE_POINTS = 1024;

type Edges = { top: number; right: number; bottom: number; left: number };

/**
 * The space between a shape box and its text rectangle (`a:rect`, CT_GeomRect, ECMA-376
 * Part 1, 20.1.9.22), in EMU. The rectangle is given in the geometry's own space, so a flip
 * of the shape (`a:xfrm/@flipH`, `@flipV`, 20.1.7.6) mirrors it with the geometry.
 */
function flippedTextArea(
  rect: Readonly<{ left: number; top: number; right: number; bottom: number }>,
  extent: Readonly<{ cx: number; cy: number }>,
  flipH: boolean,
  flipV: boolean
): Edges {
  const { cx, cy } = extent;
  const left = flipH ? cx - rect.right : rect.left;
  const right = flipH ? rect.left : cx - rect.right;
  const top = flipV ? cy - rect.bottom : rect.top;
  const bottom = flipV ? rect.top : cy - rect.bottom;
  return {
    top: Math.max(0, top),
    right: Math.max(0, right),
    bottom: Math.max(0, bottom),
    left: Math.max(0, left),
  };
}

/** Whether the shape is a plain rectangle: no custom geometry and no other preset. */
function isRectangle(spPr: OoxmlElement): boolean {
  const prstGeom = findDirectChild(spPr.children, { namespaceUri: A, localName: 'prstGeom' });
  const custGeom = findDirectChild(spPr.children, { namespaceUri: A, localName: 'custGeom' });
  const preset = prstGeom ? schemaAttributeValue(prstGeom.attributes, 'prst') : undefined;
  return !custGeom && (preset === undefined || preset === 'rect');
}

/**
 * The space between a shape box of `extent` and the text rectangle its preset or custom
 * geometry names, in EMU, with the shape's own flips applied. All zero for a rectangle, and
 * for a geometry that does not evaluate: the text then takes the whole box. `groupFlips` names
 * the net flip of the groups around the shape (`a:xfrm`, ECMA-376 Part 1, 20.1.7.5): each
 * mirrors the geometry, and so the rectangle, once more.
 *
 * A text box member of a canvas or a group lays its text out in this area, as a top-level
 * text box does through {@link drawingTextboxFrame}.
 */
export function shapeTextAreaEmu(
  spPr: OoxmlElement,
  extent: Readonly<{ cx: number; cy: number }>,
  groupFlips: Readonly<{ flipH: boolean; flipV: boolean }> = { flipH: false, flipV: false }
): Edges {
  const none = { top: 0, right: 0, bottom: 0, left: 0 };
  if (extent.cx <= 0 || extent.cy <= 0 || isRectangle(spPr)) return none;
  const geometry = readShapeGeometry(spPr, extent);
  if (!geometry) return none;
  const xfrm = findDirectChild(spPr.children, { namespaceUri: A, localName: 'xfrm' });
  const flipH = xfrm !== null && schemaFlagIsSet(schemaAttributeValue(xfrm.attributes, 'flipH'));
  const flipV = xfrm !== null && schemaFlagIsSet(schemaAttributeValue(xfrm.attributes, 'flipV'));
  // A flip of a group around the shape mirrors the shape once more.
  return flippedTextArea(
    geometry.textRect,
    extent,
    flipH !== groupFlips.flipH,
    flipV !== groupFlips.flipV
  );
}

/**
 * The frame of a top-level text box, or null when it is an upright rectangle with horizontal
 * text, which paints as the plain box. Null too when the geometry does not evaluate.
 */
export function drawingTextboxFrame(
  spPr: OoxmlElement,
  bodyPr: OoxmlElement | null,
  extent: Readonly<{ cx: number; cy: number }>
): TextboxLegacyFrame | null {
  const xfrm = findDirectChild(spPr.children, { namespaceUri: A, localName: 'xfrm' });
  const turn = shapeRotationDegrees(xfrm);
  if (turn === null) return null;
  const rotationDegrees = ((turn % 360) + 360) % 360;
  const vert = bodyPr ? schemaAttributeValue(bodyPr.attributes, 'vert') : undefined;
  const flow: TextboxLegacyFrame['flow'] =
    vert === 'vert' || vert === 'eaVert' || stacksLinesLeftToRight(vert)
      ? 'vertical'
      : vert === 'vert270'
        ? 'verticalBottomToTop'
        : 'horizontal';
  const rectangle = isRectangle(spPr);
  const flipH = xfrm !== null && schemaFlagIsSet(schemaAttributeValue(xfrm.attributes, 'flipH'));
  const flipV = xfrm !== null && schemaFlagIsSet(schemaAttributeValue(xfrm.attributes, 'flipV'));
  if (rectangle && rotationDegrees === 0 && flow === 'horizontal' && !flipV) return null;

  const { cx, cy } = extent;
  let outline: TextboxLegacyFrame['outline'] = null;
  let textAreaEmu: Edges = { top: 0, right: 0, bottom: 0, left: 0 };
  if (!rectangle) {
    const geometry = readShapeGeometry(spPr, extent);
    if (!geometry) return null;
    const subpaths: { x: number; y: number }[][] = [];
    let points = 0;
    for (const path of geometry.paths) {
      if (path.fill === 'none') continue;
      for (const subpath of path.subpaths) {
        points += subpath.points.length;
        if (points > MAX_OUTLINE_POINTS) return null;
        subpaths.push(
          subpath.points.map((point) => ({
            x: flipH ? 1 - point.x / cx : point.x / cx,
            y: flipV ? 1 - point.y / cy : point.y / cy,
          }))
        );
      }
    }
    if (!subpaths.length) return null;
    outline = { kind: 'polygon', subpaths };
    textAreaEmu = flippedTextArea(geometry.textRect, extent, flipH, flipV);
  }
  const upright = bodyPr ? schemaAttributeValue(bodyPr.attributes, 'upright') : undefined;
  return {
    textAreaEmu,
    outline,
    rotationDegrees,
    textTurnsWithShape: !schemaFlagIsSet(upright),
    flow,
    // A vertical flip turns the text upside down; a horizontal flip leaves it readable.
    ...(flipV ? { textFlipped: true as const } : {}),
    ...(outline
      ? {
          textAreaRule: {
            kind: 'share' as const,
            top: textAreaEmu.top / cy,
            right: textAreaEmu.right / cx,
            bottom: textAreaEmu.bottom / cy,
            left: textAreaEmu.left / cx,
          },
        }
      : {}),
  };
}

/**
 * Whether `wps:bodyPr/@vert` (ST_TextVerticalType, ECMA-376 Part 1, 20.1.10.83) is a mode that
 * lays out as text turned a quarter clockwise with its lines stacked from left to right:
 * `wordArtVert`, `wordArtVertRtl` and `mongolianVert`.
 */
export function stacksLinesLeftToRight(vert: string | undefined): boolean {
  return vert === 'wordArtVert' || vert === 'wordArtVertRtl' || vert === 'mongolianVert';
}
