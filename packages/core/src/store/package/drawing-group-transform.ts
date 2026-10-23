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
    subpathsEmu: component.subpathsEmu.map((path) =>
      path.map((point) => ({
        x: offset.x + point.x * scaleX,
        y: offset.y + point.y * scaleY,
      }))
    ),
    // A collapsed axis (scale 0) says nothing about the stroke; the other axis scales it.
    strokeWidthEmu:
      component.strokeWidthEmu *
      (scaleX === 0
        ? Math.abs(scaleY)
        : scaleY === 0
          ? Math.abs(scaleX)
          : (Math.abs(scaleX) + Math.abs(scaleY)) / 2),
    ...(component.arrowheadsEmu
      ? {
          arrowheadsEmu: component.arrowheadsEmu.map((path) =>
            scaleX !== 0 && scaleY !== 0
              ? path.map((point) => ({
                  x: offset.x + point.x * scaleX,
                  y: offset.y + point.y * scaleY,
                }))
              : collapsedArrowhead(path, offset, scaleX, scaleY)
          ),
        }
      : {}),
  };
}

/**
 * A line end under a group that collapses one axis. The line now runs along the other axis,
 * so the outline is turned to point along it: the line end follows the line, and the length
 * and width keep their size at the other axis's scale, as the stroke width does. A line
 * perpendicular to the collapsed axis shrinks to a point and loses its line end.
 *
 * The outline's first point is the line end (see `projectLineArrowheads`). The line direction
 * runs from the outline's centroid to that end, or for a centred outline from the end to the
 * second point.
 */
function collapsedArrowhead(
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
  const alongY = scaleX === 0;
  const scale = Math.abs(alongY ? scaleY : scaleX);
  // The direction's reach along the surviving axis gives the turned direction there.
  const direction = Math.sign(alongY ? uy * scaleY : ux * scaleX);
  if (direction === 0) return [];
  const [newUx, newUy] = alongY ? [0, direction] : [direction, 0];
  const endX = offset.x + end.x * scaleX;
  const endY = offset.y + end.y * scaleY;
  return path.map((point) => {
    const along = ((point.x - end.x) * ux + (point.y - end.y) * uy) * scale;
    const across = (-(point.x - end.x) * uy + (point.y - end.y) * ux) * scale;
    return { x: endX + along * newUx - across * newUy, y: endY + along * newUy + across * newUx };
  });
}
