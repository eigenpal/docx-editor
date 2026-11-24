// The painted members of one `wpg:wgp` drawing group, with nested `wpg:grpSp` groups
// flattened in document order.
//
// A nested group places itself in its parent's child space by its own `a:xfrm` (`off`/`ext`)
// and authors its members in its own child space (`chOff`/`chExt`): `a:xfrm` of type
// CT_GroupTransform2D (ECMA-376 Part 1, 20.1.7.5), with `a:chOff` of type CT_Point2D
// (Part 1, 20.1.7.2) and `a:chExt` of type CT_PositiveSize2D (Part 1, 20.1.7.1). Each member
// comes back with the composed map from its own child space into the drawing extent, so the
// vector, picture, and text box readers place a nested member as they place a direct one.
//
// A turned or flipped nested group (`rot` of type ST_Angle, Part 1, 20.1.10.3; `flipH` and
// `flipV` about the centre of the bounding box, Part 1, 20.1.7.5) places its members upright
// in its box first, then flips and turns them about the centre of that box, as a turned member
// turns after its box scales. The space keeps those turns, innermost last, for the readers to
// apply.

import { groupFillOf } from './drawing-group-fill.ts';
import {
  MAX_GROUP_SHAPE_CHILDREN,
  WPG_NAMESPACE_URI,
  groupTurn,
  isGroupPropertyChild,
  schemaFlagIsSet,
  schemaFlagIsUnset,
  supportedGroupVisuals,
  type DrawingGroupFrame,
  type GroupTurn,
} from './drawing-group-frame.ts';
import { groupMemberPlacement } from './drawing-group-transform.ts';
import { shapePointTransform } from './drawing-shape-geometry.ts';
import { isElement } from './drawing-projection-walk.ts';
import { findDirectChild, parseEmu, readSize } from './drawing-shape-readers.ts';
import {
  collapseSchemaWhitespace,
  schemaAttributeValue,
  WPS_NAMESPACE_URI,
} from './ooxml-drawing-rules.ts';
import {
  DRAWINGML_MAIN_NAMESPACE_URI,
  PIC_NAMESPACE_URI,
  type OoxmlElement,
} from './ooxml-tree.ts';

/** The deepest nested group a drawing may hold before its projection refuses it. */
export const MAX_GROUP_NESTING_DEPTH = 16;

/** One group's flip and turn about the centre of its box, in the drawing extent, in EMU. */
export interface GroupSpaceTurn {
  readonly box: Readonly<{ x: number; y: number; cx: number; cy: number }>;
  readonly turn: GroupTurn;
}

/**
 * The map from one group's child space into the drawing extent, in EMU:
 * `extent = shift + (child - childOffset) * scale`, then each of `turns` from the last to the
 * first. A zero scale collapses that axis.
 */
export interface GroupSpace {
  readonly shift: Readonly<{ x: number; y: number }>;
  readonly childOffset: Readonly<{ x: number; y: number }>;
  readonly scaleX: number;
  readonly scaleY: number;
  /** The turned or flipped groups around the member, outermost first. Absent when none. */
  readonly turns?: readonly GroupSpaceTurn[];
}

/** Whether a turn changes anything: a non-zero angle or a flip. */
export function turnsSomething(turn: GroupTurn | undefined | null): turn is GroupTurn {
  return !!turn && (turn.rotationDegrees !== 0 || turn.flipH || turn.flipV);
}

/** A point in the upright space, carried through the turns of `space`, innermost first. */
export function turnGroupPoint(
  space: GroupSpace,
  point: Readonly<{ x: number; y: number }>
): { x: number; y: number } {
  let { x, y } = point;
  const turns = space.turns ?? [];
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const { box, turn } = turns[index]!;
    const local = shapePointTransform(
      { cx: box.cx, cy: box.cy },
      turn.flipH,
      turn.flipV,
      turn.rotationDegrees
    )({ x: x - box.x, y: y - box.y });
    x = local.x + box.x;
    y = local.y + box.y;
  }
  return { x, y };
}

/**
 * The clockwise angle of upright text, in [0, 360), once the turns of `space` carry its shape.
 * A horizontal flip mirrors the shape and keeps the text readable, so it negates the angle; a
 * vertical flip turns the text upside down as well; a turn adds its angle.
 */
export function turnGroupTextAngle(space: GroupSpace, degrees: number): number {
  let angle = degrees;
  const turns = space.turns ?? [];
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const { turn } = turns[index]!;
    if (turn.flipH) angle = -angle;
    if (turn.flipV) angle = 180 - angle;
    angle += turn.rotationDegrees;
  }
  return ((angle % 360) + 360) % 360;
}

