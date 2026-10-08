import { WML_NAMESPACE_URI, type OoxmlElement, type OoxmlNode } from './ooxml-tree.ts';
import { isStandardVmlTemplate } from './legacy-vml-templates.ts';
import { shapeLineGeometry } from './legacy-vml-shape-line.ts';
import { embeddedObjectPreview } from './legacy-vml-object.ts';
import type {
  DrawingProjection,
  DrawingHorizontalReferenceFrame,
  DrawingVerticalReferenceFrame,
  DrawingWrapProjection,
} from './drawing-projection.ts';
import { legacyTextbox, legacyTextboxStory } from './legacy-vml-textbox.ts';
import {
  legacyLineReach,
  legacyPictureBorder,
  legacyShapeFragment,
  legacyLineShape,
  type LegacyLineEnds,
  type LegacyBox,
  type LegacyGraphicFragment,
  type LegacyPictureBorder,
} from './legacy-vml-shapes.ts';
import type { VectorShapeProjection } from './drawing-shape-projection.ts';
import { freezeVectorShapeComponent } from './drawing-vector-freeze.ts';
import {
  attribute as a,
  boundedVml,
  children,
  element,
  named,
  numeric,
  off,
  OFFICE,
  pair,
  points,
  styleOf,
  VML,
  WORD_VML,
  wrapDistancePoints,
} from './legacy-vml-values.ts';
export type { LegacyGraphicProjection } from './legacy-vml-shapes.ts';

const emptyEdges = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });
const memo = new WeakMap<OoxmlNode, DrawingProjection | null>();
// Layer order is a signed CSS integer, not a geometric coordinate. Word routinely
// writes 251658240 here; the coordinate reader's one-million limit rejects that.
function layerOrder(raw = '0'): number {
  if (raw.toLowerCase() === 'auto') return 0;
  if (!/^[+-]?\d{1,10}$/.test(raw)) return NaN;
  const value = Number(raw);
  return value >= -2147483648 && value <= 2147483647 ? value : NaN;
}
const commonStyles = new Set([
  'text-align',
  'mso-left-percent',
  'mso-top-percent',
  'mso-width-relative',
  'mso-height-relative',
  'v-text-anchor',
  'mso-wrap-edited',
  'mso-width-percent',
  'mso-height-percent',
  'mso-position-horizontal',
  'mso-position-vertical',
  'mso-wrap-style',
  'visibility',
  'position',
  'left',
  'top',
  'width',
  'height',
  'margin-left',
  'margin-top',
  'z-index',
  'flip',
  'mso-position-horizontal-relative',
  'mso-position-vertical-relative',
  'mso-wrap-distance-left',
  'mso-wrap-distance-top',
  'mso-wrap-distance-right',
  'mso-wrap-distance-bottom',
]);

const relativeSizeFrames = [
  'margin',
  'page',
  'left-margin-area',
  'right-margin-area',
  'inner-margin-area',
  'outer-margin-area',
  'top-margin-area',
  'bottom-margin-area',
];
/** Style values this subset reads or can ignore; any other value refuses the shape. */
const knownValues: Readonly<Record<string, readonly string[]>> = {
  'text-align': ['left', 'center', 'right', 'justify'],
  'mso-wrap-edited': ['f', 't'],
  // -10001 is the writer's "no percentage position" value.
  'mso-left-percent': ['-10001'],
  'mso-top-percent': ['-10001'],
  'mso-width-relative': relativeSizeFrames,
  'mso-height-relative': relativeSizeFrames,
  'mso-position-horizontal': ['absolute', 'left', 'center', 'right', 'inside', 'outside'],
  'mso-position-vertical': ['absolute', 'top', 'center', 'bottom', 'inside', 'outside'],
  'mso-wrap-style': ['square', 'none'],
  'v-text-anchor': [
    'top',
    'middle',
    'bottom',
    'top-center',
    'middle-center',
    'bottom-center',
    'top-baseline',
    'bottom-baseline',
    'top-center-baseline',
    'bottom-center-baseline',
  ],
  visibility: ['visible', 'hidden'],
};

