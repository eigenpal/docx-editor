import { visiblePictureMember } from './drawing-group-picture-admission.ts';
import { readBlipEffects, type DrawingImageEffects } from './drawing-image-effects.ts';
import { shapeClipRing } from './drawing-shape-clip-ring.ts';
// The picture member of a `wpg:wgp` drawing group. A group can hold a raster picture beside
// its vector members, for example a scanned page with ruled lines drawn over it. The vector
// projection paints `wps:wsp` members only, so without this read the whole group painted
// nothing. The picture keeps its own frame inside the group extent and resolves through the
// same bounded image resource path as a top-level picture.

import {
  groupTurn,
  readDrawingGroupFrame,
  supportedMemberVisibility,
  type GroupTurn,
} from './drawing-group-frame.ts';
import {
  flattenGroupMembers,
  groupSpacePlacement,
  rootGroupSpace,
  turnGroupPoint,
  type GroupSpace,
} from './drawing-group-members.ts';
import { isElement } from './drawing-projection-walk.ts';
import { findDirectChild, parseCropPercent, parseEmu } from './drawing-shape-readers.ts';
import { schemaAttributeValue, WPS_NAMESPACE_URI } from './ooxml-drawing-rules.ts';
import {
  DRAWINGML_MAIN_NAMESPACE_URI,
  PIC_NAMESPACE_URI,
  RELATIONSHIPS_NAMESPACE_URI,
  type OoxmlElement,
} from './ooxml-tree.ts';

/** One picture painted as a member of a drawing group. */
export interface GroupPictureProjection {
  readonly embeddedRelationshipId: string | null;
  readonly linkedRelationshipId: string | null;
  readonly crop: Readonly<{ left: number; top: number; right: number; bottom: number }>;
  /**
   * The picture's rectangle inside the drawing extent, in extent EMU, before the picture
   * flips and turns about the centre of the rectangle.
   */
  readonly frameEmu: Readonly<{ x: number; y: number; cx: number; cy: number }>;
  /**
   * The clockwise turn of the picture about the centre of `frameEmu`, in degrees in (0, 360):
   * its own turn composed with the turns and flips of the groups around it. Absent for an
   * upright picture.
   */
  readonly rotationDegrees?: number;
  /** The picture mirrors left to right about the centre of `frameEmu`, before it turns. */
  readonly flipH?: true;
  /**
   * The ring that clips a group member's picture, in the unit square of `frameEmu`, before
   * the picture flips and turns: the member's preset or custom geometry. Absent for a box.
   */
  readonly memberClipUnit?: readonly Readonly<{ x: number; y: number }>[];
  /** The colour effects of the member's own blip; absent when it has none. */
  readonly effects?: DrawingImageEffects;
  /**
   * Canonical node id of the member: a `pic:pic`, or a `wps:wsp` with a picture fill. The
   * vector projection paints only the fill and outline of its frame.
   */
  readonly memberNodeId: string;
  /**
   * Whether the group is the chosen branch of a run-level `mc:AlternateContent`. A picture
   * of such a group in a format that PDF export cannot embed is left out with a note, not an
   * error.
   */
  readonly alternateContent: boolean;
  /** The ring that clips the picture, in the unit square of the extent; absent for a box. */
  readonly clipUnit?: readonly Readonly<{ x: number; y: number }>[];
}

/** Whether a point, in extent EMU, lies within one extent of the drawing on every side. */
function withinGroupReach(
  x: number,
  y: number,
  extent: Readonly<{ cx: number; cy: number }>
): boolean {
  return x >= -extent.cx && x <= 2 * extent.cx && y >= -extent.cy && y <= 2 * extent.cy;
}

/**
 * Whether a member frame, in extent EMU, stays within one extent of the drawing on every side.
 *
 * A picture paints past the extent. The bound keeps a
 * file-supplied offset or a tiny `a:chExt` from scaling the frame into coordinates that no
 * output can represent: the frame never reaches farther than three times the drawing's own
 * extent.
 */
