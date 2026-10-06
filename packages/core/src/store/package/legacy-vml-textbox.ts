// The text-box story of a legacy VML shape: `v:textbox` → `w:txbxContent`.
//
// The story is ordinary WML content. This module validates only the wrapper and reads the
// shape chrome and inner margins; story layout bounds the content by its own limits. Every value
// read here comes from the file, so each one is bounded or refused before it leaves.

import type { TextboxStoryProjection } from './drawing-shape-projection.ts';
import { WML_NAMESPACE_URI, type OoxmlElement } from './ooxml-tree.ts';
import {
  attribute as a,
  children,
  color,
  named,
  numeric,
  off,
  OFFICE,
  points,
  styleOf,
  VML,
  WORD_VML,
} from './legacy-vml-values.ts';

const EMU_PER_POINT = 12_700;
/** The `v:textbox/@inset` defaults: 0.1 in left and right, 0.05 in top and bottom. */
const DEFAULT_INSET_POINTS = Object.freeze({ left: 7.2, top: 3.6, right: 7.2, bottom: 3.6 });
const MAX_INSET_POINTS = 1000;
const MAX_STROKE_POINTS = 100;

/** A validated `v:textbox` and its story root. */
export interface LegacyTextbox {
  readonly textbox: OoxmlElement;
  readonly content: OoxmlElement;
}

/** Shape kinds whose text box paints as a rectangle with the story inside. */
const TEXTBOX_HOSTS = new Set(['shape', 'rect', 'roundrect']);
/** Shape types that are plain rectangles: no type, the rectangle, and the text box template. */
const RECTANGLE_TYPES = new Set([undefined, '#_x0000_t1', '#_x0000_t202']);
/** Chrome children the text box reads, or keeps without painting (`v:shadow`). */
const CHROME_CHILDREN = new Set(['fill', 'stroke', 'shadow', 'path', 'textbox']);

/**
 * The text box of a VML shape: undefined when the shape has none, null when this subset
 * refuses it. A refused text box refuses the whole shape, as before, rather than paint a frame
 * whose text is missing.
 */
export function legacyTextbox(root: OoxmlElement): LegacyTextbox | null | undefined {
  const boxes = children(root).filter((child) => named(child, VML, 'textbox'));
  if (boxes.length === 0) return undefined;
  if (boxes.length > 1 || !TEXTBOX_HOSTS.has(root.localName)) return null;
  if (root.localName === 'shape' && (!RECTANGLE_TYPES.has(a(root, 'type')) || a(root, 'path')))
    return null;
  for (const child of children(root)) {
    if (child.namespaceUri === VML && CHROME_CHILDREN.has(child.localName)) continue;
    if (named(child, OFFICE, 'lock') || named(child, WORD_VML, 'wrap')) continue;
    if (named(child, WORD_VML, 'anchorlock') && child.attributes.length === 0) continue;
    return null;
  }
  // A shape path child may move the text rectangle; only the template's inert flags pass.
  for (const path of children(root).filter((child) => named(child, VML, 'path'))) {
    if (
      children(path).length ||
      path.attributes.some(
        (attr) =>
          !(
            (!attr.namespaceUri && ['gradientshapeok', 'arrowok'].includes(attr.localName)) ||
            (attr.namespaceUri === OFFICE && attr.localName === 'connecttype')
          )
      )
    )
      return null;
  }
  const textbox = boxes[0]!;
  const content = children(textbox);
  if (content.length !== 1 || !named(content[0]!, WML_NAMESPACE_URI, 'txbxContent')) return null;
  if (
    textbox.attributes.some(
      (attr) =>
        !(
          (!attr.namespaceUri && ['id', 'style', 'inset'].includes(attr.localName)) ||
          (attr.namespaceUri === OFFICE && ['singleclick', 'insetmode'].includes(attr.localName))
        )
    )
  )
    return null;
  const style = styleOf(textbox);
  if (!style) return null;
  for (const [key, value] of style) {
    if (key === 'mso-fit-shape-to-text' || key === 'mso-next-textbox') continue;
    // Vertical text flow is not laid out; refuse it rather than paint it horizontally.
    if (key === 'layout-flow' && value === 'horizontal') continue;
    return null;
  }
  return Object.freeze({ textbox, content: content[0]! });
}

