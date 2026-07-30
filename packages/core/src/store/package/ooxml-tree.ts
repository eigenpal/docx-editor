import { isValidNCName } from './qname.ts';
import { escapeXmlChecked, isValidXmlText } from './sinks.ts';
import { readXml, type XmlLimits, type XmlNode, type XmlRejection } from './xml-reader.ts';

export const WML_NAMESPACE_URI =
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main' as const;
export const XML_NAMESPACE_URI = 'http://www.w3.org/XML/1998/namespace' as const;
export const XMLNS_NAMESPACE_URI = 'http://www.w3.org/2000/xmlns/' as const;
const MC_NAMESPACE_URI = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const XSI_NAMESPACE_URI = 'http://www.w3.org/2001/XMLSchema-instance';
const MC_QNAME_LIST_ATTRIBUTES = new Set([
  'ProcessContent',
  'PreserveElements',
  'PreserveAttributes',
]);

export type OoxmlNodeId = string;

export interface OoxmlNamespaceBinding {
  readonly prefix: string;
  readonly namespaceUri: string;
}

interface OoxmlAttributeBase {
  readonly namespaceUri: string;
  readonly localName: string;
  readonly prefix?: string;
  readonly value: string;
}

export interface OoxmlXmlSpaceAttribute extends OoxmlAttributeBase {
  readonly kind: 'xmlSpace';
  readonly namespaceUri: typeof XML_NAMESPACE_URI;
  readonly localName: 'space';
  readonly prefix: 'xml';
  readonly value: 'default' | 'preserve';
}

export interface OoxmlWmlValAttribute extends OoxmlAttributeBase {
  readonly kind: 'wmlVal';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'val';
}

export interface OoxmlGenericExtensionAttribute extends OoxmlAttributeBase {
  readonly kind: 'genericExtension';
}

export type OoxmlAttribute =
  | OoxmlXmlSpaceAttribute
  | OoxmlWmlValAttribute
  | OoxmlGenericExtensionAttribute;

export type OoxmlKnownNodeAttribute = OoxmlXmlSpaceAttribute | OoxmlGenericExtensionAttribute;

interface OoxmlElementBase<
  Children extends readonly OoxmlNode[] = readonly OoxmlNode[],
  Attributes extends readonly OoxmlAttribute[] = readonly OoxmlAttribute[],
> {
  readonly id: OoxmlNodeId;
  readonly namespaceUri: string;
  readonly localName: string;
  /** Authored prefix retained as non-authoritative fidelity evidence. */
  readonly prefix?: string;
  /** Namespace declarations authored directly on this element, in source order. */
  readonly namespaceBindings: readonly OoxmlNamespaceBinding[];
  readonly attributes: Attributes;
  readonly children: Children;
}

export interface OoxmlDocumentNode extends OoxmlElementBase<
  readonly (OoxmlBodyNode | OoxmlGenericElementNode)[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'document';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'document';
}

export interface OoxmlBodyNode extends OoxmlElementBase<
  readonly (OoxmlParagraphNode | OoxmlTableNode | OoxmlGenericElementNode)[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'body';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'body';
}

export interface OoxmlTableNode extends OoxmlElementBase<
  readonly (
    | OoxmlTablePropertiesNode
    | OoxmlTableGridNode
    | OoxmlTableRowNode
    | OoxmlGenericElementNode
  )[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'table';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'tbl';
}

export interface OoxmlTableRowNode extends OoxmlElementBase<
  readonly (OoxmlTableCellNode | OoxmlGenericElementNode)[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'tableRow';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'tr';
}

export interface OoxmlTableCellNode extends OoxmlElementBase<
  readonly (OoxmlParagraphNode | OoxmlTableNode | OoxmlGenericElementNode)[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'tableCell';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'tc';
}

/** Grid children (`w:gridCol`) stay generic: they are property leaves, not structure. */
export interface OoxmlTableGridNode extends OoxmlElementBase<
  readonly OoxmlGenericElementNode[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'tableGrid';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'tblGrid';
}

