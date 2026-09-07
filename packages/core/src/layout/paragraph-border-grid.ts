import {
  PARAGRAPH_BORDER_SIDE_GUTTER_PT,
  paragraphBorderExtentPt,
  paragraphBorderHorizontalBox,
  paragraphBorderSideOuterExtentPt,
  paragraphBorderStrokeWidthPt,
  type ParagraphBorderEdge,
  type ParagraphBorders,
} from './paragraph-style.ts';
import {
  quantizePageGeometryComponent,
  type PageGeometryGridPolicy,
} from './page-geometry-policy.ts';

export function gridRoundedBorderComponent(
  value: number,
  policy: PageGeometryGridPolicy | undefined
): number {
  return quantizePageGeometryComponent(value, policy);
}

export function gridRoundedBorderStroke(
  edge: ParagraphBorderEdge,
  policy: PageGeometryGridPolicy | undefined
): number {
  return gridRoundedBorderComponent(paragraphBorderStrokeWidthPt(edge), policy);
}

export function gridRoundedBorderExtent(
  edge: ParagraphBorderEdge | undefined,
  policy: PageGeometryGridPolicy | undefined
): number {
  if (!edge || !policy) return paragraphBorderExtentPt(edge);
  return gridRoundedBorderComponent(edge.spacePt, policy) + gridRoundedBorderStroke(edge, policy);
}

export function gridRoundedSideOuterExtent(
  edge: ParagraphBorderEdge,
  policy: PageGeometryGridPolicy | undefined
): number {
  if (!policy) return paragraphBorderSideOuterExtentPt(edge);
  return (
    gridRoundedBorderComponent(edge.spacePt, policy) +
    gridRoundedBorderComponent(PARAGRAPH_BORDER_SIDE_GUTTER_PT, policy) +
    gridRoundedBorderStroke(edge, policy) / 2
  );
}

export function gridRoundedHorizontalBorderBox(
  textLeft: number,
  textRight: number,
  borders: ParagraphBorders,
  edge: ParagraphBorderEdge,
  policy: PageGeometryGridPolicy | undefined
): { readonly x: number; readonly width: number } {
  if (!policy) return paragraphBorderHorizontalBox(textLeft, textRight, borders, edge);
  const leftExtent = borders.left
    ? gridRoundedSideOuterExtent(borders.left, policy)
    : gridRoundedBorderExtent(edge, policy);
  const rightExtent = borders.right
    ? gridRoundedSideOuterExtent(borders.right, policy)
    : gridRoundedBorderExtent(edge, policy);
  const x = textLeft - leftExtent;
  return { x, width: Math.max(textRight + rightExtent - x, 0) };
}
