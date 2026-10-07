import { WML_NAMESPACE_URI, type OoxmlElement } from '@docx-editor.dev/core/store';
import type { CascadedTableFormatting } from './style-cascade.ts';

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