/** Property children stay generic, mirroring `runProperties`. */
export interface OoxmlTablePropertiesNode extends OoxmlElementBase<
  readonly OoxmlGenericElementNode[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'tableProperties';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'tblPr';
}

export interface OoxmlParagraphNode extends OoxmlElementBase<
  readonly (OoxmlParagraphPropertiesNode | OoxmlRunNode | OoxmlGenericElementNode)[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'paragraph';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'p';
}

export interface OoxmlRunNode extends OoxmlElementBase<
  readonly (
    | OoxmlRunPropertiesNode
    | OoxmlTextElementNode
    | OoxmlTabNode
    | OoxmlHardBreakNode
    | OoxmlGenericElementNode
  )[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'run';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'r';
}

export interface OoxmlRunPropertiesNode extends OoxmlElementBase<
  readonly OoxmlGenericElementNode[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'runProperties';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'rPr';
}

export interface OoxmlTextElementNode extends OoxmlElementBase<
  readonly OoxmlTextNode[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'text';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 't';
}

export interface OoxmlParagraphPropertiesNode extends OoxmlElementBase<
  readonly (OoxmlRunPropertiesNode | OoxmlGenericElementNode)[],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'paragraphProperties';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'pPr';
}

export interface OoxmlTabNode extends OoxmlElementBase<
  readonly [],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'tab';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'tab';
}

export interface OoxmlHardBreakNode extends OoxmlElementBase<
  readonly [],
  readonly OoxmlKnownNodeAttribute[]
> {
  readonly kind: 'hardBreak';
  readonly namespaceUri: typeof WML_NAMESPACE_URI;
  readonly localName: 'br';
}

export interface OoxmlGenericElementNode extends OoxmlElementBase<readonly OoxmlNode[]> {
  readonly kind: 'generic';
}

export interface OoxmlTextNode {
  readonly id: OoxmlNodeId;
  readonly kind: 'textValue';
  readonly value: string;
}

export type OoxmlElement =
  | OoxmlDocumentNode
  | OoxmlBodyNode
  | OoxmlParagraphNode
  | OoxmlRunNode
  | OoxmlRunPropertiesNode
  | OoxmlTextElementNode
  | OoxmlParagraphPropertiesNode
  | OoxmlTabNode
  | OoxmlHardBreakNode
  | OoxmlTableNode
  | OoxmlTableRowNode
  | OoxmlTableCellNode
  | OoxmlTableGridNode
  | OoxmlTablePropertiesNode
  | OoxmlGenericElementNode;

export type OoxmlNode = OoxmlElement | OoxmlTextNode;

export interface OoxmlPart {
  readonly id: string;
  readonly name: string;
  readonly contentType: string;
  readonly root: OoxmlElement;
}

export interface OoxmlPartMetadata {
  readonly name: string;
  readonly contentType: string;
}

export type OoxmlReadRejection =
  | XmlRejection
  | 'missing-root'
  | 'multiple-roots'
  | 'invalid-name'
  | 'invalid-namespace'
  | 'undeclared-prefix'
  | 'duplicate-expanded-attribute';

export type OoxmlReadResult =
  | { readonly ok: true; readonly part: OoxmlPart }
  | { readonly ok: false; readonly reason: OoxmlReadRejection };

export interface OoxmlNodeIdentityRules {
  readonly initial: 'deterministic-structural-path-after-normalized-parse';
  readonly unchanged: 'retain-id-through-structural-sharing';
  readonly replacement: 'explicitly-retain-or-allocate';
  readonly uniqueness: 'unique-within-part';
}

/**
 * Identity policy for future immutable tree edits. This defines the boundary
 * without implementing task 2.4 edit primitives.
 */
export const OOXML_NODE_IDENTITY_RULES: OoxmlNodeIdentityRules = Object.freeze({
  initial: 'deterministic-structural-path-after-normalized-parse',
  unchanged: 'retain-id-through-structural-sharing',
  replacement: 'explicitly-retain-or-allocate',
  uniqueness: 'unique-within-part',
});

export type OoxmlInvariantIssueCode =
  | 'invalid-id'
  | 'duplicate-id'
  | 'invalid-name'
  | 'invalid-namespace'
  | 'invalid-qname'
  | 'duplicate-expanded-attribute'
  | 'invalid-xml-value'
  | 'known-node-invariant';

