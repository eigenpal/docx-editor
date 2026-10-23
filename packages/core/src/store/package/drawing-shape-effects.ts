// Shape effects painters can draw: the outer shadow (`a:outerShdw`). It comes from the shape's
// own `a:effectLst`, which replaces the theme effects, or from the theme effect style its
// `effectRef` names. Other effects (glow, reflection, soft edges, 3-D) are not painted.

import { themeEffectStyle } from './drawing-group-theme-effects.ts';
import { findDirectChild } from './drawing-shape-readers.ts';
import { isElement } from './drawing-projection-walk.ts';
import {
  resolveColorNode,
  type ShapeColor,
  type ShapeSchemeColorResolver,
} from './drawing-shape-color.ts';
import type { ShapeStyleMatrixResolver } from './drawing-shape-projection.ts';
import { collapseSchemaWhitespace, schemaAttributeValue } from './ooxml-drawing-rules.ts';
import { DRAWINGML_MAIN_NAMESPACE_URI, type OoxmlElement } from './ooxml-tree.ts';

const A = DRAWINGML_MAIN_NAMESPACE_URI;
/** Larger shadow distances and blurs are clamped: they would only add empty paint area. */
const MAX_SHADOW_EMU = 1_270_000;

/** An outer shadow: the shape's silhouette, offset, blurred and filled in one colour. */
export interface ShapeShadow {
  /** Offset of the silhouette, in the component's point space. */
  readonly dxEmu: number;
  readonly dyEmu: number;
  /** Blur radius in the same units; 0 is a crisp silhouette. */
  readonly blurEmu: number;
  /** Validated six-character sRGB hex, without `#`. */
  readonly hex: string;
  readonly alpha: number;
}

function nonNegative(element: OoxmlElement, name: string): number {
  const raw = schemaAttributeValue(element.attributes, name);
  if (raw === undefined) return 0;
  const collapsed = collapseSchemaWhitespace(raw);
  if (!/^\d{1,10}$/.test(collapsed)) return 0;
  return Math.min(MAX_SHADOW_EMU, Number(collapsed));
}

/** How a shape is flipped and turned, for shadows that turn with it. */
export interface ShapeTurn {
  readonly flipH: boolean;
  readonly flipV: boolean;
  readonly rotationDegrees: number;
}

function shadowOf(
  effectLst: OoxmlElement,
  resolveSchemeColor: ShapeSchemeColorResolver | undefined,
  placeholder: ShapeColor | undefined,
  turn: ShapeTurn | undefined
): ShapeShadow | null {
  const outer = findDirectChild(effectLst.children, { namespaceUri: A, localName: 'outerShdw' });
  if (!outer) return null;
  let colorNode: OoxmlElement | null = null;
  for (const node of outer.children) {
    if (isElement(node)) {
      colorNode = node;
      break;
    }
  }
  // An outer shadow with no colour is black at full strength (ECMA-376 20.1.8.49).
  const color = colorNode
    ? resolveColorNode(colorNode, resolveSchemeColor, placeholder)
    : { hex: '000000', alpha: 1 };
  if (!color || color.alpha <= 0) return null;
  const distance = nonNegative(outer, 'dist');
  const rawDirection = collapseSchemaWhitespace(
    schemaAttributeValue(outer.attributes, 'dir') ?? '0'
  );
  const direction = /^\d{1,9}$/.test(rawDirection) ? Number(rawDirection) / 60_000 : 0;
  const radians = (direction * Math.PI) / 180;
  let dx = distance * Math.cos(radians);
  let dy = distance * Math.sin(radians);
  // A shadow turns and flips with its shape unless `rotWithShape` is off (it defaults on).
  const rotWithShape = schemaAttributeValue(outer.attributes, 'rotWithShape');
  if (turn && rotWithShape !== '0' && rotWithShape !== 'false') {
    if (turn.flipH) dx = -dx;
    if (turn.flipV) dy = -dy;
    const angle = (turn.rotationDegrees * Math.PI) / 180;
    [dx, dy] = [
      dx * Math.cos(angle) - dy * Math.sin(angle),
      dx * Math.sin(angle) + dy * Math.cos(angle),
    ];
  }
  return {
    dxEmu: dx,
    dyEmu: dy,
    blurEmu: nonNegative(outer, 'blurRad'),
    hex: color.hex,
    alpha: color.alpha,
  };
}

/** The outer shadow a shape paints, or null when it has none the painters can draw. */
export function readShapeShadow(
  shape: OoxmlElement,
  spPr: OoxmlElement,
  resolveSchemeColor?: ShapeSchemeColorResolver,
  resolveStyleMatrixReference?: ShapeStyleMatrixResolver,
  turn?: ShapeTurn
): ShapeShadow | null {
  const direct = findDirectChild(spPr.children, { namespaceUri: A, localName: 'effectLst' });
  if (direct) return shadowOf(direct, resolveSchemeColor, undefined, turn);
  const style = findDirectChild(shape.children, {
    namespaceUri: shape.namespaceUri,
    localName: 'style',
  });
  const reference = style
    ? findDirectChild(style.children, { namespaceUri: A, localName: 'effectRef' })
    : null;
  if (!reference) return null;
  const raw = collapseSchemaWhitespace(schemaAttributeValue(reference.attributes, 'idx') ?? '');
  if (!/^\d{1,4}$/.test(raw) || Number(raw) === 0) return null;
  const effectStyle = themeEffectStyle(resolveStyleMatrixReference, Number(raw));
  const effectLst = effectStyle
    ? findDirectChild(effectStyle.children, { namespaceUri: A, localName: 'effectLst' })
    : null;
  if (!effectLst) return null;
  let placeholderNode: OoxmlElement | null = null;
  for (const node of reference.children) {
    if (isElement(node)) {
      placeholderNode = node;
      break;
    }
  }
  const placeholder = placeholderNode
    ? (resolveColorNode(placeholderNode, resolveSchemeColor) ?? undefined)
    : undefined;
  return shadowOf(effectLst, resolveSchemeColor, placeholder, turn);
}

/** The rim a dark-edged bevel shows, as an outline inside the shape. */
const DARK_EDGE = Object.freeze({ hex: '000000', alpha: 0.55 });
const DEFAULT_BEVEL_WIDTH_EMU = 76_200;

/**
 * The dark rim of a `dkEdge` bevel (`a:sp3d prstMaterial="dkEdge"` with `a:bevelT` or
 * `a:bevelB`): an inset outline as wide as the bevel, between 0.25 pt and 2 pt. Lit bevel
 * faces and other materials are not drawn. Null when the shape has no such bevel.
 */
export function darkEdgeOutline(
  spPr: OoxmlElement
): { readonly widthEmu: number; readonly hex: string; readonly alpha: number } | null {
  const sp3d = findDirectChild(spPr.children, { namespaceUri: A, localName: 'sp3d' });
  if (!sp3d || schemaAttributeValue(sp3d.attributes, 'prstMaterial') !== 'dkEdge') return null;
  const bevel =
    findDirectChild(sp3d.children, { namespaceUri: A, localName: 'bevelT' }) ??
    findDirectChild(sp3d.children, { namespaceUri: A, localName: 'bevelB' });
  if (!bevel) return null;
  const width = nonNegative(bevel, 'w') || DEFAULT_BEVEL_WIDTH_EMU;
  return { widthEmu: Math.max(3_175, Math.min(25_400, width)), ...DARK_EDGE };
}
