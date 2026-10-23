// Shape effects painters can draw: the outer shadow (`a:outerShdw`) and the glow (`a:glow`).
// They come from the shape's own `a:effectLst`, which replaces the theme effects, or from the
// theme effect style its `effectRef` names. Reflection, soft edges, and 3-D are not painted.

import { themeEffectStyle } from './drawing-group-theme-effects.ts';
import { findDirectChild } from './drawing-shape-readers.ts';
import { isElement } from './drawing-projection-walk.ts';
import {
  resolveColorNode,
  type ShapeColor,
  type ShapeSchemeColorResolver,
} from './drawing-shape-color.ts';
import type { ShapeStyleMatrixResolver, VectorShapeComponent } from './drawing-shape-projection.ts';
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

/**
 * The effect list a shape paints with: its own `a:effectLst`, or the theme effect style its
 * `effectRef` names, with that reference's colour as the placeholder colour.
 */
function effectList(
  shape: OoxmlElement,
  spPr: OoxmlElement,
  resolveSchemeColor?: ShapeSchemeColorResolver,
  resolveStyleMatrixReference?: ShapeStyleMatrixResolver
): { readonly effectLst: OoxmlElement; readonly placeholder?: ShapeColor } | null {
  const direct = findDirectChild(spPr.children, { namespaceUri: A, localName: 'effectLst' });
  if (direct) return { effectLst: direct };
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
  return { effectLst, ...(placeholder ? { placeholder } : {}) };
}

/** The outer shadow a shape paints, or null when it has none the painters can draw. */
export function readShapeShadow(
  shape: OoxmlElement,
  spPr: OoxmlElement,
  resolveSchemeColor?: ShapeSchemeColorResolver,
  resolveStyleMatrixReference?: ShapeStyleMatrixResolver,
  turn?: ShapeTurn
): ShapeShadow | null {
  const list = effectList(shape, spPr, resolveSchemeColor, resolveStyleMatrixReference);
  return list ? shadowOf(list.effectLst, resolveSchemeColor, list.placeholder, turn) : null;
}

/** A glow (`a:glow`): a soft halo of its colour around the shape. */
export interface ShapeGlow {
  readonly radiusEmu: number;
  readonly hex: string;
  readonly alpha: number;
}

/** The glow a shape paints, or null when it has none. */
export function readShapeGlow(
  shape: OoxmlElement,
  spPr: OoxmlElement,
  resolveSchemeColor?: ShapeSchemeColorResolver,
  resolveStyleMatrixReference?: ShapeStyleMatrixResolver
): ShapeGlow | null {
  const list = effectList(shape, spPr, resolveSchemeColor, resolveStyleMatrixReference);
  const glow = list
    ? findDirectChild(list.effectLst.children, { namespaceUri: A, localName: 'glow' })
    : null;
  if (!list || !glow) return null;
  const radiusEmu = nonNegative(glow, 'rad');
  const colorNode = glow.children.find(isElement);
  const color = colorNode
    ? resolveColorNode(colorNode, resolveSchemeColor, list.placeholder)
    : null;
  if (!color || color.alpha <= 0 || radiusEmu <= 0) return null;
  return { radiusEmu, hex: color.hex, alpha: color.alpha };
}

/** A mirror image below the shape that fades out downward (`a:reflection`). @public */
export interface ShapeReflection {
  /** Opacity where the mirror image meets the shape. */
  readonly startAlpha: number;
  /** Opacity at `endPosition`; below it the mirror image is clear. */
  readonly endAlpha: number;
  /** Where the fade ends, as a share of the shape's height. */
  readonly endPosition: number;
  /** Gap between the shape and its mirror image. */
  readonly distanceEmu: number;
  readonly blurEmu: number;
}

/** A positive fixed percentage: thousandths of a percent, or a `%` value. */
function share(element: OoxmlElement, name: string, fallback: number): number | null {
  const raw = schemaAttributeValue(element.attributes, name);
  if (raw === undefined) return fallback;
  const text = collapseSchemaWhitespace(raw);
  const value = /^-?\d{1,7}$/.test(text)
    ? Number(text) / 100_000
    : /^-?\d{1,4}(\.\d{1,3})?%$/.test(text)
      ? Number(text.slice(0, -1)) / 100
      : null;
  return value === null ? null : value;
}

