// The vector members of one `wpg:wgp` drawing group, as placed paint components.
//
// A group paints the members that paint can represent. A member that paint cannot represent
// paints nothing, and the other members still paint: one member never replaces the whole
// group with a placeholder. The caller reports each such member in a diagnostic.
//
// Members paint in document order (`wpg:grpSp`, CT_WordprocessingGroup; ECMA-376 Part 1, 20.4.2.32:
// a group is made up of the shapes within it). Each component records how many of the
// group's pictures come before it, so a painter puts it between the correct pictures.
//
// The shape projector comes in as a parameter, so this module does not import the shape
// projection that calls it.

import { readDrawingGroupFrame, supportedMemberVisibility } from './drawing-group-frame.ts';
import {
  flattenGroupMembers,
  groupSpacePlacement,
  rootGroupSpace,
} from './drawing-group-members.ts';
import { placeGradient, readGradientFill } from './drawing-gradient.ts';
import { hasOwnFrameInk, ownFillIsPicture, withResolvedGroupFill } from './drawing-group-fill.ts';
import { groupPictureFrame } from './drawing-group-picture-outline.ts';
import { shapeClipLeftOut } from './drawing-shape-clip-ring.ts';
import {
  transformComponent,
  turnComponentsInBoxes,
  turnGroupComponents,
} from './drawing-group-transform.ts';
import type { ShapeSchemeColorResolver } from './drawing-shape-color.ts';
import { shapeRotationDegrees } from './drawing-shape-geometry.ts';
import type { ShapeStyleMatrixResolver, VectorShapeComponent } from './drawing-shape-projection.ts';
import {
  childTransform,
  shapeProperties,
  shapeTransformElement,
} from './drawing-shape-transform.ts';
import { WPS_NAMESPACE_URI } from './ooxml-drawing-rules.ts';
import type { OoxmlElement } from './ooxml-tree.ts';

type Extent = Readonly<{ cx: number; cy: number }>;

/**
 * Whether a component, in extent EMU, stays within one extent of the drawing on every side,
 * with a stroke at most as wide as the drawing. A picture makes its group visible, so the
 * other members must not carry an offset or a stroke that the outputs cannot represent: a
 * file-supplied offset or a tiny `a:chExt` can scale a member far past the page.
 */
function withinGroupReach(component: VectorShapeComponent, extent: Extent): boolean {
  const stroked = component.strokeHex !== null;
  if (stroked && !(component.strokeWidthEmu <= Math.max(extent.cx, extent.cy))) return false;
  for (const paths of [component.subpathsEmu, component.arrowheadsEmu ?? []]) {
    for (const path of paths) {
      for (const { x, y } of path) {
        if (!(x >= -extent.cx && x <= 2 * extent.cx && y >= -extent.cy && y <= 2 * extent.cy))
          return false;
      }
    }
  }
  return true;
}

/** How far past the extent a point must lie to count as outside it: 0.01pt, in EMU. */
const PAST = 127;

/** Whether a point of the component's geometry, in extent EMU, lies outside the extent. */
function reachesPastExtent(component: VectorShapeComponent, extent: Extent): boolean {
  for (const paths of [component.subpathsEmu, component.arrowheadsEmu ?? []]) {
    for (const path of paths) {
      for (const { x, y } of path) {
        if (x < -PAST || y < -PAST || x > extent.cx + PAST || y > extent.cy + PAST) return true;
      }
    }
  }
  return false;
}

/**
 * The gradient of a group fill, placed over the box of the group that sets it, for a member
 * that says `a:grpFill` (CT_GroupFillProperties, ECMA-376 Part 1, 20.1.8.35). One gradient
 * spans the group, so two members show two parts of it. The standard does not define the span.
 * Null when the member paints another fill, or the group fill is not a gradient that reads.
 */
