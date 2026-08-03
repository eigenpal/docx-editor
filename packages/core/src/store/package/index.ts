// Bounded package trust boundary: OPC names, content types, relationships
// (document-engine tasks 2.2, 2.6).
export {
  type NameRejection,
  type NameResult,
  normalizePartName,
  partNameKey,
  asciiFold,
  detectDuplicateNames,
  resolveInternalTarget,
  validateExternalTarget,
} from './opc-names.ts';
export {
  type DefaultRecord,
  type OverrideRecord,
  type ContentTypeRecords,
  type ContentTypeError,
  type ContentTypeIndex,
  type IndexResult,
  type ResolveResult,
  isValidMime,
  extensionKey,
  buildContentTypeIndex,
  resolveContentType,
} from './content-types.ts';
export {
  type TargetMode,
  type RelationshipRecord,
  type RelationshipError,
  type RelationshipSetResult,
  type ResolvedRelationship,
  buildRelationshipSet,
  resolveRelationship,
} from './relationships.ts';
export {
  DANGEROUS_KEYS,
  DangerousKeyError,
  isDangerousKey,
  nullRecord,
  toSafeRecord,
} from './safe-record.ts';
export {
  type XmlNode,
  type XmlRejection,
  type XmlResult,
  type XmlLimits,
  readXml,
  findElement,
  childElements,
  textContent,
} from './xml-reader.ts';
export {
  WML_NAMESPACE_URI,
  XML_NAMESPACE_URI,
  XMLNS_NAMESPACE_URI,
  type OoxmlNodeId,
  type OoxmlNamespaceBinding,
  type OoxmlAttribute,
  type OoxmlXmlSpaceAttribute,
  type OoxmlWmlValAttribute,
  type OoxmlGenericExtensionAttribute,
  type OoxmlKnownNodeAttribute,
  type OoxmlDocumentNode,
  type OoxmlBodyNode,
  type OoxmlParagraphNode,
  type OoxmlRunNode,
  type OoxmlRunPropertiesNode,
  type OoxmlTextElementNode,
  type OoxmlParagraphPropertiesNode,
  type OoxmlTabNode,
  type OoxmlHardBreakNode,
  type OoxmlHyperlinkNode,
  type OoxmlBookmarkStartNode,
  type OoxmlBookmarkEndNode,
  type OoxmlGenericElementNode,
  type OoxmlTextNode,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
  type OoxmlPartMetadata,
  type OoxmlReadRejection,
  type OoxmlReadResult,
  type OoxmlNodeIdentityRules,
  type OoxmlInvariantIssueCode,
  type OoxmlInvariantIssue,
  type OoxmlInvariantResult,
  OOXML_NODE_IDENTITY_RULES,
  readOoxmlPart,
  validateOoxmlPart,
  serializeOoxmlPart,
  canonicalOoxmlFingerprint,
  ooxmlTreesEqual,
} from './ooxml-tree.ts';
export { readOnOffChild, isContentRevisionKind, isRangeMarkerKind } from './ooxml-shared.ts';
export {
  type ZipRejection,
  type ZipLimits,
  type ZipReadResult,
  DEFAULT_ZIP_LIMITS,
  readZip,
  writeZip,
} from './zip.ts';
export { isValidNCName, isValidQName, assertValidQName, PrefixAllocator } from './qname.ts';
export {
  type HrefProjection,
  type InertExecutableKind,
  type ContentItem,
  type ScrubResult,
  sanitizeHref,
  escapeXml,
  escapeCssString,
  containsCssFetch,
  INERT_EXECUTABLE_KINDS,
  isInertExecutable,
  isEvaluableField,
  scrubExport,
} from './sinks.ts';
export {
  readOoxmlPackage,
  writeOoxmlPackage,
  withPart,
  DEFAULT_OOXML_PACKAGE_LIMITS,
  type OoxmlPackage,
  type OoxmlPackageLimits,
  type OoxmlPackageRejection,
  type OoxmlPackageResult,
  type OoxmlExternalTarget,
} from './ooxml-package.ts';
export {
  resolveHeaderFooterParts,
  resolveHeaderFooterPartsBySection,
  collectSectionPropertyNodes,
  type HeaderFooterParts,
  type HeaderFooterVariant,
} from './hf-references.ts';
export {
  deobfuscateFont,
  readEmbeddedFonts,
  type EmbeddedFont,
  type FontStyleKey,
  type ReadEmbeddedFontsOptions,
} from './embedded-fonts.ts';
export {
  applyEdits,
  collectNodeIds,
  createNodeIdAllocator,
  findNode,
  hasNode,
  insertChildren,
  parentNodeOf,
  removeNode,
  replaceChildren,
  replaceNode,
  type EditOptions,
  type OoxmlEditResult,
} from './ooxml-edit.ts';
export {
  PAGE_BREAK_CHAR,
  hardBreakAttributes,
  hardBreakKind,
  hardBreakText,
  isPageBreakNode,
  type HardBreakKind,
} from './hard-break.ts';
export {
  deriveOoxmlIndexes,
  type OoxmlIndexes,
  type ParagraphIndexEntry,
  type StoryIndexEntry,
  type StyleIndexEntry,
} from './ooxml-indexes.ts';
export {
  digestPart,
  diffSemanticDigests,
  semanticDigest,
  type DigestDifference,
  type ParagraphDigest,
  type SemanticDigest,
  type StoryDigest,
} from './ooxml-digest.ts';
export {
  isValidParaId,
  mintParaId,
  mintedParagraphIdentityAttributes,
  normalizeParagraphIdentity,
  paraIdOf,
  usedParaIds,
  w14RootPrefix,
} from './para-id.ts';
export { ensureListDefinition, ensureNumberingLevel, type ListKind } from './numbering-part.ts';
export { buildBookmarkIndex, type BookmarkAnchor, type BookmarkIndex } from './bookmarks.ts';
export {
  ensureHyperlinkRelationship,
  relationshipTargetIn,
  type EnsuredHyperlinkRelationship,
} from './hyperlink-part.ts';
export {
  HYPERLINK_RELATIONSHIP_TYPE,
  OFFICE_RELATIONSHIP_NAMESPACE_URI,
  hyperlinkAnchorOf,
  hyperlinkRelationshipIdOf,
  hyperlinkTargetOf,
  isHyperlinkNode,
  type HyperlinkKind,
  type HyperlinkTarget,
  type RelationshipTargetResolver,
} from './hyperlink.ts';