function supportedStyle(node: OoxmlElement, root: boolean): ReadonlyMap<string, string> | null {
  const styles = styleOf(node);
  if (!styles || a(node, 'opacity') || a(node, 'href') || a(node, 'src')) return null;
  for (const key of styles.keys()) if (!commonStyles.has(key)) return null;
  for (const [key, allowed] of Object.entries(knownValues)) {
    const value = styles.get(key);
    if (value !== undefined && !allowed.includes(value)) return null;
  }
  // A relative size is stored beside the absolute size that the writer computed from it; the
  // absolute size is the one laid out.
  for (const key of ['mso-width-percent', 'mso-height-percent']) {
    const value = styles.get(key);
    if (value !== undefined && !/^\d{1,4}$/.test(value)) return null;
  }
  if (styles.has('position') && !['absolute', 'relative'].includes(styles.get('position')!))
    return null;
  if (
    !root &&
    (styles.has('z-index') ||
      styles.has('margin-left') ||
      styles.has('margin-top') ||
      Array.from(styles.keys()).some((k) => k.startsWith('mso-')))
  )
    return null;
  if (styles.has('flip') && node.localName !== 'line' && a(node, 'type') !== '#_x0000_t32')
    return null;
  return styles;
}

function groupLayers(
  group: OoxmlElement,
  box: LegacyBox,
  out: LegacyGraphicFragment[],
  depth: number,
  canvas: LegacyBox = box
): boolean {
  if (depth > 8 || out.length >= 128 || !supportedStyle(group, depth === 0)) return false;
  const origin = pair(a(group, 'coordorigin') ?? '0,0'),
    size = pair(a(group, 'coordsize') ?? '21600,21600');
  if (!origin || !size || size.some((v) => v <= 0)) return false;
  for (const child of children(group)) {
    if (named(child, OFFICE, 'lock') || (depth === 0 && named(child, WORD_VML, 'wrap'))) continue;
    if (
      child.namespaceUri !== VML ||
      !['shape', 'rect', 'oval', 'line', 'group'].includes(child.localName)
    )
      return false;
    const style = supportedStyle(child, false);
    if (!style) return false;
    const left = numeric(style.get('left') ?? '0'),
      top = numeric(style.get('top') ?? '0');
    const width = numeric(style.get('width')),
      height = numeric(style.get('height'));
    const line = child.localName === 'line' || a(child, 'type') === '#_x0000_t32';
    if (
      ![left, top, width, height].every(Number.isFinite) ||
      (line ? width < 0 || height < 0 || width + height <= 0 : width <= 0 || height <= 0)
    )
      return false;
    const next = {
      x: box.x + ((left - origin[0]) * box.width) / size[0],
      y: box.y + ((top - origin[1]) * box.height) / size[1],
      width: (width * box.width) / size[0],
      height: (height * box.height) / size[1],
    };
    if (Object.values(next).some((v) => !Number.isFinite(v) || Math.abs(v) > 100_000)) return false;
    if (child.localName === 'group') {
      if (!groupLayers(child, next, out, depth + 1, canvas)) return false;
    } else {
      const fragment = legacyShapeFragment(child, next, canvas);
      if (fragment === null || out.length >= 128) return false;
      out.push(fragment);
    }
  }
  return true;
}

