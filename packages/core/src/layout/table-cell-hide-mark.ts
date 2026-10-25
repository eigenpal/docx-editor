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
/** An on/off cell property: `undefined` when absent, else on unless its value turns it off. */
function optionalFlag(properties: OoxmlElement | undefined, name: string): boolean | undefined {
  if (properties?.namespaceUri !== WML_NAMESPACE_URI) return undefined;
  const flag = childNamed(properties, name);
  if (!flag) return undefined;
  const value = flag.attributes.find(
    (attribute) => attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === 'val'
  )?.value;
  return value === undefined || !['0', 'false', 'off'].includes(value);
}

/**
 * An on/off cell property through whole-table cell styles, conditional styles, and direct cell
 * properties, in precedence order.
 */
function cellFlag(
  style: CascadedTableFormatting,
  conditions: readonly string[],
  direct: OoxmlElement | undefined,
  name: 'hideMark' | 'noWrap'
): boolean {
  let on = false;
  for (const properties of style.tableCellPropertyNodes ?? []) {
    on = optionalFlag(properties, name) ?? on;
  }
  for (const condition of conditions) {
    const layers = style.conditionalStyleLayers?.get(condition);
    if (layers) {
      for (const layer of layers) on = optionalFlag(childNamed(layer, 'tcPr'), name) ?? on;
    } else {
      on = optionalFlag(childNamed(style.conditional.get(condition), 'tcPr'), name) ?? on;
    }
  }
  return optionalFlag(direct, name) ?? on;
}

/** `w:hideMark`: the cell's end mark takes no room in its row's height. */
export function cellIgnoresEndMark(
  style: CascadedTableFormatting,
  conditions: readonly string[],
  direct: OoxmlElement | undefined
): boolean {
  return cellFlag(style, conditions, direct, 'hideMark');
}

/** `w:noWrap`: autofit never narrows the cell's column below its preferred width. */
export function cellNoWrap(
  style: CascadedTableFormatting,
  conditions: readonly string[],
  direct: OoxmlElement | undefined
): boolean {
  return cellFlag(style, conditions, direct, 'noWrap');
}
