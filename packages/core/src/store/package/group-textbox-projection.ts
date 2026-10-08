// Text box members of one `wpg:wgp` drawing group.
//
// A member's `a:xfrm` places it in the group's child space (`chOff`/`chExt`); the group
// extent scales that space. The member's story lays out in the SCALED member box: insets and
// run sizes stay as authored, so a scaled group wraps its text at the member's painted width.
// The projection reads only the bounded group frame and the members' own properties; it never
// walks a story, so the per-drawing element budget is not spent on paragraphs.

import {
  MAX_GROUP_SHAPE_CHILDREN,
  isGroupPropertyChild,
  readDrawingGroupFrame,
  schemaAngleIsZero,
  schemaFlagIsUnset,
} from './drawing-group-frame.ts';
import type { DrawingProjection } from './drawing-projection.ts';
import { isElement } from './drawing-projection-walk.ts';
import {
  childTransform,
  findDirectChild,
  isUnpaintedGroupTextbox,
  projectWspTextboxStory,
  type ShapeSchemeColorResolver,
  type ShapeStyleMatrixResolver,
  type TextboxStoryProjection,
} from './drawing-shape-projection.ts';
import { schemaAttributeValue, WPS_NAMESPACE_URI } from './ooxml-drawing-rules.ts';
import { DRAWINGML_MAIN_NAMESPACE_URI, type OoxmlElement } from './ooxml-tree.ts';
import { WML_NAMESPACE_URI } from './ooxml-shared.ts';

/** One text box member of a drawing group. */
export interface GroupTextboxProjection {
  /** Canonical node id of the member `wps:wsp`; namespaces the story's line ids. */
  readonly memberNodeId: string;
  /** The member box in the group's extent space, in EMU (origin at the extent's top-left). */
  readonly frameEmu: Readonly<{ x: number; y: number; cx: number; cy: number }>;
  /** The member's story, projected at the scaled member size. */
  readonly story: TextboxStoryProjection;
}

/** A member transform the text layout can honour: no rotation and no flips. */
function uprightMember(member: OoxmlElement): boolean {
  const spPr = findDirectChild(member.children, {
    namespaceUri: WPS_NAMESPACE_URI,
    localName: 'spPr',
  });
  const xfrm = spPr
    ? findDirectChild(spPr.children, {
        namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
        localName: 'xfrm',
      })
    : null;
  if (!xfrm) return true;
  return (
    schemaAngleIsZero(schemaAttributeValue(xfrm.attributes, 'rot')) &&
    schemaFlagIsUnset(schemaAttributeValue(xfrm.attributes, 'flipH')) &&
    schemaFlagIsUnset(schemaAttributeValue(xfrm.attributes, 'flipV'))
  );
}

/** The `w:txbxContent` root of a `wps:wsp`, or null when it holds no story. */
function storyRootOf(wsp: OoxmlElement): OoxmlElement | null {
  const txbx = findDirectChild(wsp.children, {
    namespaceUri: WPS_NAMESPACE_URI,
    localName: 'txbx',
  });
  return txbx
    ? findDirectChild(txbx.children, { namespaceUri: WML_NAMESPACE_URI, localName: 'txbxContent' })
    : null;
}

/**
 * The story roots of a group's upright text box members, in document order, for read-only
 * derivations such as Find. A bounded read of the group frame and its direct members only.
 */
export function groupTextboxContents(anchor: OoxmlElement): readonly OoxmlElement[] {
  const frame = readDrawingGroupFrame(anchor);
  if (!frame) return [];
  const roots: OoxmlElement[] = [];
  let count = 0;
  for (const child of frame.group.children) {
    if (!isElement(child) || isGroupPropertyChild(child)) continue;
    count += 1;
    if (count > MAX_GROUP_SHAPE_CHILDREN) return [];
    if (child.namespaceUri !== WPS_NAMESPACE_URI || child.localName !== 'wsp') continue;
    if (!uprightMember(child)) continue;
    const root = storyRootOf(child);
    if (root) roots.push(root);
  }
  return roots;
}

