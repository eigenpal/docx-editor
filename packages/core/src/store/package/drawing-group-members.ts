// The painted members of one `wpg:wgp` drawing group, with nested `wpg:grpSp` groups
// flattened in document order.
//
// A nested group places itself in its parent's child space by its own `a:xfrm` (`off`/`ext`)
// and authors its members in its own child space (`chOff`/`chExt`). Each member comes back
// with the composed map from its own child space into the drawing extent, so the vector,
// picture, and text box readers place a nested member as they place a direct one.

import { groupFillOf } from './drawing-group-fill.ts';
import {
  MAX_GROUP_SHAPE_CHILDREN,
  WPG_NAMESPACE_URI,
  isGroupPropertyChild,
  schemaAngleIsZero,
  schemaFlagIsSet,
  schemaFlagIsUnset,
  supportedGroupVisuals,
  type DrawingGroupFrame,
} from './drawing-group-frame.ts';
import { groupMemberPlacement } from './drawing-group-transform.ts';
import { isElement } from './drawing-projection-walk.ts';
import { findDirectChild, parseEmu, readSize } from './drawing-shape-readers.ts';
import { collapseSchemaWhitespace, schemaAttributeValue } from './ooxml-drawing-rules.ts';
import { DRAWINGML_MAIN_NAMESPACE_URI, type OoxmlElement } from './ooxml-tree.ts';

/** The deepest nested group a drawing may hold before its projection refuses it. */
export const MAX_GROUP_NESTING_DEPTH = 16;

/**
 * The map from one group's child space into the drawing extent, in EMU:
 * `extent = shift + (child - childOffset) * scale`. A zero scale collapses that axis.
 */
export interface GroupSpace {
  readonly shift: Readonly<{ x: number; y: number }>;
  readonly childOffset: Readonly<{ x: number; y: number }>;
  readonly scaleX: number;
  readonly scaleY: number;
}

/** One painted member of a group, and the space it is authored in. */
export interface GroupMember {
  readonly member: OoxmlElement;
  readonly space: GroupSpace;
  /** The fill that `a:grpFill` on this member resolves to, or null. */
  readonly groupFill: OoxmlElement | null;
}

/** The child space of the drawing's own group, scaled into the drawing extent. */
export function rootGroupSpace(
  frame: DrawingGroupFrame,
  extent: Readonly<{ cx: number; cy: number }>
): GroupSpace {
  const { cx, cy } = frame.childExtentEmu;
  return {
    shift: { x: 0, y: 0 },
    childOffset: frame.childOffsetEmu,
    scaleX: cx > 0 ? extent.cx / cx : 0,
    scaleY: cy > 0 ? extent.cy / cy : 0,
  };
}

/** A point in a group's child space, mapped into the drawing extent. */
export function mapGroupPoint(
  space: GroupSpace,
  point: Readonly<{ x: number; y: number }>
): { x: number; y: number } {
  return {
    x: space.shift.x + (point.x - space.childOffset.x) * space.scaleX,
    y: space.shift.y + (point.y - space.childOffset.y) * space.scaleY,
  };
}

/** {@link groupMemberPlacement} for a member authored in `space`. */
export function groupSpacePlacement(
  child: Readonly<{
    offset: Readonly<{ x: number; y: number }>;
    extent: Readonly<{ cx: number; cy: number }>;
  }>,
  space: GroupSpace,
  rotationDegrees: number
): ReturnType<typeof groupMemberPlacement> {
  const place = groupMemberPlacement(
    child,
    space.childOffset,
    space.scaleX,
    space.scaleY,
    rotationDegrees
  );
  if (space.shift.x === 0 && space.shift.y === 0) return place;
  return {
    ...place,
    offset: { x: place.offset.x + space.shift.x, y: place.offset.y + space.shift.y },
  };
}

function drawingMl(parent: OoxmlElement, localName: string): OoxmlElement | null {
  return findDirectChild(parent.children, {
    namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
    localName,
  });
}

/** Whether a nested group's `wpg:cNvPr` legally sets `hidden`. */
function hiddenGroup(group: OoxmlElement): boolean {
  const nonVisual = findDirectChild(group.children, {
    namespaceUri: WPG_NAMESPACE_URI,
    localName: 'cNvPr',
  });
  return !!nonVisual && schemaFlagIsSet(schemaAttributeValue(nonVisual.attributes, 'hidden'));
}

/** A nested `wpg:grpSp`. */
export function isNestedGroup(node: OoxmlElement): boolean {
  return node.namespaceUri === WPG_NAMESPACE_URI && node.localName === 'grpSp';
}

