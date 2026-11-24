// Text box members of one `wpg:wgp` drawing group, nested `wpg:grpSp` members included.
//
// A member's `a:xfrm` places it in the group's child space (`chOff`/`chExt`); the group
// extent scales that space. The member's story lays out in the SCALED member box: insets and
// run sizes stay as authored, so a scaled group wraps its text at the member's painted width.
// The projection reads only the bounded group frame and the members' own properties; it never
// walks a story, so the per-drawing element budget is not spent on paragraphs.

import {
  flattenGroupMembers,
  listGroupMembers,
  groupSpacePlacement,
  rootGroupSpace,
  turnGroupPoint,
  turnGroupTextAngle,
} from './drawing-group-members.ts';
import { shapeRotationDegrees } from './drawing-shape-geometry.ts';
import { shapeTransformElement } from './drawing-shape-transform.ts';
import {
  readDrawingGroupFrame,
  schemaFlagIsSet,
  schemaFlagIsUnset,
} from './drawing-group-frame.ts';
import type { DrawingProjection } from './drawing-projection.ts';
import {
  childTransform,
  findDirectChild,
  isUnpaintedGroupTextbox,
  projectWspTextboxStory,
  type ShapeSchemeColorResolver,
  type ShapeStyleMatrixResolver,
  type TextboxStoryProjection,
} from './drawing-shape-projection.ts';
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
import { WML_NAMESPACE_URI } from './ooxml-shared.ts';

/** One text box member of a drawing group. @internal */
export interface GroupTextboxProjection {
  /** Canonical node id of the member `wps:wsp`; namespaces the story's line ids. */
  readonly memberNodeId: string;
  /**
   * The box the member's story lays out in, in the group's extent space, in EMU (origin at
   * the extent's top-left). It is the member box, or for vertical text the member box with
   * its sides swapped about the same centre. Under turned or flipped groups the box keeps its
   * size, and its centre moves where those groups carry the member centre.
   */
  readonly frameEmu: Readonly<{ x: number; y: number; cx: number; cy: number }>;
  /** The member's story, projected at the scaled member size. */
  readonly story: TextboxStoryProjection;
  /**
   * Clockwise turn of the member's text about the member box center, in degrees [0, 360):
   * the member's `rot`, plus 180 for `flipV`; then each enclosing group, innermost first,
   * negates it for `flipH`, reflects it to 180 minus it for `flipV`, and adds its `rot`;
   * then a quarter turn for vertical text (`bodyPr/@vert`). No flip mirrors the text.
   */
  readonly rotationDegrees: number;
}

/** EMU-free angle units of `ST_Angle`: 60000 per degree. */
const ANGLE_UNITS_PER_DEGREE = 60_000;
/** `ST_Angle` is an `xsd:int`. */
const XSD_INT_MAX = 2_147_483_647;

/**
 * The clockwise turn of a member's text, or null when its transform is schema-invalid.
 *
 * The text keeps its reading direction under `flipH` and turns upside down under `flipV`, so
 * a flip adds either nothing or a half turn to the authored rotation.
 */
export function memberTextRotation(member: OoxmlElement): number | null {
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
  if (!xfrm) return 0;
  const flipH = schemaAttributeValue(xfrm.attributes, 'flipH');
  const flipV = schemaAttributeValue(xfrm.attributes, 'flipV');
  for (const flag of [flipH, flipV]) {
    if (!schemaFlagIsUnset(flag) && !schemaFlagIsSet(flag)) return null;
  }
  const raw = schemaAttributeValue(xfrm.attributes, 'rot');
  let degrees = 0;
  if (raw !== undefined) {
    const collapsed = collapseSchemaWhitespace(raw);
    // Bounded digit count: `rot` is an xsd:int and only scales an angle here.
    if (!/^[+-]?\d{1,12}$/.test(collapsed)) return null;
    const units = Number(collapsed);
    if (units < -XSD_INT_MAX - 1 || units > XSD_INT_MAX) return null;
    degrees = units / ANGLE_UNITS_PER_DEGREE;
  }
  if (schemaFlagIsSet(flipV)) degrees += 180;
  const turned = ((degrees % 360) + 360) % 360;
  return Number.isFinite(turned) ? turned : null;
}

