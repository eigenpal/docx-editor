import { parseEmu, findDirectChild } from './drawing-shape-readers.ts';
import { isElement } from './drawing-projection-walk.ts';
import { schemaAttributeValue } from './ooxml-drawing-rules.ts';
import { DRAWINGML_MAIN_NAMESPACE_URI, type OoxmlElement } from './ooxml-tree.ts';

const MAX_VECTOR_SHAPE_SUBPATHS = 64;
const CUBIC_BEZIER_SEGMENTS = 8;
const readCoordinate = (value: string | undefined): number | null => parseEmu(value, false);

/**
 * Polygon subpaths of one `a:path`: move, line, cubic and close verbs only; anything else
 * refuses. ECMA-376 Part 1, 20.1.9 (`CT_Path2D`): only `a:moveTo` sets the current point, so a
 * line or curve before the first `a:moveTo` draws nothing, and `a:close` returns the current
 * point to the start of its subpath, where the next line or curve begins.
 */
export function readShapePathPolygons(
  path: OoxmlElement,
  scaleX: number,
  scaleY: number,
  sink: { x: number; y: number }[][],
  pointBudget: { remaining: number },
  closed: boolean[]
): boolean {
  let current: { x: number; y: number }[] | null = null;
  /** Start of the latest subpath; null until the first `a:moveTo`. */
  let start: { x: number; y: number } | null = null;
  const open = (point: { x: number; y: number }): { x: number; y: number }[] | null => {
    if (sink.length >= MAX_VECTOR_SHAPE_SUBPATHS || pointBudget.remaining <= 0) return null;
    pointBudget.remaining -= 1;
    const subpath = [point];
    sink.push(subpath);
    closed.push(false);
    return subpath;
  };
  for (const verb of path.children) {
    if (!isElement(verb)) continue;
    if (verb.namespaceUri !== DRAWINGML_MAIN_NAMESPACE_URI) return false;
    if (verb.localName === 'close') {
      if (current !== null) closed[sink.length - 1] = true;
      current = null;
      continue;
    }
    if (verb.localName === 'cubicBezTo') {
      const controls = verb.children.filter(isElement);
      if (
        controls.length !== 3 ||
        controls.some(
          (point) => point.namespaceUri !== DRAWINGML_MAIN_NAMESPACE_URI || point.localName !== 'pt'
        )
      ) {
        return false;
      }
      const parsed = controls.map((point) => {
        const x = readCoordinate(schemaAttributeValue(point.attributes, 'x'));
        const y = readCoordinate(schemaAttributeValue(point.attributes, 'y'));
        return x === null || y === null ? null : { x: x * scaleX, y: y * scaleY };
      });
      if (parsed.some((point) => point === null)) return false;
      if (start === null) continue;
      current ??= open({ ...start });
      if (current === null || pointBudget.remaining < CUBIC_BEZIER_SEGMENTS) return false;
      const points = current;
      const from = points[points.length - 1]!;
      const control1 = parsed[0]!;
      const control2 = parsed[1]!;
      const end = parsed[2]!;
      for (let index = 1; index <= CUBIC_BEZIER_SEGMENTS; index += 1) {
        const t = index / CUBIC_BEZIER_SEGMENTS;
        const inverse = 1 - t;
        points.push({
          x:
            inverse ** 3 * from.x +
            3 * inverse ** 2 * t * control1.x +
            3 * inverse * t ** 2 * control2.x +
            t ** 3 * end.x,
          y:
            inverse ** 3 * from.y +
            3 * inverse ** 2 * t * control1.y +
            3 * inverse * t ** 2 * control2.y +
            t ** 3 * end.y,
        });
      }
      pointBudget.remaining -= CUBIC_BEZIER_SEGMENTS;
      continue;
    }
    if (verb.localName !== 'moveTo' && verb.localName !== 'lnTo') return false;
    const pt = findDirectChild(verb.children, {
      namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
      localName: 'pt',
    });
    if (!pt) return false;
    const x = readCoordinate(schemaAttributeValue(pt.attributes, 'x'));
    const y = readCoordinate(schemaAttributeValue(pt.attributes, 'y'));
    if (x === null || y === null) return false;
    const scaled = { x: x * scaleX, y: y * scaleY };
    if (!Number.isFinite(scaled.x) || !Number.isFinite(scaled.y)) return false;
    if (verb.localName === 'moveTo') {
      start = scaled;
      current = open(scaled);
      if (current === null) return false;
      continue;
    }
    if (start === null) continue;
    current ??= open({ ...start });
    if (current === null || pointBudget.remaining <= 0) return false;
    pointBudget.remaining -= 1;
    current.push(scaled);
  }
  return true;
}
