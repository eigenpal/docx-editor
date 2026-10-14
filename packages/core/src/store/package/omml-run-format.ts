// Read only the run properties whose typography the equation lane represents.
// Unknown properties retain the bounded fallback rather than being discarded.
import { WML_NAMESPACE_URI, XML_NAMESPACE_URI } from './ooxml-shared.ts';
import type { OoxmlElement, OoxmlGenericElementNode, OoxmlNode } from './ooxml-tree.ts';

const MATH = 'http://schemas.openxmlformats.org/officeDocument/2006/math';

export interface EquationRunFormat {
  readonly fontFamily?: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly literal?: boolean;
  readonly normalText?: boolean;
  readonly mathStyle?: 'p' | 'b' | 'i' | 'bi';
}

function element(node: OoxmlNode, namespace: string, localName: string): boolean {
  return (
    node.kind !== 'textValue' && node.namespaceUri === namespace && node.localName === localName
  );
}

function toggle(node: OoxmlElement, namespace: string): boolean | null {
  if (node.children.length !== 0 || node.attributes.length > 1) return null;
  const attribute = node.attributes[0];
  if (!attribute) return true;
  if (attribute.namespaceUri !== namespace || attribute.localName !== 'val') return null;
  if (['1', 'true', 'on'].includes(attribute.value)) return true;
  if (['0', 'false', 'off'].includes(attribute.value)) return false;
  return null;
}

/** Null means unsupported source. An empty format preserves existing math defaults. */
export function equationRunFormat(run: OoxmlElement): EquationRunFormat | null {
  if (run.attributes.length !== 0) return null;
  const format: {
    fontFamily?: string;
    bold?: boolean;
    italic?: boolean;
    literal?: boolean;
    normalText?: boolean;
    mathStyle?: 'p' | 'b' | 'i' | 'bi';
  } = {};
  const seen = new Set<string>();
  for (const child of run.children) {
    if (child.kind === 'textValue') return null;
    if (element(child, MATH, 't')) continue;
    const word = element(child, WML_NAMESPACE_URI, 'rPr');
    const math = element(child, MATH, 'rPr');
    if ((!word && !math) || child.attributes.length !== 0) return null;
    const namespace = word ? WML_NAMESPACE_URI : MATH;
    if (seen.has(namespace)) return null;
    seen.add(namespace);
    const properties = new Set<string>();
    for (const property of child.children) {
      if (
        property.kind === 'textValue' ||
        property.namespaceUri !== namespace ||
        properties.has(property.localName)
      )
        return null;
      properties.add(property.localName);
      if (word && property.localName === 'rFonts') {
        if (property.children.length !== 0) return null;
        const slots = new Set<string>();
        let family: string | undefined;
        for (const attr of property.attributes) {
          if (
            attr.namespaceUri !== namespace ||
            !['ascii', 'hAnsi', 'eastAsia', 'cs'].includes(attr.localName) ||
            slots.has(attr.localName)
          )
            return null;
          slots.add(attr.localName);
          if (
            attr.value.length === 0 ||
            attr.value.trim() !== attr.value ||
            (family !== undefined && family !== attr.value)
          )
            return null;
          family = attr.value;
        }
        if (family !== undefined) format.fontFamily = family;
      } else if (math && property.localName === 'sty') {
        if (property.children.length !== 0 || property.attributes.length > 1) return null;
        const attribute = property.attributes[0];
        if (attribute && (attribute.namespaceUri !== namespace || attribute.localName !== 'val'))
          return null;
        const value = attribute?.value ?? 'i';
        if (value !== 'p' && value !== 'b' && value !== 'i' && value !== 'bi') return null;
        format.mathStyle = value;
      } else {
        const key = word
          ? property.localName === 'b'
            ? 'bold'
            : property.localName === 'i'
              ? 'italic'
              : undefined
          : property.localName === 'lit'
            ? 'literal'
            : property.localName === 'nor'
              ? 'normalText'
              : undefined;
        if (key === undefined) return null;
        const value = toggle(property, namespace);
        if (value === null) return null;
        format[key] = value;
      }
    }
  }
  return Object.freeze(format);
}

function isMathElement(node: OoxmlNode, localName?: string): node is OoxmlGenericElementNode {
  return (
    node.kind === 'generic' &&
    node.namespaceUri === MATH &&
    (localName === undefined || node.localName === localName)
  );
}

export function equationMathChild(
  node: OoxmlGenericElementNode,
  localName: string
): OoxmlGenericElementNode | null {
  for (const child of node.children) {
    if (isMathElement(child, localName)) return child;
  }
  return null;
}

export function equationMathChildren(
  node: OoxmlGenericElementNode,
  localName: string
): readonly OoxmlGenericElementNode[] {
  return node.children.filter((child): child is OoxmlGenericElementNode =>
    isMathElement(child, localName)
  );
}

export function equationTextIsSupported(node: OoxmlGenericElementNode): boolean {
  return (
    node.attributes.every(
      (attribute) =>
        attribute.namespaceUri === XML_NAMESPACE_URI &&
        attribute.localName === 'space' &&
        (attribute.value === 'preserve' || attribute.value === 'default')
    ) && node.children.every((child) => child.kind === 'textValue')
  );
}

export function equationRunIsSupported(node: OoxmlGenericElementNode): boolean {
  if (node.attributes.length > 0) return false;
  const texts = equationMathChildren(node, 't');
  if (texts.length === 0 || equationRunFormat(node) === null) return false;
  return texts.every(equationTextIsSupported);
}