/** The outline stroke centred in the border band, which the picture sits inside. */
function pictureOutline(
  border: LegacyPictureBorder,
  cx: number,
  cy: number
): VectorShapeProjection {
  const weight = Math.round(border.weight * 12700),
    half = weight / 2,
    hex = border.color.slice(1).toUpperCase();
  const component = freezeVectorShapeComponent({
    subpathsEmu: [
      [
        { x: half, y: half },
        { x: cx - half, y: half },
        { x: cx - half, y: cy - half },
        { x: half, y: cy - half },
      ],
    ],
    subpathsClosed: [true],
    fillHex: null,
    fillAlpha: 1,
    strokeHex: hex,
    strokeAlpha: 1,
    strokeWidthEmu: weight,
  });
  return Object.freeze({
    extentEmu: Object.freeze({ cx, cy }),
    subpathsEmu: component.subpathsEmu,
    fillHex: null,
    fillAlpha: 1,
    strokeHex: hex,
    strokeAlpha: 1,
    strokeWidthEmu: weight,
    components: Object.freeze([component]),
  });
}

/** The first `w:txbxContent` of a `v:textbox` child, found with bounded direct-child scans. */
function storyCandidate(root: OoxmlElement): OoxmlNode | undefined {
  if (root.children.length > 512) return undefined;
  for (const child of root.children) {
    if (!named(child, VML, 'textbox') || child.kind === 'textValue') continue;
    if (child.children.length > 512) return undefined;
    return child.children.find((inner) => named(inner, WML_NAMESPACE_URI, 'txbxContent'));
  }
  return undefined;
}

/** A `v:line` length pair (`x,y`) in points, or null. */
function lengthPair(value: string | undefined): [number, number] | null {
  const parts = value?.split(',');
  if (parts?.length !== 2) return null;
  const pair = parts.map((part) => points(part.trim()));
  return pair.every((n) => Number.isFinite(n) && Math.abs(n) <= 100_000)
    ? (pair as [number, number])
    : null;
}