/**
 * The text box members of a group drawing, in document order.
 *
 * A group paints whole or not at all, so its member text follows the group: `groupPaints`
 * says whether the rest of the group paints. A group whose only members are text boxes
 * without fill or outline has nothing else to paint, and its text alone still renders.
 * Rotated or flipped members keep their text unlaid. Null when no member contributes text.
 */
export function projectGroupTextboxes(
  anchor: OoxmlElement,
  extent: Readonly<{ cx: number; cy: number }>,
  groupPaints: boolean,
  resolveSchemeColor?: ShapeSchemeColorResolver,
  resolveStyleMatrixReference?: ShapeStyleMatrixResolver
): readonly GroupTextboxProjection[] | null {
  if (extent.cx <= 0 || extent.cy <= 0) return null;
  const frame = readDrawingGroupFrame(anchor);
  if (!frame) return null;
  const { x: chOffX, y: chOffY } = frame.childOffsetEmu;
  const { cx: chExtX, cy: chExtY } = frame.childExtentEmu;
  const scaleX = chExtX > 0 ? extent.cx / chExtX : 0;
  const scaleY = chExtY > 0 ? extent.cy / chExtY : 0;
  const members: GroupTextboxProjection[] = [];
  let count = 0;
  let onlyUnpaintedText = true;
  for (const child of frame.group.children) {
    if (!isElement(child) || isGroupPropertyChild(child)) continue;
    count += 1;
    if (count > MAX_GROUP_SHAPE_CHILDREN) return null;
    if (!isUnpaintedGroupTextbox(child, resolveSchemeColor, resolveStyleMatrixReference)) {
      onlyUnpaintedText = false;
    }
    if (child.namespaceUri !== WPS_NAMESPACE_URI || child.localName !== 'wsp') continue;
    if (!uprightMember(child)) continue;
    const transform = childTransform(child);
    if (!transform) continue;
    const cx = Math.round(transform.extent.cx * scaleX);
    const cy = Math.round(transform.extent.cy * scaleY);
    const story = projectWspTextboxStory(
      child,
      { cx, cy },
      resolveSchemeColor,
      resolveStyleMatrixReference
    );
    if (!story) continue;
    members.push(
      Object.freeze({
        memberNodeId: child.id,
        frameEmu: Object.freeze({
          x: Math.round((transform.offset.x - chOffX) * scaleX),
          y: Math.round((transform.offset.y - chOffY) * scaleY),
          cx,
          cy,
        }),
        story: Object.freeze({ ...story, insetsEmu: Object.freeze({ ...story.insetsEmu }) }),
      })
    );
  }
  if (members.length === 0 || !(groupPaints || onlyUnpaintedText)) return null;
  return Object.freeze(members);
}

/** The `groupTextboxes` field of a drawing projection: present only when a member has text. */
export function groupTextboxesField(
  anchor: OoxmlElement,
  extent: Readonly<{ cx: number; cy: number }>,
  painted: Pick<DrawingProjection, 'picture' | 'groupPicture' | 'vectorShape'>,
  ctx: Readonly<{
    resolveSchemeColor?: ShapeSchemeColorResolver;
    resolveStyleMatrixReference?: ShapeStyleMatrixResolver;
  }>
): { readonly groupTextboxes?: readonly GroupTextboxProjection[] } {
  if (painted.picture) return {};
  const groupTextboxes = projectGroupTextboxes(
    anchor,
    extent,
    painted.groupPicture !== null || painted.vectorShape !== null,
    ctx.resolveSchemeColor,
    ctx.resolveStyleMatrixReference
  );
  return groupTextboxes ? { groupTextboxes } : {};
}

/** Whether a projection hosts a text-box story of its own or in a group member. */
export function hostsTextboxStory(projection: DrawingProjection | null | undefined): boolean {
  return !!projection && (projection.textboxStory !== null || !!projection.groupTextboxes);
}
