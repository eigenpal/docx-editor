// The frame of a picture member of a `wpg:wgp` group. The group picture paints the raster. A
// fill on the member paints under the picture, where the picture is transparent, and a visible
// `a:ln` strokes above it. The projector comes in as a parameter so this module does not
// import the shape projection that calls it.

import type { ShapeSchemeColorResolver } from './drawing-shape-color.ts';
import type { ShapeStyleMatrixResolver, VectorShapeComponent } from './drawing-shape-projection.ts';
import type { OoxmlElement } from './ooxml-tree.ts';

type Extent = Readonly<{ cx: number; cy: number }>;

export interface GroupPictureFrameTools {
  readonly project: (
    member: OoxmlElement,
    extent: Extent,
    pointBudget: { remaining: number },
    resolveSchemeColor?: ShapeSchemeColorResolver,
    resolveStyleMatrixReference?: ShapeStyleMatrixResolver,
    groupMember?: boolean
  ) => readonly VectorShapeComponent[] | null;
  /** Places a component of the member's own extent in the drawing extent. */
  readonly place: (component: VectorShapeComponent) => VectorShapeComponent;
}

/** The components of a picture member's frame, on each side of the picture. */
export interface GroupPictureFrame {
  /** The member's fill, which shows where the picture is transparent. */
  readonly under: VectorShapeComponent[];
  /** The member's outline. */
  readonly over: VectorShapeComponent[];
}

/**
 * The member's fill and outline as placed components: empty lists when it has neither, null
 * when its frame is outside the painted subset. A shadow of the member does not paint.
 *
 * `extent` is the member's own extent, as the group places it. A shape with a picture fill
 * takes its outline from its style (`wps:style/a:lnRef`), so the caller passes the style
 * resolver for it; a `pic:pic` has no style.
 */
export function groupPictureFrame(
  member: OoxmlElement,
  extent: Extent,
  pointBudget: { remaining: number },
  resolveSchemeColor: ShapeSchemeColorResolver | undefined,
  resolveStyleMatrixReference: ShapeStyleMatrixResolver | undefined,
  tools: GroupPictureFrameTools
): GroupPictureFrame | null {
  const components = tools.project(
    member,
    extent,
    pointBudget,
    resolveSchemeColor,
    resolveStyleMatrixReference,
    true
  );
  if (components === null) return null;
  const frame: GroupPictureFrame = { under: [], over: [] };
  for (const component of components) {
    if (component.shadowOnly) continue;
    const { shadow: _shadow, ...flat } = component;
    if (flat.fillHex !== null) {
      const { arrowheadsEmu: _arrowheads, strokeDash: _dash, ...filled } = flat;
      frame.under.push(tools.place({ ...filled, strokeHex: null, strokeWidthEmu: 0 }));
    }
    if (flat.strokeHex !== null && flat.strokeWidthEmu > 0) {
      const { fillGradient: _gradient, fillPattern: _pattern, ...stroked } = flat;
      frame.over.push(tools.place({ ...stroked, fillHex: null }));
    }
  }
  return frame;
}
