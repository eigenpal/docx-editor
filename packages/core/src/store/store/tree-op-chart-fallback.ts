// A chart in `mc:AlternateContent` whose page shows the picture saved in its `mc:Fallback`.
//
// The fallback stands in for the chart only on the page. An edit to it alone would leave the
// chart branch as it was, so a reader that draws the chart would never show the edit, and the
// two branches would disagree. Picture edits on it refuse; a delete removes the whole wrapper,
// chart and fallback together.

import { drawingAtomProjection } from '../package/drawing-atom-projection.ts';
import {
  isElement,
  isMcAlternateContent,
  isMcChoice,
  isMcFallback,
} from '../package/drawing-projection-walk.ts';
import { holdsChartGraphic } from '../package/mc-fallback-projection.ts';
import { findNode, parentNodeOf } from '../package/ooxml-edit.ts';
import { WML_NAMESPACE_URI } from '../package/ooxml-shared.ts';
import type { OoxmlElement, OoxmlPart } from '../package/ooxml-tree.ts';

function choiceHoldsChart(wrapper: OoxmlElement): boolean {
  for (const choice of wrapper.children) {
    if (!isElement(choice) || !isMcChoice(choice)) continue;
    for (const content of choice.children) {
      if (!isElement(content)) continue;
      const drawing =
        content.kind === 'drawing' ||
        (content.namespaceUri === WML_NAMESPACE_URI && content.localName === 'drawing');
      if (drawing && holdsChartGraphic(content)) return true;
    }
  }
  return false;
}

/**
 * The `mc:AlternateContent` around a chart whose fallback `nodeId` names, or null.
 *
 * `nodeId` is the wrapper itself, when layout shows its fallback, or the fallback's own
 * drawing or VML. A wrapper whose chart branch is the one shown answers null.
 */
export function chartWrapperOfFallback(part: OoxmlPart, nodeId: string): OoxmlElement | null {
  const node = findNode(part, nodeId);
  if (!node || node.kind === 'textValue') return null;
  let contentId = nodeId;
  if (isMcAlternateContent(node)) {
    const shown = drawingAtomProjection(part, nodeId)?.drawingNodeId;
    if (!shown || shown === nodeId) return null;
    contentId = shown;
  }
  const fallback = parentNodeOf(part, contentId);
  if (!fallback || !isMcFallback(fallback)) return null;
  const wrapper = parentNodeOf(part, fallback.id);
  if (!wrapper || !isMcAlternateContent(wrapper)) return null;
  return choiceHoldsChart(wrapper) ? wrapper : null;
}
