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
  type ZipRejection,
  type ZipLimits,
  type ZipReadResult,
  DEFAULT_ZIP_LIMITS,
  readZip,
  writeZip,
} from './zip.ts';
export {
  type DocxParseRejection,
  type ParseResult,
  type ParseOptions,
  parseDocx,
  isPlainEditableDocx,
  isModelBodyPatchable,
  diagnoseBodyPatchability,
  type ReadOnlyDiagnostic,
  type BodyPatchability,
} from './docx/read.ts';
export { isRunPropertiesCapsule } from './preservation-capsule.ts';
export { writeDocx, documentXml } from './docx/write.ts';
// Package-level fidelity comparators (3.6): exact uncompressed XML-part range comparator +
// semantic ZIP-container comparator (permits recompression ephemera, flags unowned changes).
export {
  compareXmlPartRanges,
  reassembleXmlPartRanges,
  compareZipContainers,
  type OwnedRange,
  type XmlPartRangeResult,
  type ZipContainerResult,
} from './package-comparator.ts';
// Feature-lane contract: register a new top-level block kind's element parser without editing a
// central switch. The parse registry now lives in the unified block-capability module (model),
// re-exported here for the package-facing feature-lane API.
export {
  type BlockElementParser,
  registerBlockElementParser,
  blockElementParser,
} from '../model/index.ts';
export {
  isValidNCName,
  isValidQName,
  assertValidQName,
  PrefixAllocator,
} from './qname.ts';
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
