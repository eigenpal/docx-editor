// The picture members of a drawing group after its first one.
//
// A group's first picture is the drawing record's own image (`resource`, `crop`, and
// `geometry.imageTransformCorners`). Every later picture is a layer: its own resource, crop,
// and frame inside the extent. Layers paint in document order above the first picture. The
// group's vector members paint between the pictures, in bands (`vectorPictureBand`). Each
// layer resolves through the same resource path as the first picture, keyed by its
// relationship.

import type { DrawingPoint } from './drawing-geometry.ts';
import { framedTokenJoin } from './framed-token.ts';
import type { AnchoredDrawingRecord, InlineDrawingRecord } from './drawing-layout.ts';
import type { LayoutBox } from './semantic-records.ts';
import type {
  DrawingProjection,
  GroupPictureProjection,
  SourceCrop,
} from '../store/package/drawing-projection.ts';
import type { ImageResourceState } from '../store/package/image-resources.ts';
import type { DrawingImageEffects } from '../store/package/drawing-image-effects.ts';

const NO_EFFECTS: DrawingImageEffects = Object.freeze({
  grayscale: false,
  brightness: 0,
  contrast: 0,
});
import type { VectorShapeComponent } from '../store/package/drawing-shape-projection.ts';

/**
 * The paint band of a vector component among `pictureCount` pictures: band `n` paints above
 * the first `n` pictures and below the rest. A drawing paints band 0, then picture 0, then
 * band 1, and so on, so pictures and shapes keep their document order (`wpg:grpSp`,
 * CT_GroupShape; ECMA-376 Part 1, 20.1.2.2.20). A picture frame's `belowPicture` components
 * are band 0, and a component with no `picturesBelow` paints above every picture.
 *
 * @internal
 */
export function vectorPictureBand(component: VectorShapeComponent, pictureCount: number): number {
  if (component.belowPicture) return 0;
  const below = component.picturesBelow;
  if (below === undefined || !Number.isFinite(below)) return pictureCount;
  return Math.max(0, Math.min(pictureCount, Math.trunc(below)));
}

/** One picture member of a drawing group after the first, as a drawing record holds it. */
export interface DrawingGroupPictureLayerRecord {
  /** The picture's own image resource, resolved like the record's `resource`. */
  readonly resource: ImageResourceState;
  /** The picture's own `a:srcRect` crop, as fractions of the image. */
  readonly crop: SourceCrop;
  /**
   * The picture's frame as fractions of the drawing extent, which is
   * `geometry.contentBounds` of the record.
   */
  readonly frameUnit: Readonly<{ x: number; y: number; width: number; height: number }>;
  /** The clockwise turn of the picture about the centre of its frame; absent when upright. */
  readonly rotationDegrees?: number;
  /** The picture mirrors left to right about the centre of its frame, before it turns. */
  readonly flipH?: true;
  /** The ring that clips the picture, in the unit square of its frame, before it turns. */
  readonly clipUnit?: readonly Readonly<{ x: number; y: number }>[];
  /** The colour effects of the picture's own blip; absent when it has none. */
  readonly effects?: DrawingImageEffects;
}

/**
 * The corners of a picture in a box, in image order (top left, top right, bottom right,
 * bottom left), after the picture mirrors left to right (`flipH`) and then turns clockwise
 * about the centre of the box.
 *
 * @internal
 */
export function turnedPictureCorners(
  box: Readonly<{ x: number; y: number; width: number; height: number }>,
  rotationDegrees: number,
  flipH: boolean
): readonly DrawingPoint[] {
  const centreX = box.x + box.width / 2;
  const centreY = box.y + box.height / 2;
  const radians = (rotationDegrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const corner = (dx: number, dy: number): DrawingPoint => {
    const x = (flipH ? -dx : dx) * (box.width / 2);
    const y = dy * (box.height / 2);
    return Object.freeze({ x: centreX + x * cos - y * sin, y: centreY + x * sin + y * cos });
  };
  return Object.freeze([corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)]);
}

