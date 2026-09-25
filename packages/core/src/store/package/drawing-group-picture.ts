// The picture member of a `wpg:wgp` drawing group. A group can hold a raster picture beside
// its vector members, for example a scanned page with ruled lines drawn over it. The vector
// projection paints `wps:wsp` members only, so without this read the whole group painted
// nothing. The picture keeps its own frame inside the group extent and resolves through the
// same bounded image resource path as a top-level picture.

import {
  isGroupPropertyChild,
  MAX_GROUP_SHAPE_CHILDREN,
  readDrawingGroupFrame,
  schemaAngleIsZero,
  schemaFlagIsUnset,
} from './drawing-group-frame.ts';
import { isElement } from './drawing-projection-walk.ts';
import { findDirectChild, parseCropPercent, parseEmu } from './drawing-shape-readers.ts';
import { schemaAttributeValue } from './ooxml-drawing-rules.ts';
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
  /** The picture's rectangle inside the drawing extent, in extent EMU. */
  readonly frameEmu: Readonly<{ x: number; y: number; cx: number; cy: number }>;
  /** Canonical node id of the `pic:pic` member. The vector projection skips it. */
  readonly memberNodeId: string;
}

export interface GroupPictureRead {
  readonly picture: GroupPictureProjection;
  /** Whether the group has members other than the picture. */
  readonly hasOtherMembers: boolean;
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
 * Read the one `pic:pic` member of a drawing group, or null to leave the group unpainted.
 *
 * The read accepts only what paint reproduces exactly. The group holds one picture, and the
 * picture comes before every other member, so it paints below them. The picture is not
 * rotated or flipped. It has a rectangle geometry, a stretched fill, and no blip effects.
 * Anything else returns null, and the group keeps its earlier unpainted result.
 */
export function readGroupPicture(
  anchor: OoxmlElement,
  extent: Readonly<{ cx: number; cy: number }>
): GroupPictureRead | null {
  if (extent.cx <= 0 || extent.cy <= 0) return null;
  const frame = readDrawingGroupFrame(anchor);
  if (!frame) return null;
  let picture: OoxmlElement | null = null;
  let hasOtherMembers = false;
  let members = 0;
  for (const child of frame.group.children) {
    if (!isElement(child) || isGroupPropertyChild(child)) continue;
    members += 1;
    if (members > MAX_GROUP_SHAPE_CHILDREN) return null;
    if (child.namespaceUri === PIC_NAMESPACE_URI && child.localName === 'pic') {
      if (picture !== null || hasOtherMembers) return null;
      picture = child;
    } else {
      hasOtherMembers = true;
    }
  }
  if (!picture) return null;

  const blipFill = findDirectChild(picture.children, {
    namespaceUri: PIC_NAMESPACE_URI,
    localName: 'blipFill',
  });
  const blip = blipFill ? drawingMl(blipFill, 'blip') : null;
  if (!blipFill || !blip || drawingMl(blipFill, 'tile')) return null;
  const blipEffect = blip.children.some(
    (child) =>
      isElement(child) &&
      !(child.namespaceUri === DRAWINGML_MAIN_NAMESPACE_URI && child.localName === 'extLst')
  );
  if (blipEffect) return null;
  const embeddedRelationshipId = relationshipId(blip, 'embed');
  const linkedRelationshipId = relationshipId(blip, 'link');
  if (embeddedRelationshipId === null && linkedRelationshipId === null) return null;

  const shapeProperties = findDirectChild(picture.children, {
    namespaceUri: PIC_NAMESPACE_URI,
    localName: 'spPr',
  });
  const xfrm = shapeProperties ? drawingMl(shapeProperties, 'xfrm') : null;
  if (!shapeProperties || !xfrm) return null;
  if (!schemaAngleIsZero(schemaAttributeValue(xfrm.attributes, 'rot'))) return null;
  if (!schemaFlagIsUnset(schemaAttributeValue(xfrm.attributes, 'flipH'))) return null;
  if (!schemaFlagIsUnset(schemaAttributeValue(xfrm.attributes, 'flipV'))) return null;
  if (drawingMl(shapeProperties, 'custGeom')) return null;
  const preset = drawingMl(shapeProperties, 'prstGeom');
  if (preset && schemaAttributeValue(preset.attributes, 'prst') !== 'rect') return null;
  const offset = drawingMl(xfrm, 'off');
  const size = drawingMl(xfrm, 'ext');
  const cx = size ? parseEmu(schemaAttributeValue(size.attributes, 'cx')) : null;
  const cy = size ? parseEmu(schemaAttributeValue(size.attributes, 'cy')) : null;
  if (cx === null || cy === null || cx <= 0 || cy <= 0) return null;
  const x = offset ? (parseEmu(schemaAttributeValue(offset.attributes, 'x'), false) ?? 0) : 0;
  const y = offset ? (parseEmu(schemaAttributeValue(offset.attributes, 'y'), false) ?? 0) : 0;

  const scaleX = extent.cx / frame.childExtentEmu.cx;
  const scaleY = extent.cy / frame.childExtentEmu.cy;
  const srcRect = drawingMl(blipFill, 'srcRect');
  const cropEdge = (name: string): number =>
    srcRect ? parseCropPercent(schemaAttributeValue(srcRect.attributes, name)) : 0;
  return {
    picture: Object.freeze({
      embeddedRelationshipId,
      linkedRelationshipId,
      crop: Object.freeze({
        left: cropEdge('l'),
        top: cropEdge('t'),
        right: cropEdge('r'),
        bottom: cropEdge('b'),
      }),
      frameEmu: Object.freeze({
        x: (x - frame.childOffsetEmu.x) * scaleX,
        y: (y - frame.childOffsetEmu.y) * scaleY,
        cx: cx * scaleX,
        cy: cy * scaleY,
      }),
      memberNodeId: picture.id,
    }),
    hasOtherMembers,
  };
}