/**
 * Whether `wps:bodyPr/@upright` (CT_TextBodyProperties, ECMA-376 Part 1, 21.1.2.1.1) keeps the
 * member's text upright whatever the shape and group transforms turn.
 */
function textStaysUpright(member: OoxmlElement): boolean {
  const bodyPr = findDirectChild(member.children, {
    namespaceUri: WPS_NAMESPACE_URI,
    localName: 'bodyPr',
  });
  return !!bodyPr && schemaFlagIsSet(schemaAttributeValue(bodyPr.attributes, 'upright'));
}

/**
 * The quarter turn that `wps:bodyPr/@vert` (ST_TextVerticalType, ECMA-376 Part 1, 20.1.10.83)
 * gives a member's text: 90 for `vert` and `eaVert`, 270 for `vert270`, and 0 otherwise. As for
 * a text box outside a group, `eaVert` lays out as a turned block, so East Asian glyphs turn
 * with the line instead of standing upright.
 */
function verticalFlowTurn(member: OoxmlElement): 0 | 90 | 270 {
  const bodyPr = findDirectChild(member.children, {
    namespaceUri: WPS_NAMESPACE_URI,
    localName: 'bodyPr',
  });
  const raw = bodyPr ? schemaAttributeValue(bodyPr.attributes, 'vert') : undefined;
  const vert = raw === undefined ? undefined : collapseSchemaWhitespace(raw);
  if (vert === 'vert' || vert === 'eaVert') return 90;
  return vert === 'vert270' ? 270 : 0;
}

type Insets = Readonly<{ top: number; right: number; bottom: number; left: number }>;

/**
 * The shape's insets as the edges of text turned by `flowTurn`. A clockwise quarter turn puts
 * the text's top at the shape's right edge; a counterclockwise one puts it at the left edge.
 */
