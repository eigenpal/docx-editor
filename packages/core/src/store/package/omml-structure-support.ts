// Structural allowlist for the bounded Office Math projection.
//
// Every structure accepts only its declared children and property values. Anything else keeps
// the bounded text fallback, so unknown source is never discarded by a projection.

import {
  equationControlPropertiesAreSupported,
  equationMathChild as namedChild,
  equationMathChildren as namedChildren,
  equationRunIsSupported as isSupportedRun,
  equationTextIsSupported,
} from './omml-run-format.ts';
import type { OoxmlGenericElementNode, OoxmlNode } from './ooxml-tree.ts';

const MATH = 'http://schemas.openxmlformats.org/officeDocument/2006/math';

type ChildCounts = Readonly<Record<string, { readonly min: number; readonly max: number }>>;

const OPTIONAL = Object.freeze({ min: 0, max: 1 });
const REQUIRED = Object.freeze({ min: 1, max: 1 });
const ABSENT = Object.freeze({ min: 0, max: 0 });

function isMathElement(node: OoxmlNode, localName?: string): node is OoxmlGenericElementNode {
  return (
    node.kind === 'generic' &&
    node.namespaceUri === MATH &&
    (localName === undefined || node.localName === localName)
  );
}

function hasOnlyMathChildren(node: OoxmlGenericElementNode, counts: ChildCounts): boolean {
  if (node.attributes.length > 0) return false;
  const seen = new Map<string, number>();
  for (const child of node.children) {
    if (!isMathElement(child) || !Object.hasOwn(counts, child.localName)) return false;
    seen.set(child.localName, (seen.get(child.localName) ?? 0) + 1);
  }
  return Object.entries(counts).every(([name, range]) => {
    const count = seen.get(name) ?? 0;
    return count >= range.min && count <= range.max;
  });
}

/** The `m:val` attribute of a math property element. */
export function mathVal(node: OoxmlGenericElementNode): string | undefined {
  return node.attributes.find(
    (attribute) => attribute.namespaceUri === MATH && attribute.localName === 'val'
  )?.value;
}

function hasOnlyMathVal(node: OoxmlGenericElementNode, accepted?: ReadonlySet<string>): boolean {
  if (node.children.length > 0 || node.attributes.length !== 1) return false;
  const value = mathVal(node);
  return value !== undefined && (accepted === undefined || accepted.has(value));
}

/**
 * Check one structure property element. `m:ctrlPr` is accepted beside the declared
 * properties when its run formatting is within the math run allowlist.
 */
function propertyIsSupported(
  property: OoxmlGenericElementNode | null,
  counts: ChildCounts,
  values: (property: OoxmlGenericElementNode) => boolean = () => true
): boolean {
  if (!property) return true;
  if (!hasOnlyMathChildren(property, { ...counts, ctrlPr: OPTIONAL })) return false;
  const control = namedChild(property, 'ctrlPr');
  return (!control || equationControlPropertiesAreSupported(control)) && values(property);
}

/** True when the structure's property element carries `m:ctrlPr`. */
export function equationStructureHasControlProperties(
  node: OoxmlGenericElementNode,
  propertyName: string
): boolean {
  const property = namedChild(node, propertyName);
  return property !== null && namedChild(property, 'ctrlPr') !== null;
}

function containersSupported(node: OoxmlGenericElementNode, names: readonly string[]): boolean {
  return names.every((name) =>
    namedChildren(node, name).every((container) =>
      container.children.every(isSupportedExpressionNode)
    )
  );
}

const BAR_POSITIONS: ReadonlySet<string> = new Set(['top', 'bot']);
const FRACTION_TYPES: ReadonlySet<string> = new Set(['bar']);
const TRUE_VALUES: ReadonlySet<string> = new Set(['1', 'true', 'on']);
const NARY_LIMIT_LOCATIONS: ReadonlySet<string> = new Set(['undOvr', 'subSup']);

/** True when every node belongs to the projected Office Math subset. */
export function isSupportedExpressionNode(node: OoxmlNode): boolean {
  if (node.kind === 'textValue') return true;
  if (!isMathElement(node)) return false;
  if (node.localName === 'r') return isSupportedRun(node);
  if (node.localName === 't') return equationTextIsSupported(node);
  if (node.localName === 'bar') {
    return (
      hasOnlyMathChildren(node, { barPr: OPTIONAL, e: REQUIRED }) &&
      propertyIsSupported(namedChild(node, 'barPr'), { pos: OPTIONAL }, (property) => {
        const position = namedChild(property, 'pos');
        return !position || hasOnlyMathVal(position, BAR_POSITIONS);
      }) &&
      containersSupported(node, ['e'])
    );
  }
  if (node.localName === 'f') {
    return (
      hasOnlyMathChildren(node, { fPr: OPTIONAL, num: REQUIRED, den: REQUIRED }) &&
      propertyIsSupported(namedChild(node, 'fPr'), { type: OPTIONAL }, (property) => {
        const type = namedChild(property, 'type');
        return !type || hasOnlyMathVal(type, FRACTION_TYPES);
      }) &&
      containersSupported(node, ['num', 'den'])
    );
  }
  if (node.localName === 'rad') {
    if (!hasOnlyMathChildren(node, { radPr: OPTIONAL, deg: REQUIRED, e: REQUIRED })) return false;
    const degree = namedChildren(node, 'deg')[0]!;
    return (
      propertyIsSupported(namedChild(node, 'radPr'), { degHide: OPTIONAL }, (property) => {
        const hide = namedChild(property, 'degHide');
        return !hide || (degree.children.length === 0 && hasOnlyMathVal(hide, TRUE_VALUES));
      }) && containersSupported(node, ['deg', 'e'])
    );
  }
  if (node.localName === 'sSup' || node.localName === 'sSub' || node.localName === 'sSubSup') {
    const propertyName = `${node.localName}Pr`;
    return (
      hasOnlyMathChildren(node, {
        [propertyName]: OPTIONAL,
        e: REQUIRED,
        sub: node.localName === 'sSup' ? ABSENT : REQUIRED,
        sup: node.localName === 'sSub' ? ABSENT : REQUIRED,
      }) &&
      propertyIsSupported(namedChild(node, propertyName), {}) &&
      containersSupported(node, ['e', 'sub', 'sup'])
    );
  }
  if (node.localName === 'nary') {
    return (
      hasOnlyMathChildren(node, { naryPr: OPTIONAL, sub: OPTIONAL, sup: OPTIONAL, e: REQUIRED }) &&
      propertyIsSupported(
        namedChild(node, 'naryPr'),
        { chr: OPTIONAL, limLoc: OPTIONAL },
        (property) => {
          const character = namedChild(property, 'chr');
          const limitLocation = namedChild(property, 'limLoc');
          return (
            (!character || hasOnlyMathVal(character)) &&
            (!limitLocation || hasOnlyMathVal(limitLocation, NARY_LIMIT_LOCATIONS))
          );
        }
      ) &&
      containersSupported(node, ['e', 'sub', 'sup'])
    );
  }
  return false;
}