function memberFrameIsBounded(
  frame: Readonly<{ x: number; y: number; cx: number; cy: number }>,
  extent: Readonly<{ cx: number; cy: number }>
): boolean {
  const right = frame.x + frame.cx;
  const bottom = frame.y + frame.cy;
  return withinGroupReach(frame.x, frame.y, extent) && withinGroupReach(right, bottom, extent);
}

/**
 * Whether a shape's picture fill stays upright when the shape turns: `a:blipFill/@rotWithShape`
 * is false (CT_BlipFillProperties; ECMA-376 Part 1, 20.1.8.14). A `pic:blipFill` always turns
 * with its picture.
 */
function fillStaysUpright(blipFill: OoxmlElement): boolean {
  if (blipFill.namespaceUri !== DRAWINGML_MAIN_NAMESPACE_URI) return false;
  const raw = schemaAttributeValue(blipFill.attributes, 'rotWithShape');
  return raw === '0' || raw === 'false';
}

export interface GroupPictureRead {
  /** The first picture member that paints, which paints lowest of the pictures. */
  readonly picture: GroupPictureProjection;
  /** Every picture member that paints, in document order, `picture` first. */
  readonly pictures: readonly GroupPictureProjection[];
}

/**
 * The projection with every group picture marked as the chosen branch of a run-level
 * `mc:AlternateContent`.
 */
export function withAlternateContentGroupPictures<
  P extends {
    readonly groupPicture: GroupPictureProjection | null;
    readonly groupPictureLayers?: readonly GroupPictureProjection[];
  },
>(projection: P): P {
  if (!projection.groupPicture) return projection;
  const mark = (picture: GroupPictureProjection): GroupPictureProjection =>
    Object.freeze({ ...picture, alternateContent: true });
  const layers = projection.groupPictureLayers?.map(mark);
  return Object.freeze({
    ...projection,
    groupPicture: mark(projection.groupPicture),
    ...(layers ? { groupPictureLayers: Object.freeze(layers) } : {}),
  });
}

function relationshipId(blip: OoxmlElement, localName: 'embed' | 'link'): string | null {
  for (const attribute of blip.attributes) {
    if (
      attribute.localName === localName &&
      attribute.namespaceUri === RELATIONSHIPS_NAMESPACE_URI
    ) {
      return attribute.value;
    }
  }
  return null;
}

function drawingMl(parent: OoxmlElement, localName: string): OoxmlElement | null {
  return findDirectChild(parent.children, {
    namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
    localName,
  });
}

/**
 * Read the `pic:pic` members of a drawing group that paint, or null when none does.
 *
 * The pictures come back in document order. A picture may come before, between, or after
 * the other members: the vector projection records, for each of its components, how many
 * pictures paint under it (`VectorShapeComponent.picturesBelow`). A picture that does not
 * pass {@link readPictureMember} paints nothing, and the other members still paint.
 */
export function readGroupPicture(
  anchor: OoxmlElement,
  extent: Readonly<{ cx: number; cy: number }>
): GroupPictureRead | null {
  if (extent.cx <= 0 || extent.cy <= 0) return null;
  const frame = readDrawingGroupFrame(anchor, { turned: true });
  // A picture cannot keep a visible size in a group whose child space is zero on an axis.
  if (!frame || frame.childExtentEmu.cx <= 0 || frame.childExtentEmu.cy <= 0) return null;
  // The pictures of a turned group, or of a turned nested group, follow the turns of their space.
  const flattened = flattenGroupMembers(frame, rootGroupSpace(frame, extent, { withTurn: true }));
  if (!flattened) return null;
  const pictures: GroupPictureProjection[] = [];
  for (const { member, space } of flattened) {
    const source = pictureSourceOf(member);
    const picture = source ? readPictureMember(member, source, space, extent) : null;
    if (picture) pictures.push(picture);
  }
  if (pictures.length === 0) return null;
  return { picture: pictures[0]!, pictures: Object.freeze(pictures) };
}