/**
 * The box, turn and flip that {@link turnedPictureCorners} made `corners` from. A painter
 * that turns an element about its centre places the picture with these.
 *
 * @internal
 */
export function pictureCornerFrame(corners: readonly DrawingPoint[]): {
  readonly box: { x: number; y: number; width: number; height: number };
  readonly rotationDegrees: number;
  readonly flipH: boolean;
} | null {
  if (corners.length !== 4) return null;
  const [topLeft, topRight, bottomRight, bottomLeft] = corners as [
    DrawingPoint,
    DrawingPoint,
    DrawingPoint,
    DrawingPoint,
  ];
  const across = { x: topRight.x - topLeft.x, y: topRight.y - topLeft.y };
  const down = { x: bottomLeft.x - topLeft.x, y: bottomLeft.y - topLeft.y };
  const width = Math.hypot(across.x, across.y);
  const height = Math.hypot(down.x, down.y);
  const flipH = across.x * down.y - across.y * down.x < 0;
  const angle = flipH ? Math.atan2(-across.y, -across.x) : Math.atan2(across.y, across.x);
  const degrees = ((((angle * 180) / Math.PI) % 360) + 360) % 360;
  const rotationDegrees = Math.abs(degrees) < 1e-6 || Math.abs(degrees - 360) < 1e-6 ? 0 : degrees;
  return {
    box: {
      x: (topLeft.x + bottomRight.x) / 2 - width / 2,
      y: (topLeft.y + bottomRight.y) / 2 - height / 2,
      width,
      height,
    },
    rotationDegrees,
    flipH,
  };
}

/**
 * The layout token of one group picture. Length-framed: relationship ids are verbatim file
 * values, so a printable separator would let two different pictures share one token.
 */
export function groupPictureLayoutToken(picture: GroupPictureProjection): string {
  return framedTokenJoin([
    String(picture.crop.left),
    String(picture.crop.top),
    String(picture.crop.right),
    String(picture.crop.bottom),
    `${picture.frameEmu.x},${picture.frameEmu.y}`,
    `${picture.frameEmu.cx},${picture.frameEmu.cy}`,
    `${picture.rotationDegrees ?? 0},${picture.flipH ? 'flip' : ''}`,
    picture.memberClipUnit?.map((point) => `${point.x},${point.y}`).join(' ') ?? '',
    picture.effects ? JSON.stringify(picture.effects) : '',
    picture.embeddedRelationshipId ?? '',
    picture.linkedRelationshipId ?? '',
    picture.memberNodeId,
    picture.alternateContent ? 'mc' : '',
    picture.clipUnit?.map((point) => `${point.x},${point.y}`).join(' ') ?? '',
  ]);
}

/** The projection that resolves the resource of one layer picture. */
function layerProjection(
  projection: DrawingProjection,
  layer: GroupPictureProjection
): DrawingProjection {
  return { ...projection, groupPicture: layer, groupPictureLayers: undefined };
}

/** The resource of each layer picture, in layer order; undefined for a drawing without one. */
export function groupPictureLayerResources(
  projection: DrawingProjection,
  resourceOf: (projection: DrawingProjection) => ImageResourceState
): readonly ImageResourceState[] | undefined {
  const layers = projection.groupPictureLayers;
  if (!layers || layers.length === 0) return undefined;
  return Object.freeze(layers.map((layer) => resourceOf(layerProjection(projection, layer))));
}

