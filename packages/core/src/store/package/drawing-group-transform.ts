// Group-space to shape-space mapping for the children of one `wpg:wgp` group.
import type { VectorShapeComponent } from './drawing-shape-projection.ts';

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
 * A line-end triangle under a group that collapses one axis. The line now runs along the
 * other axis, so the triangle is rebuilt pointing along it: the tip follows the line end, and
 * the length and width keep their size at the other axis's scale, as the stroke width does.
 * A line perpendicular to the collapsed axis shrinks to a point and loses its triangle.
 */
function collapsedArrowhead(
  path: readonly Readonly<{ x: number; y: number }>[],
  offset: Readonly<{ x: number; y: number }>,
  scaleX: number,
  scaleY: number
): { x: number; y: number }[] {
  const [tip, wingA, wingB] = path;
  if (!tip || !wingA || !wingB) return [];
  const alongY = scaleX === 0;
  const scale = Math.abs(alongY ? scaleY : scaleX);
  const baseX = (wingA.x + wingB.x) / 2;
  const baseY = (wingA.y + wingB.y) / 2;
  // The triangle's reach along the surviving axis gives its direction there.
  const reach = alongY ? (tip.y - baseY) * scaleY : (tip.x - baseX) * scaleX;
  if (reach === 0) return [];
  const length = Math.hypot(tip.x - baseX, tip.y - baseY) * scale;
  const halfWidth = (Math.hypot(wingA.x - wingB.x, wingA.y - wingB.y) / 2) * scale;
  const direction = Math.sign(reach);
  const tipX = offset.x + tip.x * scaleX;
  const tipY = offset.y + tip.y * scaleY;
  if (alongY) {
    const base = tipY - direction * length;
    return [
      { x: tipX, y: tipY },
      { x: tipX - halfWidth, y: base },
      { x: tipX + halfWidth, y: base },
    ];
  }
  const base = tipX - direction * length;
  return [
    { x: tipX, y: tipY },
    { x: base, y: tipY - halfWidth },
    { x: base, y: tipY + halfWidth },
  ];
}
