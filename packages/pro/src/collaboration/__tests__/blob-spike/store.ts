/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import {
  describeBytes,
  LEASE_TTL_MS,
  MAX_BLOB_BYTES,
  type BlobDescriptor,
  type BlobLease,
  type SpikeResult,
  validateDescriptor,
} from './contract.ts';
import { contentDigest } from './digest.ts';

export interface CollectHooks {
  readonly afterEligible?: (digest: string) => void;
}

export interface VisibleBlob {
  readonly descriptor: BlobDescriptor;
  readonly bytes: Uint8Array;
}

type StoredBlob = {
  descriptor: BlobDescriptor;
  bytes: Uint8Array;
};

export class BlobStore {
  private readonly blobs = new Map<string, StoredBlob>();
  private readonly hidden = new Set<string>();
  private readonly leases = new Map<string, BlobLease>();
  private leaseSeq = 0;

  put(
    bytes: Uint8Array,
    claimed: BlobDescriptor,
    actorId: string,
    now: number
  ): SpikeResult<{ lease: BlobLease; descriptor: BlobDescriptor }> {
    if (bytes.byteLength > MAX_BLOB_BYTES) {
      return { ok: false, code: 'blob-exceeds-policy' };
    }
    const actual = describeBytes(bytes, claimed.mediaType);
    const claimedValid = validateDescriptor(claimed);
    if (!claimedValid.ok) return claimedValid;
    if (claimed.size !== bytes.byteLength) return { ok: false, code: 'size-mismatch' };
    if (claimed.digest !== actual.digest) return { ok: false, code: 'digest-mismatch' };
    const existing = this.blobs.get(actual.digest);
    if (existing && existing.descriptor.mediaType !== claimed.mediaType) {
      return { ok: false, code: 'invalid-blob-descriptor' };
    }
    if (!existing) {
      this.blobs.set(actual.digest, {
        descriptor: actual,
        bytes: bytes.slice(),
      });
    }
    const lease = this.issueLease(actual.digest, actorId, now);
    return { ok: true, lease, descriptor: existing?.descriptor ?? actual };
  }

  get(digest: string): SpikeResult<{ state: 'visible'; blob: VisibleBlob } | { state: 'pending' }> {
    if (this.hidden.has(digest) && this.blobs.has(digest)) {
      return { ok: true, state: 'pending' };
    }
    const stored = this.blobs.get(digest);
    if (!stored) return { ok: false, code: 'blob-bytes-missing' };
    return {
      ok: true,
      state: 'visible',
      blob: { descriptor: stored.descriptor, bytes: stored.bytes.slice() },
    };
  }

  hasBytes(digest: string): boolean {
    return this.blobs.has(digest);
  }

  isVerified(digest: string): boolean {
    return this.blobs.has(digest);
  }

  hide(digest: string): void {
    this.hidden.add(digest);
  }

  reveal(digest: string): void {
    this.hidden.delete(digest);
  }

  /** Fault injector: lose object-store bytes while callers may still pin the digest. */
  dropBytes(digest: string): void {
    this.blobs.delete(digest);
    this.hidden.delete(digest);
  }

  liveLeases(digest: string, now: number): BlobLease[] {
    this.dropExpiredLeases(now);
    return [...this.leases.values()].filter((lease) => lease.digest === digest);
  }

  lease(leaseId: string, now: number): BlobLease | null {
    this.dropExpiredLeases(now);
    return this.leases.get(leaseId) ?? null;
  }

  dropExpiredLeases(now: number): void {
    for (const [leaseId, lease] of this.leases) {
      if (lease.expiresAt <= now) this.leases.delete(leaseId);
    }
  }

  collect(
    now: number,
    extraRequired: (digest: string) => boolean,
    hooks?: CollectHooks
  ): readonly string[] {
    this.dropExpiredLeases(now);
    const deleted: string[] = [];
    for (const digest of [...this.blobs.keys()]) {
      if (this.isRequired(digest, now, extraRequired)) continue;
      hooks?.afterEligible?.(digest);
      if (this.isRequired(digest, now, extraRequired)) continue;
      this.blobs.delete(digest);
      this.hidden.delete(digest);
      deleted.push(digest);
    }
    return deleted;
  }

  private isRequired(
    digest: string,
    now: number,
    extraRequired: (digest: string) => boolean
  ): boolean {
    return this.liveLeases(digest, now).length > 0 || extraRequired(digest);
  }

  private issueLease(digest: string, actorId: string, now: number): BlobLease {
    this.leaseSeq += 1;
    const lease: BlobLease = {
      leaseId: `lease:${actorId}:${digest}:${this.leaseSeq}`,
      digest,
      actorId,
      expiresAt: now + LEASE_TTL_MS,
    };
    this.leases.set(lease.leaseId, lease);
    return lease;
  }
}

export function actualDigest(bytes: Uint8Array): string {
  return contentDigest(bytes);
}