/** One `inset` component in points; the default when empty, NaN when malformed. */
function insetPoints(raw: string | undefined, fallback: number): number {
  const value = raw?.trim();
  if (!value) return fallback;
  const parsed = points(value);
  if (!Number.isFinite(parsed) || parsed > MAX_INSET_POINTS) return NaN;
  return Math.max(0, parsed);
}

/** `v-text-anchor` on the shape style, collapsed to the three renderable positions. */
function verticalAnchor(value: string | undefined): TextboxStoryProjection['verticalAnchor'] {
  if (value?.startsWith('middle')) return 'center';
  if (value?.startsWith('bottom')) return 'bottom';
  return 'top';
}

const hex = (value: string | null) => (value ? value.slice(1).toUpperCase() : null);

/**
 * The story projection of a validated VML text box. `style` is the shape's validated style.
 *
 * The chrome is the shape's solid fill and outline. Decorations outside that subset, such as a
 * shadow, a dash pattern or a gradient, keep the box and its text and paint the solid base
 * colors. Null when an inset is malformed.
 */
export function legacyTextboxStory(
  root: OoxmlElement,
  box: LegacyTextbox,
  style: ReadonlyMap<string, string>
): TextboxStoryProjection | null {
  const auto = a(box.textbox, 'insetmode', OFFICE) === 'auto';
  const parts = auto ? [] : (a(box.textbox, 'inset') ?? '').split(',');
  if (parts.length > 4) return null;
  const left = insetPoints(parts[0], DEFAULT_INSET_POINTS.left),
    top = insetPoints(parts[1], DEFAULT_INSET_POINTS.top),
    right = insetPoints(parts[2], DEFAULT_INSET_POINTS.right),
    bottom = insetPoints(parts[3], DEFAULT_INSET_POINTS.bottom);
  if (![left, top, right, bottom].every(Number.isFinite)) return null;

  const list = children(root);
  const fillNode = list.find((child) => named(child, VML, 'fill'));
  const strokeNode = list.find((child) => named(child, VML, 'stroke'));
  if (
    list.filter((child) => named(child, VML, 'fill')).length > 1 ||
    list.filter((child) => named(child, VML, 'stroke')).length > 1
  )
    return null;
  // A fully transparent fill paints nothing. Opacity is a fraction or a 16.16 fixed value.
  const opacity = fillNode ? a(fillNode, 'opacity')?.trim() : undefined;
  const clear =
    opacity !== undefined &&
    (opacity.endsWith('f') ? numeric(opacity.slice(0, -1)) : numeric(opacity)) === 0;
  const filled = !(off(a(root, 'filled')) || (fillNode && off(a(fillNode, 'on'))) || clear);
  const fill = filled
    ? color(
        fillNode ? (a(fillNode, 'color') ?? a(root, 'fillcolor')) : a(root, 'fillcolor'),
        'white'
      )
    : null;
  const stroked = !(off(a(root, 'stroked')) || (strokeNode && off(a(strokeNode, 'on'))));
  const stroke = stroked
    ? color(
        strokeNode ? (a(strokeNode, 'color') ?? a(root, 'strokecolor')) : a(root, 'strokecolor'),
        'black'
      )
    : null;
  const weight = points(
    (strokeNode ? a(strokeNode, 'weight') : undefined) ?? a(root, 'strokeweight') ?? '0.75pt'
  );
  const strokeWidth =
    Number.isFinite(weight) && weight >= 0 && weight <= MAX_STROKE_POINTS ? weight : 0.75;
  const fitStyle = styleOf(box.textbox)?.get('mso-fit-shape-to-text');
  return Object.freeze({
    contentNodeId: box.content.id,
    content: box.content,
    insetsEmu: Object.freeze({
      top: Math.round(top * EMU_PER_POINT),
      right: Math.round(right * EMU_PER_POINT),
      bottom: Math.round(bottom * EMU_PER_POINT),
      left: Math.round(left * EMU_PER_POINT),
    }),
    verticalAnchor: verticalAnchor(style.get('v-text-anchor')),
    autofit: fitStyle !== undefined && !off(fitStyle) ? 'shape' : 'none',
    fillHex: hex(fill),
    strokeHex: stroke && strokeWidth > 0 ? hex(stroke) : null,
    strokeWidthEmu: stroke && strokeWidth > 0 ? Math.round(strokeWidth * EMU_PER_POINT) : 0,
  });
}
