import { WML_NAMESPACE_URI, type OoxmlElement } from '@docx-editor.dev/core/store';
import type { CascadedTableFormatting } from './style-cascade.ts';
import type { PendingLine } from './paragraph-flow.ts';
import type { ResolvedListItem } from './list-resolve.ts';
import type { TextMeasurer } from './semantic-records.ts';
import { applyLineSpacing, type ParagraphLineSpacing } from './paragraph-style.ts';

function childNamed(node: OoxmlElement | undefined, name: string): OoxmlElement | undefined {
  if (!node) return undefined;
  for (const child of node.children) {
    if (
      child.kind !== 'textValue' &&
      child.namespaceUri === WML_NAMESPACE_URI &&
      child.localName === name
    )
      return child;
  }
  return undefined;
}
function optionalHideMark(properties: OoxmlElement | undefined): boolean | undefined {
  if (properties?.namespaceUri !== WML_NAMESPACE_URI) return undefined;
  const flag = childNamed(properties, 'hideMark');
  if (!flag) return undefined;
  const value = flag.attributes.find(
    (attribute) => attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === 'val'
  )?.value;
  return value === undefined || !['0', 'false', 'off'].includes(value);
}

/** Whole-table cell styles, conditional styles, and direct cell properties, in precedence order. */
export function cellIgnoresEndMark(
  style: CascadedTableFormatting,
  conditions: readonly string[],
  direct: OoxmlElement | undefined
): boolean {
  let hidden = false;
  for (const properties of style.tableCellPropertyNodes ?? []) {
    hidden = optionalHideMark(properties) ?? hidden;
  }
  for (const condition of conditions) {
    const layers = style.conditionalStyleLayers?.get(condition);
    if (layers) {
      for (const layer of layers) hidden = optionalHideMark(childNamed(layer, 'tcPr')) ?? hidden;
    } else {
      hidden = optionalHideMark(childNamed(style.conditional.get(condition), 'tcPr')) ?? hidden;
    }
  }
  return optionalHideMark(direct) ?? hidden;
}

/** Keep the source position, but remove an excluded empty cell glyph's line-height contribution. */
export function withoutHiddenCellMark(
  lines: readonly PendingLine[],
  hideMark: boolean,
  measurer: TextMeasurer,
  spacing: ParagraphLineSpacing,
  listItem?: ResolvedListItem
): readonly PendingLine[] {
  const last = lines.at(-1);
  if (!hideMark || !last || last.spans.length > 0 || last.drawings.length > 0) return lines;
  // A list marker is printable and belongs to the first line, even when the paragraph is empty.
  const marker =
    lines.length === 1 && listItem?.markerText && !listItem.markerStyle.hidden
      ? measurer.lineMetrics(listItem.markerStyle)
      : { height: 0, baseline: 0 };
  const spaced =
    marker.height > 0 ? applyLineSpacing(spacing, marker.height, marker.baseline) : marker;
  // Copy only for placement: the break cache also serves ordinary paragraphs and visible marks.
  return [
    ...lines.slice(0, -1),
    {
      ...last,
      height: spaced.height,
      baseline: spaced.baseline,
      leading: Math.max(0, spaced.baseline - marker.baseline),
      trailingSpacing: spacing.rule === 'exact' ? 0 : Math.max(0, spaced.height - marker.height),
    },
  ];
}