/**
 * The child space of a nested group inside `parent`, or null when paint cannot place it
 * exactly: no `a:xfrm` with an `a:ext` and an `a:chExt`, a negative size, an offset that does
 * not read, a turn or a flip,
 * or a group visual its members cannot represent. A hidden nested group is skipped before
 * this read.
 */
function nestedGroupSpace(group: OoxmlElement, parent: GroupSpace): GroupSpace | null {
  const properties = findDirectChild(group.children, {
    namespaceUri: WPG_NAMESPACE_URI,
    localName: 'grpSpPr',
  });
  if (!properties || !supportedGroupVisuals(group, properties, true)) return null;
  const xfrm = drawingMl(properties, 'xfrm');
  if (!xfrm) return null;
  // A turned or flipped nested group does not paint yet.
  if (!schemaAngleIsZero(schemaAttributeValue(xfrm.attributes, 'rot'))) return null;
  if (!schemaFlagIsUnset(schemaAttributeValue(xfrm.attributes, 'flipH'))) return null;
  if (!schemaFlagIsUnset(schemaAttributeValue(xfrm.attributes, 'flipV'))) return null;
  const off = drawingMl(xfrm, 'off');
  const ext = drawingMl(xfrm, 'ext');
  const chOff = drawingMl(xfrm, 'chOff');
  const chExt = drawingMl(xfrm, 'chExt');
  if (!ext || !chExt) return null;
  // An absent offset is the origin; an offset that does not read refuses the group.
  const point = (node: OoxmlElement | null) => {
    if (!node) return { x: 0, y: 0 };
    const read = (name: string) => {
      const raw = schemaAttributeValue(node.attributes, name);
      return raw === undefined ? null : parseEmu(collapseSchemaWhitespace(raw), false);
    };
    const x = read('x');
    const y = read('y');
    return x === null || y === null ? null : { x, y };
  };
  const size = (node: OoxmlElement) => ({
    cx: readSize(schemaAttributeValue(node.attributes, 'cx'), null),
    cy: readSize(schemaAttributeValue(node.attributes, 'cy'), null),
  });
  const own = size(ext);
  const child = size(chExt);
  if (own.cx === null || own.cy === null || child.cx === null || child.cy === null) return null;
  const at = point(off);
  const childOffset = point(chOff);
  if (!at || !childOffset) return null;
  // The nested box sits at `off` in the parent's child space; its child space spans that box.
  const space: GroupSpace = {
    shift: mapGroupPoint(parent, at),
    childOffset,
    scaleX: child.cx > 0 ? parent.scaleX * (own.cx / child.cx) : 0,
    scaleY: child.cy > 0 ? parent.scaleY * (own.cy / child.cy) : 0,
  };
  const finite = [space.shift.x, space.shift.y, space.scaleX, space.scaleY].every(Number.isFinite);
  return finite ? space : null;
}

/**
 * Every painted member of the group, nested groups flattened in document order, or null when
 * the group cannot paint whole: more than {@link MAX_GROUP_SHAPE_CHILDREN} members in all
 * (nested groups count too), nesting deeper than {@link MAX_GROUP_NESTING_DEPTH}, or a nested
 * group that paint cannot place.
 */
export function flattenGroupMembers(
  frame: DrawingGroupFrame,
  space: GroupSpace
): readonly GroupMember[] | null {
  const members: GroupMember[] = [];
  const budget = { remaining: MAX_GROUP_SHAPE_CHILDREN };
  const walk = (
    group: OoxmlElement,
    groupSpace: GroupSpace,
    groupFill: OoxmlElement | null,
    depth: number
  ): boolean => {
    for (const child of group.children) {
      if (!isElement(child) || isGroupPropertyChild(child)) continue;
      budget.remaining -= 1;
      if (budget.remaining < 0) return false;
      if (!isNestedGroup(child)) {
        members.push({ member: child, space: groupSpace, groupFill });
        continue;
      }
      // A hidden nested group paints nothing, and the rest of the group still paints.
      if (hiddenGroup(child)) continue;
      const nested = depth < MAX_GROUP_NESTING_DEPTH ? nestedGroupSpace(child, groupSpace) : null;
      if (!nested) return false;
      if (!walk(child, nested, groupFillOf(child, groupFill), depth + 1)) return false;
    }
    return true;
  };
  return walk(frame.group, space, groupFillOf(frame.group, null), 0) ? members : null;
}
