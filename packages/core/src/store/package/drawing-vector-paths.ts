import { parseEmu, findDirectChild } from './drawing-shape-readers.ts';
import { isElement } from './drawing-projection-walk.ts';
import { schemaAttributeValue } from './ooxml-drawing-rules.ts';
import { DRAWINGML_MAIN_NAMESPACE_URI, type OoxmlElement } from './ooxml-tree.ts';

const MAX_VECTOR_SHAPE_SUBPATHS = 64;
const CUBIC_BEZIER_SEGMENTS = 8;
const readCoordinate = (value: string | undefined): number | null => parseEmu(value, false);

/** Polygon subpaths of one `a:path` — move/line/close verbs only; anything else refuses. */
export function readShapePathPolygons(
  path: OoxmlElement,
  scaleX: number,
  scaleY: number,
  sink: { x: number; y: number }[][],
  pointBudget: { remaining: number },
  closed: boolean[]
): boolean {
  let current: { x: number; y: number }[] | null = null;
  for (const verb of path.children) {
    if (!isElement(verb)) continue;
    if (verb.namespaceUri !== DRAWINGML_MAIN_NAMESPACE_URI) return false;
    if (verb.localName === 'close') {
      if (current !== null) closed[sink.length - 1] = true;
      current = null;
      continue;
    }
    if (verb.localName === 'cubicBezTo') {
      if (current === null || pointBudget.remaining < CUBIC_BEZIER_SEGMENTS) return false;
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
      const start = current[current.length - 1]!;
      const control1 = parsed[0]!;
      const control2 = parsed[1]!;
      const end = parsed[2]!;
      for (let index = 1; index <= CUBIC_BEZIER_SEGMENTS; index += 1) {
        const t = index / CUBIC_BEZIER_SEGMENTS;
        const inverse = 1 - t;
        current.push({
          x:
            inverse ** 3 * start.x +
            3 * inverse ** 2 * t * control1.x +
            3 * inverse * t ** 2 * control2.x +
            t ** 3 * end.x,
          y:
            inverse ** 3 * start.y +
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
    if (pointBudget.remaining <= 0) return false;
    pointBudget.remaining -= 1;
    if (verb.localName === 'moveTo' || current === null) {
      if (sink.length >= MAX_VECTOR_SHAPE_SUBPATHS) return false;
      current = [scaled];
      sink.push(current);
      closed.push(false);
    } else {
      current.push(scaled);
    }
  }
  return true;
}