/** The picture fill of a member and the shape properties that place it. */
interface PictureSource {
  readonly blipFill: OoxmlElement;
  readonly shapeProperties: OoxmlElement;
}

/**
 * The picture that a member paints: the `pic:blipFill` of a `pic:pic` (CT_Picture, ECMA-376
 * Part 1, 20.2.2.5), or the `a:blipFill` that fills a `wps:wsp` shape (CT_BlipFillProperties,
 * Part 1, 20.1.8.14). Null for any other member, and for a member whose `hidden` is spelled
 * outside the schema. A shape that takes a picture from its group (`a:grpFill`) has none here.
 */
function pictureSourceOf(member: OoxmlElement): PictureSource | null {
  if (member.namespaceUri === PIC_NAMESPACE_URI && member.localName === 'pic') {
    const nonVisual = findDirectChild(member.children, {
      namespaceUri: PIC_NAMESPACE_URI,
      localName: 'nvPicPr',
    });
    const info = nonVisual
      ? findDirectChild(nonVisual.children, { namespaceUri: PIC_NAMESPACE_URI, localName: 'cNvPr' })
      : null;
    if (!visiblePictureMember(info)) return null;
    const blipFill = findDirectChild(member.children, {
      namespaceUri: PIC_NAMESPACE_URI,
      localName: 'blipFill',
    });
    const shapeProperties = findDirectChild(member.children, {
      namespaceUri: PIC_NAMESPACE_URI,
      localName: 'spPr',
    });
    return blipFill && shapeProperties ? { blipFill, shapeProperties } : null;
  }
  if (member.namespaceUri !== WPS_NAMESPACE_URI || member.localName !== 'wsp') return null;
  if (!supportedMemberVisibility(member)) return null;
  const shapeProperties = findDirectChild(member.children, {
    namespaceUri: WPS_NAMESPACE_URI,
    localName: 'spPr',
  });
  // The first fill choice is the shape's fill (EG_FillProperties).
  let fill: OoxmlElement | null = null;
  for (const node of shapeProperties?.children ?? []) {
    if (!isElement(node) || node.namespaceUri !== DRAWINGML_MAIN_NAMESPACE_URI) continue;
    if (!FILL_CHOICES.has(node.localName)) continue;
    fill = node;
    break;
  }
  return shapeProperties && fill?.localName === 'blipFill'
    ? { blipFill: fill, shapeProperties }
    : null;
}

const UNIT_SQUARE = Object.freeze([
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
]);

const FILL_CHOICES = new Set([
  'noFill',
  'solidFill',
  'gradFill',
  'blipFill',
  'pattFill',
  'grpFill',
]);

/**
 * A signed percentage in 1/1000 of a percent as a fraction (ST_Percentage): 0 when the
 * attribute is absent, and null when its spelling is outside the schema.
 */
function signedFraction(node: OoxmlElement | null, name: string): number | null {
  const raw = node ? schemaAttributeValue(node.attributes, name) : undefined;
  if (raw === undefined) return 0;
  return /^[+-]?\d{1,9}$/.test(raw) ? Number(raw) / 100_000 : null;
}

/**
 * One picture member, or null when paint cannot place it.
 *
 * Its fill is not tiled. Its frame has a visible part inside the group extent and stays
 * within the bounds of {@link memberFrameIsBounded}. A turned or flipped picture, and a
 * picture in a turned or flipped group, records the turn that it paints with.
 *
 * `a:stretch/a:fillRect` (CT_RelativeRect, ECMA-376 Part 1, 20.1.8.30) insets the picture in
 * the member's box, or lets it reach past the box, which then cuts it. The frame here is the
 * part of the box that the picture covers, and the crop is the part of the picture in it.
 * The picture clips to the member's geometry and keeps its blip colour effects
 * (`a:alphaModFix`, Part 1, 20.1.8.6, and the others that a lone picture keeps). It paints
 * without its shape effects, such as a shadow.
 *
 * A shape fill with `rotWithShape` false does not turn or mirror with its shape or its groups
 * (`a:blipFill/@rotWithShape`, 20.1.8.14). It stretches upright over the bounding box of the
 * turned shape, and the turned geometry of the shape clips it. The standard does not define
 * the stretch.
 */
