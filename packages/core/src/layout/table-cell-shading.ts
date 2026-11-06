// The fill a table cell paints: its own `w:tcPr/w:shd` over its table style's.
//
// The style contributes in layers, base first: the whole-table `w:tcPr` of each style in the
// `basedOn` chain, then each conditional format that applies to the cell. The cell's own
// `w:tcPr` comes last. A layer counts when it states `w:shd` with any value but `nil`, so a
// stated `auto` fill clears the layers below it, while `nil` leaves them showing. Reference
// renderings agree on each of these: a derived style's fill over its base's, a first-row fill
// over the whole table's, the whole table's even where `w:tblLook` turns a condition off, and
// a direct `auto` fill painting no colour over a shaded style.

import { WML_NAMESPACE_URI, type OoxmlElement } from '@docx-editor.dev/core/store';
import { statedShadingFill } from './ooxml-shading.ts';
import type { CascadedTableFormatting } from './style-cascade.ts';

function childNamed(node: OoxmlElement, localName: string): OoxmlElement | undefined {
  for (const child of node.children) {
    if (
      child.kind !== 'textValue' &&
      child.namespaceUri === WML_NAMESPACE_URI &&
      child.localName === localName
    )
      return child as OoxmlElement;
  }
  return undefined;
}

/** The validated fill a cell paints under `tableStyle`, or undefined for none. */
export function cellShading(
  tableStyle: Pick<CascadedTableFormatting, 'tableCellPropertyNodes' | 'conditional'>,
  conditions: readonly string[],
  cellProperties: OoxmlElement | undefined
): string | undefined {
  const layers: (OoxmlElement | undefined)[] = [...(tableStyle.tableCellPropertyNodes ?? [])];
  for (const condition of conditions) {
    const format = tableStyle.conditional.get(condition);
    if (format) layers.push(childNamed(format, 'tcPr'));
  }
  layers.push(cellProperties);
  let fill: string | null | undefined;
  for (const layer of layers) {
    const stated = statedShadingFill(layer && childNamed(layer, 'shd'));
    if (stated !== undefined) fill = stated;
  }
  return fill ?? undefined;
}
