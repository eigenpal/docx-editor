// Default control properties (`m:ctrlPr`) of Office Math structures.
//
// Most documents write the same `m:ctrlPr` on every structure, holding only the default math
// run formatting. Compact replacement can reproduce that source by writing the same control
// properties on each structure it emits. Any other control content stays read-only.

import { WML_NAMESPACE_URI } from './ooxml-shared.ts';
import type { OoxmlElement, OoxmlGenericElementNode, OoxmlNode } from './ooxml-tree.ts';

const MATH = 'http://schemas.openxmlformats.org/officeDocument/2006/math';

/** The math face the equation lane draws with. Control fonts must name it to be default. */
export const EQUATION_DEFAULT_MATH_FONT = 'Cambria Math';

const FONT_SLOTS: ReadonlySet<string> = new Set(['ascii', 'hAnsi', 'eastAsia', 'cs']);
const LANGUAGE_SLOTS: ReadonlySet<string> = new Set(['val', 'eastAsia', 'bidi']);
const ON_VALUES: ReadonlySet<string> = new Set(['1', 'true', 'on']);
// A bounded language tag: no nested quantifiers, so no backtracking on file-derived text.
const LANGUAGE_TAG = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,4}$/;
const HALF_POINTS = /^[1-9][0-9]{0,3}$/;

function wordElement(node: OoxmlNode, localName?: string): node is OoxmlElement {
  return (
    node.kind !== 'textValue' &&
    node.namespaceUri === WML_NAMESPACE_URI &&
    (localName === undefined || node.localName === localName)
  );
}

function wordAttributes(
  node: OoxmlElement,
  allowed: ReadonlySet<string>,
  accept: (value: string) => boolean
): boolean {
  const seen = new Set<string>();
  for (const attribute of node.attributes) {
    if (
      attribute.namespaceUri !== WML_NAMESPACE_URI ||
      !allowed.has(attribute.localName) ||
      seen.has(attribute.localName) ||
      !accept(attribute.value)
    )
      return false;
    seen.add(attribute.localName);
  }
  return true;
}

/**
 * One default `m:ctrlPr`, reduced to an order-insensitive signature of its properties and
 * values. Two controls with the same signature write the same formatting.
 */
type DefaultControl = { readonly signature: string } | false;

function propertySignature(property: OoxmlElement): string {
  const attributes = property.attributes
    .map((attribute) => `${attribute.localName}=${attribute.value}`)
    .sort();
  return `${property.localName}(${attributes.join(',')})`;
}

function readDefaultControl(node: OoxmlElement): DefaultControl {
  if (node.attributes.length !== 0 || node.children.length > 1) return false;
  const properties = node.children[0];
  if (!properties) return { signature: '' };
  if (!wordElement(properties, 'rPr') || properties.attributes.length !== 0) return false;
  const seen = new Set<string>();
  const sizes: string[] = [];
  const signature: string[] = [];
  for (const property of properties.children) {
    if (!wordElement(property) || property.children.length !== 0) return false;
    if (seen.has(property.localName)) return false;
    seen.add(property.localName);
    switch (property.localName) {
      case 'rFonts':
        if (!wordAttributes(property, FONT_SLOTS, (value) => value === EQUATION_DEFAULT_MATH_FONT))
          return false;
        break;
      case 'i':
      case 'iCs':
        if (!wordAttributes(property, new Set(['val']), (value) => ON_VALUES.has(value)))
          return false;
        break;
      case 'sz':
      case 'szCs': {
        const value = property.attributes[0]?.value;
        if (
          property.attributes.length !== 1 ||
          !wordAttributes(property, new Set(['val']), (size) => HALF_POINTS.test(size))
        )
          return false;
        sizes.push(value!);
        break;
      }
      case 'lang':
        if (!wordAttributes(property, LANGUAGE_SLOTS, (value) => LANGUAGE_TAG.test(value)))
          return false;
        break;
      default:
        return false;
    }
    signature.push(propertySignature(property));
  }
  if (sizes.some((size) => size !== sizes[0])) return false;
  return { signature: signature.sort().join(';') };
}