function readPictureMember(
  member: OoxmlElement,
  { blipFill, shapeProperties }: PictureSource,
  space: GroupSpace,
  extent: Readonly<{ cx: number; cy: number }>
): GroupPictureProjection | null {
  const blip = drawingMl(blipFill, 'blip');
  if (!blip || drawingMl(blipFill, 'tile')) return null;
  const embeddedRelationshipId = relationshipId(blip, 'embed');
  const linkedRelationshipId = relationshipId(blip, 'link');
  if (embeddedRelationshipId === null && linkedRelationshipId === null) return null;

  const xfrm = drawingMl(shapeProperties, 'xfrm');
  if (!xfrm) return null;
  // The picture's own turn and flips; a spelling outside the schema leaves them unknown.
  const turn = groupTurn(xfrm);
  if (!turn) return null;
  const offset = drawingMl(xfrm, 'off');
  const size = drawingMl(xfrm, 'ext');
  const cx = size ? parseEmu(schemaAttributeValue(size.attributes, 'cx')) : null;
  const cy = size ? parseEmu(schemaAttributeValue(size.attributes, 'cy')) : null;
  if (cx === null || cy === null || cx <= 0 || cy <= 0) return null;
  const x = offset ? (parseEmu(schemaAttributeValue(offset.attributes, 'x'), false) ?? 0) : 0;
  const y = offset ? (parseEmu(schemaAttributeValue(offset.attributes, 'y'), false) ?? 0) : 0;

  // A nested group can collapse an axis, which leaves the picture no visible size.
  if (!(space.scaleX > 0) || !(space.scaleY > 0)) return null;
  // The member's box maps upright into the extent, as a turned shape's box does. Its centre
  // then moves where the turns of the groups around it take it, and the box keeps its size.
  const place = groupSpacePlacement(
    { offset: { x, y }, extent: { cx, cy } },
    space,
    turn.rotationDegrees
  );
  const shapeCx = place.extent.cx * place.scaleX;
  const shapeCy = place.extent.cy * place.scaleY;
  const shapeCentre = turnGroupPoint(space, {
    x: place.offset.x + shapeCx / 2,
    y: place.offset.y + shapeCy / 2,
  });
  const shapeFacing = composedPictureTurn(turn, space);
  // The ring flattens at the size that the member paints at, so a group with small child
  // units keeps a smooth ring. The proportions stay those of the member's own extent.
  const fine = Math.max(1, space.scaleX, space.scaleY);
  // A ring with too many points at that size keeps the ring of the member's own extent.
  const shapeRing =
    shapeClipRing(shapeProperties, { cx: cx * fine, cy: cy * fine }) ??
    (fine > 1 ? shapeClipRing(shapeProperties, { cx, cy }) : null);
  // An upright fill takes the bounding box of the turned geometry as its box.
  const uprightFill =
    fillStaysUpright(blipFill) && (shapeFacing.rotationDegrees !== 0 || shapeFacing.flipH);
  const turnedRing = uprightFill
    ? turnedShapeRing(shapeRing ?? UNIT_SQUARE, shapeCx, shapeCy, shapeFacing)
    : null;
  const boxCx = turnedRing ? turnedRing.right - turnedRing.left : shapeCx;
  const boxCy = turnedRing ? turnedRing.bottom - turnedRing.top : shapeCy;
  if (!(boxCx > 0 && boxCy > 0)) return null;
  const boxCentre = turnedRing
    ? {
        x: shapeCentre.x + (turnedRing.left + turnedRing.right) / 2,
        y: shapeCentre.y + (turnedRing.top + turnedRing.bottom) / 2,
      }
    : shapeCentre;
  const facing = turnedRing ? { rotationDegrees: 0, flipH: false } : shapeFacing;

  // The picture's rectangle in the unit square of the box, and the part of it inside the box.
  const stretch = drawingMl(blipFill, 'stretch');
  const stretched = stretch ? drawingMl(stretch, 'fillRect') : null;
  const insets = (['l', 't', 'r', 'b'] as const).map((edge) => signedFraction(stretched, edge));
  // An inset that does not read leaves the picture's rectangle unknown.
  if (insets.some((inset) => inset === null)) return null;
  const [insetLeft, insetTop, insetRight, insetBottom] = insets as number[];
  const image = {
    left: insetLeft!,
    top: insetTop!,
    right: 1 - insetRight!,
    bottom: 1 - insetBottom!,
  };
  const shown = {
    left: Math.max(0, image.left),
    top: Math.max(0, image.top),
    right: Math.min(1, image.right),
    bottom: Math.min(1, image.bottom),
  };
  const imageWidth = image.right - image.left;
  const imageHeight = image.bottom - image.top;
  if (!(imageWidth > 0 && imageHeight > 0)) return null;
  if (!(shown.right > shown.left && shown.bottom > shown.top)) return null;
  // The shown part sits off the centre of the box; the offset turns and flips with the picture.
  const offCentre = {
    x: ((shown.left + shown.right) / 2 - 0.5) * boxCx * (facing.flipH ? -1 : 1),
    y: ((shown.top + shown.bottom) / 2 - 0.5) * boxCy,
  };
  const radians = (facing.rotationDegrees * Math.PI) / 180;
  const centre = {
    x: boxCentre.x + offCentre.x * Math.cos(radians) - offCentre.y * Math.sin(radians),
    y: boxCentre.y + offCentre.x * Math.sin(radians) + offCentre.y * Math.cos(radians),
  };
  const frameCx = (shown.right - shown.left) * boxCx;
  const frameCy = (shown.bottom - shown.top) * boxCy;
  const frameEmu = {
    x: centre.x - frameCx / 2,
    y: centre.y - frameCy / 2,
    cx: frameCx,
    cy: frameCy,
  };
  if (![frameEmu.x, frameEmu.y, frameCx, frameCy].every(Number.isFinite)) return null;
  // The bound applies to the member's upright box, as it applies to a shape member before the
  // group turns. A picture that a turn brings into the extent also passes.
  const placed = { x: place.offset.x, y: place.offset.y, cx: shapeCx, cy: shapeCy };
  if (!memberFrameIsBounded(placed, extent) && !memberFrameIsBounded(frameEmu, extent)) return null;

  // `a:srcRect` (Part 1, 20.1.8.55) picks the part of the source that stretches over the
  // picture's rectangle. The box then cuts a further part of that.
  const srcRect = drawingMl(blipFill, 'srcRect');
  const source = (name: string): number =>
    srcRect ? parseCropPercent(schemaAttributeValue(srcRect.attributes, name)) : 0;
  const sourceWidth = Math.max(0, 1 - source('l') - source('r'));
  const sourceHeight = Math.max(0, 1 - source('t') - source('b'));
  const crop = {
    left: source('l') + (sourceWidth * (shown.left - image.left)) / imageWidth,
    top: source('t') + (sourceHeight * (shown.top - image.top)) / imageHeight,
    right: source('r') + (sourceWidth * (image.right - shown.right)) / imageWidth,
    bottom: source('b') + (sourceHeight * (image.bottom - shown.bottom)) / imageHeight,
  };
  // The member's geometry clips the picture, in the unit square of the shown part.
  // The turned shape cuts an upright fill: its ring, in the unit square of the box.
  const ring = turnedRing
    ? turnedRing.points.map((point) => ({
        x: (point.x - turnedRing.left) / boxCx,
        y: (point.y - turnedRing.top) / boxCy,
      }))
    : shapeRing;
  const clipUnit = ring?.map((point) =>
    Object.freeze({
      x: (point.x - shown.left) / (shown.right - shown.left),
      y: (point.y - shown.top) / (shown.bottom - shown.top),
    })
  );
  const effects = readBlipEffects(blip);
  const adjusted =
    effects.opacity !== undefined ||
    effects.grayscale ||
    effects.brightness !== 0 ||
    effects.contrast !== 0 ||
    effects.bilevel !== undefined;
  return Object.freeze({
    embeddedRelationshipId,
    linkedRelationshipId,
    crop: Object.freeze(crop),
    frameEmu: Object.freeze(frameEmu),
    memberNodeId: member.id,
    alternateContent: false,
    ...(facing.rotationDegrees !== 0 ? { rotationDegrees: facing.rotationDegrees } : {}),
    ...(facing.flipH ? { flipH: true as const } : {}),
    ...(clipUnit ? { memberClipUnit: Object.freeze(clipUnit) } : {}),
    ...(adjusted ? { effects } : {}),
  });
}

