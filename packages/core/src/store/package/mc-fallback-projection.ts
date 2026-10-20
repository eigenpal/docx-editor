// The `mc:Fallback` of a run-level `mc:AlternateContent` whose chosen branch cannot paint.
//
// The chosen branch can hold content outside the supported subset, such as a group nested
// inside a group. Its `mc:Fallback` often holds the same graphic as VML, which the engine can
// draw. That fallback then stands for the wrapper, with its own geometry. Without a fallback
// that paints, the caller keeps its earlier answer for the chosen branch.

import type { DrawingProjection } from './drawing-projection.ts';
import { isElement, isMcFallback } from './drawing-projection-walk.ts';
import { projectLegacyVml } from './legacy-vml-projection.ts';
import type { OoxmlGenericElementNode } from './ooxml-tree.ts';

/**
 * The read-only projection of a VML `mc:Fallback` that paints, or null. A fallback text box
 * is left out: the wrapper's text box story is always read from its chosen branch.
 */
export function paintableMcFallback(
  wrapper: OoxmlGenericElementNode,
  ownerPartName: string
): DrawingProjection | null {
  for (const child of wrapper.children) {
    if (!isElement(child) || !isMcFallback(child)) continue;
    const content = child.children.find(isElement);
    const projection = content ? projectLegacyVml(content, ownerPartName) : null;
    if (!projection || projection.hidden || projection.textboxStory) return null;
    return projection.picture || projection.vectorShape || projection.legacyGraphic
      ? projection
      : null;
  }
  return null;
}
