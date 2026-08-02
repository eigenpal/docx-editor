// Shared OOXML name machinery.
//
// This module owns the namespace constants, QName resolution/canonicalization and the
// known-kind shape rules that the ooxml-tree read path, the canonical serializer
// (ooxml-serialize) and the invariant validator (ooxml-validate) all consume. It lives
// apart from all three so none of them has to import another for a constant — the type
// imports below are erased, so the module graph stays acyclic at runtime.

import { isValidNCName } from './qname.ts';
import type { OoxmlAttribute, OoxmlElement, OoxmlNode, OoxmlReadRejection } from './ooxml-tree.ts';

// No `as const` on the three below: a `const` bound to a string literal is already
// literal-typed, and `typeof WML_NAMESPACE_URI` / `typeof XML_NAMESPACE_URI` are read by
// the typed attribute kinds in `ooxml-tree.ts`. API Extractor 7.x crashes ("Unable to
// follow symbol for 'const'", rushstack#4754) whenever a public type reaches an
// `as const` variable declaration, and any public type that reaches `OoxmlElement` drags
// these attribute kinds along with it. Same reason `CHROME_GROUPS` in
// `editor/chrome-controls.ts` avoids the derived-from-`as const` form.
export const WML_NAMESPACE_URI = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const XML_NAMESPACE_URI = 'http://www.w3.org/XML/1998/namespace';
export const XMLNS_NAMESPACE_URI = 'http://www.w3.org/2000/xmlns/';
export const MC_NAMESPACE_URI = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
export const XSI_NAMESPACE_URI = 'http://www.w3.org/2001/XMLSchema-instance';
export const MC_QNAME_LIST_ATTRIBUTES = new Set([
  'ProcessContent',
  'PreserveElements',
  'PreserveAttributes',
]);

export type KnownKind = Exclude<OoxmlElement['kind'], 'generic'>;

export class TreeReadError extends Error {
  constructor(readonly reason: OoxmlReadRejection) {
    super(reason);
  }
}

export interface ExpandedName {
  readonly prefix?: string;
  readonly localName: string;
}

export function splitQName(name: string): ExpandedName {
  const colon = name.indexOf(':');
  if (colon < 0) {
    if (!isValidNCName(name)) throw new TreeReadError('invalid-name');
    return { localName: name };
  }
  if (name.indexOf(':', colon + 1) >= 0) throw new TreeReadError('invalid-name');
  const prefix = name.slice(0, colon);
  const localName = name.slice(colon + 1);
  if (!isValidNCName(prefix) || !isValidNCName(localName)) throw new TreeReadError('invalid-name');
  return { prefix, localName };
}

export function expandedKey(namespaceUri: string, localName: string): string {
  return `${namespaceUri}\u0000${localName}`;
}

export function resolvedQNameToken(
  token: string,
  bindings: ReadonlyMap<string, string>
): readonly [string, string] {
  const name = splitQName(token);
  const namespaceUri =
    name.prefix === undefined ? (bindings.get('') ?? '') : bindings.get(name.prefix);
  if (namespaceUri === undefined) throw new TreeReadError('undeclared-prefix');
  return [namespaceUri, name.localName];
}

export function resolvedPrefixNamespaceSet(
  value: string,
  bindings: ReadonlyMap<string, string>
): readonly string[] {
  const namespaceUris = value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((prefix) => {
      if (!isValidNCName(prefix)) throw new TreeReadError('invalid-name');
      const namespaceUri = bindings.get(prefix);
      if (namespaceUri === undefined) throw new TreeReadError('undeclared-prefix');
      return namespaceUri;
    });
  return [...new Set(namespaceUris)].sort();
}

export function canonicalQNameAttributeValue(
  attribute: OoxmlAttribute,
  bindings: ReadonlyMap<string, string>,
  ownerNamespaceUri: string,
  ownerLocalName: string
): string {
  if (
    (attribute.namespaceUri === MC_NAMESPACE_URI &&
      (attribute.localName === 'Ignorable' || attribute.localName === 'MustUnderstand')) ||
    (ownerNamespaceUri === MC_NAMESPACE_URI &&
      ownerLocalName === 'Choice' &&
      attribute.namespaceUri === '' &&
      attribute.localName === 'Requires')
  ) {
    return resolvedPrefixNamespaceSet(attribute.value, bindings).join(' ');
  }
  if (
    attribute.namespaceUri === MC_NAMESPACE_URI &&
    MC_QNAME_LIST_ATTRIBUTES.has(attribute.localName)
  ) {
    return attribute.value
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((token) => JSON.stringify(resolvedQNameToken(token, bindings)))
      .sort()
      .join(' ');
  }
  if (attribute.namespaceUri === XSI_NAMESPACE_URI && attribute.localName === 'type') {
    return JSON.stringify(resolvedQNameToken(attribute.value.trim(), bindings));
  }
  return attribute.value;
}

export function validateQNameAttributeValues(
  attributes: readonly OoxmlAttribute[],
  bindings: ReadonlyMap<string, string>,
  ownerNamespaceUri: string,
  ownerLocalName: string
): void {
  for (const attribute of attributes)
    canonicalQNameAttributeValue(attribute, bindings, ownerNamespaceUri, ownerLocalName);
}

/**
 * The `w:pPr` children that legally FOLLOW `w:rPr`.
 *
 * `CT_PPr` (ECMA-376 17.3.1.26) is `CT_PPrBase`, then `w:rPr`, then `w:sectPr`, then
 * `w:pPrChange` — so the paragraph-mark properties are NOT last. Requiring them to be
 * demoted the `w:pPr` of every section-ending paragraph, and of every paragraph carrying a
 * tracked property change, to a generic node: the tree still round-tripped it, but nothing
 * downstream could read the paragraph's style, alignment, indent or numbering out of it,
 * and writing a paragraph mark onto a section-ending paragraph produced a document that
 * reopened demoted.
 */
