/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
export {
  LogicalIdAllocator,
  assertIndependentIdentity,
  createReplicaIdentity,
  isReplicaIdentity,
  mintLogicalId,
  wordFacingIdsOf,
  yjsItemKey,
  type LogicalId,
  type NodeIdentityMeta,
} from './identity.ts';
export {
  DEFAULT_DOCUMENT_LIMITS,
  DIGEST_PATTERN,
  mergeLimits,
  rejectBlobDescriptor,
  rejectDangerousKey,
  rejectPartName,
  rejectString,
  type DocumentLimits,
  type LimitCode,
} from './limits.ts';
export {
  PACKAGE_CANONICAL_MODEL_VERSION,
  PACKAGE_PROTOCOL_VERSION,
  PACKAGE_REPAIR_VERSION,
  PACKAGE_SHARED_SCHEMA_VERSION,
  PACKAGE_SCHEMA_VERSIONS,
  PACKAGE_BINARIES_KEY,
  PACKAGE_DEFAULTS_KEY,
  PACKAGE_META_KEY,
  PACKAGE_NODES_KEY,
  PACKAGE_OVERRIDES_KEY,
  PACKAGE_PARTS_KEY,
  PACKAGE_RELS_KEY,
  PACKAGE_NAMESPACES_KEY,
  PACKAGE_ATTRIBUTES_KEY,
  PACKAGE_BINDINGS_KEY,
  isElementRecord,
  isTextRecord,
  packageSchemaOf,
  type DirtyPaths,
  type ElementRecord,
  type EncodedAttribute,
  type EncodedBinding,
  type EncodedRelationship,
  type PackageSchema,
  type PartDirectoryEntry,
  type RepairIssue,
  type RepairIssueCode,
  type SharedRecord,
  type TextRecord,
} from './schema.ts';
export { DocumentRegistry } from './registry.ts';
export {
  MemoryBlobStore,
  seedPackage,
  sha256Digest,
  type BlobBytesStore,
  type SeedResult,
} from './seed.ts';
export {
  applyPrimitiveJournal,
  type ApplyJournalResult,
  type JournalRefusalCode,
} from './journal.ts';
export {
  PackageMaterializer,
  replaceChildRange,
  type MaterializeFailureCode,
  type MaterializeResult,
} from './materialize.ts';
