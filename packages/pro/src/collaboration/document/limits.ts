/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { isDangerousKey, normalizePartName } from '@docx-editor.dev/core/store';

/** Finite resource limits for shared package state. Every value is attacker-controlled. */
export interface DocumentLimits {
  readonly maxNodes: number;
  readonly maxTreeDepth: number;
  readonly maxTextLength: number;
  readonly maxAttributes: number;
  readonly maxChildren: number;
  readonly maxParts: number;
  readonly maxRelationships: number;
  readonly maxBlobBytes: number;
  readonly maxDigestLength: number;
  readonly maxMediaTypeLength: number;
  readonly maxStorageKeyLength: number;
  readonly maxStringLength: number;
}

export const DEFAULT_DOCUMENT_LIMITS: DocumentLimits = Object.freeze({
  maxNodes: 200_000,
  maxTreeDepth: 256,
  maxTextLength: 1_048_576,
  maxAttributes: 4096,
  maxChildren: 100_000,
  maxParts: 512,
  maxRelationships: 10_000,
  maxBlobBytes: 32 * 1024 * 1024,
  maxDigestLength: 80,
  maxMediaTypeLength: 256,
  maxStorageKeyLength: 512,
  maxStringLength: 4096,
});

export const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

export type LimitCode =
  | 'prototype-key'
  | 'unsafe-part-name'
  | 'too-many-nodes'
  | 'tree-too-deep'
  | 'text-too-long'
  | 'too-many-attributes'
  | 'too-many-children'
  | 'too-many-parts'
  | 'too-many-relationships'
  | 'blob-too-large'
  | 'invalid-blob-descriptor'
  | 'invalid-logical-id'
  | 'unknown-logical-id'
  | 'invalid-bound'
  | 'invalid-string';

export function mergeLimits(overrides?: Partial<DocumentLimits>): DocumentLimits {
  if (!overrides) return DEFAULT_DOCUMENT_LIMITS;
  return Object.freeze({ ...DEFAULT_DOCUMENT_LIMITS, ...overrides });
}

export function rejectDangerousKey(key: string): LimitCode | null {
  return isDangerousKey(key) ? 'prototype-key' : null;
}

export function rejectString(value: string, max: number): LimitCode | null {
  if (typeof value !== 'string') return 'invalid-string';
  if (value.length > max) return 'invalid-string';
  if (isDangerousKey(value)) return 'prototype-key';
  return null;
}

/** OPC part names must be absolute and must not traverse. */
export function rejectPartName(partName: string): LimitCode | null {
  const dangerous = rejectDangerousKey(partName);
  if (dangerous) return dangerous;
  if (typeof partName !== 'string' || partName.length === 0) return 'unsafe-part-name';
  const normalized = normalizePartName(partName);
  if (!normalized.ok) return 'unsafe-part-name';
  if (normalized.partName !== partName) return 'unsafe-part-name';
  return null;
}

export function rejectBlobDescriptor(fields: {
  readonly digest: string;
  readonly size: number;
  readonly mediaType: string;
  readonly storageKey: string;
}): LimitCode | null {
  for (const key of Object.keys(fields)) {
    const dangerous = rejectDangerousKey(key);
    if (dangerous) return dangerous;
  }
  if (!DIGEST_PATTERN.test(fields.digest) || fields.digest.length > 80) {
    return 'invalid-blob-descriptor';
  }
  if (!Number.isSafeInteger(fields.size) || fields.size < 0) return 'invalid-blob-descriptor';
  if (fields.size > DEFAULT_DOCUMENT_LIMITS.maxBlobBytes) return 'blob-too-large';
  if (
    rejectString(fields.mediaType, DEFAULT_DOCUMENT_LIMITS.maxMediaTypeLength) ||
    fields.mediaType.length === 0
  ) {
    return 'invalid-blob-descriptor';
  }
  if (
    rejectString(fields.storageKey, DEFAULT_DOCUMENT_LIMITS.maxStorageKeyLength) ||
    fields.storageKey.length === 0
  ) {
    return 'invalid-blob-descriptor';
  }
  return null;
}
