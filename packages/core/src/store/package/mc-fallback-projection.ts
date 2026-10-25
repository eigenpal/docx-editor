// The `mc:Fallback` of a run-level `mc:AlternateContent` whose chosen branch cannot paint.
//
// The chosen branch can hold content outside the supported subset, such as a group nested
// inside a group. Its `mc:Fallback` often holds the same graphic as VML, which the engine can
// draw. That fallback then stands for the wrapper, with its own geometry. Without a fallback
// that paints, the caller keeps its earlier answer for the chosen branch.
//
// A chart (classic `c:chart` or chartex `cx:chart`) follows one rule: its chosen branch when
// that paints (a chart renderer is installed and supports the chart), otherwise its fallback
// when that paints (a DrawingML picture or drawable VML), otherwise its labelled `chart`
// placeholder. A chart never paints nothing, and a hidden chart stays hidden whatever its
// fallback shows. The fallback that stands in carries the chart's summary. The renderer
// registry is process-wide and read when the drawing is projected, so install renderers
// before opening a document.

import { CHART_GRAPHIC_DATA_URI } from './chart-parts.ts';
import { CHARTEX_GRAPHIC_DATA_URI } from './chartex-parts.ts';
import { findGraphicData } from './drawing-group-frame.ts';
import type { DrawingProjection } from './drawing-projection.ts';
import { isElement, isMcFallback, namespaceScopeForNode } from './drawing-projection-walk.ts';
import { projectLegacyVml } from './legacy-vml-projection.ts';
import { WML_NAMESPACE_URI, WP_NAMESPACE_URI } from './ooxml-shared.ts';
import type { OoxmlDrawingNode, OoxmlElement, OoxmlGenericElementNode } from './ooxml-tree.ts';

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

function isDrawingAnchor(node: OoxmlElement): boolean {
  return (
    node.kind === 'inlineDrawing' ||
    node.kind === 'anchoredDrawing' ||
    (node.namespaceUri === WP_NAMESPACE_URI &&
      (node.localName === 'inline' || node.localName === 'anchor'))
  );
}

/** Whether a `w:drawing` holds a chart graphic, classic or chartex. */
export function holdsChartGraphic(drawing: OoxmlElement): boolean {
  let anchor: OoxmlElement | null = null;
  for (const child of drawing.children) {
    if (child.kind !== 'textValue' && isDrawingAnchor(child)) {
      anchor = child;
      break;
    }
  }
  const data = anchor ? findGraphicData(anchor) : null;
  const uri = data?.attributes.find((attribute) => attribute.localName === 'uri')?.value;
  return uri === CHART_GRAPHIC_DATA_URI || uri === CHARTEX_GRAPHIC_DATA_URI;
}

/** Projects one fallback `w:drawing` in its namespace scope. */
export type McFallbackDrawingProjector = (
  drawing: OoxmlDrawingNode,
  namespaceScope: ReadonlyMap<string, string>
) => DrawingProjection | null;

/**
 * The fallback that stands for a chart whose chosen branch does not paint: a DrawingML
 * picture (or a shape or group the engine draws) in a fallback `w:drawing`, or drawable VML.
 * Null when the fallback paints nothing, so the chart keeps its placeholder.
 */
export function paintableMcChartFallback(
  wrapper: OoxmlGenericElementNode,
  namespaceScope: ReadonlyMap<string, string>,
  ownerPartName: string,
  project: McFallbackDrawingProjector
): DrawingProjection | null {
  for (const child of wrapper.children) {
    if (!isElement(child) || !isMcFallback(child)) continue;
    let content: OoxmlElement | null = null;
    for (const node of child.children) {
      if (node.kind !== 'textValue') {
        content = node;
        break;
      }
    }
    if (!content) return null;
    const isDrawing =
      content.kind === 'drawing' ||
      (content.namespaceUri === WML_NAMESPACE_URI && content.localName === 'drawing');
    if (!isDrawing) return paintableMcFallback(wrapper, ownerPartName);
    if (holdsChartGraphic(content)) return null;
    const scope = namespaceScopeForNode(namespaceScopeForNode(namespaceScope, child), content);
    const projection = project(content as unknown as OoxmlDrawingNode, scope);
    if (!projection || projection.hidden) return null;
    return projection.picture || projection.vectorShape || projection.groupPicture
      ? projection
      : null;
  }
  return null;
}
