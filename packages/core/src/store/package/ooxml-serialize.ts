// Canonical OOXML serialization and the semantic equality oracle.
//
// This module owns normalized XML output from a canonical part — repository-controlled
// prefixes, validated and escaped names/values — plus the namespace-aware fingerprint that
// backs `ooxmlTreesEqual`. It is a projection of the tree in ooxml-tree.ts; the read path
// stays there, and importers keep reaching everything through that module's re-exports.

import { isValidNCName } from './qname.ts';
import { escapeXmlChecked } from './sinks.ts';
import {
  MC_NAMESPACE_URI,
  MC_QNAME_LIST_ATTRIBUTES,
  WML_NAMESPACE_URI,
  XML_NAMESPACE_URI,
  XMLNS_NAMESPACE_URI,
  XSI_NAMESPACE_URI,
  canonicalQNameAttributeValue,
  expandedKey,
  resolvedPrefixNamespaceSet,
  resolvedQNameToken,
  validateQNameAttributeValues,
} from './ooxml-shared.ts';
import type { OoxmlAttribute, OoxmlElement, OoxmlNode, OoxmlPart } from './ooxml-tree.ts';

function assertSerializableName(localName: string): void {
  if (!isValidNCName(localName))
    throw new Error(`invalid local name for OOXML serialization: ${JSON.stringify(localName)}`);
}

function assertSerializableNamespace(namespaceUri: string): void {
  if (namespaceUri === XMLNS_NAMESPACE_URI)
    throw new Error('the XMLNS namespace cannot name an OOXML element or authored attribute');
  escapeXmlChecked(namespaceUri, 'namespace URI');
}

function collectNamespacesAndAliases(
  node: OoxmlNode,
  namespaceUris: Set<string>,
  aliasUris: Map<string, Set<string>>
): void {
  if (node.kind === 'textValue') return;
  if (node.namespaceUri !== '') namespaceUris.add(node.namespaceUri);
  for (const attribute of node.attributes)
    if (attribute.namespaceUri !== '') namespaceUris.add(attribute.namespaceUri);
  for (const binding of node.namespaceBindings) {
    if (binding.namespaceUri !== '') namespaceUris.add(binding.namespaceUri);
    const uris = aliasUris.get(binding.prefix) ?? new Set<string>();
    uris.add(binding.namespaceUri);
    aliasUris.set(binding.prefix, uris);
  }
  for (const child of node.children) collectNamespacesAndAliases(child, namespaceUris, aliasUris);
}

function controlledPrefixMap(root: OoxmlElement): ReadonlyMap<string, string> {
  const namespaceUris = new Set<string>();
  const aliasUris = new Map<string, Set<string>>();
  collectNamespacesAndAliases(root, namespaceUris, aliasUris);
  namespaceUris.delete('');
  namespaceUris.delete(XML_NAMESPACE_URI);
  namespaceUris.delete(XMLNS_NAMESPACE_URI);
  const byUri = new Map<string, string>([[XML_NAMESPACE_URI, 'xml']]);
  const used = new Set(['xml', 'xmlns']);
  const allocate = (namespaceUri: string, preferred: string): void => {
    let prefix = preferred;
    let suffix = 0;
    while (
      used.has(prefix) ||
      [...(aliasUris.get(prefix) ?? [])].some((uri) => uri !== namespaceUri)
    ) {
      suffix += 1;
      prefix = `${preferred}${suffix}`;
    }
    byUri.set(namespaceUri, prefix);
    used.add(prefix);
    namespaceUris.delete(namespaceUri);
  };
  if (namespaceUris.has(WML_NAMESPACE_URI)) allocate(WML_NAMESPACE_URI, 'w');
  if (namespaceUris.has(MC_NAMESPACE_URI)) allocate(MC_NAMESPACE_URI, 'mc');
  if (namespaceUris.has(XSI_NAMESPACE_URI)) allocate(XSI_NAMESPACE_URI, 'xsi');
  let generated = 0;
  for (const namespaceUri of [...namespaceUris].sort()) {
    let preferred: string;
    do {
      generated += 1;
      preferred = `ns${generated}`;
    } while (used.has(preferred));
    allocate(namespaceUri, preferred);
  }
  return byUri;
}

function controlledQualifiedName(
  namespaceUri: string,
  localName: string,
  prefixes: ReadonlyMap<string, string>,
  attribute: boolean
): string {
  assertSerializableName(localName);
  assertSerializableNamespace(namespaceUri);
  if (namespaceUri === '') return localName;
  const prefix = prefixes.get(namespaceUri);
  if (!prefix)
    throw new Error(`no controlled prefix for namespace ${JSON.stringify(namespaceUri)}`);
  if (!attribute && prefix === '') return localName;
  return `${prefix}:${localName}`;
}

