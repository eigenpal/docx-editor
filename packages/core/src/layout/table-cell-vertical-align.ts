// Vertical alignment metadata for table-cell layout.

import type { OoxmlElement } from '@docx-editor.dev/core/store';

/** `w:vAlign` — where a cell's content sits when the row is taller than the content. */
export type CellVerticalAlign = 'top' | 'center' | 'bottom';

/**
 * The `w:vAlign` (CT_VerticalJc, 17.4.83) a `w:tcPr` states, or undefined when it has none.
 * A stated value other than `center` or `bottom` reads as `top`, so a stated `top` is an
 * override and not an absence.
 */
export function readStatedCellVerticalAlign(
  cellProperties: OoxmlElement | undefined
): CellVerticalAlign | undefined {
  let node: OoxmlElement | undefined;
  for (const child of cellProperties?.children ?? []) {
    if (child.kind !== 'textValue' && child.localName === 'vAlign') {
      node = child;
      break;
    }
  }
  if (!node) return undefined;
  const value = node.attributes.find((attribute) => attribute.localName === 'val')?.value;
  if (value === 'center') return 'center';
  if (value === 'bottom') return 'bottom';
  return 'top';
}
