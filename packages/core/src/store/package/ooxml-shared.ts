// Shared OOXML name machinery.
//
// This module owns the namespace constants, QName resolution/canonicalization and the
// known-kind shape rules that the ooxml-tree read path, the canonical serializer
// (ooxml-serialize) and the invariant validator (ooxml-validate) all consume. It lives
// apart from all three so none of them has to import another for a constant — the type
// imports below are erased, so the module graph stays acyclic at runtime.

import { isValidNCName } from './qname.ts';
import type { OoxmlAttribute, OoxmlElement, OoxmlNode, OoxmlReadRejection } from './ooxml-tree.ts';

export const WML_NAMESPACE_URI =
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main' as const;
export const XML_NAMESPACE_URI = 'http://www.w3.org/XML/1998/namespace' as const;
export const XMLNS_NAMESPACE_URI = 'http://www.w3.org/2000/xmlns/' as const;
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
        (runProperties < 0 || runProperties === children.length - 1)
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