function sortedAttributes(attributes: readonly OoxmlAttribute[]): readonly OoxmlAttribute[] {
  const seen = new Set<string>();
  for (const attribute of attributes) {
    assertSerializableName(attribute.localName);
    assertSerializableNamespace(attribute.namespaceUri);
    const key = expandedKey(attribute.namespaceUri, attribute.localName);
    if (seen.has(key))
      throw new Error(
        `duplicate expanded attribute {${attribute.namespaceUri}}${attribute.localName}`
      );
    seen.add(key);
  }
  return [...attributes].sort((left, right) => {
    const leftKey = expandedKey(left.namespaceUri, left.localName);
    const rightKey = expandedKey(right.namespaceUri, right.localName);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

function controlledQNameValue(
  attribute: OoxmlAttribute,
  owner: OoxmlElement,
  bindings: ReadonlyMap<string, string>,
  prefixes: ReadonlyMap<string, string>
): string {
  const prefixList =
    (attribute.namespaceUri === MC_NAMESPACE_URI &&
      (attribute.localName === 'Ignorable' || attribute.localName === 'MustUnderstand')) ||
    (owner.namespaceUri === MC_NAMESPACE_URI &&
      owner.localName === 'Choice' &&
      attribute.namespaceUri === '' &&
      attribute.localName === 'Requires');
  if (prefixList) {
    return resolvedPrefixNamespaceSet(attribute.value, bindings)
      .map((namespaceUri) => {
        const controlledPrefix = prefixes.get(namespaceUri);
        if (!controlledPrefix)
          throw new Error(`no controlled prefix for QName namespace ${namespaceUri}`);
        return controlledPrefix;
      })
      .sort()
      .join(' ');
  }
  const qnameList =
    attribute.namespaceUri === MC_NAMESPACE_URI &&
    MC_QNAME_LIST_ATTRIBUTES.has(attribute.localName);
  const qnameScalar =
    attribute.namespaceUri === XSI_NAMESPACE_URI && attribute.localName === 'type';
  if (!qnameList && !qnameScalar) return attribute.value;
  return attribute.value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      const [namespaceUri, localName] = resolvedQNameToken(token, bindings);
      return controlledQualifiedName(namespaceUri, localName, prefixes, false);
    })
    .sort()
    .join(' ');
}

function serializeNode(
  node: OoxmlNode,
  prefixes: ReadonlyMap<string, string>,
  inheritedBindings: ReadonlyMap<string, string>,
  inheritedPreserve: boolean,
  rootDeclarations: string
): string {
  if (node.kind === 'textValue') return escapeXmlChecked(node.value, 'OOXML text');
  const bindings = new Map(inheritedBindings);
  const seenDeclarationPrefixes = new Set<string>();
  const declarations = [...node.namespaceBindings]
    .sort((left, right) => {
      const prefixOrder = left.prefix.localeCompare(right.prefix);
      return prefixOrder !== 0 ? prefixOrder : left.namespaceUri.localeCompare(right.namespaceUri);
    })
    .map((binding) => {
      if (
        (binding.prefix !== '' && !isValidNCName(binding.prefix)) ||
        binding.prefix === 'xmlns' ||
        seenDeclarationPrefixes.has(binding.prefix)
      )
        throw new Error(`invalid or duplicate namespace prefix ${JSON.stringify(binding.prefix)}`);
      assertSerializableNamespace(binding.namespaceUri);
      seenDeclarationPrefixes.add(binding.prefix);
      const declaredByControlledRoot =
        rootDeclarations !== '' && bindings.get(binding.prefix) === binding.namespaceUri;
      bindings.set(binding.prefix, binding.namespaceUri);
      if (declaredByControlledRoot) return '';
      const declarationName = binding.prefix === '' ? 'xmlns' : `xmlns:${binding.prefix}`;
      return ` ${declarationName}="${escapeXmlChecked(binding.namespaceUri, declarationName)}"`;
    })
    .join('');
  validateQNameAttributeValues(node.attributes, bindings, node.namespaceUri, node.localName);
  const ownSpace = xmlSpaceValue(node);
  const preserve =
    ownSpace === 'preserve' ? true : ownSpace === 'default' ? false : inheritedPreserve;
  const name = controlledQualifiedName(node.namespaceUri, node.localName, prefixes, false);
  const attributes = sortedAttributes(node.attributes)
    .map((attribute) => {
      const attributeName = controlledQualifiedName(
        attribute.namespaceUri,
        attribute.localName,
        prefixes,
        true
      );
      const value = controlledQNameValue(attribute, node, bindings, prefixes);
      return ` ${attributeName}="${escapeXmlChecked(value, `attribute ${attributeName}`)}"`;
    })
    .join('');
  const open = `<${name}${rootDeclarations}${declarations}${attributes}`;
  const children = significantChildren(node, preserve);
  if (children.length === 0) return `${open}/>`;
  return `${open}>${children
    .map((child) => serializeNode(child, prefixes, bindings, preserve, ''))
    .join('')}</${name}>`;
}

/**
 * Serialize normalized XML from a canonical part using repository-controlled
 * prefixes and validated, escaped names and values. This does not yet replace
 * writeDocx; package integration belongs to the subsequent migration pass.
 */
export function serializeOoxmlPart(part: OoxmlPart): string {
  const prefixes = controlledPrefixMap(part.root);
  const rootBindings = new Map<string, string>([
    ['xml', XML_NAMESPACE_URI],
    ['xmlns', XMLNS_NAMESPACE_URI],
  ]);
  const declarations = [...prefixes.entries()]
    .filter(([namespaceUri]) => namespaceUri !== XML_NAMESPACE_URI)
    .sort((left, right) => left[1].localeCompare(right[1]))
    .map(([namespaceUri, prefix]) => {
      rootBindings.set(prefix, namespaceUri);
      return ` xmlns:${prefix}="${escapeXmlChecked(namespaceUri, `namespace ${prefix}`)}"`;
    })
    .join('');
  return serializeNode(part.root, prefixes, rootBindings, false, declarations);
}

type FingerprintValue =
  | readonly ['text', string]
  | readonly [
      'element',
      string,
      string,
      readonly (readonly [string, string, string])[],
      readonly FingerprintValue[],
    ];

function xmlSpaceValue(node: OoxmlElement): string | undefined {
  return node.attributes.find(
    (attribute) => attribute.namespaceUri === XML_NAMESPACE_URI && attribute.localName === 'space'
  )?.value;
}

function significantChildren(node: OoxmlElement, preserve: boolean): readonly OoxmlNode[] {
  const hasElementChild = node.children.some((child) => child.kind !== 'textValue');
  const hasNonWhitespaceText = node.children.some(
    (child) => child.kind === 'textValue' && !/^\s*$/.test(child.value)
  );
  return node.children.filter(
    (child) =>
      child.kind !== 'textValue' ||
      preserve ||
      node.kind === 'text' ||
      !hasElementChild ||
      hasNonWhitespaceText ||
      !/^\s*$/.test(child.value)
  );
}

function fingerprintNode(
  node: OoxmlNode,
  inheritedPreserve: boolean,
  inheritedBindings: ReadonlyMap<string, string>
): FingerprintValue {
  if (node.kind === 'textValue') return ['text', node.value];
  const bindings = new Map(inheritedBindings);
  for (const binding of node.namespaceBindings) bindings.set(binding.prefix, binding.namespaceUri);
  const ownSpace = xmlSpaceValue(node);
  const preserve =
    ownSpace === 'preserve' ? true : ownSpace === 'default' ? false : inheritedPreserve;
  const attributes = sortedAttributes(node.attributes).map(
    (attribute) =>
      [
        attribute.namespaceUri,
        attribute.localName,
        canonicalQNameAttributeValue(attribute, bindings, node.namespaceUri, node.localName),
      ] as const
  );
  const children = significantChildren(node, preserve).map((child) =>
    fingerprintNode(child, preserve, bindings)
  );
  return ['element', node.namespaceUri, node.localName, attributes, children];
}

/** Repository-owned namespace-aware semantic XML oracle. */
export function canonicalOoxmlFingerprint(value: OoxmlPart | OoxmlNode): string {
  return JSON.stringify(
    fingerprintNode(
      'root' in value ? value.root : value,
      false,
      new Map([
        ['xml', XML_NAMESPACE_URI],
        ['xmlns', XMLNS_NAMESPACE_URI],
      ])
    )
  );
}

export function ooxmlTreesEqual(
  left: OoxmlPart | OoxmlNode,
  right: OoxmlPart | OoxmlNode
): boolean {
  return canonicalOoxmlFingerprint(left) === canonicalOoxmlFingerprint(right);
}