function spanningGroupGradient(
  member: OoxmlElement,
  groupFill: OoxmlElement | null,
  box: Readonly<{ x: number; y: number; cx: number; cy: number }> | undefined,
  resolveSchemeColor: ShapeSchemeColorResolver | undefined
): VectorShapeComponent['fillGradient'] | null {
  if (!box || groupFill?.localName !== 'gradFill') return null;
  const spPr = shapeProperties(member);
  if (!spPr || withResolvedGroupFill(spPr, groupFill) === spPr) return null;
  const spec = readGradientFill(groupFill, resolveSchemeColor);
  return (spec && placeGradient(spec, box.cx, box.cy, [1, 0, 0, 1, box.x, box.y])) ?? null;
}

/** The shape readers of the shape projection, passed in by it. */
export interface GroupVectorMemberTools {
  readonly project: (
    member: OoxmlElement,
    extent: Extent,
    pointBudget: { remaining: number },
    resolveSchemeColor?: ShapeSchemeColorResolver,
    resolveStyleMatrixReference?: ShapeStyleMatrixResolver,
    groupMember?: boolean,
    groupFill?: OoxmlElement | null
  ) => readonly VectorShapeComponent[] | null;
  readonly isUnpaintedTextbox: (
    member: OoxmlElement,
    resolveSchemeColor?: ShapeSchemeColorResolver,
    resolveStyleMatrixReference?: ShapeStyleMatrixResolver,
    groupFill?: OoxmlElement | null
  ) => boolean;
}

export interface GroupVectorMembers {
  readonly components: VectorShapeComponent[];
  /** The group's own turn in clockwise degrees; 0 for an upright group. */
  readonly rotationDegrees: number;
  /** A member paints past the group extent: it is turned, or its geometry reaches past it. */
  readonly overflowVisible: boolean;
  /** The visible members of the group, nested members too, whether or not they paint. */
  readonly memberCount: number;
}

/**
 * The group's vector members in the drawing extent, or null when the group has no readable
 * frame or holds more members than the budget.
 *
 * `pictureNodeIds` names the members that the group picture projection paints. `omitted`
 * receives the node id of each member that paints nothing because paint cannot represent it.
 */