interface LineGeometry {
  /** The box origin relative to the shape's own offset, in points. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly ends: LegacyLineEnds;
}

/**
 * The box of a floating `v:line`, from its `from` and `to` points. A horizontal or vertical
 * line has no width or height, as a modern line can. Null for an inline line, a line without
 * both points, or one whose points coincide.
 */
function lineGeometry(root: OoxmlElement, floating: boolean): LineGeometry | null {
  const from = lengthPair(a(root, 'from')),
    to = lengthPair(a(root, 'to'));
  if (!floating || !from || !to) return null;
  const x = Math.min(from[0], to[0]),
    y = Math.min(from[1], to[1]);
  const width = Math.abs(to[0] - from[0]),
    height = Math.abs(to[1] - from[1]);
  if (width + height <= 0) return null;
  return Object.freeze({
    x,
    y,
    width,
    height,
    ends: Object.freeze([
      Object.freeze([from[0] - x, from[1] - y] as const),
      Object.freeze([to[0] - x, to[1] - y] as const),
    ] as const),
  });
}

/**
 * `preview` is the validated cached-preview shape of a `w:object`. Its projection is a static
 * read-only graphic: no picture member, so picture edits never reach the embedded object.
 */
function readProjection(node: OoxmlElement, preview?: OoxmlElement): DrawingProjection | null {
  const roots = preview ? [preview] : children(node).filter((c) => !named(c, VML, 'shapetype'));
  if (roots.length !== 1) return null;
  const root = roots[0]!;
  if (
    root.namespaceUri !== VML ||
    !['shape', 'rect', 'roundrect', 'oval', 'line', 'group'].includes(root.localName)
  )
    return null;
  // The text box story is ordinary WML content, bounded by story layout rather than here.
  // Everything else is bounded before the text box is read.
  if (!boundedVml(preview ?? node, preview ? undefined : storyCandidate(root))) return null;
  const textbox = preview ? undefined : legacyTextbox(root);
  if (textbox === null) return null;
  // Built-in templates are metadata, not a second drawing. Unknown custom
  // templates may redefine geometry and are outside this bounded subset.
  if (
    children(node).some((child) => named(child, VML, 'shapetype') && !isStandardVmlTemplate(child))
  )
    return null;
  const style = supportedStyle(root, true);
  if (!style) return null;
  const floating = style.get('position') === 'absolute';
  // A line spans its `from` and `to` points.
  const line =
    root.localName === 'line'
      ? lineGeometry(root, floating)
      : shapeLineGeometry(root, style, floating);
  if (line === null) return null;
  const width = line?.width ?? points(style.get('width')),
    height = line?.height ?? points(style.get('height'));
  const extentOk = (n: number) => Number.isFinite(n) && (line ? n >= 0 : n > 0) && n <= 10_000;
  if (![width, height].every(extentOk)) return null;
  // A picture outline widens the drawing by its full weight on every side; the picture keeps
  // its authored size inside it.
  const border = root.localName === 'shape' && !textbox ? legacyPictureBorder(root) : undefined;
  if (border === null || (preview && border)) return null;
  // A line is a vector shape, which paints in every output and whose outline reaches past its
  // box as a modern line's does. The other shapes are a graphic preview, which grows by the
  // outline's reach on every side to keep the outline inside its image.
  const vector = !!line;
  const strokeReach =
    !textbox && !border && (line || ['rect', 'roundrect', 'oval'].includes(root.localName))
      ? legacyLineReach(root, !line)
      : 0;
  if (strokeReach === null) return null;
  const inset = border?.weight ?? strokeReach,
    outerWidth = width + 2 * inset,
    outerHeight = height + 2 * inset;
  const grow = vector ? 0 : inset;
  const fragments: LegacyGraphicFragment[] = [];
  const box = { x: 0, y: 0, width, height };
  // The story paints the shape's fill and outline itself, so a text box has no graphic.
  const textboxStory = textbox ? legacyTextboxStory(root, textbox, style) : null;
  if (textbox && !textboxStory) return null;
  if (!textboxStory && root.localName === 'group') {
    if (!groupLayers(root, box, fragments, 0) || !fragments.length) return null;
  } else if (!textboxStory) {
    const fragment = legacyShapeFragment(
      root,
      { x: inset, y: inset, width, height },
      { x: 0, y: 0, width: outerWidth, height: outerHeight },
      !!border,
      line?.ends
    );
    if (fragment === null) return null;
    if ((border || preview) && (typeof fragment === 'string' || !fragment.nativeCrop)) return null;
    // A vector shape is validated by the same reading and painted from its own projection.
    if (!vector) fragments.push(fragment);
  }
  const vectorShape = line ? legacyLineShape(root, width, height, line.ends) : null;
  if (line && !vectorShape) return null;
  const wrapNodes = children(root).filter((n) => named(n, WORD_VML, 'wrap'));
  if (wrapNodes.length > 1) return null;
  const wrapNode = wrapNodes[0];
  const anchorX = wrapNode ? a(wrapNode, 'anchorx') : undefined;
  const anchorY = wrapNode ? a(wrapNode, 'anchory') : undefined;
  if (anchorX && !['page', 'margin', 'text', 'char'].includes(anchorX)) return null;
  if (anchorY && !['page', 'margin', 'text', 'line'].includes(anchorY)) return null;
  if ((border || preview) && floating) return null;
  const horizontal = new Map<string, DrawingHorizontalReferenceFrame>([
    ['text', 'column'],
    ['char', 'character'],
    ['page', 'page'],
    ['margin', 'margin'],
    ['left-margin-area', 'leftMargin'],
    ['right-margin-area', 'rightMargin'],
  ]).get(style.get('mso-position-horizontal-relative') ?? anchorX ?? 'text');
  const vertical = new Map<string, DrawingVerticalReferenceFrame>([
    ['text', 'paragraph'],
    ['line', 'line'],
    ['page', 'page'],
    ['margin', 'margin'],
    ['top-margin-area', 'topMargin'],
    ['bottom-margin-area', 'bottomMargin'],
  ]).get(style.get('mso-position-vertical-relative') ?? anchorY ?? 'text');
  const left = points(style.get('margin-left') ?? style.get('left') ?? '0') + (line?.x ?? 0) - grow,
    top = points(style.get('margin-top') ?? style.get('top') ?? '0') + (line?.y ?? 0) - grow;
  // An aligned position replaces the offset, as `wp:align` does for a modern drawing.
  const alignOf = (value: string | undefined) =>
    value === undefined || value === 'absolute' ? null : value;
  const horizontalAlign = alignOf(style.get('mso-position-horizontal')),
    verticalAlign = alignOf(style.get('mso-position-vertical'));
  const z = layerOrder(style.get('z-index'));
  if (
    !horizontal ||
    !vertical ||
    ![left, top, z].every(Number.isFinite) ||
    Math.abs(left) > 100_000 ||
    Math.abs(top) > 100_000
  )
    return null;
  const wrap = wrapNode ? (a(wrapNode, 'type') ?? 'none') : 'none';
  if (
    !['none', 'square', 'topAndBottom', 'tight'].includes(wrap) ||
    (wrapNode &&
      wrapNode.attributes.some(
        (attr) =>
          !['type', 'side', 'anchorx', 'anchory'].includes(attr.localName) || attr.namespaceUri
      ))
  )
    return null;
  const side = wrapNode ? (a(wrapNode, 'side') ?? 'both') : 'both';
  const textSide = new Map<string, DrawingWrapProjection['textSide']>([
    ['both', 'bothSides'],
    ['left', 'left'],
    ['right', 'right'],
    ['largest', 'largest'],
  ]).get(side);
  if (!textSide) return null;
  const polygon: { x: number; y: number }[] = [];
  if (wrap === 'tight') {
    const raw = (a(root, 'wrapcoords') ?? '').trim().split(/[\s,]+/);
    if (raw.length < 6 || raw.length > 256 || raw.length % 2) return null;
    const coords = raw.map(numeric);
    if (coords.some((n) => !Number.isFinite(n) || Math.abs(n) > 216_000)) return null;
    for (let i = 0; i < coords.length; i += 2)
      polygon.push(Object.freeze({ x: coords[i]!, y: coords[i + 1]! }));
  }
  const distances: Record<'top' | 'right' | 'bottom' | 'left', number> = { ...emptyEdges };
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const value = wrapDistancePoints(style.get('mso-wrap-distance-' + side) ?? '0');
    if (!Number.isFinite(value) || value > 1000) return null;
    distances[side] = Math.round(value * 12700);
  }
  const photo =
    !preview &&
    root.localName !== 'group' &&
    fragments.length === 1 &&
    typeof fragments[0] !== 'string' &&
    fragments[0]?.nativeCrop
      ? fragments[0]
      : undefined;
  const outerCx = Math.round((vector ? width : outerWidth) * 12700),
    outerCy = Math.round((vector ? height : outerHeight) * 12700);
  return Object.freeze({
    drawingNodeId: node.id,
    ownerPartName: '',
    kind: floating ? 'anchored' : 'inline',
    relationshipId: photo?.relationshipId ?? null,
    docPrId: null,
    name: a(root, 'id') ?? 'Legacy graphic',
    title: a(root, 'title') ?? '',
    description: a(root, 'alt') ?? '',
    hyperlinkHref: null,
    hidden: style.get('visibility') === 'hidden',
    extentEmu: Object.freeze({ cx: outerCx, cy: outerCy }),
    effectExtentEmu: emptyEdges,
    inlineDistancesEmu: emptyEdges,
    wrap: floating
      ? wrap === 'none'
        ? z < 0
          ? 'behind'
          : 'inFront'
        : wrap === 'tight'
          ? 'tight'
          : wrap === 'topAndBottom'
            ? 'topAndBottom'
            : textSide === 'left'
              ? 'squareLeft'
              : textSide === 'right'
                ? 'squareRight'
                : 'square'
      : 'inline',
    wrapGeometry: floating
      ? Object.freeze({
          element: wrap as DrawingWrapProjection['element'],
          textSide,
          distancesEmu: Object.freeze(distances),
          polygon: Object.freeze(polygon),
        })
      : null,
    position: floating
      ? Object.freeze({
          simplePosition: Object.freeze({ xEmu: 0, yEmu: 0 }),
          horizontal: Object.freeze({
            relativeFrom: horizontal,
            align: horizontalAlign,
            offsetEmu: horizontalAlign ? null : Math.round(left * 12700),
          }),
          vertical: Object.freeze({
            relativeFrom: vertical,
            align: verticalAlign,
            offsetEmu: verticalAlign ? null : Math.round(top * 12700),
          }),
        })
      : null,
    anchor: floating
      ? Object.freeze({
          simplePos: false,
          // Behind-text drawings have their own paint layer; retain their signed order
          // in its non-negative rank instead of collapsing every negative value to zero.
          relativeHeight: z < 0 ? z + 2147483648 : z,
          behindDocument: z < 0,
          layoutInCell: !off(a(root, 'allowincell', OFFICE)),
          allowOverlap: true,
        })
      : null,
    picture:
      photo && !border
        ? Object.freeze({
            embeddedRelationshipId: photo.relationshipId,
            linkedRelationshipId: null,
            crop: photo.nativeCrop!,
            fillMode: 'stretch' as const,
            presetGeometry: null,
            transform: Object.freeze({
              rotationDegrees: 0,
              flipHorizontal: false,
              flipVertical: false,
              offsetEmu: Object.freeze({ x: 0, y: 0 }),
              extentEmu: Object.freeze({
                cx: Math.round(width * 12700),
                cy: Math.round(height * 12700),
              }),
            }),
          })
        : null,
    vectorShape: border ? pictureOutline(border, outerCx, outerCy) : vectorShape,
    groupPicture:
      photo && border
        ? Object.freeze({
            embeddedRelationshipId: photo.relationshipId,
            linkedRelationshipId: null,
            crop: photo.nativeCrop!,
            frameEmu: Object.freeze({
              x: Math.round(inset * 12700),
              y: Math.round(inset * 12700),
              cx: Math.round(width * 12700),
              cy: Math.round(height * 12700),
            }),
            memberNodeId: children(root).find((n) => named(n, VML, 'imagedata'))!.id,
            alternateContent: false,
          })
        : null,
    textboxStory,
    // The graphic covers the whole drawing, outline reach included.
    ...(!photo && !textboxStory && !vectorShape
      ? {
          legacyGraphic: Object.freeze({
            width: outerWidth,
            height: outerHeight,
            fragments: Object.freeze(fragments),
          }),
        }
      : {}),
    locks: Object.freeze({ select: true, move: true, resize: true, changeAspect: true }),
    effects: Object.freeze({ grayscale: false, brightness: 0, contrast: 0 }),
    compatibilityBranchNodeId: null,
    diagnostics: Object.freeze([]),
  });
}

/**
 * Supported standalone w:pict, or the cached preview of a w:object, is one read-only drawing
 * atom. Dead MC fallbacks are not visited.
 */
export function isLegacyVmlAtom(node: OoxmlNode): boolean {
  if (!element(node)) return false;
  const object = named(node, WML_NAMESPACE_URI, 'object');
  if (!object && !named(node, WML_NAMESPACE_URI, 'pict')) return false;
  if (!memo.has(node)) {
    const preview = object ? embeddedObjectPreview(node) : undefined;
    memo.set(node, preview === null ? null : readProjection(node, preview));
  }
  return memo.get(node) !== null;
}
/** Whether a supported VML atom floats; false for anything else. Reads the memo, no copy. */
export function isFloatingLegacyVmlAtom(node: OoxmlNode): boolean {
  return isLegacyVmlAtom(node) && memo.get(node)!.kind === 'anchored';
}

export function projectLegacyVml(node: OoxmlNode, ownerPartName: string): DrawingProjection | null {
  if (!isLegacyVmlAtom(node)) return null;
  return Object.freeze({ ...memo.get(node)!, ownerPartName });
}