/** The `groupPictureLayers` field of a drawing record; empty for a drawing without one. */
export function groupPictureLayerFields(
  projection: DrawingProjection,
  resources: readonly ImageResourceState[] | undefined
): { readonly groupPictureLayers?: readonly DrawingGroupPictureLayerRecord[] } {
  const layers = projection.groupPictureLayers;
  if (!layers || layers.length === 0 || !resources || resources.length !== layers.length) {
    return {};
  }
  const extent = projection.extentEmu;
  if (!(extent.cx > 0 && extent.cy > 0)) return {};
  return {
    groupPictureLayers: Object.freeze(
      layers.map((layer, index) =>
        Object.freeze({
          resource: resources[index]!,
          crop: layer.crop,
          frameUnit: Object.freeze({
            x: layer.frameEmu.x / extent.cx,
            y: layer.frameEmu.y / extent.cy,
            width: layer.frameEmu.cx / extent.cx,
            height: layer.frameEmu.cy / extent.cy,
          }),
          ...(layer.rotationDegrees ? { rotationDegrees: layer.rotationDegrees } : {}),
          ...(layer.flipH ? { flipH: true as const } : {}),
          ...(layer.memberClipUnit ? { clipUnit: layer.memberClipUnit } : {}),
          ...(layer.effects ? { effects: layer.effects } : {}),
        })
      )
    ),
  };
}

/**
 * The record that paints one layer picture alone: the layer's resource and crop, with its
 * frame as the image corners, no vector members, no link, and no other layers. Every output
 * paints a layer through its ordinary group picture path with this record.
 *
 * @internal
 */
export function groupPictureLayerDrawing<D extends InlineDrawingRecord | AnchoredDrawingRecord>(
  drawing: D,
  layer: DrawingGroupPictureLayerRecord
): D {
  const box = drawing.geometry.contentBounds;
  const corners = turnedPictureCorners(
    {
      x: box.x + layer.frameUnit.x * box.width,
      y: box.y + layer.frameUnit.y * box.height,
      width: layer.frameUnit.width * box.width,
      height: layer.frameUnit.height * box.height,
    },
    layer.rotationDegrees ?? 0,
    layer.flipH === true
  );
  const layered: D = {
    ...drawing,
    resource: layer.resource,
    crop: layer.crop,
    effects: layer.effects ?? NO_EFFECTS,
    // The layer's own clip replaces the clip of the record's first picture.
    ...(drawing.groupPicture
      ? {
          groupPicture: Object.freeze({
            alternateContent: drawing.groupPicture.alternateContent,
            ...(layer.clipUnit ? { clipUnit: layer.clipUnit } : {}),
          }),
        }
      : {}),
    // The record's own image already carries the group's link over the whole extent.
    hyperlinkHref: null,
    vectorShape: null,
    groupPictureLayers: undefined,
    geometry: Object.freeze({ ...drawing.geometry, imageTransformCorners: corners }),
  };
  return Object.freeze(layered);
}

/**
 * `ink` grown to hold every turned or mirrored picture of the group. Such a picture paints
 * whole, past the extent where its corners reach, as a turned shape member does. Returns
 * `ink` itself when no picture reaches past it.
 *
 * @internal
 */
export function groupPictureInkReach(
  drawing: InlineDrawingRecord | AnchoredDrawingRecord,
  ink: LayoutBox
): LayoutBox {
  if (!drawing.groupPicture) return ink;
  let left = ink.x;
  let top = ink.y;
  let right = ink.x + ink.width;
  let bottom = ink.y + ink.height;
  const pictures = [
    drawing,
    ...(drawing.groupPictureLayers ?? []).map((layer) => groupPictureLayerDrawing(drawing, layer)),
  ];
  for (const picture of pictures) {
    const corners = picture.geometry.imageTransformCorners ?? [];
    const frame = pictureCornerFrame(corners);
    if (!frame || (frame.rotationDegrees === 0 && !frame.flipH)) continue;
    for (const corner of corners) {
      if (!Number.isFinite(corner.x) || !Number.isFinite(corner.y)) continue;
      left = Math.min(left, corner.x);
      top = Math.min(top, corner.y);
      right = Math.max(right, corner.x);
      bottom = Math.max(bottom, corner.y);
    }
  }
  if (
    left === ink.x &&
    top === ink.y &&
    right === ink.x + ink.width &&
    bottom === ink.y + ink.height
  )
    return ink;
  return { x: left, y: top, width: right - left, height: bottom - top };
}