/**
 * The clip ring of a shape after the shape mirrors and turns about its centre: the points as
 * offsets from the centre, in extent EMU, and their bounding box. `ring` is in the unit square
 * of the shape's box, `cx` by `cy`.
 */
function turnedShapeRing(
  ring: readonly Readonly<{ x: number; y: number }>[],
  cx: number,
  cy: number,
  facing: { readonly rotationDegrees: number; readonly flipH: boolean }
) {
  const radians = (facing.rotationDegrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  const points = ring.map((point) => {
    const dx = (point.x - 0.5) * cx * (facing.flipH ? -1 : 1);
    const dy = (point.y - 0.5) * cy;
    const turned = { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
    left = Math.min(left, turned.x);
    top = Math.min(top, turned.y);
    right = Math.max(right, turned.x);
    bottom = Math.max(bottom, turned.y);
    return turned;
  });
  return { points, left, top, right, bottom };
}

/**
 * The turn and flip that a picture paints with: its own flips and turn (`a:xfrm`,
 * CT_Transform2D; ECMA-376 Part 1, 20.1.7.6), then the flips and turn of each group around
 * it, innermost first (CT_GroupTransform2D; Part 1, 20.1.7.5). Each step flips, then turns
 * clockwise. The result is one horizontal flip, or none, and one clockwise angle in [0, 360).
 */
function composedPictureTurn(
  own: GroupTurn,
  space: GroupSpace
): { readonly rotationDegrees: number; readonly flipH: boolean } {
  // The linear part of the map, as the images of the x and y unit vectors.
  let xAxis = { x: 1, y: 0 };
  let yAxis = { x: 0, y: 1 };
  const steps = [own, ...[...(space.turns ?? [])].reverse().map((entry) => entry.turn)];
  for (const step of steps) {
    const radians = (step.rotationDegrees * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const apply = (vector: { x: number; y: number }) => {
      const fx = step.flipH ? -vector.x : vector.x;
      const fy = step.flipV ? -vector.y : vector.y;
      return { x: fx * cos - fy * sin, y: fx * sin + fy * cos };
    };
    xAxis = apply(xAxis);
    yAxis = apply(yAxis);
  }
  const flipH = xAxis.x * yAxis.y - xAxis.y * yAxis.x < 0;
  // A mirrored picture flips horizontally first, so its x axis points the other way.
  const angle = flipH ? Math.atan2(-xAxis.y, -xAxis.x) : Math.atan2(xAxis.y, xAxis.x);
  const degrees = ((((angle * 180) / Math.PI) % 360) + 360) % 360;
  // Whole quarter turns come back exact, so an upright picture stays upright.
  const rounded = Math.round(degrees * 1e6) / 1e6;
  return { rotationDegrees: rounded === 360 ? 0 : rounded, flipH };
}
