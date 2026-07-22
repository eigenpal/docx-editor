/** @spike-features fixture-comparators */
export { compareXmlPartRange, XML_PART_RANGE_COMPARATOR_VERSION } from './xml-part-range';
export { compareSemanticZip, SEMANTIC_ZIP_COMPARATOR_VERSION } from './semantic-zip';
export {
  compareCanonicalState,
  validateCanonicalState,
  CANONICAL_STATE_COMPARATOR_VERSION,
} from './canonical-state';
export {
  compareYjsSchema,
  fingerprintYjsSchema,
  validateDecodedYjsModel,
  YJS_SCHEMA_FINGERPRINT_COMPARATOR_VERSION,
} from './yjs-schema-fingerprint';
export {
  comparePaginationFingerprint,
  PAGINATION_FINGERPRINT_COMPARATOR_VERSION,
} from './pagination-fingerprint';
export { compareCounterCeilings, COUNTER_CEILINGS_COMPARATOR_VERSION } from './counter-ceilings';