function turnedInsets(insets: Insets, flowTurn: 0 | 90 | 270): Insets {
  if (flowTurn === 90) {
    return { top: insets.right, right: insets.bottom, bottom: insets.left, left: insets.top };
  }
  if (flowTurn === 270) {
    return { top: insets.left, right: insets.top, bottom: insets.right, left: insets.bottom };
  }
  return { ...insets };
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

/** One text box story root of a group, as read-only derivations list it. */
export interface GroupTextboxContent {
  readonly root: OoxmlElement;
  /** Layout lays out none of it: its member is hidden, or its group paints a placeholder. */
  readonly unplaced?: true;
}

/**
 * The story roots of a group's text box members, in document order, for read-only
 * derivations such as Find and paragraph reads. A bounded read of the group frame and its
 * members, nested and hidden members included. Text that layout lays out none of (a hidden
 * member, or a group that paints a placeholder) stays listed for paragraph reads, marked
 * `unplaced`, so the selectable story list leaves it out.
 */
export function groupTextboxContents(anchor: OoxmlElement): readonly GroupTextboxContent[] {
  const frame = readDrawingGroupFrame(anchor, { turned: true });
  if (!frame) return [];
  const members = listGroupMembers(frame);
  // Only whether the members place is read here, so the scale does not matter. A picture in a
  // turned or flipped space has no frame, so its group paints a placeholder too.
  const flattened = flattenGroupMembers(
    frame,
    rootGroupSpace(frame, { cx: 0, cy: 0 }, { withTurn: true })
  );
  const placed =
    flattened !== null &&
    !flattened.some(
      ({ member, space }) =>
        space.turns !== undefined &&
        member.namespaceUri === PIC_NAMESPACE_URI &&
        member.localName === 'pic'
    );
  const contents: GroupTextboxContent[] = [];
  for (const { member: child, hidden } of members) {
    if (child.namespaceUri !== WPS_NAMESPACE_URI || child.localName !== 'wsp') continue;
    if (memberTextRotation(child) === null) continue;
    const root = storyRootOf(child);
    if (root) contents.push(placed && !hidden ? { root } : { root, unplaced: true });
  }
  return contents;
}

/**
 * The text box members of a group drawing, in document order.
 *
 * A group paints whole or not at all, so its member text follows the group: `groupPaints`
 * says whether the rest of the group paints. A group whose only members are text boxes
 * without fill or outline has nothing else to paint, and its text alone still renders.
 * A rotated or flipped member lays out upright and records the turn its text takes. Null
 * when no member contributes text.
 */
export function projectGroupTextboxes(
  anchor: OoxmlElement,
  extent: Readonly<{ cx: number; cy: number }>,
  groupPaints: boolean,
  resolveSchemeColor?: ShapeSchemeColorResolver,
  resolveStyleMatrixReference?: ShapeStyleMatrixResolver
): readonly GroupTextboxProjection[] | null {
  if (extent.cx <= 0 || extent.cy <= 0) return null;
  const frame = readDrawingGroupFrame(anchor, { turned: true });
  if (!frame) return null;
  // The text of a turned group, or of a turned nested group, follows the turns of its space.
  const flattened = flattenGroupMembers(frame, rootGroupSpace(frame, extent, { withTurn: true }));
  if (!flattened) return null;
  const members: GroupTextboxProjection[] = [];
  let onlyUnpaintedText = true;
  for (const { member: child, space, groupFill } of flattened) {
    if (
      !isUnpaintedGroupTextbox(child, resolveSchemeColor, resolveStyleMatrixReference, groupFill)
    ) {
      onlyUnpaintedText = false;
    }
    if (child.namespaceUri !== WPS_NAMESPACE_URI || child.localName !== 'wsp') continue;
    const rotationDegrees = memberTextRotation(child);
    if (rotationDegrees === null) continue;
    const transform = childTransform(child);
    if (!transform) continue;
    // The text lays out in the box the member's shape paints in: a turned member's box maps
    // into the group extent before it turns.
    const place = groupSpacePlacement(
      transform,
      space,
      shapeRotationDegrees(shapeTransformElement(child)) ?? 0
    );
    const boxCx = Math.round(place.extent.cx * place.scaleX);
    const boxCy = Math.round(place.extent.cy * place.scaleY);
    // Vertical text lays out across the box, with the sides swapped about its centre, and
    // turns a quarter: clockwise for top-to-bottom lines, counterclockwise for bottom-to-top.
    const flowTurn = verticalFlowTurn(child);
    const [cx, cy] = flowTurn === 0 ? [boxCx, boxCy] : [boxCy, boxCx];
    const story = projectWspTextboxStory(
      child,
      { cx, cy },
      resolveSchemeColor,
      resolveStyleMatrixReference
    );
    if (!story) continue;
    // The box keeps its size under a turn; its centre moves where the turns take it.
    const centre = turnGroupPoint(space, {
      x: place.offset.x + boxCx / 2,
      y: place.offset.y + boxCy / 2,
    });
    members.push(
      Object.freeze({
        memberNodeId: child.id,
        frameEmu: Object.freeze({
          x: Math.round(centre.x - cx / 2),
          y: Math.round(centre.y - cy / 2),
          cx,
          cy,
        }),
        story: Object.freeze({
          ...story,
          insetsEmu: Object.freeze(turnedInsets(story.insetsEmu, flowTurn)),
        }),
        // Group flips and turns carry the shape's turn; the vertical flow turns after them, so
        // top-to-bottom text stays top-to-bottom in a flipped group. Upright text keeps only
        // its flow turn.
        rotationDegrees: textStaysUpright(child)
          ? flowTurn
          : (turnGroupTextAngle(space, rotationDegrees) + flowTurn) % 360,
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
