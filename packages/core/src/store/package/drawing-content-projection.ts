// What a drawing paints besides a plain picture: a picture frame, a group picture, vector shapes,
// a text box story, the text of group members, a SmartArt diagram, a chart from its chart part,
// or a drawing canvas.

import { projectChart } from './chart-projection.ts';
import type { DiagramPartResolver } from './diagram-parts.ts';
import { projectDiagram } from './diagram-projection.ts';
import { projectCanvas } from './drawing-canvas-projection.ts';
import {
  groupVectorMembersAreBounded,
  readGroupPicture,
  type GroupPictureProjection,
} from './drawing-group-picture.ts';
import {
  projectTextboxStory,
  projectVectorShape,
  type ShapeSchemeColorResolver,
  type ShapeStyleMatrixResolver,
  type TextboxStoryProjection,
  type VectorShapeProjection,
} from './drawing-shape-projection.ts';
import { groupTextboxesField, type GroupTextboxProjection } from './group-textbox-projection.ts';
import { projectPictureFrame } from './drawing-picture-frame.ts';
import type { OoxmlElement } from './ooxml-tree.ts';

export interface DrawingContentContext {
  readonly resolveSchemeColor?: ShapeSchemeColorResolver;
  readonly resolveStyleMatrixReference?: ShapeStyleMatrixResolver;
  readonly resolveDiagramParts?: DiagramPartResolver;
}

export interface DrawingContentProjection {
  readonly groupPicture: GroupPictureProjection | null;
  readonly vectorShape: VectorShapeProjection | null;
  readonly textboxStory: TextboxStoryProjection | null;
  readonly groupTextboxes?: readonly GroupTextboxProjection[];
  /** Something paints, so an "unsupported graphic" diagnostic no longer applies. */
  readonly paints: boolean;
  /** A picture's clip ring in the unit square of its extent; see `projectPictureFrame`. */
  readonly pictureClipUnit?: readonly Readonly<{ x: number; y: number }>[];
}

const NOTHING: DrawingContentProjection = Object.freeze({
  groupPicture: null,
  vectorShape: null,
  textboxStory: null,
  paints: false,
});

/**
 * The painted content of a drawing: for a picture, the frame its `pic:spPr` draws around it;
 * otherwise the group picture, shapes, story, diagram, or canvas it holds.
 */
export function projectDrawingContent(
  anchor: OoxmlElement,
  extent: Readonly<{ cx: number; cy: number }>,
  compatibilityMode: boolean,
  picture: OoxmlElement | null,
  ctx: DrawingContentContext
): DrawingContentProjection {
  if (picture) {
    const frame = projectPictureFrame(picture, extent, ctx);
    return {
      ...NOTHING,
      vectorShape: frame.vectorShape,
      ...(frame.clipUnit ? { pictureClipUnit: frame.clipUnit } : {}),
    };
  }
  const groupRead = readGroupPicture(
    anchor,
    extent,
    ctx.resolveStyleMatrixReference,
    ctx.resolveSchemeColor
  );
  const vectorMembers = projectVectorShape(
    anchor,
    extent,
    compatibilityMode,
    ctx.resolveSchemeColor,
    ctx.resolveStyleMatrixReference,
    groupRead?.picture.memberNodeId
  );
  // A group paints whole or not at all: the picture needs every other member to paint too,
  // inside the same bounds as the picture frame.
  const groupAdmitted =
    groupRead !== null &&
    (vectorMembers
      ? groupVectorMembersAreBounded(vectorMembers, extent)
      : !groupRead.hasOtherMembers);
  const groupPicture = groupAdmitted ? groupRead.picture : null;
  const vectorShape = groupRead && !groupAdmitted ? null : vectorMembers;
  if (!groupPicture && !vectorShape) {
    const diagram =
      projectDiagram(anchor, extent, ctx) ??
      projectChart(anchor, extent, {
        resolveChartPart: ctx.resolveDiagramParts?.chart,
        resolveSchemeColor: ctx.resolveSchemeColor,
      }) ??
      projectCanvas(anchor, extent, ctx);
    if (diagram) {
      return {
        groupPicture: null,
        vectorShape: diagram.vectorShape,
        textboxStory: null,
        ...(diagram.groupTextboxes ? { groupTextboxes: diagram.groupTextboxes } : {}),
        paints: true,
      };
    }
  }
  return {
    groupPicture,
    vectorShape,
    textboxStory: projectTextboxStory(
      anchor,
      extent,
      ctx.resolveSchemeColor,
      ctx.resolveStyleMatrixReference
    ),
    ...groupTextboxesField(anchor, extent, { picture: null, groupPicture, vectorShape }, ctx),
    paints: groupPicture !== null || vectorShape !== null,
  };
}
