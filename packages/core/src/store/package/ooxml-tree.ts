// The canonical typed + generic ordered OOXML tree: node types and the bounded read path.
//
// This module remains the single entry point for the tree. The canonical serializer and
// semantic fingerprint live in ooxml-serialize.ts, the invariant walk in ooxml-validate.ts,
// and the name/namespace machinery all three share in ooxml-shared.ts — everything is
// re-exported from here, so importers keep one module to reach for.

import { readXml, type XmlLimits, type XmlNode, type XmlRejection } from './xml-reader.ts';
import { isValidNCName } from './qname.ts';
import {
  TreeReadError,
  WML_NAMESPACE_URI,
  XML_NAMESPACE_URI,
  XMLNS_NAMESPACE_URI,
  expandedKey,
  splitQName,
  validKnownKind,
  validateQNameAttributeValues,
  type ExpandedName,
  type KnownKind,
} from './ooxml-shared.ts';

export {
  W14_NAMESPACE_URI,
  WML_NAMESPACE_URI,
  XML_NAMESPACE_URI,
  XMLNS_NAMESPACE_URI,
} from './ooxml-shared.ts';
export {
  canonicalOoxmlFingerprint,
  ooxmlTreesEqual,
  serializeOoxmlPart,
} from './ooxml-serialize.ts';
export { validateOoxmlPart, validateOoxmlPartDelta } from './ooxml-validate.ts';

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
