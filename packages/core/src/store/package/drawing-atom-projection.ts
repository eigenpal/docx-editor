import {
  indexInlineDrawingProjectionsInPart,
  type DrawingProjection,
} from './drawing-projection.ts';
import type { OoxmlPart } from './ooxml-tree.ts';
import { createRecentRootCache } from '../store/recent-root-cache.ts';

const indexes = createRecentRootCache<ReadonlyMap<string, DrawingProjection>>(16);

/** Resolve the selected compatibility branch of a run-level drawing atom. */
export function drawingAtomProjection(part: OoxmlPart, atomId: string): DrawingProjection | null {
  let index = indexes.get(part.root);
  if (!index) {
    index = indexInlineDrawingProjectionsInPart(part);
    indexes.set(part.root, index);
  }
  return index.get(atomId) ?? null;
}