const PPR_ELEMENTS_AFTER_RPR = new Set(['sectPr', 'pPrChange']);

export function validKnownKind(kind: KnownKind, children: readonly OoxmlNode[]): boolean {
  switch (kind) {
    case 'document':
      return (
        children.every((child) => child.kind === 'body' || child.kind === 'generic') &&
        children.filter((child) => child.kind === 'body').length === 1
      );
    case 'body':
      return children.every(
        (child) => child.kind === 'paragraph' || child.kind === 'table' || child.kind === 'generic'
      );
    case 'paragraph': {
      const properties = children.findIndex((child) => child.kind === 'paragraphProperties');
      return (
        children.every(
          (child) =>
            child.kind === 'paragraphProperties' || child.kind === 'run' || child.kind === 'generic'
        ) &&
        (properties < 0 || properties === 0) &&
        children.filter((child) => child.kind === 'paragraphProperties').length <= 1
      );
    }
    case 'run': {
      const properties = children.findIndex((child) => child.kind === 'runProperties');
      return (
        children.every(
          (child) =>
            child.kind === 'runProperties' ||
            child.kind === 'text' ||
            child.kind === 'tab' ||
            child.kind === 'hardBreak' ||
            child.kind === 'generic'
        ) &&
        (properties < 0 || properties === 0) &&
        children.filter((child) => child.kind === 'runProperties').length <= 1
      );
    }
    case 'runProperties':
      return children.every((child) => child.kind === 'generic');
    case 'paragraphProperties': {
      const runProperties = children.findIndex((child) => child.kind === 'runProperties');
      return (
        children.every((child) => child.kind === 'runProperties' || child.kind === 'generic') &&
        children.filter((child) => child.kind === 'runProperties').length <= 1 &&
        (runProperties < 0 ||
          children
            .slice(runProperties + 1)
            .every(
              (child) =>
                child.kind === 'generic' &&
                child.namespaceUri === WML_NAMESPACE_URI &&
                PPR_ELEMENTS_AFTER_RPR.has(child.localName)
            ))
      );
    }
    case 'text':
      return children.every((child) => child.kind === 'textValue');
    case 'tab':
    case 'hardBreak':
      return children.length === 0;
    // Table arms are deliberately permissive (no ordering constraints): demotion to
    // generic on any violation is the safe fallback, and generic round-trips losslessly.
    case 'table':
      return (
        children.every(
          (child) =>
            child.kind === 'tableRow' ||
            child.kind === 'tableProperties' ||
            child.kind === 'tableGrid' ||
            child.kind === 'generic'
        ) &&
        children.filter((child) => child.kind === 'tableProperties').length <= 1 &&
        children.filter((child) => child.kind === 'tableGrid').length <= 1
      );
    case 'tableRow':
      return children.every((child) => child.kind === 'tableCell' || child.kind === 'generic');
    case 'tableCell':
      return children.every(
        (child) => child.kind === 'paragraph' || child.kind === 'table' || child.kind === 'generic'
      );
    case 'tableGrid':
    case 'tableProperties':
      return children.every((child) => child.kind === 'generic');
  }
}

/** XML 1.0 whitespace — the set Word uses for `w:t` boundary semantics. */
export function isXmlWhitespaceChar(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\r' || char === '\n';
}

/** True when a `w:t` text value must carry `xml:space="preserve"` on save. */
export function wmlTextNeedsXmlSpacePreserve(text: string): boolean {
  return (
    text.length > 0 &&
    (isXmlWhitespaceChar(text[0]!) || isXmlWhitespaceChar(text[text.length - 1]!))
  );
}

/** Text content of a typed `w:t` element, or empty when absent or malformed. */
export function wmlTextValueOf(node: OoxmlElement): string {
  const child = node.children.find((candidate) => candidate.kind === 'textValue');
  return child?.kind === 'textValue' ? child.value : '';
}

/**
 * Canonical `w:t` attributes for normalized serialization and fingerprinting.
 * Injects `xml:space="preserve"` when boundary whitespace requires it; drops a
 * redundant or stale `xml:space` when the text no longer needs it. Other authored
 * attributes (including generic extensions) are preserved verbatim.
 */
export function normalizedWmlTextAttributes(
  attributes: readonly OoxmlAttribute[],
  text: string
): readonly OoxmlAttribute[] {
  const withoutSpace = attributes.filter(
    (attribute) =>
      !(attribute.namespaceUri === XML_NAMESPACE_URI && attribute.localName === 'space')
  );
  if (!wmlTextNeedsXmlSpacePreserve(text)) return withoutSpace;
  return [
    ...withoutSpace,
    {
      kind: 'xmlSpace',
      namespaceUri: XML_NAMESPACE_URI,
      localName: 'space',
      prefix: 'xml',
      value: 'preserve',
    },
  ];
}

function ooxmlChildNamed(node: OoxmlNode, localName: string): OoxmlElement | undefined {
  if (node.kind === 'textValue') return undefined;
  for (const child of node.children) {
    if (child.kind !== 'textValue' && child.localName === localName) return child;
  }
  return undefined;
}

function ooxmlAttributeValue(node: OoxmlElement, localName: string): string | undefined {
  return node.attributes.find((attribute) => attribute.localName === localName)?.value;
}

/** OOXML on/off toggle: on only when present and `w:val` does not explicitly disable. */
export function readOnOffChild(parent: OoxmlNode, localName: string): boolean {
  const child = ooxmlChildNamed(parent, localName);
  if (!child) return false;
  const value = ooxmlAttributeValue(child, 'val');
  return value === undefined || !(value === '0' || value === 'false' || value === 'off');
}