/**
 * True when one `m:ctrlPr` holds only default math formatting, so compact replacement can
 * write it back unchanged. The rule is narrow:
 *
 * - The element is empty, or holds exactly one `w:rPr` (no tracked `w:ins`/`w:del` wrapper).
 * - `w:rPr` holds each of these at most once, and nothing else:
 *   - `w:rFonts` whose `w:ascii`, `w:hAnsi`, `w:eastAsia`, and `w:cs` are absent or name
 *     the math face ({@link EQUATION_DEFAULT_MATH_FONT});
 *   - `w:i` and `w:iCs`, on;
 *   - `w:sz` and `w:szCs`, one positive half-point value shared by both;
 *   - `w:lang` with bounded language tags.
 *
 * The equation-level check, {@link equationDefaultControlProperties}, also requires every
 * `m:ctrlPr` of the equation to hold the same properties and values. Replacement writes one
 * copy on every structure, so differing controls (one sized and one not, or two languages)
 * would otherwise lose formatting.
 */
export function equationControlPropertiesAreDefault(node: OoxmlElement): boolean {
  return readDefaultControl(node) !== false;
}

/** How compact replacement treats the control properties of one equation. */
export type EquationControlDefaults =
  /** No structure carries `m:ctrlPr`. Replacement writes none. */
  | { readonly kind: 'none' }
  /** Every `m:ctrlPr` is default. Replacement writes `control` on each emitted structure. */
  | { readonly kind: 'default'; readonly control: OoxmlGenericElementNode }
  /** Some `m:ctrlPr` is not default, or the scan passed its work limit. */
  | { readonly kind: 'other' };

const NONE: EquationControlDefaults = Object.freeze({ kind: 'none' });
const OTHER: EquationControlDefaults = Object.freeze({ kind: 'other' });

/**
 * Classify the `m:ctrlPr` elements of one `m:oMath`. The first `m:ctrlPr` in document order is
 * the canonical control. The scan visits at most `maxNodes` nodes to `maxDepth` levels, the
 * equation reader's own limits, and reports `other` past them.
 */
export function equationDefaultControlProperties(
  equation: OoxmlNode,
  maxNodes: number,
  maxDepth: number
): EquationControlDefaults {
  let visited = 0;
  let first: OoxmlGenericElementNode | null = null;
  let signature: string | null = null;
  const stack: { node: OoxmlNode; depth: number }[] = [{ node: equation, depth: 1 }];
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    visited += 1;
    if (visited > maxNodes || depth > maxDepth) return OTHER;
    if (node.kind === 'textValue') continue;
    if (node.namespaceUri === MATH && node.localName === 'ctrlPr') {
      const control = readDefaultControl(node);
      if (control === false || node.kind !== 'generic') return OTHER;
      if (signature !== null && signature !== control.signature) return OTHER;
      signature = control.signature;
      first ??= node;
      continue;
    }
    if (visited + stack.length + node.children.length > maxNodes) return OTHER;
    // Push in reverse so the stack pops children in document order.
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: node.children[index]!, depth: depth + 1 });
    }
  }
  return first ? Object.freeze({ kind: 'default', control: first }) : NONE;
}

/** Copy a control element with fresh part-scoped ids. Attributes and values stay verbatim. */
export function cloneEquationControl(
  node: OoxmlGenericElementNode,
  nextId: () => string
): OoxmlGenericElementNode {
  const copy = (source: OoxmlNode): OoxmlNode =>
    source.kind === 'textValue'
      ? Object.freeze({ ...source, id: nextId() })
      : (Object.freeze({
          ...source,
          id: nextId(),
          children: Object.freeze(source.children.map(copy)),
        }) as OoxmlNode);
  return copy(node) as OoxmlGenericElementNode;
}
