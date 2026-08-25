import { contentDigest, DIGEST_PATTERN } from './digest.ts';

/** Design D23 default blob ceiling. */
export const MAX_BLOB_BYTES = 32 * 1024 * 1024;

/** Temporary retention after a verified PUT, before persistence confirmation. */
export const LEASE_TTL_MS = 30_000;

/** Bounded GET retries before quarantine. */
export const MISSING_RETRY_LIMIT = 3;

export const BLOBS_MAP_KEY = 'blobs';

export const ALLOWED_MEDIA_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/bmp',
  'image/webp',
  'image/svg+xml',
  'image/tiff',
  'image/x-emf',
  'image/x-wmf',
  'application/octet-stream',
  'font/ttf',
  'font/otf',
]);

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export type BlobIssueCode =
  | 'invalid-blob-descriptor'
  | 'digest-mismatch'
  | 'size-mismatch'
  | 'blob-exceeds-policy'
  | 'unverified-blob-reference'
  | 'blob-bytes-pending'
  | 'blob-bytes-missing'
  | 'checkpoint-blob-missing'
  | 'lease-expired'
  | 'wrong-generation'
  | 'prototype-key'
  | 'unsafe-part-name'
  | 'external-fetch-forbidden';

export type PinReason =
  | 'lease'
  | 'pending-persist'
  | 'active-generation'
  | 'retained-generation'
  | 'checkpoint'
  | 'offline-frame';

export interface BlobDescriptor {
  readonly digest: string;
  readonly size: number;
  readonly mediaType: string;
  readonly storageKey: string;
}

export interface BlobLease {
  readonly leaseId: string;
  readonly digest: string;
  readonly actorId: string;
  readonly expiresAt: number;
}

export interface DescriptorPin {
  readonly digest: string;
  readonly reason: PinReason;
  readonly token: string;
}

export type SpikeFailure = { readonly ok: false; readonly code: BlobIssueCode };
/** Success with no payload beyond `ok`. */
export type EmptySpikeSuccess = { readonly ok: true };
export type EmptySpikeResult = EmptySpikeSuccess | SpikeFailure;
export type SpikeSuccess<T> = { readonly ok: true } & T;
export type SpikeResult<T> = SpikeSuccess<T> | SpikeFailure;

/**
 * Exact publication and retention contract proved by this spike.
 * Bytes stay outside Yjs. A verified PUT leases first. A reference may
 * commit only after that lease. Persistence confirmation converts the
 * lease into retained ownership. Garbage collection deletes a digest
 * only when no pin remains.
 */
export const BLOB_PUBLICATION_CONTRACT = Object.freeze({
  digestAlgorithm: 'sha256',
  digestPrefix: 'sha256:',
  storageKeyEqualsDigest: true,
  bytesOutsideYjs: true,
  uploadBeforeReference: true,
  verifyOnPut: true,
  leaseBeforeRoomRef: true,
  persistBeforeLeaseConvert: true,
  pendingPersistPinsAcrossLeaseExpiry: true,
  isolatedApplyIncludesPendingFrames: true,
  restartRebuildsPinsFromPersistedRefs: true,
  delayedBytesBlockMaterialize: true,
  missingBytesQuarantineAfterRetries: true,
  noExternalFetch: true,
  gcRequiresZeroPins: true,
  pinReasons: [
    'lease',
    'pending-persist',
    'active-generation',
    'retained-generation',
    'checkpoint',
    'offline-frame',
  ] as const satisfies readonly PinReason[],
  maxBlobBytes: MAX_BLOB_BYTES,
  leaseTtlMs: LEASE_TTL_MS,
  missingRetryLimit: MISSING_RETRY_LIMIT,
});

export function describeBytes(bytes: Uint8Array, mediaType: string): BlobDescriptor {
  const digest = contentDigest(bytes);
  return { digest, size: bytes.byteLength, mediaType, storageKey: digest };
}

export function validatePartName(partName: string): EmptySpikeResult {
  if (FORBIDDEN_KEYS.has(partName)) return { ok: false, code: 'prototype-key' };
  if (
    partName.length === 0 ||
    partName.includes('..') ||
    partName.includes('\0') ||
    partName.startsWith('/') ||
    partName.startsWith('\\')
  ) {
    return { ok: false, code: 'unsafe-part-name' };
  }
  return { ok: true };
}

export function validateDescriptor(descriptor: BlobDescriptor): EmptySpikeResult {
  for (const key of Object.keys(descriptor)) {
    if (FORBIDDEN_KEYS.has(key)) return { ok: false, code: 'prototype-key' };
  }
  if (!DIGEST_PATTERN.test(descriptor.digest)) {
    return { ok: false, code: 'invalid-blob-descriptor' };
  }
  if (descriptor.storageKey !== descriptor.digest) {
    if (/^(https?|javascript|data|file|blob):/i.test(descriptor.storageKey)) {
      return { ok: false, code: 'external-fetch-forbidden' };
    }
    return { ok: false, code: 'invalid-blob-descriptor' };
  }
  if (!Number.isInteger(descriptor.size) || descriptor.size < 1) {
    return { ok: false, code: 'invalid-blob-descriptor' };
  }
  if (descriptor.size > MAX_BLOB_BYTES) {
    return { ok: false, code: 'blob-exceeds-policy' };
  }
  if (!ALLOWED_MEDIA_TYPES.has(descriptor.mediaType)) {
    return { ok: false, code: 'blob-exceeds-policy' };
  }
  return { ok: true };
}

export function parseDescriptor(raw: unknown): SpikeResult<{ descriptor: BlobDescriptor }> {
  if (typeof raw !== 'string') return { ok: false, code: 'invalid-blob-descriptor' };
  let parsed: unknown;
  let sawPrototypeKey = false;
  try {
    parsed = JSON.parse(raw, (key, value) => {
      if (FORBIDDEN_KEYS.has(key)) sawPrototypeKey = true;
      return value;
    });
  } catch {
    return { ok: false, code: 'invalid-blob-descriptor' };
  }
  if (sawPrototypeKey) return { ok: false, code: 'prototype-key' };
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, code: 'invalid-blob-descriptor' };
  }
  const record = parsed as Record<string, unknown>;
  if (
    typeof record.digest !== 'string' ||
    typeof record.size !== 'number' ||
    typeof record.mediaType !== 'string' ||
    typeof record.storageKey !== 'string'
  ) {
    return { ok: false, code: 'invalid-blob-descriptor' };
  }
  const descriptor: BlobDescriptor = {
    digest: record.digest,
    size: record.size,
    mediaType: record.mediaType,
    storageKey: record.storageKey,
  };
  const valid = validateDescriptor(descriptor);
  if (!valid.ok) return valid;
  return { ok: true, descriptor };
}

export function encodeDescriptor(descriptor: BlobDescriptor): string {
  return JSON.stringify({
    digest: descriptor.digest,
    size: descriptor.size,
    mediaType: descriptor.mediaType,
    storageKey: descriptor.storageKey,
  });
}

export function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.byteLength === 0 || needle.byteLength > haystack.byteLength) return false;
  for (let index = 0; index <= haystack.byteLength - needle.byteLength; index += 1) {
    let matched = true;
    for (let offset = 0; offset < needle.byteLength; offset += 1) {
      if (haystack[index + offset] !== needle[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}