export function projectGroupVectorMembers(
  anchor: OoxmlElement,
  extent: Extent,
  pointBudget: { remaining: number },
  resolveSchemeColor: ShapeSchemeColorResolver | undefined,
  resolveStyleMatrixReference: ShapeStyleMatrixResolver | undefined,
  pictureNodeIds: ReadonlySet<string> | undefined,
  omitted: string[],
  tools: GroupVectorMemberTools
): GroupVectorMembers | null {
  const frame = readDrawingGroupFrame(anchor, { turned: true });
  if (!frame) return null;
  const omittedBefore = omitted.length;
  const members = flattenGroupMembers(frame, rootGroupSpace(frame, extent), omitted);
  if (!members) return null;
  // A nested group that cannot be placed is a visible member that paints nothing.
  const unplacedGroups = omitted.length - omittedBefore;
  let components: VectorShapeComponent[] = [];
  let overflowVisible = false;
  const pictureCount = pictureNodeIds?.size ?? 0;
  let picturesBelow = 0;
  let ordered = 0;
  // Each component records the pictures that come before its member.
  const orderAmongPictures = () => {
    for (; ordered < components.length; ordered += 1) {
      if (picturesBelow < pictureCount)
        components[ordered] = { ...components[ordered]!, picturesBelow };
    }
  };
  for (const { member, space, groupFill, groupFillBox } of members) {
    orderAmongPictures();
    if (pictureNodeIds?.has(member.id)) {
      // The group picture paints the raster. The member's fill paints under it and its outline
      // above it, placed as a shape member is placed. A frame that paint cannot represent
      // paints nothing, and the picture still paints.
      const box = childTransform(member);
      const turn = shapeRotationDegrees(shapeTransformElement(member)) ?? 0;
      const place = box ? groupSpacePlacement(box, space, turn) : null;
      const frame = place
        ? groupPictureFrame(
            member,
            place.extent,
            pointBudget,
            resolveSchemeColor,
            // A `pic:pic` has no style; a shape with a picture fill takes its outline from it.
            member.namespaceUri === WPS_NAMESPACE_URI ? resolveStyleMatrixReference : undefined,
            {
              project: tools.project,
              place: (component) =>
                transformComponent(component, place.offset, place.scaleX, place.scaleY),
            }
          )
        : null;
      // The frame turns with the nested groups around the picture, as the picture does.
      const turned = (list: VectorShapeComponent[]) =>
        space.turns ? turnComponentsInBoxes(list, space.turns) : list;
      if (frame) components.push(...turned(frame.under));
      orderAmongPictures();
      picturesBelow += 1;
      if (frame) components.push(...turned(frame.over));
      // A turned frame paints whole, past the group extent, as a turned shape member does.
      if (frame && (turn !== 0 || space.turns) && frame.under.length + frame.over.length > 0)
        overflowVisible = true;
      // A geometry that gives no clip ring leaves the picture a rectangle. A fill or an
      // outline whose frame does not project does not paint. Each names the member.
      const spPr = shapeProperties(member);
      if (
        spPr &&
        box &&
        (shapeClipLeftOut(spPr, box.extent) || (place && !frame && hasOwnFrameInk(spPr)))
      )
        omitted.push(member.id);
      continue;
    }
    if (
      tools.isUnpaintedTextbox(member, resolveSchemeColor, resolveStyleMatrixReference, groupFill)
    )
      continue;
    const transform =
      member.namespaceUri === WPS_NAMESPACE_URI &&
      member.localName === 'wsp' &&
      supportedMemberVisibility(member)
        ? childTransform(member)
        : null;
    if (!transform) {
      omitted.push(member.id);
      continue;
    }
    // A turned member turns in group space, after its box scales, so it never skews.
    const memberTurn = shapeRotationDegrees(shapeTransformElement(member)) ?? 0;
    const place = groupSpacePlacement(transform, space, memberTurn);
    // A member paints as the same shape paints alone, its effects too.
    const memberComponents = tools.project(
      member,
      place.extent,
      pointBudget,
      resolveSchemeColor,
      resolveStyleMatrixReference,
      true,
      groupFill
    );
    if (!memberComponents) {
      omitted.push(member.id);
      continue;
    }
    // A picture fill that the group picture read did not take does not paint. The outline of
    // the shape still paints, and the member is named as not shown in full.
    if (ownFillIsPicture(shapeProperties(member))) omitted.push(member.id);
    // A turned member paints whole, past the group extent where its corners reach.
    if (memberTurn !== 0 || space.turns) overflowVisible = true;
    // One gradient spans the box of the group that sets it; each member shows its own part.
    const spanning = spanningGroupGradient(member, groupFill, groupFillBox, resolveSchemeColor);
    const placed = memberComponents.map((component) => {
      const moved = transformComponent(component, place.offset, place.scaleX, place.scaleY);
      return spanning && moved.fillGradient ? { ...moved, fillGradient: spanning } : moved;
    });
    // Members of a turned nested group turn with it.
    const painted = space.turns ? turnComponentsInBoxes(placed, space.turns) : placed;
    // Beside a picture, a member keeps within the bound that the picture frames keep.
    if (pictureCount > 0 && !painted.every((component) => withinGroupReach(component, extent))) {
      omitted.push(member.id);
      continue;
    }
    components.push(...painted);
  }
  orderAmongPictures();
  // A member is not cut at the group extent: a member that reaches past the extent paints
  // whole, as a turned member does.
  if (!overflowVisible && components.some((component) => reachesPastExtent(component, extent)))
    overflowVisible = true;
  if (frame.turn) components = turnGroupComponents(components, extent, frame.turn);
  return {
    components,
    rotationDegrees: frame.turn?.rotationDegrees ?? 0,
    overflowVisible,
    memberCount: members.length + unplacedGroups,
  };
}