export interface OoxmlInvariantIssue {
  readonly code: OoxmlInvariantIssueCode;
  readonly path: string;
  readonly nodeId?: string;
}

export type OoxmlInvariantResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly issues: readonly OoxmlInvariantIssue[] };

type LegacyElement = Extract<XmlNode, { type: 'element' }>;
type KnownKind = Exclude<OoxmlElement['kind'], 'generic'>;

const KNOWN_WML_ELEMENTS: Readonly<Record<string, KnownKind>> = {
  document: 'document',
  body: 'body',
  p: 'paragraph',
  r: 'run',
  rPr: 'runProperties',
  t: 'text',
  pPr: 'paragraphProperties',
  tab: 'tab',
  br: 'hardBreak',
  tbl: 'table',
  tr: 'tableRow',
  tc: 'tableCell',
  tblGrid: 'tableGrid',
  tblPr: 'tableProperties',
};

class TreeReadError extends Error {
  constructor(readonly reason: OoxmlReadRejection) {
    super(reason);
  }
}

interface ExpandedName {
  readonly prefix?: string;
  readonly localName: string;
}

function splitQName(name: string): ExpandedName {
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

function expandedKey(namespaceUri: string, localName: string): string {
  return `${namespaceUri}\u0000${localName}`;
}

function deepFreezeNode(node: OoxmlNode): OoxmlNode {
  if (node.kind === 'textValue') return Object.freeze(node);
  for (const attribute of node.attributes) Object.freeze(attribute);
  for (const binding of node.namespaceBindings) Object.freeze(binding);
  for (const child of node.children) deepFreezeNode(child);
  Object.freeze(node.attributes);
  Object.freeze(node.namespaceBindings);
  Object.freeze(node.children);
  return Object.freeze(node);
}

function namespaceDeclarations(
  element: LegacyElement,
  inherited: ReadonlyMap<string, string>
): {
  readonly bindings: ReadonlyMap<string, string>;
  readonly authored: readonly OoxmlNamespaceBinding[];
} {
  const bindings = new Map(inherited);
  const authored: OoxmlNamespaceBinding[] = [];
  for (const [name, namespaceUri] of Object.entries(element.attributes)) {
    if (name !== 'xmlns' && !name.startsWith('xmlns:')) continue;
    const prefix = name === 'xmlns' ? '' : name.slice('xmlns:'.length);
    if (
      (prefix !== '' && !isValidNCName(prefix)) ||
      prefix === 'xmlns' ||
      (prefix === 'xml' && namespaceUri !== XML_NAMESPACE_URI) ||
      (prefix !== 'xml' && namespaceUri === XML_NAMESPACE_URI) ||
      namespaceUri === XMLNS_NAMESPACE_URI ||
      (prefix !== '' && namespaceUri === '')
    )
      throw new TreeReadError('invalid-namespace');
    bindings.set(prefix, namespaceUri);
    authored.push({ prefix, namespaceUri });
  }
  return { bindings, authored };
}

function resolveElementName(
  authoredName: string,
  bindings: ReadonlyMap<string, string>
): ExpandedName & { readonly namespaceUri: string } {
  const name = splitQName(authoredName);
  if (name.prefix === 'xmlns') throw new TreeReadError('invalid-namespace');
  if (name.prefix !== undefined) {
    const namespaceUri = bindings.get(name.prefix);
    if (namespaceUri === undefined) throw new TreeReadError('undeclared-prefix');
    return { ...name, namespaceUri };
  }
  return { ...name, namespaceUri: bindings.get('') ?? '' };
}

function resolveAttributes(
  element: LegacyElement,
  bindings: ReadonlyMap<string, string>
): {
  readonly attributes: readonly OoxmlAttribute[];
  readonly compatibleWithKnownNode: boolean;
} {
  const attributes: OoxmlAttribute[] = [];
  const seen = new Set<string>();
  let compatibleWithKnownNode = true;
  for (const [authoredName, value] of Object.entries(element.attributes)) {
    if (authoredName === 'xmlns' || authoredName.startsWith('xmlns:')) continue;
    const name = splitQName(authoredName);
    let namespaceUri = '';
    if (name.prefix !== undefined) {
      namespaceUri = bindings.get(name.prefix) ?? '';
      if (!bindings.has(name.prefix)) throw new TreeReadError('undeclared-prefix');
      if (name.prefix === 'xmlns') throw new TreeReadError('invalid-namespace');
    }
    const key = expandedKey(namespaceUri, name.localName);
    if (seen.has(key)) throw new TreeReadError('duplicate-expanded-attribute');
    seen.add(key);
    if (namespaceUri === XML_NAMESPACE_URI && name.localName === 'space') {
      if (name.prefix === 'xml' && (value === 'default' || value === 'preserve')) {
        attributes.push({
          kind: 'xmlSpace',
          namespaceUri: XML_NAMESPACE_URI,
          localName: 'space',
          prefix: 'xml',
          value,
        });
      } else {
        compatibleWithKnownNode = false;
        attributes.push({
          kind: 'genericExtension',
          namespaceUri,
          localName: name.localName,
          ...(name.prefix === undefined ? {} : { prefix: name.prefix }),
          value,
        });
      }
    } else if (namespaceUri === WML_NAMESPACE_URI && name.localName === 'val') {
      compatibleWithKnownNode = false;
      attributes.push({
        kind: 'wmlVal',
        namespaceUri: WML_NAMESPACE_URI,
        localName: 'val',
        ...(name.prefix === undefined ? {} : { prefix: name.prefix }),
        value,
      });
    } else {
      attributes.push({
        kind: 'genericExtension',
        namespaceUri,
        localName: name.localName,
        ...(name.prefix === undefined ? {} : { prefix: name.prefix }),
        value,
      });
    }
  }
  return { attributes, compatibleWithKnownNode };
}

function resolvedQNameToken(
  token: string,
  bindings: ReadonlyMap<string, string>
): readonly [string, string] {
  const name = splitQName(token);
  const namespaceUri =
    name.prefix === undefined ? (bindings.get('') ?? '') : bindings.get(name.prefix);
  if (namespaceUri === undefined) throw new TreeReadError('undeclared-prefix');
  return [namespaceUri, name.localName];
}

function resolvedPrefixNamespaceSet(
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

function canonicalQNameAttributeValue(
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

function validateQNameAttributeValues(
  attributes: readonly OoxmlAttribute[],
  bindings: ReadonlyMap<string, string>,
  ownerNamespaceUri: string,
  ownerLocalName: string
): void {
  for (const attribute of attributes)
    canonicalQNameAttributeValue(attribute, bindings, ownerNamespaceUri, ownerLocalName);
}

function resolvedXmlSpace(
  attributes: readonly OoxmlAttribute[],
  inheritedPreserve: boolean
): boolean {
  const value = attributes.find(
    (attribute) => attribute.namespaceUri === XML_NAMESPACE_URI && attribute.localName === 'space'
  )?.value;
  return value === 'preserve' ? true : value === 'default' ? false : inheritedPreserve;
}

function canonicalLegacyChildren(
  children: readonly XmlNode[],
  preserve: boolean,
  isWmlText: boolean
): readonly XmlNode[] {
  const hasElement = children.some((child) => child.type === 'element');
  const hasNonWhitespaceText = children.some(
    (child) => child.type === 'text' && !/^\s*$/.test(child.value)
  );
  const retained = children.filter(
    (child) =>
      child.type === 'element' ||
      preserve ||
      isWmlText ||
      !hasElement ||
      hasNonWhitespaceText ||
      !/^\s*$/.test(child.value)
  );
  const merged: XmlNode[] = [];
  for (const child of retained) {
    const previous = merged[merged.length - 1];
    if (child.type === 'text' && previous?.type === 'text') {
      merged[merged.length - 1] = {
        type: 'text',
        value: previous.value + child.value,
      };
    } else {
      merged.push(child);
    }
  }
  return merged;
}

function validKnownKind(kind: KnownKind, children: readonly OoxmlNode[]): boolean {
  switch (kind) {
    case 'document':
      return (
        children.every((child) => child.kind === 'body' || child.kind === 'generic') &&
        children.filter((child) => child.kind === 'body').length === 1
      );
    case 'body':
      return children.every(
        (child) =>
          child.kind === 'paragraph' || child.kind === 'table' || child.kind === 'generic'
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
        (child) =>
          child.kind === 'paragraph' || child.kind === 'table' || child.kind === 'generic'
      );
    case 'tableGrid':
    case 'tableProperties':
      return children.every((child) => child.kind === 'generic');
  }
}

function convertElement(
  element: LegacyElement,
  inherited: ReadonlyMap<string, string>,
  partName: string,
  path: string,
  inheritedPreserve: boolean
): OoxmlElement {
  const declarations = namespaceDeclarations(element, inherited);
  const name = resolveElementName(element.name, declarations.bindings);
  const resolvedAttributes = resolveAttributes(element, declarations.bindings);
  const attributes = resolvedAttributes.attributes;
  validateQNameAttributeValues(
    attributes,
    declarations.bindings,
    name.namespaceUri,
    name.localName
  );
  const preserve = resolvedXmlSpace(attributes, inheritedPreserve);
  const candidateKind =
    name.namespaceUri === WML_NAMESPACE_URI
      ? (KNOWN_WML_ELEMENTS[name.localName] ?? 'generic')
      : 'generic';
  const retainedChildren = canonicalLegacyChildren(
    element.children,
    preserve,
    candidateKind === 'text'
  );
  const children = retainedChildren.map((child, index): OoxmlNode => {
    const childPath = `${path}.${index}`;
    if (child.type === 'text')
      return {
        id: `${partName}#${childPath}`,
        kind: 'textValue',
        value: child.value,
      };
    return convertElement(child, declarations.bindings, partName, childPath, preserve);
  });
  const kind =
    candidateKind !== 'generic' &&
    resolvedAttributes.compatibleWithKnownNode &&
    validKnownKind(candidateKind, children)
      ? candidateKind
      : 'generic';
  return {
    id: `${partName}#${path}`,
    kind,
    namespaceUri: name.namespaceUri,
    localName: name.localName,
    ...(name.prefix === undefined ? {} : { prefix: name.prefix }),
    namespaceBindings: declarations.authored,
    attributes,
    children,
  } as OoxmlElement;
}

/**
 * Read one XML part into the additive typed/generic foundation. Existing package
 * parsing and DocumentStore models intentionally remain unchanged until their
 * later migration tasks; this tree is not yet the repository's sole runtime authority.
 * Structural-path IDs are deterministic across normalized reopen. Preserving an
 * identity through moves and edits is deferred to PackageModel/DocumentStore integration.
 */
export function readOoxmlPart(
  xml: string,
  metadata: OoxmlPartMetadata,
  limits?: XmlLimits
): OoxmlReadResult {
  const result = readXml(xml, limits);
  if (!result.ok) return result;
  const roots = result.nodes.filter((node): node is LegacyElement => node.type === 'element');
  if (roots.length === 0) return { ok: false, reason: 'missing-root' };
  if (roots.length !== 1) return { ok: false, reason: 'multiple-roots' };
  try {
    const root = deepFreezeNode(
      convertElement(
        roots[0],
        new Map([
          ['xml', XML_NAMESPACE_URI],
          ['xmlns', XMLNS_NAMESPACE_URI],
        ]),
        metadata.name,
        '0',
        false
      )
    ) as OoxmlElement;
    return {
      ok: true,
      part: Object.freeze({
        id: `part:${metadata.name}`,
        name: metadata.name,
        contentType: metadata.contentType,
        root,
      }),
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof TreeReadError ? error.reason : 'parse-error',
    };
  }
}

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

const KNOWN_ELEMENT_NAMES: Readonly<
  Record<KnownKind, readonly [namespaceUri: string, localName: string]>
> = {
  document: [WML_NAMESPACE_URI, 'document'],
  body: [WML_NAMESPACE_URI, 'body'],
  paragraph: [WML_NAMESPACE_URI, 'p'],
  run: [WML_NAMESPACE_URI, 'r'],
  runProperties: [WML_NAMESPACE_URI, 'rPr'],
  text: [WML_NAMESPACE_URI, 't'],
  paragraphProperties: [WML_NAMESPACE_URI, 'pPr'],
  tab: [WML_NAMESPACE_URI, 'tab'],
  hardBreak: [WML_NAMESPACE_URI, 'br'],
  table: [WML_NAMESPACE_URI, 'tbl'],
  tableRow: [WML_NAMESPACE_URI, 'tr'],
  tableCell: [WML_NAMESPACE_URI, 'tc'],
  tableGrid: [WML_NAMESPACE_URI, 'tblGrid'],
  tableProperties: [WML_NAMESPACE_URI, 'tblPr'],
};

function knownAttributesAreValid(attributes: readonly OoxmlAttribute[]): boolean {
  return attributes.every((attribute) => {
    if (attribute.kind === 'wmlVal') return false;
    if (attribute.kind === 'xmlSpace')
      return (
        attribute.namespaceUri === XML_NAMESPACE_URI &&
        attribute.localName === 'space' &&
        attribute.prefix === 'xml' &&
        (attribute.value === 'default' || attribute.value === 'preserve')
      );
    return !(
      (attribute.namespaceUri === XML_NAMESPACE_URI && attribute.localName === 'space') ||
      (attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === 'val')
    );
  });
}

/**
 * Validate a parser-created or copy-modified immutable part before publication.
 * Future tree-edit primitives can retain shared nodes and their IDs, while any
 * replacement chooses explicitly whether to retain or allocate identity.
 */
export function validateOoxmlPart(part: OoxmlPart): OoxmlInvariantResult {
  return runValidation(part, null);
}

/**
 * Validate only what an edit could have changed, against a previously validated tree.
 *
 * Structural sharing makes an edited tree mostly object-identical to its predecessor. A
 * subtree that is the SAME OBJECT, reached under the SAME inherited namespace context, was
 * already proven valid when `previous` was — re-walking it proves nothing, and re-walking
 * the whole document per commit made validation the single largest cost of a keystroke on
 * a long document. Context equality is tracked by binding-array identity down the rebuilt
 * spine, so a node that alters its namespace declarations forfeits pruning for its whole
 * subtree.
 *
 * Two deliberate narrowings against the full walk, both bounded elsewhere:
 * DUPLICATE IDS across a changed and an unchanged subtree are not observed here — id
 * uniqueness for edits rests on the allocator, which mints against the whole part, and
 * `previous` itself was validated in full. NOTHING else is narrowed: every visited node
 * runs the identical rules.
 */
export function validateOoxmlPartDelta(previous: OoxmlPart, part: OoxmlPart): OoxmlInvariantResult {
  return runValidation(part, previous);
}

function runValidation(part: OoxmlPart, previous: OoxmlPart | null): OoxmlInvariantResult {
  const issues: OoxmlInvariantIssue[] = [];
  const ids = new Set<string>();
  const report = (code: OoxmlInvariantIssueCode, path: string, nodeId?: string): void => {
    issues.push({ code, path, ...(nodeId === undefined ? {} : { nodeId }) });
  };
  const walk = (
    node: OoxmlNode,
    inheritedBindings: ReadonlyMap<string, string>,
    path: string,
    priorNode: OoxmlNode | undefined,
    priorContext: boolean
  ): void => {
    // The prune: this very object was validated as part of `previous`, under an inherited
    // context proven identical — nothing in the subtree can have changed.
    if (priorContext && priorNode === node) return;

    if (typeof node.id !== 'string' || node.id.length === 0) report('invalid-id', path, node.id);
    else if (ids.has(node.id)) report('duplicate-id', path, node.id);
    else ids.add(node.id);

    if (node.kind === 'textValue') {
      if (!isValidXmlText(node.value)) report('invalid-xml-value', path, node.id);
      return;
    }

    const bindings = new Map(inheritedBindings);
    const localPrefixes = new Set<string>();
    for (const binding of node.namespaceBindings) {
      const valid =
        !localPrefixes.has(binding.prefix) &&
        (binding.prefix === '' || isValidNCName(binding.prefix)) &&
        binding.prefix !== 'xmlns' &&
        isValidXmlText(binding.namespaceUri) &&
        binding.namespaceUri !== XMLNS_NAMESPACE_URI &&
        !(binding.prefix === 'xml' && binding.namespaceUri !== XML_NAMESPACE_URI) &&
        !(binding.prefix !== 'xml' && binding.namespaceUri === XML_NAMESPACE_URI) &&
        !(binding.prefix !== '' && binding.namespaceUri === '');
      if (!valid) report('invalid-namespace', path, node.id);
      localPrefixes.add(binding.prefix);
      bindings.set(binding.prefix, binding.namespaceUri);
    }

    if (!isValidNCName(node.localName)) report('invalid-name', path, node.id);
    if (!isValidXmlText(node.namespaceUri) || node.namespaceUri === XMLNS_NAMESPACE_URI)
      report('invalid-namespace', path, node.id);
    const elementPrefixValid =
      node.prefix === undefined
        ? (bindings.get('') ?? '') === node.namespaceUri
        : isValidNCName(node.prefix) && bindings.get(node.prefix) === node.namespaceUri;
    if (!elementPrefixValid) report('invalid-qname', path, node.id);

    const expandedAttributes = new Set<string>();
    for (const attribute of node.attributes) {
      if (!isValidNCName(attribute.localName)) report('invalid-name', path, node.id);
      if (!isValidXmlText(attribute.namespaceUri) || attribute.namespaceUri === XMLNS_NAMESPACE_URI)
        report('invalid-namespace', path, node.id);
      if (!isValidXmlText(attribute.value)) report('invalid-xml-value', path, node.id);
      const attributePrefixValid =
        attribute.prefix === undefined
          ? attribute.namespaceUri === ''
          : isValidNCName(attribute.prefix) &&
            bindings.get(attribute.prefix) === attribute.namespaceUri;
      if (!attributePrefixValid) report('invalid-qname', path, node.id);
      const key = expandedKey(attribute.namespaceUri, attribute.localName);
      if (expandedAttributes.has(key)) report('duplicate-expanded-attribute', path, node.id);
      expandedAttributes.add(key);
    }

    try {
      validateQNameAttributeValues(node.attributes, bindings, node.namespaceUri, node.localName);
    } catch {
      report('invalid-qname', path, node.id);
    }

    if (node.kind !== 'generic') {
      const [namespaceUri, localName] = KNOWN_ELEMENT_NAMES[node.kind];
      if (
        node.namespaceUri !== namespaceUri ||
        node.localName !== localName ||
        !knownAttributesAreValid(node.attributes) ||
        !validKnownKind(node.kind, node.children)
      )
        report('known-node-invariant', path, node.id);
    }

    // Children may prune only when THIS node's paired predecessor declares the very same
    // binding array (reference identity — the spine rebuild spreads it through), so the
    // inherited context every child sees is provably what its predecessor saw.
    const childContext =
      priorContext &&
      priorNode !== undefined &&
      priorNode.kind !== 'textValue' &&
      priorNode.namespaceBindings === node.namespaceBindings;
    let priorChildren: ReadonlyMap<string, OoxmlNode> | null = null;
    if (childContext) {
      const paired = new Map<string, OoxmlNode>();
      for (const child of (priorNode as OoxmlElement).children) {
        if (!paired.has(child.id)) paired.set(child.id, child);
      }
      priorChildren = paired;
    }
    node.children.forEach((child, index) =>
      walk(
        child,
        bindings,
        `${path}.children[${index}]`,
        priorChildren?.get(child.id),
        childContext
      )
    );
  };

  walk(
    part.root,
    new Map([
      ['xml', XML_NAMESPACE_URI],
      ['xmlns', XMLNS_NAMESPACE_URI],
    ]),
    'root',
    previous?.root,
    previous !== null
  );
  return issues.length === 0 ? { ok: true } : { ok: false, issues: Object.freeze(issues) };
}
