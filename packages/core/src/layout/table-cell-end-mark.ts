import type { SemanticTableCell } from './semantic-table.ts';
import type { TableFlowDeps } from './semantic-table-layout.ts';
import { resolveParagraphLayoutInputs } from './style-cascade.ts';
import { DEFAULT_RUN_STYLE, resolveRunStyle } from './run-style.ts';
import { applyLineSpacing } from './paragraph-style.ts';

/** An end-of-cell glyph constrains the cell height, not the last printable line. */
export function cellEndMarkHeight(
  cell: SemanticTableCell,
  width: number,
  deps: TableFlowDeps
): number {
  if (cell.hideEndMark) return 0;
  const paragraph = cell.blocks.at(-1);
  if (paragraph?.kind !== 'paragraph') return 0;
  const inputs = resolveParagraphLayoutInputs(
    paragraph,
    width,
    deps.styleCascade,
    deps.listItems?.get(paragraph.id),
    cell.styleFormatting,
    true
  );
  const style =
    inputs.markRunProperties.length === 0
      ? DEFAULT_RUN_STYLE
      : resolveRunStyle(inputs.markRunProperties, deps.styleCascade?.themeFonts);
  if (style.hidden || deps.measurer.hasResolvedFont?.(style) === false) return 0;
  const metrics = deps.measurer.lineMetrics(style);
  return applyLineSpacing(inputs.lineSpacing, metrics.height, metrics.baseline).height;
}