/** One painted member of a group, and the space it is authored in. */
export interface GroupMember {
  readonly member: OoxmlElement;
  readonly space: GroupSpace;
  /**
   * The fill that `a:grpFill` (CT_GroupFillProperties, Part 1, 20.1.8.35) on this member
   * resolves to, or null.
   */
  readonly groupFill: OoxmlElement | null;
}

/**
 * The child space of the drawing's own group, scaled into the drawing extent. With
 * `withTurn`, a turned or flipped group read with its turn carries it, about the extent.
 */
export function rootGroupSpace(
  frame: DrawingGroupFrame,
  extent: Readonly<{ cx: number; cy: number }>,
  options: { readonly withTurn?: boolean } = {}
): GroupSpace {
  const { cx, cy } = frame.childExtentEmu;
  const turn = options.withTurn ? frame.turn : undefined;
  return {
    shift: { x: 0, y: 0 },
    childOffset: frame.childOffsetEmu,
    scaleX: cx > 0 ? extent.cx / cx : 0,
    scaleY: cy > 0 ? extent.cy / cy : 0,
    ...(turnsSomething(turn)
      ? { turns: [{ box: { x: 0, y: 0, cx: extent.cx, cy: extent.cy }, turn }] }
      : {}),
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
  // The turns of the space are not applied here: the box is the upright one.
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

/**
 * Whether a member's non-visual properties legally set `hidden` (CT_NonVisualDrawingProps,
 * ECMA-376 Part 1, 20.1.2.2.8: the object is not displayed): `wps:cNvPr` of a shape,
 * `pic:nvPicPr/pic:cNvPr` of a picture, or `wpg:cNvPr` of a nested group. An invalid spelling
 * is not hidden here; the member's own read refuses it.
 */
function hiddenMember(member: OoxmlElement): boolean {
  let nonVisual: OoxmlElement | null = null;
  if (member.namespaceUri === PIC_NAMESPACE_URI && member.localName === 'pic') {
    const props = findDirectChild(member.children, {
      namespaceUri: PIC_NAMESPACE_URI,
      localName: 'nvPicPr',
    });
    nonVisual = props
      ? findDirectChild(props.children, { namespaceUri: PIC_NAMESPACE_URI, localName: 'cNvPr' })
      : null;
  } else if (
    (member.namespaceUri === WPS_NAMESPACE_URI && member.localName === 'wsp') ||
    isNestedGroup(member)
  ) {
    nonVisual = findDirectChild(member.children, {
      namespaceUri: member.namespaceUri,
      localName: 'cNvPr',
    });
  }
  return !!nonVisual && schemaFlagIsSet(schemaAttributeValue(nonVisual.attributes, 'hidden'));
}

/** A nested `wpg:grpSp`. */
export function isNestedGroup(node: OoxmlElement): boolean {
  return node.namespaceUri === WPG_NAMESPACE_URI && node.localName === 'grpSp';
}

/**
 * The child space of a nested group inside `parent`, or null when paint cannot place it
 * exactly: no `a:xfrm` with an `a:ext` and an `a:chExt`, a negative size, an offset that does
 * not read, a turn, flip, or `hidden` spelled outside the schema, or a group visual its
 * members cannot represent. A hidden nested group is skipped before this read, as every
 * hidden member is.
 */
function nestedGroupSpace(group: OoxmlElement, parent: GroupSpace): GroupSpace | null {
  // A `hidden` spelled outside the schema leaves the group's display unknown.
  const nonVisual = findDirectChild(group.children, {
    namespaceUri: WPG_NAMESPACE_URI,
    localName: 'cNvPr',
  });
  const hidden = nonVisual ? schemaAttributeValue(nonVisual.attributes, 'hidden') : undefined;
  if (hidden !== undefined && !schemaFlagIsSet(hidden) && !schemaFlagIsUnset(hidden)) return null;
  const properties = findDirectChild(group.children, {
    namespaceUri: WPG_NAMESPACE_URI,
    localName: 'grpSpPr',
  });
  if (!properties || !supportedGroupVisuals(group, properties, true)) return null;
  const xfrm = drawingMl(properties, 'xfrm');
  if (!xfrm) return null;
  const turn = groupTurn(xfrm);
  if (!turn) return null;
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
  // Sizes read after whitespace collapse, as offsets do.
  const sizeOf = (node: OoxmlElement, name: string) => {
    const raw = schemaAttributeValue(node.attributes, name);
    return readSize(raw === undefined ? undefined : collapseSchemaWhitespace(raw), null);
  };
  const size = (node: OoxmlElement) => ({
    cx: sizeOf(node, 'cx'),
    cy: sizeOf(node, 'cy'),
  });
  const own = size(ext);
  const child = size(chExt);
  if (own.cx === null || own.cy === null || child.cx === null || child.cy === null) return null;
  const at = point(off);
  const childOffset = point(chOff);
  if (!at || !childOffset) return null;
  // The nested box sits at `off` in the parent's child space; its child space spans that box.
  let space: GroupSpace = {
    shift: mapGroupPoint(parent, at),
    childOffset,
    scaleX: child.cx > 0 ? parent.scaleX * (own.cx / child.cx) : 0,
    scaleY: child.cy > 0 ? parent.scaleY * (own.cy / child.cy) : 0,
    ...(parent.turns ? { turns: parent.turns } : {}),
  };
  if (turnsSomething(turn)) {
    // A turned group's box maps upright first, as a turned member's box does: near a quarter
    // turn it takes the other axis's scale on each side, so its members never skew.
    const place = groupSpacePlacement(
      { offset: at, extent: { cx: own.cx, cy: own.cy } },
      parent,
      turn.rotationDegrees
    );
    const box = {
      x: place.offset.x,
      y: place.offset.y,
      cx: place.extent.cx * place.scaleX,
      cy: place.extent.cy * place.scaleY,
    };
    space = {
      shift: { x: box.x, y: box.y },
      childOffset,
      scaleX: child.cx > 0 ? box.cx / child.cx : 0,
      scaleY: child.cy > 0 ? box.cy / child.cy : 0,
      turns: [...(parent.turns ?? []), { box, turn }],
    };
  }
  const numbers = [space.shift.x, space.shift.y, space.scaleX, space.scaleY];
  for (const { box } of space.turns ?? []) numbers.push(box.x, box.y, box.cx, box.cy);
  return numbers.every(Number.isFinite) ? space : null;
}

/**
 * Every painted member of the group, nested groups flattened in document order, or null when
 * the group cannot paint whole: more than {@link MAX_GROUP_SHAPE_CHILDREN} members in all
 * (nested groups count too), nesting deeper than {@link MAX_GROUP_NESTING_DEPTH}, or a nested
 * group that paint cannot place. A member inside a turned or flipped nested group carries the
 * turns in its space.
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
      // A hidden member paints nothing, and the rest of the group still paints.
      if (hiddenMember(child)) continue;
      if (!isNestedGroup(child)) {
        members.push({ member: child, space: groupSpace, groupFill });
        continue;
      }
      const nested = depth < MAX_GROUP_NESTING_DEPTH ? nestedGroupSpace(child, groupSpace) : null;
      if (!nested) return false;
      if (!walk(child, nested, groupFillOf(child, groupFill), depth + 1)) return false;
    }
    return true;
  };
  return walk(frame.group, space, groupFillOf(frame.group, null), 0) ? members : null;
}

/** One member of a group as read-only derivations list it. */
export interface ListedGroupMember {
  readonly member: OoxmlElement;
  /** The member, or a nested group around it, is hidden, so it paints nothing. */
  readonly hidden: boolean;
}

/**
 * Every member of a group in document order, nested and hidden members included, whether or
 * not paint can place them. Read-only derivations use it, so text in a group that paints a
 * placeholder, or in a hidden member, stays readable. Visible members count against the
 * member budget as paint counts them; hidden ones read from a budget of their own, so a large
 * hidden group never hides visible text. Past either budget the list stops; levels past the
 * depth cap are not read.
 */
export function listGroupMembers(frame: DrawingGroupFrame): readonly ListedGroupMember[] {
  const members: ListedGroupMember[] = [];
  const budget = { visible: MAX_GROUP_SHAPE_CHILDREN, hidden: MAX_GROUP_SHAPE_CHILDREN };
  const walk = (group: OoxmlElement, depth: number, hiddenGroup: boolean): boolean => {
    for (const child of group.children) {
      if (!isElement(child) || isGroupPropertyChild(child)) continue;
      const hidden = hiddenGroup || hiddenMember(child);
      // Paint counts a hidden member once and reads nothing under it.
      if (!hiddenGroup) budget.visible -= 1;
      else budget.hidden -= 1;
      if (budget.visible < 0 || budget.hidden < 0) return false;
      if (!isNestedGroup(child)) members.push({ member: child, hidden });
      else if (depth < MAX_GROUP_NESTING_DEPTH && !walk(child, depth + 1, hidden)) return false;
    }
    return true;
  };
  walk(frame.group, 0, false);
  return members;
}
