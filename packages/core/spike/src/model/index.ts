/** @spike-features one-body-story, paragraphs, text, bold-mark, italic-mark, stable-paragraph-ids, one-preservation-capsule, synthetic-128-paragraph-fixture */
export type {
  AuthoredBodyStory,
  AuthoredBodyStoryInput,
  AuthoredMark,
  AuthoredMarkKind,
  AuthoredPackageModel,
  AuthoredPackageModelInput,
  AuthoredParagraph,
  DocumentModel,
  ImmutableLookup,
  ModelRevision,
  UnsupportedCapsule,
} from './types';
export type { AuthoredProperty } from './authored-property';
export {
  freezeAuthoredProperty,
  freezeAuthoredProperties,
  isValidAuthoredProperty,
  isUnsafeAuthoredPropertyName,
  rejectsResolvedOrCacheAuthoredPropertyName,
} from './authored-property';
export { validateAuthoredPackage, validateDocumentModel } from './validators';
export { createDocumentModel, createFrozenAuthoredFixture, createFrozenAuthoredPackage } from './fixture';
export { fingerprintAuthoredModel, authoredFingerprintPayload } from './fingerprint';
export type { AuthoredFingerprintPayload } from './fingerprint';
export {
  canReuseResolvedCache,
  createResolvedModelCache,
  RESOLVED_STYLE_LIMITS,
  type ResolvedCacheProvenance,
  type ResolvedCacheEntry,
  type ResolvedModelCache,
  type ResolvedParagraphStyle,
} from './resolved-cache';