/**
 * The reflection a shape paints, or null when it has none or uses a form outside the painted
 * subset: a straight mirror image below the shape (`sy` -100%, no skew or horizontal scale),
 * fading downward.
 */
export function readShapeReflection(
  shape: OoxmlElement,
  spPr: OoxmlElement,
  resolveSchemeColor?: ShapeSchemeColorResolver,
  resolveStyleMatrixReference?: ShapeStyleMatrixResolver
): ShapeReflection | null {
  const list = effectList(shape, spPr, resolveSchemeColor, resolveStyleMatrixReference);
  const reflection = list
    ? findDirectChild(list.effectLst.children, { namespaceUri: A, localName: 'reflection' })
    : null;
  if (!reflection) return null;
  const angle = (name: string, fallback: number) => {
    const raw = collapseSchemaWhitespace(schemaAttributeValue(reflection.attributes, name) ?? '');
    return raw === '' ? fallback : /^-?\d{1,9}$/.test(raw) ? Number(raw) : null;
  };
  const sx = share(reflection, 'sx', 1);
  const sy = share(reflection, 'sy', 1);
  const startAlpha = share(reflection, 'stA', 1);
  const startPosition = share(reflection, 'stPos', 0);
  const endAlpha = share(reflection, 'endA', 0);
  const endPosition = share(reflection, 'endPos', 1);
  const algn = schemaAttributeValue(reflection.attributes, 'algn') ?? 'b';
  if (
    sx !== 1 ||
    sy !== -1 ||
    angle('kx', 0) !== 0 ||
    angle('ky', 0) !== 0 ||
    angle('dir', 0) !== 5_400_000 ||
    angle('fadeDir', 5_400_000) !== 5_400_000 ||
    startPosition !== 0 ||
    (algn !== 'b' && algn !== 'bl' && algn !== 'br') ||
    startAlpha === null ||
    endAlpha === null ||
    endPosition === null ||
    endPosition <= 0
  ) {
    return null;
  }
  return {
    startAlpha: Math.max(0, Math.min(1, startAlpha)),
    endAlpha: Math.max(0, Math.min(1, endAlpha)),
    endPosition: Math.min(1, endPosition),
    distanceEmu: nonNegative(reflection, 'dist'),
    blurEmu: nonNegative(reflection, 'blurRad'),
  };
}

/** The soft edge radius of a shape (`a:softEdge`): its edge fades out over it. 0 for none. */
export function readShapeSoftEdge(
  shape: OoxmlElement,
  spPr: OoxmlElement,
  resolveSchemeColor?: ShapeSchemeColorResolver,
  resolveStyleMatrixReference?: ShapeStyleMatrixResolver
): number {
  const list = effectList(shape, spPr, resolveSchemeColor, resolveStyleMatrixReference);
  const softEdge = list
    ? findDirectChild(list.effectLst.children, { namespaceUri: A, localName: 'softEdge' })
    : null;
  return softEdge ? nonNegative(softEdge, 'rad') : 0;
}

/**
 * A glow as a component that paints only its shadow: the outline of `subpathsEmu` widened by
 * half the glow radius and blurred with a standard deviation of a sixth of it, which puts the
 * halo's half-strength edge half the radius out and its last trace at the radius.
 */
export function glowComponent(
  glow: ShapeGlow,
  subpathsEmu: readonly (readonly Readonly<{ x: number; y: number }>[])[],
  subpathsClosed: readonly boolean[],
  filled: boolean,
  /** The width of the outline the glow surrounds, for an unfilled shape such as a line. */
  baseWidthEmu = 0
): VectorShapeComponent {
  return {
    subpathsEmu,
    subpathsClosed,
    fillHex: filled ? glow.hex : null,
    fillAlpha: 1,
    strokeHex: glow.hex,
    strokeAlpha: 1,
    strokeWidthEmu: glow.radiusEmu + baseWidthEmu,
    strokeJoin: 'round',
    strokeCap: 'round',
    shadow: {
      dxEmu: 0,
      dyEmu: 0,
      blurEmu: (glow.radiusEmu * 2) / 3,
      hex: glow.hex,
      alpha: glow.alpha,
    },
    shadowOnly: true,
  };
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
