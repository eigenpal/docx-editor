// The break-cache key inputs of one cell paragraph, apart from the exclusion token.
//
// One builder for cell placement and for row geometry reuse: reuse is sound only while every
// part here matches the placement that measured the line. Width is the one input left out.

import type { OoxmlElement, OoxmlProperty } from '@docx-editor.dev/core/store';
import { withDrawingContext, type ParagraphKeyInputs } from './layout-cache.ts';
import type { TableFlowDeps } from './semantic-table-layout.ts';

/** Every key input of a cell paragraph except its properties, width and offset. */
export interface CellBreakKeyParts {
  readonly producer: string;
  readonly drawing: string;
  readonly drawingContext: boolean;
  readonly projection: string;
  readonly inTableCell: boolean;
  readonly cellEndMark: boolean;
  readonly rowsClearOutOfCellFloats: boolean;
}

export function cellBreakKeyParts(
  paragraph: OoxmlElement,
  deps: TableFlowDeps,
  inTableCell: boolean,
  cellEndMark: boolean,
  rowsClearOutOfCellFloats: boolean
): CellBreakKeyParts {
  return {
    producer: deps.producer,
    // `||`, not `??`: a per-paragraph callback answering `''` falls through to the
    // document-wide token, as it always has.
    drawing: deps.drawingTokenForParagraph?.(paragraph) || deps.drawingLayoutToken || '',
    drawingContext: deps.inlineDrawingLayout !== undefined,
    projection: deps.projectionTokenForParagraph?.(paragraph) ?? '',
    inTableCell,
    cellEndMark,
    rowsClearOutOfCellFloats,
  };
}

/** True when every part matches; new parts are compared without a change here. */
export function sameCellBreakKeyParts(a: CellBreakKeyParts, b: CellBreakKeyParts): boolean {
  for (const key of Object.keys(a) as (keyof CellBreakKeyParts)[])
    if (a[key] !== b[key]) return false;
  return true;
}

export function cellBreakKeyInputs(
  paragraph: OoxmlElement,
  properties: readonly OoxmlProperty[],
  width: number,
  parts: CellBreakKeyParts,
  offset: number
): ParagraphKeyInputs {
  return {
    paragraph,
    properties,
    width,
    producer: parts.producer,
    // The inline-drawing CONTEXT joins the token exactly as it does in the body flow: the
    // context changes how a paragraph breaks (drawings become measured atoms), so a
    // token-less pass with the context may not share cell entries with one without it.
    drawingToken: withDrawingContext(parts.drawing, parts.drawingContext),
    projectionToken: `${parts.projection}|inTableCell:${parts.inTableCell}|cellEndMark:${parts.cellEndMark}|from:${offset}|rowsClear:${parts.rowsClearOutOfCellFloats}`,
  };
}
