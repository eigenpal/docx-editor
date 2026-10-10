import { schemaAttributeValue } from './ooxml-drawing-rules.ts';
import { DRAWINGML_MAIN_NAMESPACE_URI, type OoxmlElement } from './ooxml-tree.ts';

type Point = Readonly<{ x: number; y: number }>;
type End = { width: number; length: number };

/** Bounded solid triangular line ends. Unknown visible decorations refuse the shape. */
export function projectLineArrowheads(
  paths: readonly (readonly Point[])[],
  closed: readonly boolean[],
  line: OoxmlElement | null,
  strokeWidth: number
): readonly (readonly Point[])[] | null {
  const ends: { head?: End; tail?: End } = {};
  const size = (value: string | undefined) =>
    value === 'sm' ? 2 : value === 'lg' ? 5 : value === 'med' || value === undefined ? 3 : null;
  for (const child of line?.children ?? []) {
    if (
      child.kind !== 'generic' ||
      child.namespaceUri !== DRAWINGML_MAIN_NAMESPACE_URI ||
      (child.localName !== 'headEnd' && child.localName !== 'tailEnd')
    )
      continue;
    const type = schemaAttributeValue(child.attributes, 'type') ?? 'none';
    if (type === 'none') continue;
    if (type !== 'triangle') return null;
    const width = size(schemaAttributeValue(child.attributes, 'w'));
    const length = size(schemaAttributeValue(child.attributes, 'len'));
    if (width === null || length === null) return null;
    ends[child.localName === 'headEnd' ? 'head' : 'tail'] = { width, length };
  }
  const arrows: Point[][] = [];
  if (!(strokeWidth > 0)) return arrows;
  for (const [index, points] of paths.entries()) {
    if (closed[index] || points.length < 2) continue;
    for (const side of ['head', 'tail'] as const) {
      const end = ends[side];
      if (!end) continue;
      const ordered = side === 'head' ? points : [...points].reverse();
      const tip = ordered[0]!;
      const next = ordered.find((point) => point.x !== tip.x || point.y !== tip.y);
      if (!next) continue;
      const distance = Math.hypot(tip.x - next.x, tip.y - next.y);
      const ux = (tip.x - next.x) / distance;
      const uy = (tip.y - next.y) / distance;
      const length = end.length * strokeWidth;
      const half = (end.width * strokeWidth) / 2;
      const arrow = [
        tip,
        { x: tip.x - ux * length - uy * half, y: tip.y - uy * length + ux * half },
        { x: tip.x - ux * length + uy * half, y: tip.y - uy * length - ux * half },
      ];
      if (!arrow.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)))
        return null;
      arrows.push(arrow);
    }
  }
  return arrows;
}
