/** @spike-features yjs-backend */
import yjsSchema from '../../../oracles/yjs-schema.v1.json';

export const YJS_BACKEND_VERSION = yjsSchema.backendVersion;
export const YJS_SCHEMA_VERSION = yjsSchema.schemaVersion;
export const YJS_NORMALIZATION_VERSION = yjsSchema.normalizationVersion;
export const YJS_SEED_ACTOR = 'actor-seed';
export const YJS_SNAPSHOT_KIND = 'yjs-backend-snapshot/2';
export const YJS_MAX_UPDATE_BYTES = 256 * 1024;
export const YJS_MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;
export const YJS_MAX_PENDING_UPDATES = 32;
export const YJS_MAX_PENDING_UPDATE_BYTES = 512 * 1024;
export const YJS_MAX_PENDING_UPDATES_PER_SOURCE = 8;
export const YJS_MAX_PENDING_BYTES_PER_SOURCE = 128 * 1024;
export const YJS_MAX_RESEED_JOURNAL_ENTRIES = 8;
export const YJS_MAX_RESEED_JOURNAL_BYTES = 1024 * 1024;
export const YJS_MAX_SPLIT_TAIL_JOURNAL_ENTRIES = 256;
export const YJS_MAX_CONTRIBUTIONS_PER_TEXT = 64;
