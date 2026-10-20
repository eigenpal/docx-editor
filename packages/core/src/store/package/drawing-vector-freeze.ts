import type { VectorShapeComponent } from './drawing-shape-projection.ts';

const freezePaths = (paths: VectorShapeComponent['subpathsEmu']) =>
  Object.freeze(
    paths.map((points) => Object.freeze(points.map((point) => Object.freeze({ ...point }))))
  );

export function freezeVectorShapeComponent(component: VectorShapeComponent): VectorShapeComponent {
  return Object.freeze({
    ...component,
    subpathsEmu: freezePaths(component.subpathsEmu),
    ...(component.subpathsClosed
      ? { subpathsClosed: Object.freeze([...component.subpathsClosed]) }
      : {}),
    ...(component.arrowheadsEmu ? { arrowheadsEmu: freezePaths(component.arrowheadsEmu) } : {}),
  });
}
