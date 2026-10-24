// Group-space to shape-space mapping for the children of one `wpg:wgp` group.
import type { VectorShapeComponent } from './drawing-shape-projection.ts';
import { compose } from './drawing-gradient.ts';

/**
 * Map a group child's component from child coordinates into the group's extent. A zero scale
 * collapses an axis: rules that share one x in child space all land on the group's origin.
 */
export function transformComponent(
  component: VectorShapeComponent,
  offset: Readonly<{ x: number; y: number }>,
  scaleX: number,
  scaleY: number
): VectorShapeComponent {
  // A group that collapses an axis flattens an inset outline's shape onto a line; with no
  // inside left, the outline stays centred.
  const { strokeInset: inset, ...rest } = component;
  return {
    ...rest,
    ...(inset && scaleX !== 0 && scaleY !== 0 ? { strokeInset: true } : {}),
    ...(component.shadow
      ? {
          shadow: {
            ...component.shadow,
            dxEmu: component.shadow.dxEmu * scaleX,
            dyEmu: component.shadow.dyEmu * scaleY,
            blurEmu: component.shadow.blurEmu * ((Math.abs(scaleX) + Math.abs(scaleY)) / 2),
          },
        }
      : {}),
    ...(component.fillGradient
      ? {
          fillGradient: {
            ...component.fillGradient,
            matrix: compose(
              [scaleX, 0, 0, scaleY, offset.x, offset.y],
              component.fillGradient.matrix
            ),
          },
        }
      : {}),
    ...(component.clipEmu
      ? {
          clipEmu: component.clipEmu.map((path) =>
            path.map((point) => ({
              x: offset.x + point.x * scaleX,
              y: offset.y + point.y * scaleY,
            }))
          ),
        }
      : {}),
    subpathsEmu: component.subpathsEmu.map((path) =>
      path.map((point) => ({
        x: offset.x + point.x * scaleX,
        y: offset.y + point.y * scaleY,
      }))
    ),
    // A line width is an absolute length: the group's child-to-extent scale moves and sizes
    // the geometry, never the width of its outlines.
    strokeWidthEmu: component.strokeWidthEmu,
    ...(component.arrowheadsEmu
      ? {
          arrowheadsEmu: component.arrowheadsEmu.map((path) =>
            groupArrowhead(path, offset, scaleX, scaleY)
          ),
        }
      : {}),
  };
}

/**
 * A line end under a group's child-to-extent scale. The outline is sized from the line width,
 * an absolute length, so it keeps its size and only turns to follow the scaled line. A group
 * that collapses one axis turns it along the other axis; a line perpendicular to the
 * collapsed axis shrinks to a point and loses its line end.
 *
 * The outline's first point is the line end (see `projectLineArrowheads`). The line direction
 * runs from the outline's centroid to that end, or for a centred outline from the end to the
 * second point.
 */
function groupArrowhead(
  path: readonly Readonly<{ x: number; y: number }>[],
  offset: Readonly<{ x: number; y: number }>,
  scaleX: number,
  scaleY: number
): { x: number; y: number }[] {
  const end = path[0];
  if (!end || path.length < 3) return [];
  let centroidX = 0;
  let centroidY = 0;
  for (const point of path) {
    centroidX += point.x / path.length;
    centroidY += point.y / path.length;
  }
  let ux = end.x - centroidX;
  let uy = end.y - centroidY;
  if (Math.hypot(ux, uy) < 1e-6 * Math.max(1, Math.abs(end.x), Math.abs(end.y))) {
    ux = path[1]!.x - end.x;
    uy = path[1]!.y - end.y;
  }
  const norm = Math.hypot(ux, uy);
  if (!(norm > 0)) return [];
  ux /= norm;
  uy /= norm;
  // The scaled direction; zero when the line runs along a collapsed axis.
  let newUx = ux * scaleX;
  let newUy = uy * scaleY;
  const newNorm = Math.hypot(newUx, newUy);
  if (!(newNorm > 1e-12)) return [];
  newUx /= newNorm;
  newUy /= newNorm;
  const endX = offset.x + end.x * scaleX;
  const endY = offset.y + end.y * scaleY;
  return path.map((point) => {
    const along = (point.x - end.x) * ux + (point.y - end.y) * uy;
    const across = -(point.x - end.x) * uy + (point.y - end.y) * ux;
    return { x: endX + along * newUx - across * newUy, y: endY + along * newUy + across * newUx };
  });
}
